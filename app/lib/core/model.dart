// Performance projects (poems, movie lines/scenes, scripts, spoken lyrics), music, takes.
// Items keep their data in a JSON map so catalogue entries and user items share one shape.
import 'dart:ui' show Color;

import 'text.dart';

enum Kind { poem, line, script, lyrics, inst }

Kind kindOf(String? k) {
  switch (k) {
    case 'poem':
      return Kind.poem;
    case 'line':
      return Kind.line;
    case 'inst':
      return Kind.inst;
    case 'lyrics':
    case 'song': // karaoke songs from older versions are now spoken-word lyrics
      return Kind.lyrics;
    default:
      return Kind.script;
  }
}

String kindLabel(Kind k) => const {
      Kind.poem: 'Poem',
      Kind.line: 'Movie line',
      Kind.script: 'Script',
      Kind.lyrics: 'Lyrics',
      Kind.inst: 'Instrumental',
    }[k]!;

double? _d(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse('$v'));

/// Keys karaoke used to store; removed when an older item is loaded.
const _karaokeKeys = ['times', 'ends', 'wt', 'timedText', 'anch', 'sttWords', 'refined', 'genText', 'vad', 'stt', 'confidence', 'offset', 'audioGuide'];

class Item {
  final Map<String, dynamic> m;
  Item(this.m);
  factory Item.create(Kind kind, String id) => Item({
        'id': id,
        'kind': kind.name,
        'title': '',
        'body': '',
        'updated': DateTime.now().millisecondsSinceEpoch,
      });

  /// Brings an item saved by an older version up to date (karaoke data dropped, text kept).
  static Item migrate(Map<String, dynamic> m) {
    if (m['kind'] == 'song') m['kind'] = 'lyrics';
    for (final k in _karaokeKeys) {
      m.remove(k);
    }
    return Item(m);
  }

  String get id => '${m['id']}';
  Kind get kind => kindOf(m['kind'] as String?);
  bool get isCat => m['cat'] == true;
  String get title => (m['title'] as String?)?.trim().isNotEmpty == true ? m['title'] as String : 'Untitled ${kindLabel(kind).toLowerCase()}';
  set title(String v) => m['title'] = v;
  String get rawTitle => (m['title'] as String?) ?? '';
  String get body => (m['body'] as String?) ?? '';
  set body(String v) => m['body'] = v;
  String get sub => (m['sub'] as String?) ?? (m['artist'] as String?) ?? kindLabel(kind);
  double get dur => _d(m['dur']) ?? 0;
  set dur(double v) => m['dur'] = v;
  String? get audioAsset => m['audio'] as String?;
  String? get url => m['url'] as String?;
  int get updated => (m['updated'] as num?)?.toInt() ?? 0;
  void touch() => m['updated'] = DateTime.now().millisecondsSinceEpoch;

  /// Background music: {type:'file'|'inst'|'asset', path|id|asset, name}
  Map<String, dynamic>? get music => (m['music'] as Map?)?.cast<String, dynamic>();
  set music(Map<String, dynamic>? v) => m['music'] = v;

  MusicSettings get musicSettings => MusicSettings((m['musicSettings'] as Map?)?.cast<String, dynamic>() ?? {});
  set musicSettings(MusicSettings v) => m['musicSettings'] = v.m;
  ScriptStyle get style => ScriptStyle((m['style'] as Map?)?.cast<String, dynamic>() ?? {});
  set style(ScriptStyle v) => m['style'] = v.m;
  PrompterSettings get prompter => PrompterSettings((m['prompter'] as Map?)?.cast<String, dynamic>() ?? {});
  set prompter(PrompterSettings v) => m['prompter'] = v.m;

  List<String> get lines => scriptLines(body);
  List<Section> get sections => parseSections(body);

  Map<String, dynamic> toJson() => m;
}

