// Karaoke sync engine tests: measurable tolerances, no visual inspection.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:lectern/core/jobs.dart';
import 'package:lectern/core/model.dart';
import 'package:lectern/lyrics/karaoke.dart';
import 'package:lectern/lyrics/timing.dart';

/// A song with [n] lines; line i starts at start + i*period, its words sung back to back.
({List<String> lines, List<double?> times, List<double> ends, List<List<WordTime>?> wt}) song(int n, double start, double period, {int seed = 1}) {
  final r = math.Random(seed);
  final lines = <String>[], times = <double?>[], ends = <double>[];
  final wt = <List<WordTime>?>[];
  const vocab = ['love', 'night', 'every', 'river', 'shining', 'calling', 'home', 'I', 'see', 'the', 'city', 'lights', 'ooh', 'hold', 'on'];
  for (var i = 0; i < n; i++) {
    final words = [for (var k = 0; k < 3 + r.nextInt(6); k++) vocab[r.nextInt(vocab.length)]];
    lines.add(words.join(' '));
    var t = start + i * period;
    final ws = <WordTime>[];
    for (final _ in words) {
      final d = 0.15 + r.nextDouble() * 0.5;
      ws.add(WordTime(t, t + d));
      t += d + 0.02 + r.nextDouble() * 0.1;
    }
    times.add(ws.first.s);
    ends.add(ws.last.e);
    wt.add(ws);
  }
  return (lines: lines, times: times, ends: ends, wt: wt);
}

