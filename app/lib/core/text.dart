// Text helpers for scripts, poems and lyrics: lines, words, syllables, sections, time format.
import 'dart:math' as math;

/// A word heard by the speech recogniser (Clip to lines).
class HeardWord {
  final String text;
  final double start, end;
  HeardWord(this.text, this.start, this.end);
  Map<String, dynamic> toJson() => {'text': text, 'start': start, 'end': end};
  static HeardWord fromJson(dynamic m) => HeardWord('${m['text']}', (m['start'] as num).toDouble(), (m['end'] as num).toDouble());
}

final sectionTag = RegExp(r'^\[([^\]]*)\]$');

/// Text lines of a script, without [Section] headers and blank lines.
List<String> scriptLines(String? t) => (t ?? '')
    .split(RegExp(r'\r?\n'))
    .map((l) => l.trim())
    .where((l) => l.isNotEmpty && !sectionTag.hasMatch(l))
    .toList();

List<String> lineWords(String l) => l.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();

int wordCount(String? t) => scriptLines(t).fold(0, (a, l) => a + lineWords(l).length);

/// Reading time at a comfortable performance pace (about 140 words a minute).
double readingSeconds(String? t, {double wpm = 140}) => wordCount(t) / wpm * 60;

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

/// Groups recognised speech into lines (pauses, sentence ends, at most 9 words).
List<String> wordsToLines(List<HeardWord> words) {
  final lines = <String>[];
  var cur = <HeardWord>[];
  void flush() {
    if (cur.isEmpty) return;
    lines.add(cur.map((w) => w.text.trim()).join(' ').replaceAllMapped(RegExp(r'\s+([,.!?;:])'), (m) => m[1]!));
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
  return lines;
}

String fmtTime(double s) {
  if (!s.isFinite || s < 0) s = 0;
  final m = s ~/ 60, r = (s - m * 60).floor();
  return '$m:${r.toString().padLeft(2, '0')}';
}

String fmtTimePrecise(double s) {
  if (!s.isFinite || s < 0) s = 0;
  final m = s ~/ 60;
  final r = s - m * 60;
  return '$m:${r.toStringAsFixed(1).padLeft(4, '0')}';
}

// ------------------------------------------------------------------ sections
/// A script is a list of sections: an optional [Header] line followed by its text.
class Section {
  String title; // '' for text before the first header
  String text;
  Section(this.title, this.text);
  Section copy() => Section(title, text);
}

List<Section> parseSections(String body) {
  final out = <Section>[];
  var cur = Section('', '');
  final buf = <String>[];
  void flush() {
    cur.text = buf.join('\n').trim();
    if (cur.title.isNotEmpty || cur.text.isNotEmpty) out.add(cur);
    buf.clear();
  }

  for (final raw in body.split(RegExp(r'\r?\n'))) {
    final m = sectionTag.firstMatch(raw.trim());
    if (m != null) {
      flush();
      cur = Section(m.group(1)!.trim(), '');
    } else {
      buf.add(raw);
    }
  }
  flush();
  return out;
}

String joinSections(List<Section> s) => s
    .map((x) => [if (x.title.isNotEmpty) '[${x.title}]', if (x.text.isNotEmpty) x.text].join('\n'))
    .where((x) => x.isNotEmpty)
    .join('\n\n');
