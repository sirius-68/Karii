// Lyric timing: syllables, word timing, lyrics ↔ transcript alignment.
// Ported from the web app (engine.js / stage.js) and kept behaviour-compatible.
import 'dart:math' as math;

class WordTime {
  double s, e;
  WordTime(this.s, this.e);
  Map<String, dynamic> toJson() => {'s': _r3(s), 'e': _r3(e)};
  static WordTime fromJson(dynamic m) => WordTime((m['s'] as num).toDouble(), (m['e'] as num).toDouble());
  WordTime copy() => WordTime(s, e);
}

double _r3(double v) => (v * 1000).roundToDouble() / 1000;

class HeardWord {
  final String text;
  final double start, end;
  HeardWord(this.text, this.start, this.end);
  Map<String, dynamic> toJson() => {'text': text, 'start': start, 'end': end};
  static HeardWord fromJson(dynamic m) => HeardWord('${m['text']}', (m['start'] as num).toDouble(), (m['end'] as num).toDouble());
}

final _sectionTag = RegExp(r'^\[[^\]]*\]$');
List<String> lyricLines(String? t) => (t ?? '')
    .split(RegExp(r'\r?\n'))
    .map((l) => l.trim())
    .where((l) => l.isNotEmpty && !_sectionTag.hasMatch(l))
    .toList();

List<String> lineWords(String l) => l.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();

int syllables(String word) {
  var w = word.toLowerCase().replaceAll(RegExp(r"[^a-zа-яёàâäçéèêëîïôöùûüœæñ'-]", unicode: true), '');
  if (w.isEmpty) return 0;
  if (RegExp(r'[а-яё]', unicode: true).hasMatch(w)) {
    return math.max(1, RegExp(r'[аеёиоуыэюя]', unicode: true).allMatches(w).length);
  }
  if (RegExp(r'[àâäçéèêëîïôöùûüœæñ]', unicode: true).hasMatch(w)) {
    return math.max(1, RegExp(r'[aeiouyàâäéèêëîïôöùûüœæ]+', unicode: true).allMatches(w).length);
  }
  w = w.replaceAll("'", '');
  if (w.length <= 3) return 1;
  w = w.replaceFirst(RegExp(r'(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$'), '').replaceFirst(RegExp(r'^y'), '');
  final m = RegExp(r'[aeiouy]{1,2}').allMatches(w).length;
  return math.max(1, m);
}

int lineSyllables(String l) => lineWords(l).fold(0, (a, w) => a + math.max(1, syllables(w)));

const _accents = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'ç': 'c', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y', 'œ': 'oe', 'æ': 'ae', 'й': 'и'
};

String normWord(String w) {
  final sb = StringBuffer();
  for (final ch in w.toLowerCase().split('')) {
    sb.write(_accents[ch] ?? ch);
  }
  return sb.toString().replaceAll(RegExp(r'[^a-zа-яё0-9]', unicode: true), '');
}