/// How the music plays under a performance.
class MusicSettings {
  final Map<String, dynamic> m;
  MusicSettings(this.m);
  double _g(String k, double d) => _d(m[k]) ?? d;
  double get volume => _g('volume', 0.8); // what the performer hears (0..1)
  double get trimStart => _g('trimStart', 0);
  double get trimEnd => _g('trimEnd', 0); // 0 = to the end
  bool get loop => m['loop'] != false;
  double get fadeIn => _g('fadeIn', 1.5);
  double get fadeOut => _g('fadeOut', 3);
  bool get duck => m['duck'] != false;
  double get duckDb => _g('duckDb', 9); // how much quieter the music gets under the voice
  double get balanceDb => _g('balanceDb', 0); // music level in the finished video, relative to the default
  MusicSettings copyWith(Map<String, dynamic> c) => MusicSettings({...m, ...c});
}

/// How the script looks on the teleprompter (and in an optional overlay).
class ScriptStyle {
  final Map<String, dynamic> m;
  ScriptStyle(this.m);
  static const fonts = {'sans-serif': 'Sans', 'serif': 'Serif', 'sans-serif-condensed': 'Condensed', 'monospace': 'Mono', 'casual': 'Casual', 'cursive': 'Script'};
  String get font => (m['font'] as String?) ?? 'sans-serif';
  double get size => _d(m['size']) ?? 34;
  int get weight => (m['weight'] as num?)?.toInt() ?? 700;
  Color get color => Color((m['color'] as num?)?.toInt() ?? 0xFFFFFFFF);
  Color get background => Color((m['background'] as num?)?.toInt() ?? 0xFF000000);
  double get backgroundOpacity => _d(m['backgroundOpacity']) ?? 0.35;
  Color get highlight => Color((m['highlight'] as num?)?.toInt() ?? 0xFFEC4899);
  String get align => (m['align'] as String?) ?? 'center'; // left | center | right
  double get lineHeight => _d(m['lineHeight']) ?? 1.35;
  double get paragraphSpacing => _d(m['paragraphSpacing']) ?? 22;
  bool get shadow => m['shadow'] != false;
  bool get outline => m['outline'] == true;
  ScriptStyle copyWith(Map<String, dynamic> c) => ScriptStyle({...m, ...c});
}

/// Teleprompter behaviour while rehearsing and recording.
class PrompterSettings {
  final Map<String, dynamic> m;
  PrompterSettings(this.m);
  bool get autoScroll => m['autoScroll'] != false;
  double get speed => _d(m['speed']) ?? 6; // 1..20
  bool get mirror => m['mirror'] == true;
  double get readingLine => _d(m['readingLine']) ?? 0.33; // where the eyes rest, fraction of the area from the top
  String get position => (m['position'] as String?) ?? 'center'; // top | center | bottom
  double get areaHeight => _d(m['areaHeight']) ?? 0.55; // fraction of the screen
  double get opacity => _d(m['opacity']) ?? 1.0;
  bool get showWhileRecording => m['showWhileRecording'] != false;
  PrompterSettings copyWith(Map<String, dynamic> c) => PrompterSettings({...m, ...c});
}

/// A recorded take kept as a draft until it is saved or discarded.
class Draft {
  final Map<String, dynamic> m;
  Draft(this.m);
  String get id => '${m['id']}';
  String get title => (m['title'] as String?) ?? 'Take';
  String get video => '${m['video']}';
  /// Voice recording (32-bit float WAV) and the music heard during the take (16-bit WAV).
  String? get voice => (m['voice'] ?? m['stem']) as String?;
  String? get music => m['music'] as String?;
  String? get mix => m['mix'] as String?;
  String? get itemId => m['itemId'] as String?;
  double get dur => _d(m['dur']) ?? 0;
  int get created => (m['created'] as num?)?.toInt() ?? 0;
  Map<String, dynamic> get meta => ((m['meta'] as Map?) ?? {}).cast<String, dynamic>();
  Map<String, dynamic> get edit => ((m['edit'] as Map?) ?? {}).cast<String, dynamic>();
  set edit(Map<String, dynamic> v) => m['edit'] = v;
}

/// A finished, saved recording.
class Rec {
  final Map<String, dynamic> m;
  Rec(this.m);
  String get id => '${m['id']}';
  String get title => (m['title'] as String?) ?? 'Take';
  String get path => '${m['path']}';
  double get dur => _d(m['dur']) ?? 0;
  int get created => (m['created'] as num?)?.toInt() ?? 0;
  String? get thumb => m['thumb'] as String?;
}
