// Sound recorder: hums, vocals, foley and ideas, optionally over a backing track. Saved as a sound
// that can be used as music anywhere.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../core/text.dart';
import '../screens/take_editor.dart';
import '../widgets/ui.dart';
import 'beat_maker.dart';

class Recorder extends StatefulWidget {
  const Recorder({super.key});
  @override
  State<Recorder> createState() => _RecorderState();
}

class _RecorderState extends State<Recorder> with SingleTickerProviderStateMixin {
  Engine get e => Engine.i;
  bool recording = false, busy = false;
  bool clean = true;
  Item? backing;
  String? stem, mix;
  double secs = 0, micDb = -90;
  final List<double> levels = [];
  late final Ticker _ticker;
  bool _polling = false;
  final Stopwatch watch = Stopwatch();
  final name = TextEditingController(text: 'My sound');

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((_) => _tick())..start();
  }

  Future<void> _tick() async {
    if (!recording || _polling) return;
    _polling = true;
    final s = await e.state();
    _polling = false;
    if (!mounted) return;
    setState(() {
      micDb = s.micDb;
      secs = watch.elapsedMilliseconds / 1000;
      levels.add(((micDb + 60) / 60).clamp(0.0, 1.0));
      if (levels.length > 240) levels.removeAt(0);
    });
  }

  @override
  void dispose() {
    _ticker.dispose();
    if (recording) {
      e.stopRecord().then((_) => e.closeMic());
    }
    e.pause();
    _rm(stem);
    _rm(mix);
    name.dispose();
    super.dispose();
  }

  void _rm(String? p) {
    if (p == null) return;
    try {
      File(p).deleteSync();
    } catch (_) {}
  }

  Future<void> start() async {
    if (!await e.requestPermissions(['android.permission.RECORD_AUDIO'])) {
      if (mounted) toast(context, 'Allow the microphone to record.');
      return;
    }
    _rm(stem);
    _rm(mix);
    stem = mix = null;
    var hasBack = false;
    if (backing != null) {
      final src = instSource(backing!);
      hasBack = await e.load(asset: src.asset, path: src.path, url: src.url);
      if (hasBack) {
        await e.seek(0);
        await e.setVolume(0.7);
      }
    } else {
      await e.unload();
    }
    final mode = hasBack && !e.route.headphones ? RecMode.mixAec : (hasBack ? RecMode.mix : RecMode.mic);
    final r = await e.openMic(mode: mode, nc: clean, gainDb: Store.i.sd('micGain'));
    if (r['ok'] != true) {
      if (mounted) toast(context, 'The microphone couldn’t start.');
      return;
    }
    final id = Store.uid();
    stem = Store.i.mediaPath('snd-$id-voice.wav');
    mix = Store.i.mediaPath('snd-$id.m4a');
    if (!await e.startRecord(stem!)) {
      await e.closeMic();
      if (mounted) toast(context, 'Recording couldn’t start.');
      return;
    }
    levels.clear();
    watch
      ..reset()
      ..start();
    if (hasBack) await e.play();
    setState(() => recording = true);
  }

  Future<void> stop() async {
    watch.stop();
    setState(() => busy = true);
    final res = await e.stopRecord();
    await e.pause();
    await e.closeMic();
    secs = res.seconds;
    // loudness-normalised preview (and what gets saved)
    try {
      await e.finishTake(voice: stem!, mode: 0, wav: '${mix!}.wav', out: mix!);
    } catch (err) {
      if (mounted) toast(context, 'Couldn’t process the recording: $err');
    }
    setState(() {
      recording = false;
      busy = false;
    });
  }

  Future<void> save() async {
    if (stem == null) return;
    setState(() => busy = true);
    final id = 'snd-${Store.uid()}';
    final file = '$id.m4a';
    try {
      await File(mix!).rename(Store.i.mediaPath(file));
    } catch (err) {
      if (mounted) toast(context, 'Couldn’t save the sound: $err');
      setState(() => busy = false);
      return;
    }
    final nm = name.text.trim().isEmpty ? 'My sound' : name.text.trim();
    addUserInst(id: id, name: nm, file: file, dur: secs, store: 'snd', extra: {'mood': 'Your sound'});
    _rm(stem);
    _rm(mix);
    stem = mix = null;
    if (!mounted) return;
    Navigator.pop(context);
    toast(context, 'Saved “$nm” to your sounds');
  }

  @override
  Widget build(BuildContext context) {
    final done = !recording && mix != null && File(mix!).existsSync();
    return Scaffold(
      appBar: AppBar(title: const Text('Sound recorder')),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 40), children: [
        const Text('Record a melody idea, a vocal, a sound effect or a whole acapella. It’s saved as a sound you can use anywhere.', style: TextStyle(color: C.muted)),
        const SizedBox(height: 20),
        Container(
          height: 120,
          decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(18)),
          child: CustomPaint(painter: _Wave(levels)),
        ),
        const SizedBox(height: 24),
        Center(
          child: GestureDetector(
            onTap: busy ? null : (recording ? stop : start),
            child: Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 4)),
              alignment: Alignment.center,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: recording ? 34 : 70,
                height: recording ? 34 : 70,
                decoration: BoxDecoration(color: C.hot, borderRadius: BorderRadius.circular(recording ? 8 : 40)),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Center(child: Text(fmtTime(secs), style: const TextStyle(fontSize: 22, fontFeatures: [FontFeature.tabularFigures()]))),
        const SizedBox(height: 16),
        Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: [
          Pill('Clean up noise', icon: Icons.auto_fix_high, selected: clean, onTap: recording ? null : () => setState(() => clean = !clean)),
          Pill(backing == null ? 'Backing: none' : 'Backing: ${backing!.title}', icon: Icons.headphones, selected: backing != null, onTap: recording
              ? null
              : () => actionSheet(context, 'Backing track', [
                    SheetAction(Icons.music_off_outlined, 'None', () => setState(() => backing = null)),
                    for (final x in instruments()) SheetAction(Icons.graphic_eq, x.title, () => setState(() => backing = x), sub: fmtTime(x.dur)),
                  ], note: 'The backing plays while you record; only your sound is saved. Headphones keep it out of the mic.')),
        ]),
        if (done) ...[
          const SizedBox(height: 26),
          Player(key: ValueKey(mix), path: mix!, video: false),
          TextField(controller: name, maxLength: 40, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
                child: OutlinedButton(
                    onPressed: () {
                      _rm(stem);
                      _rm(mix);
                      setState(() {
                        stem = mix = null;
                        secs = 0;
                        levels.clear();
                      });
                    },
                    child: const Text('Discard'))),
            const SizedBox(width: 10),
            Expanded(child: FilledButton(onPressed: busy ? null : save, child: const Text('Save sound'))),
          ]),
        ],
      ]),
    );
  }
}

class _Wave extends CustomPainter {
  final List<double> v;
  _Wave(this.v);
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()
      ..color = C.brand
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    const n = 120;
    final start = v.length > n ? v.length - n : 0;
    for (var i = start; i < v.length; i++) {
      final x = (i - start) / n * s.width;
      final h = 4 + v[i] * (s.height - 16);
      c.drawLine(Offset(x, s.height / 2 - h / 2), Offset(x, s.height / 2 + h / 2), p);
    }
  }

  @override
  bool shouldRepaint(_Wave o) => true;
}
