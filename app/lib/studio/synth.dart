// Offline synthesizer for the beat maker, metronome and click tracks. Renders mono float audio
// (run it in an isolate) and writes 16-bit WAV files the audio engine can play.
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

const _deg = <String, List<dynamic>>{
  'I': [0, 'maj'], 'ii': [2, 'min'], 'iii': [4, 'min'], 'IV': [5, 'maj'], 'V': [7, 'maj'], 'vi': [9, 'min'], 'bVII': [10, 'maj'],
  'Imaj7': [0, 'maj7'], 'ii7': [2, 'm7'], 'iii7': [4, 'm7'], 'IVmaj7': [5, 'maj7'], 'V7': [7, '7'], 'vi7': [9, 'm7'],
};
const _qual = <String, List<int>>{'maj': [0, 4, 7], 'min': [0, 3, 7], 'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10], '7': [0, 4, 7, 10]};
const _qsuf = {'maj': '', 'min': 'm', 'maj7': 'maj7', 'm7': 'm7', '7': '7'};
const beatKeys = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'Bb': 10};
const _nn = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

String chordName(String d, String k) => _nn[(beatKeys[k]! + (_deg[d]![0] as int)) % 12] + _qsuf[_deg[d]![1]]!;

class Chord {
  final int root;
  final List<int> tones;
  Chord(this.root, this.tones);
}

Chord chordMidi(String d, String k) {
  var r = 48 + beatKeys[k]! + (_deg[d]![0] as int);
  while (r > 55) {
    r -= 12;
  }
  return Chord(r, _qual[_deg[d]![1]]!.map((i) => r + 12 + i).toList());
}

List<bool> _s16(List<int> a) => List.generate(16, (i) => a.contains(i));

class BeatStyle {
  final String name;
  final int bpm;
  final List<String> prog;
  final List<int> kick, snare, hat, clap, bass;
  final Map<String, bool> layers;
  final double swing;
  const BeatStyle(this.name, this.bpm, this.prog, this.kick, this.snare, this.hat, this.clap, this.bass, this.layers, this.swing);
}

const beatStyles = <String, BeatStyle>{
  'pop': BeatStyle('Pop', 100, ['I', 'V', 'vi', 'IV'], [0, 8, 10], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14], [], [0, 8, 10],
      {'keys': true, 'pad': true, 'bass': true, 'arp': false, 'vinyl': false}, 0),
  'lofi': BeatStyle('Lo-fi', 78, ['ii7', 'V7', 'Imaj7', 'vi7'], [0, 7, 10], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14], [], [0, 7, 10],
      {'keys': true, 'pad': false, 'bass': true, 'arp': false, 'vinyl': true}, 0.22),
  'ballad': BeatStyle('Ballad', 68, ['I', 'vi', 'IV', 'V'], [0, 10], [8], [0, 4, 8, 12], [], [0, 8],
      {'keys': true, 'pad': true, 'bass': true, 'arp': true, 'vinyl': false}, 0),
  'hiphop': BeatStyle('Hip-hop', 90, ['vi', 'IV', 'I', 'V'], [0, 3, 8, 11], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14, 15], [12], [0, 3, 8, 11],
      {'keys': true, 'pad': false, 'bass': true, 'arp': false, 'vinyl': false}, 0.12),
  'dance': BeatStyle('Dance', 124, ['vi', 'IV', 'I', 'V'], [0, 4, 8, 12], [], [2, 6, 10, 14], [4, 12], [2, 6, 10, 14],
      {'keys': false, 'pad': true, 'bass': true, 'arp': true, 'vinyl': false}, 0),
  'acoustic': BeatStyle('Acoustic', 92, ['I', 'IV', 'vi', 'V'], [0, 8], [], [], [4, 12], [0, 8],
      {'keys': true, 'pad': false, 'bass': true, 'arp': true, 'vinyl': false}, 0.08),
};

