// Background jobs (transcription for lyric sync, lyrics from audio, clip to lines).
// The work runs in an Android foreground service (native/android/kotlin/JobService.kt) with its
// own notification, so it keeps going when the user moves around the app, leaves it, or the
// screen turns off. Jobs and their results are stored on disk: after a restart, unfinished jobs
// resume and finished results are applied to their song the next time the app runs.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../lyrics/retime.dart';
import '../lyrics/timing.dart';
import 'media.dart';
import 'model.dart';
import 'store.dart';

enum JobState { queued, downloading, running, done, error, cancelled }

class Job {
  final Map<String, dynamic> m;
  Job(this.m);
  String get id => '${m['id']}';
  String get itemId => '${m['itemId'] ?? ''}';
  String get purpose => '${m['purpose'] ?? 'sync'}';
  String get title => '${m['title'] ?? 'Transcription'}';
  String get phase => '${m['phase'] ?? ''}';
  String get error => '${m['error'] ?? ''}';
  int get progress => (m['progress'] as num?)?.toInt() ?? 0;
  bool get applied => m['applied'] == true;
  int get words => (m['words'] as num?)?.toInt() ?? 0;
  int get updated => (m['updated'] as num?)?.toInt() ?? 0;
  JobState get state => JobState.values.firstWhere((s) => s.name == m['state'], orElse: () => JobState.queued);
  bool get active => state == JobState.queued || state == JobState.downloading || state == JobState.running;
  String get label {
    switch (state) {
      case JobState.queued:
        return phase.isNotEmpty ? phase : 'Waiting';
      case JobState.downloading:
        return 'Downloading the speech model · $progress%';
      case JobState.running:
        return progress > 1 ? 'Listening · $progress%' : (phase.isNotEmpty ? phase : 'Preparing');
      case JobState.done:
        return words > 0 ? 'Ready · $words words' : 'Finished';
      case JobState.error:
        return 'Failed: $error';
      case JobState.cancelled:
        return 'Cancelled';
    }
  }
}

class Jobs extends ChangeNotifier {
  Jobs._();
  static final Jobs i = Jobs._();
  static const _ch = MethodChannel('lectern/engine');
  static const _ev = EventChannel('lectern/jobs');

  List<Job> jobs = [];
  StreamSubscription? _sub;
  final _opens = StreamController<Job>.broadcast();
  final _finished = StreamController<Job>.broadcast();
  final Set<String> _applying = {};

  /// A notification was tapped: open this job's result.
  Stream<Job> get opens => _opens.stream;

  /// A job finished and its result was applied (for a toast with an Open action).
  Stream<Job> get finished => _finished.stream;

  Future<void> init() async {
    _sub ??= _ev.receiveBroadcastStream().listen((e) {
      if (e is! Map) return;
      if (e['jobs'] is List) _set(e['jobs'] as List);
      if (e['open'] != null) _open('${e['open']}');
    }, onError: (_) {});
    await refresh();
    try {
      final open = await _ch.invokeMethod<String>('jobs.takeOpen');
      if (open != null) _open(open);
    } catch (_) {}
  }

  Future<void> refresh() async {
    try {
      _set(await _ch.invokeListMethod<dynamic>('jobs.list') ?? []);
    } catch (e) {
      debugPrint('jobs: $e');
    }
  }

  void _set(List l) {
    jobs = l.map((x) => Job(Map<String, dynamic>.from(x as Map))).toList()..sort((a, b) => b.updated.compareTo(a.updated));
    notifyListeners();
    for (final j in jobs) {
      if (j.state == JobState.done && !j.applied) _apply(j);
    }
  }

  void _open(String id) {
    Job? j;
    for (final x in jobs) {
      if (x.id == id) j = x;
    }
    if (j != null) {
      _opens.add(j);
    } else {
      // the list isn't loaded yet: try again once it is
      refresh().then((_) {
        for (final x in jobs) {
          if (x.id == id) _opens.add(x);
        }
      });
    }
  }

  Job? forItem(String itemId) {
    for (final j in jobs) {
      if (j.itemId == itemId && (j.active || (j.state == JobState.error))) return j;
    }
    return null;
  }

