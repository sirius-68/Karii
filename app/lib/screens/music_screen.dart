// Background music for a project: pick it (your files or the library), preview, trim, loop,
// fades, the level you hear while performing, and how it sits under your voice in the video.
import 'dart:async';

import 'package:flutter/material.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../core/text.dart';
import '../engine/engine.dart';
import '../widgets/ui.dart';

class MusicScreen extends StatefulWidget {
  final Item item;
  const MusicScreen({super.key, required this.item});
  @override
  State<MusicScreen> createState() => _MusicScreenState();
}

class _MusicScreenState extends State<MusicScreen> {
  Item get it => widget.item;
  Engine get e => Engine.i;
  MusicSettings get ms => it.musicSettings;
  MusicSource src = MusicSource.empty;
  double dur = 0, pos = 0;
  bool loading = false, playing = false;
  double? drag;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _load();
    _t = Timer.periodic(const Duration(milliseconds: 100), (_) async {
      final s = await e.state();
      if (!mounted) return;
      if ((s.pos - pos).abs() > 0.01 || s.playing != playing) setState(() {
        pos = s.pos;
        playing = s.playing;
      });
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    e.pause();
    Store.i.save();
    super.dispose();
  }

  double get regionEnd => ms.trimEnd > 0 && ms.trimEnd <= dur ? ms.trimEnd : dur;

  Future<void> _load() async {
    src = musicFor(it);
    await e.pause();
    if (src.none) {
      setState(() => dur = 0);
      return;
    }
    setState(() => loading = true);
    final ok = await e.load(asset: src.asset, path: src.path, url: src.url);
    if (!mounted) return;
    loading = false;
    if (!ok) {
      setState(() => dur = 0);
      toast(context, 'Couldn’t load the music${src.url != null ? '. Are you online?' : '.'}');
      return;
    }
    dur = e.duration;
    await e.setRate(1);
    await e.setVolume(ms.volume);
    await _apply();
    await e.seek(ms.trimStart);
    if (mounted) setState(() {});
  }

  Future<void> _apply() => e.setMusic(start: ms.trimStart, end: ms.trimEnd, loop: ms.loop, fadeIn: ms.fadeIn, fadeOut: ms.fadeOut);

  void set(Map<String, dynamic> c, {bool shape = false}) {
    it.musicSettings = ms.copyWith(c);
    it.touch();
    Store.i.save();
    setState(() {});
    if (shape) _apply();
    if (c.containsKey('volume')) e.setVolume(ms.volume);
  }

  Future<void> choose() async {
    await actionSheet(context, 'Background music', [
      SheetAction(Icons.upload_file, 'Your audio file', upload, sub: 'MP3, M4A, WAV… stays on this phone'),
      for (final x in instruments())
        SheetAction(Icons.graphic_eq, x.title, () => _use({'type': 'inst', 'id': x.id, 'name': x.title}),
            sub: [if (x.m['mood'] != null) '${x.m['mood']}', if (!x.isCat) 'Yours', if (x.dur > 0) fmtTime(x.dur)].join(' · ')),
    ]);
  }

  Future<void> upload() async {
    final r = await e.pickFile('audio/*');
    if (r == null || !mounted) return;
    await _use({'type': 'file', 'path': r['path'], 'name': r['name']});
  }

  Future<void> _use(Map<String, dynamic> m) async {
    final old = it.music, oldSettings = ms.m;
    it.music = m;
    // a new track starts untrimmed; levels and fades carry over
    it.musicSettings = ms.copyWith({'trimStart': 0.0, 'trimEnd': 0.0});
    await _load();
    if (!mounted) return;
    if (dur <= 0) {
      it.music = old;
      it.musicSettings = MusicSettings(oldSettings);
      await _load();
    } else {
      toast(context, 'Music set: ${musicFor(it).label}');
    }
    it.touch();
    Store.i.save();
  }

  Future<void> remove() async {
    await e.pause();
    it.music = {'type': 'none'};
    it.touch();
    Store.i.save();
    await _load();
  }

  Future<void> togglePlay() async {
    if (dur <= 0) return;
    if (playing) {
      await e.pause();
    } else {
      await _apply();
      await e.setVolume(ms.volume);
      await e.play();
    }
  }

  @override
  Widget build(BuildContext context) {
    final has = !src.none && dur > 0;
    return Scaffold(
      appBar: AppBar(title: const Text('Background music')),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 40), children: [
        _card(Row(children: [
          const Icon(Icons.music_note_outlined, color: C.muted),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(src.none ? 'No music' : (src.label.isEmpty ? 'Your track' : src.label), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16), maxLines: 2, overflow: TextOverflow.ellipsis),
              Text(src.none ? 'Perform over silence, or add a track' : loading ? 'Loading…' : has ? fmtTime(dur) : 'Couldn’t be loaded', style: const TextStyle(color: C.muted, fontSize: 13)),
            ]),
          ),
          TextButton(onPressed: choose, child: Text(src.none ? 'Add' : 'Replace')),
          if (!src.none) IconButton(onPressed: remove, icon: const Icon(Icons.delete_outline, color: C.muted), tooltip: 'Remove music'),
        ])),
        if (has) ...[
          const SizedBox(height: 18),
          _title('Preview and trim'),
          Row(children: [
            IconButton.filled(
              onPressed: togglePlay,
              style: IconButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.black, fixedSize: const Size(52, 52)),
              icon: Icon(playing ? Icons.pause : Icons.play_arrow),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Slider(
                value: (drag ?? pos).clamp(0.0, dur),
                max: dur,
                onChanged: (v) => setState(() => drag = v),
                onChangeEnd: (v) async {
                  await e.seek(v);
                  setState(() => drag = null);
                },
              ),
            ),
            SizedBox(width: 44, child: Text(fmtTime(drag ?? pos), textAlign: TextAlign.right, style: const TextStyle(color: C.muted, fontFeatures: [FontFeature.tabularFigures()]))),
          ]),
          RangeSlider(
            values: RangeValues(ms.trimStart.clamp(0.0, dur), regionEnd.clamp(0.0, dur)),
            max: dur,
            onChanged: (r) {
              if (r.end - r.start < 1) return;
              it.musicSettings = ms.copyWith({'trimStart': _r(r.start), 'trimEnd': r.end >= dur - 0.05 ? 0.0 : _r(r.end)});
              setState(() {});
            },
            onChangeEnd: (_) => set({}, shape: true),
          ),
          Row(children: [
            Text('Plays ${fmtTimePrecise(ms.trimStart)} – ${fmtTimePrecise(regionEnd)}  (${fmtTime(regionEnd - ms.trimStart)})', style: const TextStyle(color: C.muted, fontSize: 13)),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 8, children: [
            Pill('Start here', icon: Icons.first_page, onTap: pos < regionEnd - 1 ? () => set({'trimStart': _r(pos)}, shape: true) : null),
            Pill('End here', icon: Icons.last_page, onTap: pos > ms.trimStart + 1 ? () => set({'trimEnd': _r(pos)}, shape: true) : null),
            if (ms.trimStart > 0 || ms.trimEnd > 0) Pill('Whole track', icon: Icons.restart_alt, onTap: () => set({'trimStart': 0.0, 'trimEnd': 0.0}, shape: true)),
          ]),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Loop'),
            subtitle: const Text('Repeat the trimmed part for longer performances', style: TextStyle(color: C.muted)),
            value: ms.loop,
            onChanged: (v) => set({'loop': v}, shape: true),
          ),
          _row('Fade in', '${ms.fadeIn.toStringAsFixed(1)} s'),
          Slider(value: ms.fadeIn.clamp(0.0, 8.0), max: 8, divisions: 16, onChanged: (v) => set({'fadeIn': v}), onChangeEnd: (_) => _apply()),
          _row('Fade out', '${ms.fadeOut.toStringAsFixed(1)} s'),
          Slider(value: ms.fadeOut.clamp(0.0, 10.0), max: 10, divisions: 20, onChanged: (v) => set({'fadeOut': v}), onChangeEnd: (_) => _apply()),
          Text(ms.loop ? 'The music fades out when you stop recording.' : 'The music fades out at the end of the trimmed part, or when you stop recording.',
              style: const TextStyle(color: C.faint, fontSize: 12.5)),
          const SizedBox(height: 18),
          _title('While you perform'),
          _row('Music volume', '${(ms.volume * 100).round()}%'),
          Slider(value: ms.volume.clamp(0.0, 1.0), onChanged: (v) => set({'volume': double.parse(v.toStringAsFixed(2))})),
          const Text('What you hear in your headphones or on the speaker.', style: TextStyle(color: C.faint, fontSize: 12.5)),
          const SizedBox(height: 18),
          _title('In the finished video'),
          _row('Music level', '${ms.balanceDb >= 0 ? '+' : ''}${ms.balanceDb.round()} dB'),
          Slider(value: ms.balanceDb.clamp(-12.0, 6.0), min: -12, max: 6, divisions: 18, onChanged: (v) => set({'balanceDb': v.roundToDouble()})),
          const Text('Voice to music balance. 0 dB keeps the music comfortably under your voice.', style: TextStyle(color: C.faint, fontSize: 12.5)),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Lower the music while you speak'),
            subtitle: const Text('Smooth ducking: no jumps between words or breaths', style: TextStyle(color: C.muted)),
            value: ms.duck,
            onChanged: (v) => set({'duck': v}),
          ),
          if (ms.duck) ...[
            _row('Lower by', '${ms.duckDb.round()} dB'),
            Slider(value: ms.duckDb.clamp(3.0, 18.0), min: 3, max: 18, divisions: 15, onChanged: (v) => set({'duckDb': v.roundToDouble()})),
          ],
          const SizedBox(height: 10),
          const Text(
            'With headphones (or the clean-mix setting on the speaker), your voice is recorded on its own and the music is mixed in afterwards on the same timeline, so levels, fades and ducking can be changed after recording.',
            style: TextStyle(color: C.muted, fontSize: 13, height: 1.4),
          ),
        ],
      ]),
    );
  }

  double _r(double v) => (v * 100).round() / 100;

  Widget _card(Widget child) => Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(18)),
        child: child,
      );

  Widget _title(String t) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(t, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)));

  Widget _row(String a, String b) => Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Row(children: [Text(a, style: const TextStyle(fontWeight: FontWeight.w600)), const Spacer(), Text(b, style: const TextStyle(color: C.muted))]),
      );
}