const progressions = [
  ['I', 'V', 'vi', 'IV'],
  ['vi', 'IV', 'I', 'V'],
  ['I', 'vi', 'IV', 'V'],
  ['ii7', 'V7', 'Imaj7', 'vi7'],
  ['I', 'IV', 'vi', 'V'],
  ['I', 'bVII', 'IV', 'I'],
  ['vi', 'V', 'IV', 'V'],
  ['IVmaj7', 'iii7', 'vi7', 'Imaj7'],
];

class Beat {
  String style;
  int bpm;
  String key;
  List<String> prog;
  double swing;
  Map<String, bool> layers;
  Map<String, List<bool>> steps;
  List<int> bass;
  Beat(this.style, this.bpm, this.key, this.prog, this.swing, this.layers, this.steps, this.bass);

  factory Beat.fromStyle(String id, [String key = 'C']) {
    final s = beatStyles[id]!;
    return Beat(id, s.bpm, key, [...s.prog], s.swing, {...s.layers},
        {'kick': _s16(s.kick), 'snare': _s16(s.snare), 'hat': _s16(s.hat), 'clap': _s16(s.clap)}, [...s.bass]);
  }

  Map<String, dynamic> toJson() => {
        'style': style,
        'bpm': bpm,
        'key': key,
        'prog': prog,
        'swing': swing,
        'layers': layers,
        'steps': steps,
        'bass': bass,
      };

  static Beat fromJson(Map m) => Beat(
        '${m['style']}',
        (m['bpm'] as num).toInt(),
        '${m['key']}',
        (m['prog'] as List).map((e) => '$e').toList(),
        (m['swing'] as num).toDouble(),
        (m['layers'] as Map).map((k, v) => MapEntry('$k', v == true)),
        (m['steps'] as Map).map((k, v) => MapEntry('$k', (v as List).map((e) => e == true).toList())),
        (m['bass'] as List).map((e) => (e as num).toInt()).toList(),
      );

  Beat copy() => Beat.fromJson(toJson());
}

double _hz(num m) => 440 * math.pow(2, (m - 69) / 12).toDouble();

// ---------------------------------------------------------------- tiny DSP
class _Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
  _Biquad.lowpass(double fs, double f, [double q = 0.707]) {
    final w = 2 * math.pi * f / fs, c = math.cos(w), al = math.sin(w) / (2 * q), a0 = 1 + al;
    b0 = (1 - c) / 2 / a0;
    b1 = (1 - c) / a0;
    b2 = b0;
    a1 = -2 * c / a0;
    a2 = (1 - al) / a0;
  }
  _Biquad.highpass(double fs, double f, [double q = 0.707]) {
    final w = 2 * math.pi * f / fs, c = math.cos(w), al = math.sin(w) / (2 * q), a0 = 1 + al;
    b0 = (1 + c) / 2 / a0;
    b1 = -(1 + c) / a0;
    b2 = b0;
    a1 = -2 * c / a0;
    a2 = (1 - al) / a0;
  }
  _Biquad.bandpass(double fs, double f, [double q = 1]) {
    final w = 2 * math.pi * f / fs, c = math.cos(w), al = math.sin(w) / (2 * q), a0 = 1 + al;
    b0 = al / a0;
    b1 = 0;
    b2 = -al / a0;
    a1 = -2 * c / a0;
    a2 = (1 - al) / a0;
  }
  double run(double x) {
    final y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
}

/// Exponential attack/decay/sustain/release, like the web synth's envelope.
double _env(double t, double a, double p, double d, double s, double end) {
  const floor = 0.0001;
  if (t < 0) return 0;
  if (t < a) return floor * math.pow(p / floor, t / a);
  final sus = math.max(floor, p * s);
  if (t < a + d) return p * math.pow(sus / p, (t - a) / d);
  final holdEnd = math.max(a + d, end - 0.05);
  if (t < holdEnd) return sus;
  final rel = (end + 0.04) - holdEnd;
  if (t < end + 0.04) return sus * math.pow(floor / sus, (t - holdEnd) / rel);
  return 0;
}

