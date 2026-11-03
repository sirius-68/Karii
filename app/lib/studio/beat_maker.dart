// Beat maker: six styles, tempo, key, chord progression, a 16-step drum grid and instrument layers.
import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../core/text.dart';
import '../widgets/ui.dart';
import 'lyric_pad.dart';
import 'synth.dart';

/// Renders off the UI thread (top-level so the closure captures nothing else).
Future<List<double>> renderInIsolate(Map<String, dynamic> cfg, double seconds, String path) => Isolate.run(() => renderBeatToFile(cfg, seconds, path));

Future<double> clickInIsolate(int bpm, int beats, int bars, String path) => Isolate.run(() => renderClickToFile(bpm, beats, bars, path));

/// Saves a rendered beat or sound as one of the user's instrumentals.
Item addUserInst({required String id, required String name, required String file, required double dur, required String store, Map<String, dynamic>? extra}) {
  final st = Store.i;
  st.items.removeWhere((x) => x.id == id);
  final it = Item({
    'id': id,
    'kind': 'inst',
    'title': name,
    'file': file,
    'dur': dur,
    'store': store,
    'updated': DateTime.now().millisecondsSinceEpoch,
    ...?extra,
  });
  st.items.add(it);
  st.save();
  return it;
}

class BeatMaker extends StatefulWidget {
  final Item? edit;
  const BeatMaker({super.key, this.edit});
  @override
  State<BeatMaker> createState() => _BeatMakerState();
}

class _BeatMakerState extends State<BeatMaker> with SingleTickerProviderStateMixin {
  late Beat b;
  bool playing = false, rendering = false;
  String? previewPath;
  Timer? _deb;
  late final Ticker _ticker;
  bool _polling = false;
  double pos = 0, previewDur = 0;
  int gen = 0;

  Engine get e => Engine.i;

  @override
  void initState() {
    super.initState();
    final cfg = widget.edit?.m['cfg'] ?? Store.i.settings['beatDraft'];
    try {
      b = cfg is Map ? Beat.fromJson(cfg) : Beat.fromStyle('pop');
    } catch (_) {
      b = Beat.fromStyle('pop');
    }
    _ticker = createTicker((_) => _tick())..start();
  }

  Future<void> _tick() async {
    if (!playing || _polling) return;
    _polling = true;
    final s = await e.state();
    _polling = false;
    if (!mounted || !playing) return;
    pos = s.pos;
    // loop the bars (skip the ending chord)
    final loopEnd = previewDur - 2.5;
    if (loopEnd > 1 && (s.pos >= loopEnd || !s.playing)) {
      await e.seek(0.05);
      if (!s.playing) await e.play();
    }
    final sd = 60 / b.bpm / 4;
    final step = ((pos - 0.05) / sd).floor() % 16;
    if (step != _step) setState(() => _step = step);
  }

  int _step = -1;

  @override
  void dispose() {
    _deb?.cancel();
    _ticker.dispose();
    if (playing) e.pause();
    Store.i.settings['beatDraft'] = b.toJson();
    Store.i.save();
    _cleanPreview();
    super.dispose();
  }

  void _cleanPreview() {
    if (previewPath != null) {
      try {
        File(previewPath!).deleteSync();
      } catch (_) {}
    }
  }

  void changed() {
    setState(() {});
    if (!playing) return;
    _deb?.cancel();
    _deb = Timer(const Duration(milliseconds: 350), () => _render(restart: false));
  }

  Future<void> _render({bool restart = true}) async {
    final my = ++gen;
    setState(() => rendering = true);
    final path = '${Store.i.dir.path}/cache/beat-preview-$my.wav';
    final cfg = b.toJson();
    final bars = 8 * 60 / b.bpm * 4;
    try {
      await renderInIsolate(cfg, bars, path);
    } catch (err) {
      if (mounted) toast(context, 'Couldn’t render the beat');
      setState(() => rendering = false);
      return;
    }
    if (!mounted || my != gen) {
      try {
        File(path).deleteSync();
      } catch (_) {}
      return;
    }
    final keep = restart ? 0.05 : pos;
    final ok = await e.load(path: path);
    _cleanPreview();
    previewPath = path;
    previewDur = e.duration;
    if (ok && playing) {
      final loopEnd = previewDur - 2.5;
      await e.seek(keep < loopEnd ? keep : 0.05);
      await e.setVolume(0.9);
      await e.setRate(1);
      await e.play();
    }
    if (mounted) setState(() => rendering = false);
  }

  Future<void> toggle() async {
    if (playing) {
      playing = false;
      await e.pause();
      setState(() {});
      return;
    }
    playing = true;
    await _render();
  }

  void style(String id) {
    final k = b.key;
    b = Beat.fromStyle(id, k);
    changed();
  }

  void surprise() {
    final r = math.Random();
    final ids = beatStyles.keys.toList();
    b = Beat.fromStyle(ids[r.nextInt(ids.length)], beatKeys.keys.elementAt(r.nextInt(beatKeys.length)));
    b.prog = [...progressions[r.nextInt(progressions.length)]];
    b.bpm = (b.bpm + r.nextInt(17) - 8).clamp(60, 160);
    for (final row in ['kick', 'snare', 'hat', 'clap']) {
      for (var i = 0; i < 16; i++) {
        if (r.nextDouble() < 0.06) b.steps[row]![i] = !b.steps[row]![i];
      }
    }
    changed();
  }

