// Tap sync / Re-tap: play the song and tap as each line starts.
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../lyrics/retime.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';

class SyncScreen extends StatefulWidget {
  final Item item;
  const SyncScreen({super.key, required this.item});
  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> with SingleTickerProviderStateMixin {
  late final List<String> lines = lyricLines(widget.item.body);
  final List<double> marks = [];
  late final Ticker _ticker;
  bool ready = false, failed = false, _polling = false, dragging = false;
  double t = 0, dur = 0, rate = 1;
  bool playing = false;
  double? dragV;
  int flash = 0;

  Engine get e => Engine.i;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((_) => _tick());
    _load();
  }

  Future<void> _load() async {
    final src = musicFor(widget.item);
    final ok = await e.load(asset: src.asset, path: src.path, url: src.url);
    if (!mounted) return;
    if (!ok) {
      setState(() => failed = true);
      return;
    }
    await e.pause();
    await e.seek(0);
    await e.setRate(1);
    await e.setVolume(1);
    dur = e.duration;
    setState(() => ready = true);
    _ticker.start();
  }

  // the audio clock, read synchronously each frame: taps are stamped with what is heard now
  void _tick() {
    final s = e.clock.ok ? e.clock.state : null;
    if (s == null) {
      _pollFallback();
      return;
    }
    _apply(s);
  }

  Future<void> _pollFallback() async {
    if (_polling) return;
    _polling = true;
    final s = await e.state();
    _polling = false;
    if (mounted) _apply(s);
  }

  void _apply(EngineState s) {
    setState(() {
      t = s.pos;
      playing = s.playing;
      if (s.duration > 0) dur = s.duration;
    });
  }

  @override
  void dispose() {
    _ticker.dispose();
    e.pause();
    e.setRate(1);
    super.dispose();
  }

  void tap() {
    if (marks.length >= lines.length) return;
    if (!playing) e.play();
    final lat = Store.i.sd('tapLat');
    var v = t - lat * rate.clamp(0.0, 1.0);
    if (marks.isNotEmpty && v <= marks.last) v = marks.last + 0.05;
    marks.add(double.parse(v.clamp(0.0, 1e9).toStringAsFixed(3)));
    setState(() => flash++);
  }

  void undo() {
    if (marks.isEmpty) return;
    final m = marks.removeLast();
    e.seek((m - 2).clamp(0.0, dur));
    setState(() {});
  }

  void setRate(double r) {
    rate = r;
    e.setRate(r);
    setState(() {});
  }

  void save() {
    final it = widget.item;
    if (marks.isEmpty) {
      toast(context, 'Tap along with at least one line first');
      return;
    }
    final n = lines.length, old = it.times, last = marks.last;
    it.times = [for (var i = 0; i < n; i++) i < marks.length ? marks[i] : (old.length == n && old[i] != null && old[i]! > last ? old[i] : null)];
    finishTiming(it);
    markTimed(it);
    it.refined = 0;
    it.touch();
    Store.i.save();
    Navigator.pop(context);
    toast(context, 'Saved timing for ${marks.length} of $n lines · word timing added');
  }

  @override
  Widget build(BuildContext context) {
    final i = marks.length, n = lines.length;
    return PopScope(
      canPop: marks.isEmpty,
      onPopInvokedWithResult: (did, _) async {
        if (did) return;
        if (await confirm(context, 'Leave without saving?', 'Your taps on this run will be lost.', 'Leave', danger: true)) {
          if (context.mounted) {
            marks.clear();
            Navigator.pop(context);
          }
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.item.title, overflow: TextOverflow.ellipsis),
          actions: [TextButton(onPressed: ready ? save : null, child: const Text('Save', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)))],
        ),
        body: failed
            ? const Center(child: Text('Couldn’t load the music.', style: TextStyle(color: C.muted)))
            : !ready
                ? const Center(child: CircularProgressIndicator())
                : SafeArea(
                    child: Column(children: [
                      const SizedBox(height: 12),
                      Text('${i.clamp(0, n)} of $n lines tapped', style: const TextStyle(color: C.muted)),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                            Text(i > 0 ? lines[i - 1] : '', textAlign: TextAlign.center, style: const TextStyle(color: C.faint, fontSize: 18)),
                            const SizedBox(height: 18),
                            Text(i >= n ? 'All lines tapped' : (i == 0 ? 'Tap when the first line starts' : 'Tap when this line starts'),
                                style: const TextStyle(color: C.brand, fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
                            const SizedBox(height: 8),
                            TweenAnimationBuilder<double>(
                              key: ValueKey(flash),
                              tween: Tween(begin: 1.08, end: 1),
                              duration: const Duration(milliseconds: 220),
                              builder: (_, s, child) => Transform.scale(scale: s, child: child),
                              child: Text(i < n ? lines[i] : 'Press Save to keep your timing',
                                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, height: 1.25)),
                            ),
                            const SizedBox(height: 18),
                            Text(i + 1 < n ? lines[i + 1] : '', textAlign: TextAlign.center, style: const TextStyle(color: C.faint, fontSize: 18)),
                          ]),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Row(children: [
                          SizedBox(width: 48, child: Text(fmtTime(dragV ?? t), style: const TextStyle(color: C.muted, fontFeatures: [FontFeature.tabularFigures()]))),
                          Expanded(
                            child: Slider(
                              value: (dragV ?? t).clamp(0.0, dur > 0 ? dur : 1.0),
                              max: dur > 0 ? dur : 1,
                              onChangeStart: (v) => setState(() => dragV = v),
                              onChanged: (v) => setState(() => dragV = v),
                              onChangeEnd: (v) {
                                e.seek(v);
                                marks.removeWhere((m) => m >= v);
                                setState(() => dragV = null);
                              },
                            ),
                          ),
                          SizedBox(width: 48, child: Text(fmtTime(dur), textAlign: TextAlign.right, style: const TextStyle(color: C.muted))),
                        ]),
                      ),
                      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        for (final r in const [0.5, 0.75, 1.0])
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: Pill(r == 1 ? '1×' : '$r×', selected: rate == r, onTap: () => setRate(r)),
                          ),
                      ]),
                      const SizedBox(height: 16),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                        child: Row(children: [
                          IconButton.filledTonal(onPressed: marks.isEmpty ? null : undo, icon: const Icon(Icons.undo), tooltip: 'Undo last tap'),
                          const SizedBox(width: 12),
                          Expanded(
                            child: SizedBox(
                              height: 72,
                              child: FilledButton(
                                onPressed: i >= n ? null : tap,
                                style: FilledButton.styleFrom(backgroundColor: C.brand, foregroundColor: Colors.white),
                                child: const Text('Tap', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          IconButton.filledTonal(onPressed: () => playing ? e.pause() : e.play(), icon: Icon(playing ? Icons.pause : Icons.play_arrow), tooltip: playing ? 'Pause' : 'Play'),
                        ]),
                      ),
                    ]),
                  ),
      ),
    );
  }
}