class _Renderer {
  final int sr;
  final Float32List out;
  final math.Random rnd = math.Random(7);
  _Renderer(this.sr, int len) : out = Float32List(len);

  void _add(double t0, double len, double Function(double t, int i) f) {
    final s0 = (t0 * sr).round();
    final n = (len * sr).round();
    for (var i = 0; i < n; i++) {
      final k = s0 + i;
      if (k < 0) continue;
      if (k >= out.length) break;
      out[k] += f(i / sr, i);
    }
  }

  void kick(double t, [double v = 0.9]) {
    var ph = 0.0;
    _add(t, 0.34, (x, _) {
      final f = x < 0.13 ? 150 * math.pow(40 / 150, x / 0.13) : 40.0;
      ph += 2 * math.pi * f / sr;
      return math.sin(ph) * v * math.pow(0.0001 / v, math.min(1, x / 0.32));
    });
  }

  void snare(double t, [double v = 0.35]) {
    final hp = _Biquad.highpass(sr.toDouble(), 1200);
    _add(t, 0.2, (x, _) => hp.run(rnd.nextDouble() * 2 - 1) * v * math.pow(0.0001 / v, math.min(1, x / 0.18)));
    var ph = 0.0;
    _add(t, 0.12, (x, _) {
      final f = x < 0.08 ? 200 * math.pow(120 / 200, x / 0.08) : 120.0;
      ph += 2 * math.pi * f / sr;
      return math.sin(ph) * v * 0.6 * math.pow(0.0001 / (v * 0.6), math.min(1, x / 0.1));
    });
  }

  void hat(double t, [double v = 0.12]) {
    final hp = _Biquad.highpass(sr.toDouble(), 8000);
    _add(t, 0.06, (x, _) => hp.run(rnd.nextDouble() * 2 - 1) * v * math.pow(0.0001 / v, math.min(1, x / 0.045)));
  }

  void clap(double t, [double v = 0.3]) {
    for (var k = 0; k < 3; k++) {
      final d = [0.0, 0.012, 0.024][k], len = k == 2 ? 0.16 : 0.03, g = v * (k == 2 ? 1 : 0.6);
      final bp = _Biquad.bandpass(sr.toDouble(), 1600, 1.2);
      _add(t + d, 0.18, (x, _) => bp.run(rnd.nextDouble() * 2 - 1) * g * math.pow(0.0001 / g, math.min(1, x / len)));
    }
  }

  static double _tri(double ph) {
    final p = ph / (2 * math.pi) % 1;
    return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  }

  static double _saw(double ph) => 2 * (ph / (2 * math.pi) % 1) - 1;
  static double _sq(double ph) => (ph / (2 * math.pi) % 1) < 0.5 ? 1 : -1;

  void keys(double t, int m, double d, [double v = 0.08, bool soft = false]) {
    final f1 = _hz(m), f2 = _hz(m + 12);
    final lp1 = _Biquad.lowpass(sr.toDouble(), soft ? 1400 : 2800), lp2 = _Biquad.lowpass(sr.toDouble(), soft ? 1400 : 2800);
    _add(t, d + 0.1, (x, _) {
      final a = lp1.run(_tri(2 * math.pi * f1 * x)) * _env(x, 0.006, v, 0.5, 0.22, d);
      final b = lp2.run(math.sin(2 * math.pi * f2 * x)) * _env(x, 0.006, v * 0.3, 0.5, 0.22, d);
      return a + b;
    });
  }

  void pad(double t, List<int> tones, double d, [double v = 0.035]) {
    final lp = _Biquad.lowpass(sr.toDouble(), 1100);
    final fs = <double>[];
    for (final m in tones) {
      for (final dt in [-6, 6]) {
        fs.add(_hz(m) * math.pow(2, dt / 1200));
      }
    }
    _add(t, d + 0.1, (x, _) {
      var s = 0.0;
      for (final f in fs) {
        s += _saw(2 * math.pi * f * x);
      }
      return lp.run(s) * _env(x, 0.35, v, 0.5, 0.8, d);
    });
  }

