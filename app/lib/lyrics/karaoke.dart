// Karaoke sync engine.
//
// One rule: what is highlighted is a pure function of the audio clock. There is no timer, no
// animation clock and no state carried from frame to frame, so seeking, pausing, speed changes,
// interruptions and long songs can't make the lyrics drift: every frame asks "the listener hears
// second t of the song; which word is that?".
//
// Every lyric source (catalogue timing, tap sync, AI sync, lyrics generated from audio, lyrics
// edited after timing) is normalised into the same LyricTrack: ordered lines of ordered words,
// each with a start and an end, all finite, never overlapping. Bad or missing data is repaired
// here, once, instead of breaking the stage.
import 'dart:math' as math;

import '../core/model.dart';
import 'retime.dart';
import 'timing.dart';

class LWord {
  final String text;
  final double s, e;
  const LWord(this.text, this.s, this.e);
}

class LLine {
  final String text;
  final List<LWord> words;
  final bool estimated; // no timing for this line: placed between its neighbours
  const LLine(this.text, this.words, this.estimated);
  double get s => words.isEmpty ? 0 : words.first.s;
  double get e => words.isEmpty ? 0 : words.last.e;
}

class LyricState {
  /// Line being sung (or the last one sung); -1 before the first word.
  final int line;
  /// Line shown as the current line (the upcoming one during gaps and the intro).
  final int show;
  /// Per-word fill (0..1) of the `show` line.
  final List<double> fill;
  /// Index of the word being sung in `line` (-1 when none).
  final int word;
  /// Before the first word.
  final bool intro;
  /// Between lines (nothing is being sung).
  final bool gap;
  final String? hint;
  /// Countdown dots before a line that follows a long pause (0 = none).
  final int dots;
  const LyricState(this.line, this.show, this.fill, this.word, this.intro, this.gap, this.hint, this.dots);
}

class LyricTrack {
  final List<LLine> lines;
  final bool synced;
  final double duration;
  final String signature;
  // flattened word starts for binary search
  final List<double> _starts;
  final List<int> _lineOf, _wordOf;

  LyricTrack._(this.lines, this.synced, this.duration, this.signature)
      : _starts = [for (final l in lines) for (final w in l.words) w.s],
        _lineOf = [for (var i = 0; i < lines.length; i++) for (var k = 0; k < lines[i].words.length; k++) i],
        _wordOf = [for (var i = 0; i < lines.length; i++) for (var k = 0; k < lines[i].words.length; k++) k];

  static final empty = LyricTrack._(const [], false, 0, '');

  int get length => lines.length;
  double get firstStart => _starts.isEmpty ? 0 : _starts.first;

  /// Builds the track for an item. Lyrics edited since they were timed are re-aligned first.
  factory LyricTrack.of(Item it, double duration) {
    retimeIfLyricsChanged(it);
    final vad = (it.m['vad'] as List?)
        ?.map((r) => (r is List && r.length == 2 && r[0] is num && r[1] is num) ? [(r[0] as num).toDouble(), (r[1] as num).toDouble()] : null)
        .whereType<List<double>>()
        .toList();
    return LyricTrack.build(it.lines, it.times, it.ends, it.wt, duration, vad: vad);
  }

  /// Normalises raw timing (any of it may be missing, stale or invalid) into a track.
  factory LyricTrack.build(List<String> text, List<double?> times, List<double> ends, List<List<WordTime>?> wt, double duration,
      {List<List<double>>? vad}) {
    final n = text.length;
    if (n == 0) return empty;
    final maxT = duration > 0 ? duration + 1 : double.infinity;
    bool ok(double? v) => v != null && v.isFinite && v >= 0 && v <= maxT;
    final known = [for (var i = 0; i < n; i++) i < times.length && ok(times[i]) ? times[i] : null];
    final anyKnown = known.any((v) => v != null);
    final filled = fillTimes(known, n, duration).t;
    final out = <LLine>[];
    for (var i = 0; i < n; i++) {
      final words = lineWords(text[i]);
      if (words.isEmpty) {
        out.add(LLine(text[i], const [], true));
        continue;
      }
      final start = filled[i];
      final next = i + 1 < n ? filled[i + 1] : null;
      final w = i < wt.length ? wt[i] : null;
      List<WordTime> ws;
      final wordsOk = w != null && w.length == words.length && w.every((x) => ok(x.s) && ok(x.e)) && known[i] != null;
      if (wordsOk) {
        ws = cleanWordTimes(words, w, next);
      } else {
        final e0 = i < ends.length && ok(ends[i]) && ends[i] > start ? ends[i] : null;
        final cap = start + math.max(1.4, lineSyllables(text[i]) * 0.38 + 0.4);
        final end = e0 ?? (next != null ? math.min(next - 0.08, cap) : cap);
        ws = distributeWords(text[i], start, math.max(start + 0.3, end));
      }
      out.add(LLine(text[i], [for (var k = 0; k < words.length; k++) LWord(words[k], ws[k].s, ws[k].e)], known[i] == null));
    }
    // one timeline: starts strictly increase, a word ends before the next one starts
    final flat = <List<double>>[];
    for (final l in out) {
      for (final w in l.words) {
        flat.add([w.s, w.e]);
      }
    }
    for (var k = 0; k < flat.length; k++) {
      if (k > 0 && flat[k][0] < flat[k - 1][0] + 0.03) flat[k][0] = flat[k - 1][0] + 0.03;
      if (flat[k][1] < flat[k][0] + 0.06) flat[k][1] = flat[k][0] + 0.06;
    }
    // words placed where nobody sings (intro, instrumental break): move to the next vocal onset
    if (vad != null && vad.isNotEmpty) refineToVoice(flat, vad);
    for (var k = 0; k + 1 < flat.length; k++) {
      if (flat[k][1] > flat[k + 1][0] - 0.01) flat[k][1] = math.max(flat[k][0] + 0.05, flat[k + 1][0] - 0.01);
    }
    var p = 0;
    final lines = <LLine>[];
    for (final l in out) {
      final ws = <LWord>[];
      for (final w in l.words) {
        ws.add(LWord(w.text, flat[p][0], flat[p][1]));
        p++;
      }
      lines.add(LLine(l.text, ws, l.estimated));
    }
    return LyricTrack._(lines, anyKnown, duration, text.join('\n'));
  }

