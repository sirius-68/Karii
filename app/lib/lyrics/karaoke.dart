// Karaoke state for the stage: which line is sung, which is next, how far each word is filled.
// Same rules as the web app: the upcoming line is shown (and scrolled to) but not highlighted
// until its first word is actually sung.
import 'dart:math' as math;

import '../core/model.dart';
import 'timing.dart';

class KaraLine {
  final String text;
  final List<String> words;
  final List<double> wa, wb; // fraction of the line where each word starts / ends (by characters)
  KaraLine(this.text)
      : words = lineWords(text),
        wa = [],
        wb = [] {
    final len = math.max(1, text.length);
    var acc = 0;
    var pos = 0;
    for (final w in words) {
      final at = text.indexOf(w, pos);
      acc = at >= 0 ? at : acc;
      wa.add(acc / len);
      wb.add((acc + w.length) / len);
      pos = acc + w.length;
      acc = pos;
    }
  }
}

class KaraFrame {
  final int idx; // line being sung (-1 before the first)
  final int show; // line shown as current (may be the upcoming one)
  final List<double> fill; // per-word fill 0..1 for line `idx` when show == idx
  final String? hint; // intro / countdown hint
  final int dots; // countdown dots before a late entry (0 = none)
  const KaraFrame(this.idx, this.show, this.fill, this.hint, this.dots);
}

class Karaoke {
  final List<KaraLine> lines;
  final List<double> t, e;
  final List<List<WordTime>?> wt;
  final bool synced;
  final double duration;
  Karaoke._(this.lines, this.t, this.e, this.wt, this.synced, this.duration);

  factory Karaoke.of(Item it, double duration) {
    final ls = lyricLines(it.body);
    final ft = fillTimes(it.times, ls.length, duration);
    final ends = it.ends;
    final e = List<double>.generate(ls.length, (i) => i < ends.length ? ends[i] : 0);
    final src = it.wt;
    final wt = List<List<WordTime>?>.generate(ls.length, (i) {
      final w = i < src.length ? src[i] : null;
      final words = lineWords(ls[i]);
      if (w == null || w.length != words.length || i >= it.times.length || it.times[i] == null) return null;
      return cleanWordTimes(words, w, i + 1 < ft.t.length ? ft.t[i + 1] : null);
    });
    return Karaoke._(ls.map((l) => KaraLine(l)).toList(), ft.t, e, wt, ft.synced, duration);
  }

  int get length => lines.length;

  double lineEnd(int i) {
    final st = t[i];
    final nx = i + 1 < t.length ? t[i + 1] : null;
    final w = wt[i];
    if (w != null && w.isNotEmpty) return math.max(st + 0.2, w.last.e);
    if (e[i] > st) return nx != null ? math.min(e[i], nx - 0.02) : e[i];
    final cap = st + math.max(1.4, lineSyllables(lines[i].text) * 0.38 + 0.4);
    final lim = nx != null ? math.min(nx - 0.05, cap) : math.min(cap, duration > 0 ? duration : cap);
    return math.max(lim, st + 0.3);
  }

  KaraFrame frame(double time) {
    final n = lines.length;
    if (n == 0) return const KaraFrame(-1, -1, [], null, 0);
    var idx = -1;
    for (var i = 0; i < n; i++) {
      if (t[i] <= time) {
        idx = i;
      } else {
        break;
      }
    }
    final le = idx >= 0 ? lineEnd(idx) : 0.0;
    var show = idx;
    if (idx >= 0 && idx < n - 1 && time > le + 0.6 && t[idx + 1] - time < 2.2) show = idx + 1;
    var fill = const <double>[];
    if (show >= 0 && show == idx) {
      final l = lines[idx];
      final w = wt[idx];
      if (w != null) {
        fill = [for (var k = 0; k < l.words.length; k++) ((time - w[k].s) / math.max(0.05, w[k].e - w[k].s)).clamp(0.0, 1.0)];
      } else {
        final f = ((time - t[idx]) / math.max(0.0001, le - t[idx])).clamp(0.0, 1.0);
        fill = [for (var k = 0; k < l.words.length; k++) ((f - l.wa[k]) / math.max(0.0001, l.wb[k] - l.wa[k])).clamp(0.0, 1.0)];
      }
    }
    String? hint;
    var dots = 0;
    final next = idx + 1;
    if (next < n) {
      final gapStart = idx >= 0 ? le : 0.0, rem = t[next] - time, gap = t[next] - gapStart;
      if (gap > 3.6 && rem > 0 && rem < 3.3 && time > gapStart) {
        dots = rem.ceil();
      } else if (idx == -1 && rem > 3.3) {
        hint = 'Intro · first line in ${rem.ceil()}s';
      }
    }
    return KaraFrame(idx, show, fill, hint, dots);
  }
}
