// Keeps timing attached to the right words when lyrics are edited after they were timed,
// and finishes timing made by tapping (line ends and word timing).
import 'dart:math' as math;

import '../core/model.dart';
import 'timing.dart';

String timedSignature(Item it) => lyricLines(it.body).join('\n');

void markTimed(Item it, {bool keepAnch = false}) {
  it.timedText = timedSignature(it);
  if (!keepAnch) it.anch = null;
}

/// Line ends and word timing for line starts that were tapped or placed on the beat.
void finishTiming(Item it) {
  final lines = lyricLines(it.body);
  final t = fillTimes(it.times, lines.length, 0).t;
  final ends = estimateEnds(lines, t);
  it.ends = ends;
  final times = it.times;
  it.wt = [for (var i = 0; i < lines.length; i++) (i < times.length && times[i] != null) ? distributeWords(lines[i], t[i], ends[i]) : null];
}

/// Returns a message if the timing was re-aligned because the lyrics changed.
String? retimeIfLyricsChanged(Item it) {
  if (it.isCat || it.kind != Kind.song) return null;
  final cur = lyricLines(it.body);
  final curS = cur.join('\n');
  final hasT = it.times.any((v) => v != null && v.isFinite);
  if (it.timedText == null) {
    final gen = it.genText != null ? lyricLines(it.genText).join('\n') : null;
    if (!(gen != null && gen != curS && hasT)) {
      it.timedText = curS;
      return null;
    }
    it.timedText = gen;
  }
  if (it.timedText == curS) return null;
  if (!hasT || cur.isEmpty) {
    it.timedText = curS;
    return null;
  }
  final old = lyricLines(it.timedText);
  final times = it.times;
  final t = fillTimes(times, old.length, 0).t;
  final ends = it.ends;
  final wts = it.wt;
  final words = <HeardWord>[];
  for (var i = 0; i < old.length; i++) {
    if (i >= times.length || times[i] == null) continue;
    final ws = lineWords(old[i]);
    final nx = i + 1 < t.length ? t[i + 1] : t[i] + 6;
    final end = (i < ends.length && ends[i] > t[i]) ? ends[i] : math.min(nx - 0.05, t[i] + lineSyllables(old[i]) * 0.38 + 0.5);
    final w = (i < wts.length && wts[i] != null && wts[i]!.length == ws.length) ? wts[i]! : distributeWords(old[i], t[i], end);
    for (var k = 0; k < ws.length; k++) {
      words.add(HeardWord(ws[k], w[k].s, w[k].e));
    }
  }
  final heard = (it.sttWords != null && it.sttWords!.isNotEmpty) ? it.sttWords! : words;
  final r = heard.isNotEmpty ? alignLyricsToWords(cur, heard) : null;
  String msg;
  if (r != null && r.confidence >= 0.3) {
    it.times = r.times;
    it.ends = r.ends;
    it.wt = r.wt;
    it.anch = r.anchored;
    markTimed(it, keepAnch: true);
    msg = 'Lyrics changed, so the timing was re-aligned to your corrected lines';
  } else {
    it.times = [for (var i = 0; i < cur.length; i++) i < times.length ? times[i] : null];
    it.ends = [];
    it.wt = [];
    markTimed(it);
    msg = 'Lyrics changed a lot. Line timing kept; use Re-tap to fine-tune.';
  }
  it.touch();
  return msg;
}
