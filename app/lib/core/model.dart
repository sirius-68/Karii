// Items (songs, poems, movie lines, scripts, instrumentals), takes and drafts.
// Items keep their data in a JSON map so catalogue entries and user items share one shape.
import '../lyrics/timing.dart';

enum Kind { song, poem, line, script, inst }

Kind kindOf(String? k) {
  switch (k) {
    case 'song':
      return Kind.song;
    case 'poem':
      return Kind.poem;
    case 'line':
      return Kind.line;
    case 'inst':
      return Kind.inst;
    default:
      return Kind.script;
  }
}

String kindLabel(Kind k) => const {
      Kind.song: 'Karaoke',
      Kind.poem: 'Poem',
      Kind.line: 'Movie line',
      Kind.script: 'Script',
      Kind.inst: 'Instrumental',
    }[k]!;

double? _d(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse('$v'));

class Item {
  final Map<String, dynamic> m;
  Item(this.m);
  factory Item.create(Kind kind, String id) => Item({
        'id': id,
        'kind': kind.name,
        'title': '',
        'body': '',
        'updated': DateTime.now().millisecondsSinceEpoch,
        if (kind == Kind.song) 'times': <double?>[],
        if (kind == Kind.song) 'offset': 0.0,
      });

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
  String? get audioGuideAsset => m['audioGuide'] as String?;
  String? get url => m['url'] as String?;
  double get offset => _d(m['offset']) ?? 0;
  set offset(double v) => m['offset'] = v;
  int get updated => (m['updated'] as num?)?.toInt() ?? 0;
  void touch() => m['updated'] = DateTime.now().millisecondsSinceEpoch;

  /// Music attached to a user song: {type:'file', path, name, dur} | {type:'inst', id} | {type:'cat', id}
  Map<String, dynamic>? get music => (m['music'] as Map?)?.cast<String, dynamic>();
  set music(Map<String, dynamic>? v) => m['music'] = v;

  List<double?> get times => ((m['times'] as List?) ?? const []).map((v) => _d(v)).toList();
  set times(List<double?> v) => m['times'] = v;
  List<double> get ends => ((m['ends'] as List?) ?? const []).map((v) => _d(v) ?? 0).toList();
  set ends(List<double> v) => m['ends'] = v;
  List<List<WordTime>?> get wt => ((m['wt'] as List?) ?? const [])
      .map((l) => l == null ? null : (l as List).map((w) => WordTime.fromJson(w)).toList())
      .toList();
  set wt(List<List<WordTime>?> v) => m['wt'] = v.map((l) => l?.map((w) => w.toJson()).toList()).toList();
  bool get hasTiming => times.any((t) => t != null);

  String? get timedText => m['timedText'] as String?;
  set timedText(String? v) => m['timedText'] = v;
  List<bool>? get anch => (m['anch'] as List?)?.map((v) => v == true).toList();
  set anch(List<bool>? v) => m['anch'] = v;
  List<HeardWord>? get sttWords => (m['sttWords'] as List?)?.map((w) => HeardWord.fromJson(w)).toList();
  set sttWords(List<HeardWord>? v) => m['sttWords'] = v?.map((w) => w.toJson()).toList();
  int get refined => (m['refined'] as num?)?.toInt() ?? 0;
  set refined(int v) => m['refined'] = v;
  String? get genText => m['genText'] as String?;
  set genText(String? v) => m['genText'] = v;

  List<String> get lines => lyricLines(body);
  bool get timed => kind == Kind.song;

  Map<String, dynamic> toJson() => m;
}

/// A recorded take kept as a draft until it is saved or discarded.
class Draft {
  final Map<String, dynamic> m;
  Draft(this.m);
  String get id => '${m['id']}';
  String get title => (m['title'] as String?) ?? 'Take';
  String get video => '${m['video']}';
  /// Voice recording (32-bit float WAV) and, for clean mixes, the music the singer heard.
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