  Future<void> save() async {
    final old = widget.edit;
    final name = TextEditingController(text: old?.title ?? '${beatStyles[b.style]!.name} beat ${Store.i.items.where((x) => x.m['store'] == 'beat').length + 1}');
    var len = 90;
    final r = await sheet<bool>(
      context,
      (c) => StatefulBuilder(
        builder: (c, set) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Save beat', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              TextField(controller: name, maxLength: 40, decoration: const InputDecoration(labelText: 'Name')),
              const Text('Length', style: TextStyle(color: C.muted)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [for (final v in const [30, 60, 90, 150]) Pill(v < 60 ? '$v s' : '${v / 60} min'.replaceAll('.0', ''), selected: len == v, onTap: () => set(() => len = v))]),
              const SizedBox(height: 18),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(old != null ? 'Update' : 'Render & save'))),
            ]),
          ),
        ),
      ),
    );
    if (r != true || !mounted) return;
    if (playing) await toggle();
    if (!mounted) return;
    toast(context, 'Rendering “${name.text.trim()}”…');
    final id = old?.id ?? 'beat-${Store.uid()}';
    final file = '$id-${DateTime.now().millisecondsSinceEpoch}.wav';
    final path = Store.i.mediaPath(file);
    final cfg = b.toJson();
    try {
      final res = await renderInIsolate(cfg, len.toDouble(), path);
      final oldFile = old?.m['file'] as String?;
      if (oldFile != null) {
        try {
          File(Store.i.mediaPath(oldFile)).deleteSync();
        } catch (_) {}
      }
      final nm = name.text.trim().isEmpty ? 'My beat' : name.text.trim();
      final it = addUserInst(id: id, name: nm, file: file, dur: res[0], store: 'beat', extra: {
        'cfg': cfg,
        'bpm': b.bpm,
        'beats': 4,
        'key': b.key,
        'mood': '${beatStyles[b.style]!.name} · ${b.bpm} BPM',
      });
      if (!mounted) return;
      await actionSheet(context, 'Saved “$nm”', [
        SheetAction(Icons.edit_note, 'Write lyrics on this beat', () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => LyricPad(beat: it))),
            sub: 'Lines snap to the bars automatically'),
        SheetAction(Icons.queue_music, 'Use as music bed', () {
          Store.i.set('bed', it.id);
          toast(context, 'Music bed set');
        }, sub: 'Plays under poems, scripts and lines'),
        SheetAction(Icons.check, 'Done', () {}),
      ], note: '${fmtTime(res[0])} · ${b.bpm} BPM · ${chordName(b.prog[0], b.key)}');
    } catch (err) {
      if (mounted) toast(context, 'Couldn’t render the beat: $err');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Beat maker'), actions: [
        IconButton(onPressed: surprise, icon: const Icon(Icons.casino_outlined), tooltip: 'Surprise me'),
        TextButton(onPressed: save, child: const Text('Save', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
      ]),
      floatingActionButton: FloatingActionButton.large(
        onPressed: toggle,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        child: rendering ? const CircularProgressIndicator(color: Colors.black) : Icon(playing ? Icons.pause : Icons.play_arrow, size: 40),
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 140), children: [
        _h('Style'),
        Wrap(spacing: 8, runSpacing: 8, children: [for (final s in beatStyles.entries) Pill(s.value.name, selected: b.style == s.key, onTap: () => style(s.key))]),
        _h('Tempo', '${b.bpm} BPM'),
        Slider(value: b.bpm.toDouble(), min: 60, max: 160, divisions: 100, onChanged: (v) => setState(() => b.bpm = v.round()), onChangeEnd: (_) => changed()),
        _h('Key'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final k in beatKeys.keys)
            Pill(k.replaceAll('b', '♭'), selected: b.key == k, onTap: () {
              b.key = k;
              changed();
            }),
        ]),
        _h('Chords'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in progressions)
            Pill(p.map((d) => chordName(d, b.key)).join(' – '), selected: p.join() == b.prog.join(), onTap: () {
              b.prog = [...p];
              changed();
            }),
        ]),
        _h('Drums'),
        for (final row in const ['kick', 'snare', 'hat', 'clap']) _grid(row),
        _h('Layers'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final l in const [('keys', 'Keys'), ('pad', 'Pad'), ('bass', 'Bass'), ('arp', 'Arpeggio'), ('vinyl', 'Vinyl crackle')])
            Pill(l.$2, selected: b.layers[l.$1] == true, onTap: () {
              b.layers[l.$1] = !(b.layers[l.$1] == true);
              changed();
            }),
        ]),
        _h('Swing', '${(b.swing * 100).round()}%'),
        Slider(value: b.swing.clamp(0.0, 0.4), max: 0.4, onChanged: (v) => setState(() => b.swing = v), onChangeEnd: (_) => changed()),
      ]),
    );
  }

  Widget _h(String t, [String? v]) => Padding(
        padding: const EdgeInsets.only(top: 20, bottom: 10),
        child: Row(children: [
          Text(t, style: const TextStyle(fontWeight: FontWeight.w700, color: C.muted, letterSpacing: 0.3)),
          const Spacer(),
          if (v != null) Text(v, style: const TextStyle(fontWeight: FontWeight.w600)),
        ]),
      );

  Widget _grid(String row) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          SizedBox(width: 48, child: Text(row[0].toUpperCase() + row.substring(1), style: const TextStyle(color: C.muted, fontSize: 12.5))),
          for (var i = 0; i < 16; i++)
            Expanded(
              child: GestureDetector(
                onTap: () {
                  b.steps[row]![i] = !b.steps[row]![i];
                  changed();
                },
                child: Container(
                  height: 30,
                  margin: EdgeInsets.only(right: i % 4 == 3 ? 4 : 1.5),
                  decoration: BoxDecoration(
                    color: b.steps[row]![i] ? (playing && _step == i ? C.amber : C.brand) : (playing && _step == i ? C.s4 : (i ~/ 4).isEven ? C.s3 : C.s2),
                    borderRadius: BorderRadius.circular(5),
                  ),
                ),
              ),
            ),
        ]),
      );
}