void main() {
  group('timing is a pure function of the audio clock', () {
    test('instrumental intro: nothing highlighted before the first word', () {
      final s = song(8, 14.0, 4.0);
      final tr = LyricTrack.build(s.lines, s.times, s.ends, s.wt, 60);
      var lit = 0;
      for (var t = 0.0; t < 14.0 - 0.001; t += 0.005) {
        final st = tr.at(t);
        if (!st.intro || st.word >= 0 || st.fill.any((f) => f > 0)) lit++;
      }
      expect(lit, 0, reason: 'frames with a highlighted word during the intro');
      final at = tr.at(14.0 + 0.001);
      expect(at.intro, false);
      expect(at.line, 0);
      expect(at.word, 0);
      // ignore: avoid_print
      print('intro: 0 of ${(14 / 0.005).round()} intro frames lit; first word lit at 14.000 s');
    });

    test('every word lights exactly when it starts (100k random clock readings vs a reference)', () {
      final s = song(120, 3.0, 3.1, seed: 7);
      final tr = LyricTrack.build(s.lines, s.times, s.ends, s.wt, 400);
      final starts = [for (final l in tr.lines) for (final w in l.words) w.s];
      final r = math.Random(3);
      var mismatches = 0;
      for (var k = 0; k < 100000; k++) {
        final t = r.nextDouble() * 400;
        // reference: linear scan for the last started word
        var ref = -1;
        for (var q = 0; q < starts.length; q++) {
          if (starts[q] <= t) ref = q;
        }
        final st = tr.at(t);
        var got = -1;
        if (st.line >= 0) {
          var idx = 0;
          for (var li = 0; li < st.line; li++) {
            idx += tr.lines[li].words.length;
          }
          // the last word of `line` that started
          final words = tr.lines[st.line].words;
          var w = -1;
          for (var q = 0; q < words.length; q++) {
            if (words[q].s <= t) w = q;
          }
          got = idx + w;
        }
        if (got != ref) mismatches++;
      }
      expect(mismatches, 0);
      // ignore: avoid_print
      print('random clock readings: 100000, mismatches: $mismatches');
    });

    test('no drift over a long song: word starts at 7 minutes are exact', () {
      final s = song(60, 5.0, 7.0, seed: 11); // 7 minutes, lines never overlap
      final tr = LyricTrack.build(s.lines, s.times, s.ends, s.wt, 430);
      var worst = 0.0;
      for (var li = 0; li < tr.length; li++) {
        for (var wi = 0; wi < tr.lines[li].words.length; wi++) {
          final w = tr.lines[li].words[wi];
          final before = tr.at(w.s - 0.002), after = tr.at(w.s + 0.002);
          final litBefore = before.line == li && before.word == wi;
          final litAfter = after.line == li && after.word == wi;
          if (litBefore || !litAfter) worst = math.max(worst, 0.002);
          // the input timing is preserved exactly (no accumulated offset)
          worst = math.max(worst, (w.s - s.wt[li]![wi].s).abs());
        }
      }
      expect(worst, lessThan(0.0021));
      final sw = Stopwatch()..start();
      for (var k = 0; k < 100000; k++) {
        tr.at(k * 0.0043);
      }
      sw.stop();
      // ignore: avoid_print
      print('long song: worst start error ${worst.toStringAsFixed(4)} s; 100000 frames in ${sw.elapsedMilliseconds} ms');
      expect(sw.elapsedMilliseconds, lessThan(1500));
    });

    test('seeking back and forth gives the same answer as a fresh start (stateless)', () {
      final s = song(30, 2.0, 3.0, seed: 5);
      final tr = LyricTrack.build(s.lines, s.times, s.ends, s.wt, 100);
      final fresh = {for (final t in [10.0, 55.5, 3.2, 80.1]) t: tr.at(t)};
      for (final t in [80.1, 3.2, 55.5, 10.0, 55.5, 80.1, 3.2]) {
        final a = tr.at(t), b = fresh[t]!;
        expect([a.line, a.show, a.word, a.intro, a.gap], [b.line, b.show, b.word, b.intro, b.gap]);
        expect(a.fill, b.fill);
      }
    });

    test('pauses between lines: the next line is not lit before it starts', () {
      final lines = ['first line here', 'second line after a break'];
      final times = <double?>[5.0, 20.0];
      final wt = <List<WordTime>?>[
        [WordTime(5.0, 5.4), WordTime(5.5, 5.9), WordTime(6.0, 6.6)],
        [WordTime(20.0, 20.3), WordTime(20.4, 20.7), WordTime(20.8, 21.0), WordTime(21.1, 21.3), WordTime(21.4, 22.0)],
      ];
      final tr = LyricTrack.build(lines, times, [6.6, 22.0], wt, 30);
      var early = 0;
      for (var t = 6.0; t < 20.0 - 0.001; t += 0.01) {
        final st = tr.at(t);
        if (st.line == 1 || (st.show == 1 && st.fill.any((f) => f > 0))) early++;
      }
      expect(early, 0);
      expect(tr.at(12.0).gap, true);
      expect(tr.at(12.0).hint, 'Instrumental');
      expect(tr.at(18.5).dots, 2);
      expect(tr.at(20.01).line, 1);
    });
  });

  group('every lyric source normalises into the same safe track', () {
    test('broken timing never throws and always yields an ordered, finite track', () {
      final r = math.Random(9);
      for (var k = 0; k < 500; k++) {
        final n = 1 + r.nextInt(12);
        final lines = [for (var i = 0; i < n; i++) i % 5 == 4 ? '' : 'word ' * (1 + r.nextInt(5))];
        double? junk() => [null, double.nan, double.infinity, -3.0, 1e9, r.nextDouble() * 100][r.nextInt(6)];
        final times = [for (var i = 0; i < r.nextInt(n + 3); i++) junk()];
        final ends = [for (var i = 0; i < r.nextInt(n + 1); i++) junk() ?? 0.0];
        final wt = [
          for (var i = 0; i < r.nextInt(n + 2); i++)
            r.nextBool() ? null : [for (var q = 0; q < r.nextInt(6); q++) WordTime(junk() ?? 0, junk() ?? 0)]
        ];
        final tr = LyricTrack.build(lines, times, ends, wt, r.nextBool() ? 0 : 120);
        var prev = -1.0;
        for (final l in tr.lines) {
          for (final w in l.words) {
            expect(w.s.isFinite && w.e.isFinite, true);
            expect(w.s, greaterThan(prev));
            expect(w.e, greaterThan(w.s));
            prev = w.s;
          }
        }
        for (var t = -1.0; t < 130; t += 7.3) {
          tr.at(t);
        }
      }
    });

    test('generated lyrics replaced by the real lyrics: re-aligned, not frozen or stale', () {
      final it = Item.create(Kind.song, 'x');
      // a transcript (as AI sync stores it), lyrics generated from it
      final heard = <Map<String, dynamic>>[];
      var t = 12.0;
      for (final w in 'every night i see the city lights shining on the river where we used to walk'.split(' ')) {
        heard.add({'text': w, 'start': t, 'end': t + 0.3});
        t += 0.38;
      }
      applyTranscript(it, {'words': heard, 'vad': [[11.9, 20.0]]}, 'generate');
      final generated = LyricTrack.of(it, 60);
      expect(generated.firstStart, closeTo(12.0, 0.01));
      // the user pastes the official lyrics (different line breaks and spelling)
      it.body = 'Every night I see the city lights\nShining on the river where we used to walk';
      final real = LyricTrack.of(it, 60);
      expect(real.length, 2);
      expect(real.signature, it.lines.join('\n'));
      expect(real.lines[0].words.first.s, closeTo(12.0, 0.05));
      expect(real.lines[1].words.first.s, closeTo(12.0 + 7 * 0.38, 0.05));
      expect(real.at(5).intro, true);
      expect(real.at(12.02).word, 0);
    });

    test('imported lyrics + transcript with an early first word: moved out of the intro', () {
      final it = Item.create(Kind.song, 'y');
      it.body = 'hold on to me\nnever let me go';
      final heard = [
        {'text': 'hold', 'start': 0.4, 'end': 0.7}, // the recogniser put it in the intro
        {'text': 'on', 'start': 18.3, 'end': 18.5},
        {'text': 'to', 'start': 18.6, 'end': 18.7},
        {'text': 'me', 'start': 18.8, 'end': 19.2},
        {'text': 'never', 'start': 21.0, 'end': 21.4},
        {'text': 'let', 'start': 21.5, 'end': 21.7},
        {'text': 'me', 'start': 21.8, 'end': 22.0},
        {'text': 'go', 'start': 22.1, 'end': 22.8},
      ];
      applyTranscript(it, {'words': heard, 'vad': [[18.0, 19.4], [20.9, 23.0]]}, 'sync');
      final tr = LyricTrack.of(it, 40);
      expect(tr.firstStart, closeTo(18.0, 0.01));
      for (var t = 0.0; t < 17.99; t += 0.01) {
        expect(tr.at(t).intro, true);
      }
    });
  });

  test('end to end: speech recognised from a song with a 14 s intro (CI fixture)', () {
    final dir = Directory('test/fixtures');
    final words = File('${dir.path}/words_new.json'), truthF = File('${dir.path}/truth.txt'), lyricsF = File('${dir.path}/lyrics.txt');
    if (!words.existsSync() || !truthF.existsSync() || !lyricsF.existsSync()) {
      markTestSkipped('no ASR fixture (made by the CI speech test)');
      return;
    }
    final it = Item.create(Kind.song, 'e2e');
    it.body = lyricsF.readAsStringSync();
    applyTranscript(it, jsonDecode(words.readAsStringSync()) as Map<String, dynamic>, 'sync');
    final tr = LyricTrack.of(it, 54);
    final truth = truthF.readAsLinesSync().where((l) => l.trim().isNotEmpty).map((l) => double.parse(l.split('\t')[1])).toList();
    final got = [for (final l in tr.lines) for (final w in l.words) w.s];
    expect(got.length, truth.length);
    final err = [for (var i = 0; i < truth.length; i++) (got[i] - truth[i]).abs()]..sort();
    final median = err[err.length ~/ 2], p90 = err[(err.length * 0.9).floor()];
    var introLit = 0;
    for (var t = 0.0; t < truth.first - 0.25; t += 0.01) {
      if (!tr.at(t).intro) introLit++;
    }
    // ignore: avoid_print
    print('end to end (lyrics aligned to recognised speech): ${truth.length} words, median start error ${median.toStringAsFixed(3)} s, '
        'p90 ${p90.toStringAsFixed(3)} s, max ${err.last.toStringAsFixed(3)} s, intro frames lit: $introLit');
    expect(introLit, 0);
    expect(median, lessThan(0.2));
    expect(p90, lessThan(0.5));
  });
}