int lev(String a, String b) {
  if (a == b) return 0;
  final m = a.length, n = b.length;
  if (m == 0) return n;
  if (n == 0) return m;
  var p = List<int>.generate(n + 1, (j) => j);
  for (var i = 1; i <= m; i++) {
    final c = List<int>.filled(n + 1, 0);
    c[0] = i;
    for (var j = 1; j <= n; j++) {
      c[j] = math.min(math.min(p[j] + 1, c[j - 1] + 1), p[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
    }
    p = c;
  }
  return p[n];
}

double wsim(String a, String b) {
  if (a.isEmpty || b.isEmpty) return 0;
  if (a == b) return 1;
  return 1 - lev(a, b) / math.max(a.length, b.length);
}

const _fillers = {
  'ooh', 'oooh', 'oh', 'ohh', 'ah', 'ahh', 'aah', 'uh', 'um', 'mm', 'mmm', 'hmm', 'yeah', 'yea', 'ya', 'la', 'na', 'da',
  'hey', 'whoa', 'woah', 'wo', 'oo', 'ay', 'eh', 'ha', 'huh', 'ooo', 'ohoh', 'ooooh', 'mmmm', 'да', 'о', 'а', 'ах', 'ох', 'ля', 'на', 'эй'
};
final _fillerRe = RegExp(r'^(o+h*|a+h+|m+|la+|na+|ye+a*h*|wo+a*h*)$');
bool isFiller(String w) => _fillers.contains(w) || _fillerRe.hasMatch(w);

/// Needleman–Wunsch alignment of lyric words to transcript words. Returns, for each lyric
/// word, the index of the transcript word it matches, or -1.
List<int> alignWords(List<String> lyr, List<String> tr) {
  final n = lyr.length, m = tr.length;
  const g = -0.45;
  final s = List.generate(n + 1, (_) => List<double>.filled(m + 1, 0));
  final p = List.generate(n + 1, (_) => List<int>.filled(m + 1, 0));
  bool okMatch(String a, double sim) => a.length <= 3 ? sim == 1 : sim >= 0.6;
  for (var i = 1; i <= n; i++) {
    s[i][0] = i * g;
    p[i][0] = 1;
  }
  for (var j = 1; j <= m; j++) {
    s[0][j] = j * g;
    p[0][j] = 2;
  }
  for (var i = 1; i <= n; i++) {
    for (var j = 1; j <= m; j++) {
      final lw = lyr[i - 1], sim = wsim(lw, tr[j - 1]);
      final ms = okMatch(lw, sim) ? sim * (isFiller(lw) ? 0.6 : 1.4) : -0.7;
      final d = s[i - 1][j - 1] + ms, u = s[i - 1][j] + g, l = s[i][j - 1] + g;
      if (d >= u && d >= l) {
        s[i][j] = d;
        p[i][j] = 0;
      } else if (u >= l) {
        s[i][j] = u;
        p[i][j] = 1;
      } else {
        s[i][j] = l;
        p[i][j] = 2;
      }
    }
  }
  final map = List<int>.filled(n, -1);
  var i = n, j = m;
  while (i > 0 || j > 0) {
    final d = (i > 0 && j > 0) ? p[i][j] : (i > 0 ? 1 : 2);
    if (i > 0 && j > 0 && d == 0) {
      if (okMatch(lyr[i - 1], wsim(lyr[i - 1], tr[j - 1]))) map[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (d == 1 || j == 0)) {
      i--;
    } else {
      j--;
    }
  }
  return map;
}

class AlignResult {
  final List<double> times, ends;
  final List<List<WordTime>> wt;
  final List<bool> anchored;
  final double confidence;
  AlignResult(this.times, this.ends, this.wt, this.anchored, this.confidence);
}

class _Anchor {
  final int i, j;
  final double t, e, wt;
  _Anchor(this.i, this.j, this.t, this.e, this.wt);
}

/// Lyrics ↔ transcript in three steps: word alignment, keeping only matches that form a
/// singable timeline, then filling the rest at a natural singing pace.
AlignResult alignLyricsToWords(List<String> lines, List<HeardWord> words) {
  final lw = <String>[], owner = <int>[], raw = <String>[];
  for (var li = 0; li < lines.length; li++) {
    for (final w in lineWords(lines[li])) {
      raw.add(w);
      lw.add(normWord(w));
      owner.add(li);
    }
  }
  final tw = words.map((w) => normWord(w.text)).toList();
  final map = alignWords(lw, tw);
  final n = lw.length;
  final syl = raw.map((w) => math.max(1, syllables(w))).toList();
  final cs = List<double>.filled(n + 1, 0);
  for (var i = 0; i < n; i++) {
    cs[i + 1] = cs[i] + syl[i];
  }
  final anchors = <_Anchor>[];
  for (var i = 0; i < n; i++) {
    final j = map[i];
    if (j < 0) continue;
    final w = words[j];
    if (!w.start.isFinite || !w.end.isFinite) continue;
    final exact = lw[i] == tw[j], filler = isFiller(lw[i]);
    final nb = (i > 0 && map[i - 1] == j - 1) || (i < n - 1 && map[i + 1] == j + 1);
    final weak = (filler && !nb) || (lw[i].length <= 3 && !nb);
    final wt = weak ? 0.25 : filler ? 0.6 : (lw[i].length >= 4 ? 1.3 : 1.0) * (exact ? 1 : 0.7) * (nb ? 1.5 : 1);
    anchors.add(_Anchor(i, j, w.start, w.end, wt));
  }
  final k = anchors.length;
  final best = List<double>.filled(k, 0), prev = List<int>.filled(k, -1);
  bool ok(_Anchor a, _Anchor b) {
    final dt = b.t - a.t, sy = cs[b.i] - cs[a.i];
    if (dt <= 0.03) return false;
    if (dt / sy < 0.055) return false;
    if (owner[a.i] == owner[b.i]) return dt <= sy * 1.8 + 1.2;
    return dt <= sy * 1.8 + 30;
  }

  double skip(_Anchor a, _Anchor b) => math.max(0, (b.j - a.j - 1) - (b.i - a.i - 1) - 2) * 0.6;
  for (var b = 0; b < k; b++) {
    best[b] = anchors[b].wt - math.max(0, anchors[b].j - anchors[b].i - 2) * 0.6;
    for (var a = 0; a < b; a++) {
      final v = best[a] + anchors[b].wt - skip(anchors[a], anchors[b]);
      if (v > best[b] && ok(anchors[a], anchors[b])) {
        best[b] = v;
        prev[b] = a;
      }
    }
  }
  var end = -1;
  var bv = -1e18;
  for (var b = 0; b < k; b++) {
    if (best[b] > bv) {
      bv = best[b];
      end = b;
    }
  }
  final keep = <int>{};
  for (var b = end; b >= 0; b = prev[b]) {
    keep.add(b);
  }
  final st = List<double?>.filled(n, null), en = List<double?>.filled(n, null);
  var kept = 0;
  for (var x = 0; x < k; x++) {
    final a = anchors[x];
    if (keep.contains(x) && a.wt > 0.3) {
      st[a.i] = a.t;
      en[a.i] = math.max(a.t + 0.06, a.e);
      kept++;
    }
  }
  for (var x = 0; x < k; x++) {
    final a = anchors[x];
    if (keep.contains(x) && a.wt <= 0.3 && ((a.i > 0 && st[a.i - 1] != null) || (a.i < n - 1 && st[a.i + 1] != null))) {
      st[a.i] = a.t;
      en[a.i] = math.max(a.t + 0.06, a.e);
      kept++;
    }
  }
  const pace = 0.3;
  final idx = <int>[for (var i = 0; i < n; i++) if (st[i] != null) i];
  final gaps = <double>[];
  for (var i = 1; i < n; i++) {
    if (owner[i] != owner[i - 1] && st[i] != null && en[i - 1] != null) {
      final g = st[i]! - en[i - 1]!;
      if (g > 0 && g < 8) gaps.add(g);
    }
  }
  gaps.sort();
  final gap = math.max(0.3, math.min(4.0, gaps.isNotEmpty ? gaps[gaps.length >> 1] : 1.2));
  if (n > 0) {
    if (idx.isEmpty) {
      var t = 1.0;
      for (var q = 0; q < n; q++) {
        if (q > 0 && owner[q] != owner[q - 1]) t += 1.2;
        st[q] = t;
        t += syl[q] * pace;
        en[q] = t - 0.04;
      }
    } else {
      final f = idx.first;
      var t = st[f]!;
      for (var q = f - 1; q >= 0; q--) {
        t -= syl[q] * pace + (owner[q] != owner[q + 1] ? 0.9 : 0);
        st[q] = t;
        en[q] = t + syl[q] * pace - 0.04;
      }
      if (f > 0 && st[0]! < 0) {
        final sh = -st[0]! + 0.05, span = st[f]!;
        for (var q = 0; q < f; q++) {
          st[q] = (st[q]! + sh) * span / (span + sh);
          en[q] = math.min(st[q]! + syl[q] * pace, q + 1 < f ? st[q + 1]! + sh : span);
        }
      }
      for (var x = 0; x < idx.length - 1; x++) {
        final a = idx[x], b = idx[x + 1];
        if (b == a + 1) continue;
        final t0 = en[a]!, t1 = st[b]!;
        final need = (cs[b] - cs[a + 1]) * pace + 0.9 * (owner[b] - owner[a]);
        if (need >= t1 - t0 - 0.05) {
          var acc = 0.0;
          final tot = cs[b] - cs[a + 1];
          for (var q = a + 1; q < b; q++) {
            st[q] = t0 + (t1 - t0) * acc / tot;
            acc += syl[q];
            en[q] = t0 + (t1 - t0) * acc / tot;
          }
        } else {
          var q = a + 1;
          var tt = t0 + 0.04;
          while (q < b && owner[q] == owner[a]) {
            st[q] = tt;
            tt += syl[q] * pace;
            en[q] = tt - 0.04;
            q++;
          }
          var r = b - 1;
          var u = t1 - 0.04;
          final back = <int>[];
          while (r >= q && owner[r] == owner[b]) {
            u -= syl[r] * pace;
            back.add(r);
            st[r] = u;
            en[r] = u + syl[r] * pace - 0.04;
            r--;
          }
          if (q <= r) {
            final hi = (back.isNotEmpty ? st[back.last]! : t1) - 0.3;
            var t2 = tt - 0.04 + gap;
            final first = t2;
            final zs = <int>[];
            for (var z = q; z <= r; z++) {
              if (z > q && owner[z] != owner[z - 1]) t2 += gap;
              st[z] = t2;
              t2 += syl[z] * pace;
              en[z] = t2 - 0.04;
              zs.add(z);
            }
            if (t2 > hi && t2 > first) {
              final k2 = (hi - first) / (t2 - first);
              for (final z in zs) {
                st[z] = first + (st[z]! - first) * k2;
                en[z] = first + (en[z]! - first) * k2;
              }
            }
          }
        }
      }
      var t3 = en[idx.last]! + 0.04;
      for (var q = idx.last + 1; q < n && st[q] == null; q++) {
        if (owner[q] != owner[q - 1]) t3 += 0.9;
        st[q] = t3;
        t3 += syl[q] * pace;
        en[q] = t3 - 0.04;
      }
    }
    for (var i = 1; i < n; i++) {
      if (st[i]! < st[i - 1]! + 0.04) st[i] = st[i - 1]! + 0.04;
      if (en[i - 1]! > st[i]!) en[i - 1] = math.max(st[i - 1]! + 0.05, st[i]! - 0.01);
    }
  }
  final times = <double>[], ends = <double>[];
  final wt = <List<WordTime>>[];
  var p = 0;
  for (var li = 0; li < lines.length; li++) {
    final c = lineWords(lines[li]).length;
    final arr = <WordTime>[];
    for (var q = 0; q < c; q++, p++) {
      arr.add(WordTime(_r3(math.max(0.0, st[p]!)), _r3(math.max(st[p]! + 0.05, en[p]!))));
    }
    times.add(arr.isNotEmpty ? arr.first.s : (li > 0 ? times[li - 1] : 0.0) + 2);
    ends.add(arr.isNotEmpty ? arr.last.e : times[li] + 1);
    wt.add(arr);
  }
  for (var i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) times[i] = _r3(times[i - 1] + 0.05);
  }
  final anchored = List<bool>.filled(lines.length, false);
  for (var x = 0; x < k; x++) {
    if (keep.contains(x) && anchors[x].wt > 0.3) anchored[owner[anchors[x].i]] = true;
  }
  return AlignResult(times, ends, wt, anchored, n > 0 ? kept / n : 0);
}

class LinesResult {
  final List<String> lines;
  final List<double> times, ends;
  final List<List<WordTime>> wt;
  LinesResult(this.lines, this.times, this.ends, this.wt);
}

/// Groups transcribed words into lyric lines (used when lyrics are generated from audio).
LinesResult wordsToLines(List<HeardWord> words) {
  final lines = <String>[], wt = <List<WordTime>>[];
  final times = <double>[], ends = <double>[];
  var cur = <HeardWord>[];
  void flush() {
    if (cur.isEmpty) return;
    lines.add(cur.map((w) => w.text.trim()).join(' ').replaceAllMapped(RegExp(r'\s+([,.!?;:])'), (m) => m[1]!));
    times.add(_r3(cur.first.start));
    ends.add(_r3(cur.last.end));
    wt.add(cur.map((w) => WordTime(_r3(w.start), _r3(w.end))).toList());
    cur = [];
  }

  for (var i = 0; i < words.length; i++) {
    final w = words[i];
    if (cur.isNotEmpty) {
      final prev = words[i - 1];
      if (w.start - prev.end > 0.7 || cur.length >= 9 || (RegExp(r'[.!?]$').hasMatch(prev.text.trim()) && cur.length >= 3)) flush();
    }
    if (w.text.trim().isNotEmpty) cur.add(w);
  }
  flush();
  return LinesResult(lines, times, ends, wt);
}

/// Fill missing line times by interpolation (as the stage does).
class FilledTimes {
  final List<double> t;
  final bool synced;
  FilledTimes(this.t, this.synced);
}

FilledTimes fillTimes(List<double?>? times, int n, double duration) {
  final t = List<double?>.generate(n, (i) => (times != null && i < times.length && times[i] != null && times[i]!.isFinite) ? times[i] : null);
  final known = [for (var i = 0; i < n; i++) if (t[i] != null) i];
  if (known.isEmpty) {
    final d = duration > 0 ? duration : n * 4.0;
    return FilledTimes(List.generate(n, (i) => d * 0.04 + i * (d * 0.9 / math.max(1, n))), false);
  }
  for (var i = 0; i < known.first; i++) {
    t[i] = math.max(0.0, t[known.first]! - (known.first - i) * 3);
  }
  for (var x = 0; x < known.length - 1; x++) {
    final a = known[x], b = known[x + 1];
    for (var i = a + 1; i < b; i++) {
      t[i] = t[a]! + (t[b]! - t[a]!) * (i - a) / (b - a);
    }
  }
  final last = known.last;
  for (var i = last + 1; i < n; i++) {
    t[i] = t[last]! + (i - last) * 3.5;
  }
  final out = t.map((v) => v!).toList();
  for (var i = 1; i < n; i++) {
    if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 0.05;
  }
  return FilledTimes(out, true);
}

/// Keep ASR word times in order and give each word a believable length.
List<WordTime> cleanWordTimes(List<String> words, List<WordTime> wt, double? nextLine) {
  final out = wt.map((x) => x.copy()).toList();
  final n = out.length;
  for (var k = 0; k < n; k++) {
    if (!out[k].s.isFinite) out[k].s = k > 0 ? out[k - 1].e : 0;
    if (k > 0 && out[k].s < out[k - 1].s + 0.04) out[k].s = out[k - 1].s + 0.04;
    if (!out[k].e.isFinite || out[k].e < out[k].s + 0.08) out[k].e = out[k].s + 0.08;
  }
  for (var k = 0; k < n; k++) {
    final syl = math.max(1, syllables(k < words.length ? words[k] : ''));
    final last = k == n - 1;
    final cap = last ? math.min(2.6, 0.35 + syl * 0.45) : math.min(1.4, 0.2 + syl * 0.32);
    var e = math.min(out[k].e, out[k].s + cap);
    if (!last) {
      e = math.min(e, out[k + 1].s);
    } else if (nextLine != null) {
      e = math.min(e, nextLine - 0.05);
    }
    out[k].e = math.max(out[k].s + 0.06, e);
  }
  return out;
}

/// Spread a line's words over [start, end] by syllables, snapping to onsets if given.
List<WordTime> distributeWords(String line, double start, double end, [List<double>? peaks]) {
  final ws = lineWords(line);
  if (ws.isEmpty) return [];
  final syl = ws.map((w) => math.max(1, syllables(w))).toList();
  final tot = syl.fold<int>(0, (a, b) => a + b);
  final span = math.max(0.3, end - start);
  var acc = 0;
  final out = <WordTime>[];
  for (var i = 0; i < ws.length; i++) {
    final s = start + span * acc / tot;
    acc += syl[i];
    out.add(WordTime(s, start + span * acc / tot));
  }
  if (peaks != null && peaks.isNotEmpty) {
    for (var i = 1; i < out.length; i++) {
      final p = nearestPeak(peaks, out[i].s, 0.12);
      if (p != null && p > out[i - 1].s + 0.08 && p < end - 0.05) out[i].s = p;
    }
    for (var i = 0; i < out.length; i++) {
      out[i].e = i < out.length - 1 ? math.max(out[i].s + 0.06, out[i + 1].s - 0.01) : end;
    }
  }
  return out.map((x) => WordTime(_r3(x.s), _r3(x.e))).toList();
}

double? nearestPeak(List<double> peaks, double t, double win) {
  var lo = 0, hi = peaks.length - 1;
  while (lo < hi) {
    final m = (lo + hi) >> 1;
    if (peaks[m] < t) {
      lo = m + 1;
    } else {
      hi = m;
    }
  }
  double? best;
  var bd = win;
  for (var k = math.max(0, lo - 2); k <= math.min(peaks.length - 1, lo + 2); k++) {
    final d = (peaks[k] - t).abs();
    if (d < bd) {
      bd = d;
      best = peaks[k];
    }
  }
  return best;
}

/// Line ends from syllables when there is no analysis.
List<double> estimateEnds(List<String> lines, List<double> times) {
  return List.generate(lines.length, (i) {
    final st = times[i], nx = i + 1 < times.length ? times[i + 1] : st + 6;
    final e = math.min(nx - 0.08, st + lineSyllables(lines[i]) * 0.38 + 0.5);
    return _r3(math.max(st + 0.3, e));
  });
}

String fmtTime(double s) {
  if (!s.isFinite || s < 0) s = 0;
  final m = s ~/ 60, r = (s - m * 60).floor();
  return '$m:${r.toString().padLeft(2, '0')}';
}

String fmtTag(double s) {
  final m = s ~/ 60;
  final r = s - m * 60;
  return '${m.toString().padLeft(2, '0')}:${r.toStringAsFixed(2).padLeft(5, '0')}';
}