  void bass(double t, int m, double d, [double v = 0.4]) {
    final f1 = _hz(m), f2 = _hz(m - 12);
    _add(t, d + 0.08, (x, _) => (_tri(2 * math.pi * f1 * x) + math.sin(2 * math.pi * f2 * x)) * _env(x, 0.008, v, 0.2, 0.6, d));
  }

  void arp(double t, int m, [double v = 0.045]) {
    final f = _hz(m), lp = _Biquad.lowpass(sr.toDouble(), 2200);
    _add(t, 0.2, (x, _) => lp.run(_sq(2 * math.pi * f * x)) * _env(x, 0.004, v, 0.12, 0.15, 0.16));
  }

  void crackle(double t, double dur) {
    final hp = _Biquad.highpass(sr.toDouble(), 3000);
    for (var k = 0; k < (dur * 6).round(); k++) {
      final tt = t + rnd.nextDouble() * dur, g = 0.05 + rnd.nextDouble() * 0.08;
      _add(tt, 0.01, (x, _) => hp.run(rnd.nextDouble() * 2 - 1) * g * math.pow(0.0001 / g, math.min(1, x / 0.006)));
    }
    final lp = _Biquad.lowpass(sr.toDouble(), 1200);
    _add(t, dur, (x, _) => lp.run(rnd.nextDouble() * 2 - 1) * 0.012);
  }

  void click(double t, bool down) {
    final f = down ? 1320.0 : 880.0, p = down ? 0.45 : 0.2;
    _add(t, 0.08, (x, _) => math.sin(2 * math.pi * f * x) * (x < 0.003 ? p * x / 0.003 : p * math.pow(0.0001 / p, math.min(1, (x - 0.003) / 0.057))));
  }

  void step(Beat b, int step, double t) {
    final sd = 60 / b.bpm / 4, s = step % 16, bar = (step ~/ 16) % 4, ch = chordMidi(b.prog[bar % b.prog.length], b.key);
    final tt = t + (s.isOdd ? b.swing * sd : 0);
    if (b.steps['kick']![s]) kick(tt);
    if (b.steps['snare']![s]) snare(tt);
    if (b.steps['hat']![s]) hat(tt, s % 4 == 0 ? 0.13 : 0.08);
    if (b.steps['clap']![s]) clap(tt);
    final l = b.layers, lofi = b.style == 'lofi', ac = b.style == 'acoustic', dance = b.style == 'dance';
    if (l['keys'] == true && (s == 0 || s == 8 || (ac && s % 4 == 2))) {
      for (var k = 0; k < ch.tones.length; k++) {
        keys(tt + k * (ac ? 0.03 : 0.008), ch.tones[k], sd * 7.6, 0.07, lofi);
      }
    }
    if (l['pad'] == true && s == 0) pad(tt, ch.tones, sd * 16);
    if (l['bass'] == true && b.bass.contains(s)) bass(tt, ch.root - 12 + (dance ? 12 : 0), sd * (dance ? 1.6 : 3.6));
    if (l['arp'] == true && (dance || s.isEven)) {
      final seq = [...ch.tones, ch.tones[0] + 12];
      arp(tt, seq[(dance ? s : s ~/ 2) % seq.length] + 12);
    }
    if (l['vinyl'] == true && s == 0) crackle(tt, sd * 16);
  }