  List<Job> get visible => jobs.where((j) => j.active || j.state == JobState.error || (j.state == JobState.done && DateTime.now().millisecondsSinceEpoch - j.updated < 10 * 60 * 1000)).toList();

  /// Starts (or returns the already running) transcription job for an item.
  Future<String?> transcribe({required Item item, required String purpose, required MusicSource src, required String title, required String modelPath, required String modelUrl, required String language}) async {
    final id = await _ch.invokeMethod<String>('jobs.enqueue', {
      'job': {
        'id': '${item.id}-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}',
        'kind': 'transcribe',
        'itemId': item.id,
        'purpose': purpose,
        'title': title,
        'asset': src.asset ?? '',
        'path': src.path ?? '',
        'url': src.url ?? '',
        'model': modelPath,
        'modelUrl': modelUrl,
        'language': language,
      }
    });
    await refresh();
    return id;
  }

  Future<void> cancel(Job j) => _ch.invokeMethod('jobs.cancel', {'id': j.id});
  Future<void> retry(Job j) async {
    await _ch.invokeMethod('jobs.retry', {'id': j.id});
    await refresh();
  }

  Future<void> remove(Job j) async {
    await _ch.invokeMethod('jobs.remove', {'id': j.id});
    await refresh();
  }

  /// Applies a finished transcription to its item (once; survives restarts).
  Future<void> _apply(Job j) async {
    if (_applying.contains(j.id)) return;
    _applying.add(j.id);
    try {
      final s = await _ch.invokeMethod<String>('jobs.result', {'id': j.id});
      final it = Store.i.find(j.itemId);
      if (s != null && it != null && !it.isCat) {
        final r = jsonDecode(s) as Map<String, dynamic>;
        applyTranscript(it, r, j.purpose);
        it.touch();
        Store.i.save(now: true);
      }
      await _ch.invokeMethod('jobs.applied', {'id': j.id});
      j.m['applied'] = true;
      notifyListeners();
      _finished.add(j);
    } catch (e) {
      debugPrint('apply job ${j.id}: $e');
    } finally {
      _applying.remove(j.id);
    }
  }
}

/// Puts a transcript ({words:[{text,start,end}], vad:[[s,e]], lang}) onto an item:
///  - purpose "sync": times the item's own lyrics (imported/pasted) word by word
///  - purpose "generate" (or no lyrics yet): the lyrics become what was heard, with timing
///  - purpose "clip": a movie line / script gets the spoken text (no timing needed)
void applyTranscript(Item it, Map<String, dynamic> r, String purpose) {
  final words = ((r['words'] as List?) ?? [])
      .map((w) => HeardWord.fromJson(w))
      .where((w) => w.text.trim().isNotEmpty && w.start.isFinite && w.end.isFinite)
      .toList();
  final vad = ((r['vad'] as List?) ?? []).whereType<List>().where((x) => x.length == 2).map((x) => [(x[0] as num).toDouble(), (x[1] as num).toDouble()]).toList();
  if (purpose == 'clip') {
    final g = wordsToLines(words);
    it.body = g.lines.join('\n');
    return;
  }
  it.sttWords = words;
  it.m['vad'] = vad;
  it.m['stt'] = {'lang': r['lang'], 'refined': r['refined'], 'at': DateTime.now().millisecondsSinceEpoch};
  final lines = lyricLines(it.body);
  if (words.isEmpty) return;
  if (purpose == 'generate' || lines.isEmpty) {
    final g = wordsToLines(words);
    it.body = g.lines.join('\n');
    it.times = g.times;
    it.ends = g.ends;
    it.wt = g.wt;
    it.genText = it.body;
    it.anch = List<bool>.filled(g.lines.length, true);
    if (it.rawTitle.trim().isEmpty && g.lines.isNotEmpty) it.title = g.lines.first.replaceAll(RegExp(r'[,.!?]+$'), '');
  } else {
    final a = alignLyricsToWords(lines, words);
    it.times = a.times;
    it.ends = a.ends;
    it.wt = a.wt;
    it.anch = a.anchored;
    it.m['confidence'] = a.confidence;
  }
  markTimed(it, keepAnch: true);
  it.refined = 0;
}
