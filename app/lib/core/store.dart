// App state: user items, settings, drafts, recordings, recents and stats, saved as JSON
// in the app's documents folder. Writes are debounced and atomic (write then rename).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'catalog.dart';
import 'model.dart';

class Store extends ChangeNotifier {
  Store._();
  static final Store i = Store._();

  late Directory dir;
  late Directory media;
  final List<Item> items = [];
  final Map<String, dynamic> settings = {};
  final List<Draft> drafts = [];
  final List<Rec> recs = [];
  final List<String> recents = [];
  final Set<String> likes = {};
  Map<String, dynamic> profile = {};
  Map<String, dynamic> stats = {'days': <String>[], 'seconds': 0, 'takes': 0};
  Timer? _saveT;

  static const defaults = <String, dynamic>{
    'bedVol': 70,
    'micGain': 0.0,
    'noiseCancel': false,
    'echoCancel': 'auto',
    'speakerMusic': 'clean',
    'sttModel': 'base',
    'sttLanguage': 'auto',
    'countdown': 3,
    'textSize': 34.0,
    'speed': 6,
    'facing': 'front',
    'mirrorCam': true,
    'bed': null,
    'saveToGallery': true,
  };

  T s<T>(String k) => (settings.containsKey(k) ? settings[k] : defaults[k]) as T;
  double sd(String k) => ((settings[k] ?? defaults[k] ?? 0) as num).toDouble();
  void set(String k, dynamic v) {
    settings[k] = v;
    save();
  }

  Future<void> load() async {
    final docs = await getApplicationDocumentsDirectory();
    dir = Directory('${docs.path}/lectern');
    media = Directory('${dir.path}/media');
    await media.create(recursive: true);
    final f = File('${dir.path}/state.json');
    if (await f.exists()) {
      try {
        final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
        items.addAll(((j['items'] as List?) ?? []).map((e) => Item.migrate((e as Map).cast<String, dynamic>())));
        settings.addAll(((j['settings'] as Map?) ?? {}).cast<String, dynamic>());
        // settings that only karaoke used
        for (final k in const ['karVol', 'guide', 'tapLat', 'lyrShow']) {
          settings.remove(k);
        }
        drafts.addAll(((j['drafts'] as List?) ?? []).map((e) => Draft((e as Map).cast<String, dynamic>())));
        recs.addAll(((j['recs'] as List?) ?? []).map((e) => Rec((e as Map).cast<String, dynamic>())));
        recents.addAll(((j['recents'] as List?) ?? []).map((e) => '$e'));
        likes.addAll(((j['likes'] as List?) ?? []).map((e) => '$e'));
        profile = ((j['profile'] as Map?) ?? {}).cast<String, dynamic>();
        stats = ((j['stats'] as Map?) ?? stats).cast<String, dynamic>();
      } catch (e) {
        debugPrint('state load failed: $e');
      }
    }
  }

  void save({bool now = false}) {
    // notify after the current frame work (saving can happen while widgets are being disposed)
    scheduleMicrotask(notifyListeners);
    _saveT?.cancel();
    if (now) {
      _write();
    } else {
      _saveT = Timer(const Duration(milliseconds: 400), _write);
    }
  }

  Future<void> _write() async {
    final j = jsonEncode({
      'items': items.map((e) => e.m).toList(),
      'settings': settings,
      'drafts': drafts.map((e) => e.m).toList(),
      'recs': recs.map((e) => e.m).toList(),
      'recents': recents,
      'likes': likes.toList(),
      'profile': profile,
      'stats': stats,
    });
    final tmp = File('${dir.path}/state.json.tmp');
    await tmp.writeAsString(j, flush: true);
    await tmp.rename('${dir.path}/state.json');
  }

  Item? find(String? id) {
    if (id == null) return null;
    for (final it in items) {
      if (it.id == id) return it;
    }
    return Catalog.i.get(id);
  }

  Item create(Kind kind) {
    final it = Item.create(kind, uid());
    items.add(it);
    save();
    return it;
  }

  void deleteItem(Item it) {
    items.removeWhere((x) => x.id == it.id);
    final f = it.m['file'] as String?;
    if (f != null) {
      try {
        File(mediaPath(f)).deleteSync();
      } catch (_) {}
    }
    recents.remove(it.id);
    save();
  }

  void played(Item it) {
    recents.remove(it.id);
    recents.insert(0, it.id);
    if (recents.length > 30) recents.removeRange(30, recents.length);
    save();
  }

  void toggleLike(String id) {
    if (!likes.remove(id)) likes.add(id);
    save();
  }

  String get firstName {
    final n = '${profile['name'] ?? ''}'.trim();
    return n.isEmpty ? '' : n.split(RegExp(r'\s+')).first;
  }

  bool get signedIn => profile['signedIn'] == true;

  static final _rnd = math.Random();
  static String uid() => DateTime.now().microsecondsSinceEpoch.toRadixString(36) + _rnd.nextInt(1 << 20).toRadixString(36);

  String mediaPath(String name) => '${media.path}/$name';
}