  /// Gentle bus compression (threshold -12 dB, ratio 3) and a safety limiter.
  void master([double gain = 0.8]) {
    final th = math.pow(10, -12 / 20).toDouble();
    final atk = math.exp(-1 / (0.003 * sr)), rel = math.exp(-1 / (0.25 * sr));
    var envv = 0.0;
    var peak = 0.0;
    for (var i = 0; i < out.length; i++) {
      final x = out[i] * gain, a = x.abs();
      envv = a > envv ? atk * envv + (1 - atk) * a : rel * envv + (1 - rel) * a;
      var g = 1.0;
      if (envv > th) g = math.pow(envv / th, 1 / 3 - 1).toDouble();
      out[i] = x * g;
      if (out[i].abs() > peak) peak = out[i].abs();
    }
    if (peak > 0.95) {
      final k = 0.95 / peak;
      for (var i = 0; i < out.length; i++) {
        out[i] *= k;
      }
    }
  }
}

class Rendered {
  final Float32List pcm;
  final int sr;
  final double dur;
  final int bars;
  Rendered(this.pcm, this.sr, this.dur, this.bars);
}

/// Renders at least [seconds] of the beat (whole groups of four bars) plus an ending chord.
Rendered renderBeat(Beat b, double seconds, {int sr = 32000}) {
  final sd = 60 / b.bpm / 4, barDur = sd * 16;
  final bars = math.max(4, (seconds / barDur / 4).ceil() * 4);
  final len = bars * barDur + 2.5;
  final r = _Renderer(sr, (len * sr).ceil());
  for (var st = 0; st < bars * 16; st++) {
    r.step(b, st, 0.05 + st * sd);
  }
  final endT = 0.05 + bars * barDur, ch = chordMidi(b.prog[0], b.key);
  for (final m in ch.tones) {
    r.keys(endT, m, 2, 0.07);
  }
  r.kick(endT, 0.6);
  if (b.layers['pad'] == true) r.pad(endT, ch.tones, 2);
  r.master();
  return Rendered(r.out, sr, len, bars);
}

/// A click track: [bars] bars of [beats] beats at [bpm], first beat accented.
Rendered renderClick(int bpm, int beats, int bars, {int sr = 32000}) {
  final beat = 60 / bpm, len = bars * beats * beat + 1;
  final r = _Renderer(sr, (len * sr).ceil());
  for (var k = 0; k < bars * beats; k++) {
    r.click(0.05 + k * beat, k % beats == 0);
  }
  return Rendered(r.out, sr, len, bars);
}

/// Writes mono float audio as a 16-bit WAV file.
Future<void> writeWav(String path, Float32List pcm, int sr) async {
  final n = pcm.length;
  final b = ByteData(44 + n * 2);
  void s(int o, String v) {
    for (var i = 0; i < v.length; i++) {
      b.setUint8(o + i, v.codeUnitAt(i));
    }
  }

  s(0, 'RIFF');
  b.setUint32(4, 36 + n * 2, Endian.little);
  s(8, 'WAVE');
  s(12, 'fmt ');
  b.setUint32(16, 16, Endian.little);
  b.setUint16(20, 1, Endian.little);
  b.setUint16(22, 1, Endian.little);
  b.setUint32(24, sr, Endian.little);
  b.setUint32(28, sr * 2, Endian.little);
  b.setUint16(32, 2, Endian.little);
  b.setUint16(34, 16, Endian.little);
  s(36, 'data');
  b.setUint32(40, n * 2, Endian.little);
  for (var i = 0; i < n; i++) {
    b.setInt16(44 + i * 2, (pcm[i].clamp(-1.0, 1.0) * 32767).round(), Endian.little);
  }
  final f = File(path);
  await f.parent.create(recursive: true);
  await f.writeAsBytes(b.buffer.asUint8List(), flush: true);
}

/// Renders a beat to a WAV file (call through Isolate.run). Returns [seconds, bars].
Future<List<double>> renderBeatToFile(Map<String, dynamic> beat, double seconds, String path) async {
  final r = renderBeat(Beat.fromJson(beat), seconds);
  await writeWav(path, r.pcm, r.sr);
  return [r.dur, r.bars.toDouble()];
}

Future<double> renderClickToFile(int bpm, int beats, int bars, String path) async {
  final r = renderClick(bpm, beats, bars);
  await writeWav(path, r.pcm, r.sr);
  return r.dur;
}