  /// What to show at time t (seconds into the song, from the audio clock).
  LyricState at(double t) {
    if (lines.isEmpty || _starts.isEmpty) return const LyricState(-1, -1, [], -1, true, false, null, 0);
    // last word that has started
    var lo = 0, hi = _starts.length - 1, k = -1;
    while (lo <= hi) {
      final m = (lo + hi) >> 1;
      if (_starts[m] <= t) {
        k = m;
        lo = m + 1;
      } else {
        hi = m - 1;
      }
    }
    if (k < 0) {
      // intro: nothing highlighted until the first word is actually sung
      final first = _firstLineWithWords();
      final rem = _starts.first - t;
      final dots = rem <= 3 && rem > 0 && _starts.first > 3.6 ? rem.ceil() : 0;
      final hint = rem > 3.3 ? 'Intro · first line in ${rem.ceil()}s' : null;
      return LyricState(-1, first, List<double>.filled(lines[first].words.length, 0), -1, true, false, hint, dots);
    }
    final li = _lineOf[k], wi = _wordOf[k];
    final line = lines[li];
    final next = _nextLineWithWords(li);
    if (t <= line.e + 0.25 || next < 0) {
      return LyricState(li, li, _fill(line, t), t <= line.words[wi].e ? wi : -1, false, false, null, 0);
    }
    // between lines: the line just sung stays complete; the next one is shown but not lit
    final nl = lines[next];
    final rem = nl.s - t;
    final pause = nl.s - line.e;
    final dots = pause > 3.6 && rem <= 3 && rem > 0 ? rem.ceil() : 0;
    final hint = pause > 6 && rem > 3.3 ? 'Instrumental' : null;
    if (rem < 2.2 || pause < 3) {
      return LyricState(li, next, List<double>.filled(nl.words.length, 0), -1, false, true, hint, dots);
    }
    return LyricState(li, li, List<double>.filled(line.words.length, 1), -1, false, true, hint, dots);
  }

  List<double> _fill(LLine l, double t) => [for (final w in l.words) ((t - w.s) / math.max(0.05, w.e - w.s)).clamp(0.0, 1.0)];

  int _firstLineWithWords() {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].words.isNotEmpty) return i;
    }
    return 0;
  }

  int _nextLineWithWords(int i) {
    for (var j = i + 1; j < lines.length; j++) {
      if (lines[j].words.isNotEmpty) return j;
    }
    return -1;
  }
}

/// Moves word starts that fall where nobody sings (an intro or an instrumental break) to the
/// next vocal onset, never past the next word. [words]: [start, end] pairs in order, edited in
/// place. [vad]: sorted [start, end] vocal regions. Returns how many words moved.
int refineToVoice(List<List<double>> words, List<List<double>> vad) {
  bool voiced(double t) {
    var lo = 0, hi = vad.length - 1;
    while (lo <= hi) {
      final m = (lo + hi) >> 1;
      if (vad[m][1] < t) {
        lo = m + 1;
      } else if (vad[m][0] > t) {
        hi = m - 1;
      } else {
        return true;
      }
    }
    return false;
  }

  var moved = 0;
  for (var i = 0; i < words.length; i++) {
    final s = words[i][0];
    if (voiced(s) || voiced(s + 0.12)) continue;
    final nx = i + 1 < words.length ? words[i + 1][0] : s + 30;
    double? onset;
    for (final r in vad) {
      if (r[0] >= s && r[0] < nx - 0.05) {
        onset = r[0];
        break;
      }
      if (r[0] >= nx) break;
    }
    if (onset == null) continue;
    words[i][0] = onset;
    words[i][1] = math.max(words[i][1], math.min(nx - 0.01, onset + 0.15));
    moved++;
  }
  return moved;
}
