// Lyric pad: write a song with syllable counts and rhymes, set the tempo, and place the lines on the beat.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../lyrics/retime.dart';
import '../lyrics/timing.dart';
import '../screens/nav.dart';
import '../widgets/ui.dart';
import 'beat_maker.dart';

const _localWords = 'light night bright tonight right fight sight flight white bite delight might kite quite slight tight write '
    'day way stay play say away today okay pray gray stray sway display heart apart start part art smart chart love above of enough '
    'fire higher desire wire tired dream seem team beam stream scream gleam soul whole roll control gold hold cold told old bold '
    'time rhyme climb mine line shine sign fine wine design divine more door floor before shore core roar you true through new blue do too knew view '
    'me free see be sea three key tree believe rain again pain chain brain plane remain home alone stone phone own known shown grown '
    'fall all call wall small tall go know show slow flow glow low snow though below sky high fly why try cry goodbye eye lie '
    'run sun fun done one someone none begun side ride wide tide pride hide inside alive down town crown around sound ground found baby maybe crazy lazy';

final Map<String, (List<String>, String)> _rhymeCache = {};

List<String> _localRhymes(String n, String text) {
  if (n.length < 2) return [];
  final tail = n.substring(n.length - (n.length < 3 ? n.length : 3)), tail2 = n.substring(n.length - 2);
  final pool = {..._localWords.split(' '), ...RegExp(r"[A-Za-z']+").allMatches(text).map((m) => m.group(0)!.toLowerCase())}..remove(n);
  return [...pool.where((x) => x.endsWith(tail)), ...pool.where((x) => x.endsWith(tail2) && !x.endsWith(tail))].take(14).toList();
}

Future<(List<String>, String)> rhymesFor(String w, String text) async {
  final n = normWord(w);
  if (n.isEmpty) return (<String>[], '');
  final c = _rhymeCache[n];
  if (c != null) return c;
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
  try {
    Future<List<String>> q(String rel, int max) async {
      final req = await client.getUrl(Uri.parse('https://api.datamuse.com/words?$rel=${Uri.encodeQueryComponent(n)}&max=$max'));
      final res = await req.close().timeout(const Duration(seconds: 4));
      final body = await res.transform(utf8.decoder).join();
      return (jsonDecode(body) as List).map((x) => '${x['word']}').toList();
    }

    var list = await q('rel_rhy', 16);
    if (list.length < 6) list = [...list, ...await q('rel_nry', 10)];
    final r = (list.toSet().take(16).toList(), 'Datamuse');
    _rhymeCache[n] = r;
    return r;
  } catch (_) {
    return (_localRhymes(n, text), 'offline');
  } finally {
    client.close();
  }
}

class LyricPad extends StatefulWidget {
  final Item? item;
  final Item? beat;
  const LyricPad({super.key, this.item, this.beat});
  @override
  State<LyricPad> createState() => _LyricPadState();
}

class _LyricPadState extends State<LyricPad> {
  late final Item s;
  late final TextEditingController title, body;
  double per = 2;
  int intro = 1;
  final List<int> taps = [];
  bool metro = false;
  String rhymeWord = '';
  (List<String>, String) rhymes = (<String>[], '');
  Timer? _rt;
  int line = 0, syl = 0;

  Store get st => Store.i;

  @override
  void initState() {
    super.initState();
    if (widget.item != null) {
      s = widget.item!;
    } else {
      s = st.create(Kind.song);
      if (widget.beat != null) {
        s.music = {'type': 'inst', 'id': widget.beat!.id, 'name': widget.beat!.title};
        s.dur = widget.beat!.dur;
      }
    }
    title = TextEditingController(text: s.rawTitle);
    body = TextEditingController(text: s.body);
    body.addListener(_caret);
  }

  @override
  void dispose() {
    _rt?.cancel();
    if (metro) Engine.i.pause();
    save();
    retimeIfLyricsChanged(s);
    if (s.rawTitle.trim().isEmpty && s.body.trim().isEmpty) st.deleteItem(s);
    title.dispose();
    body.dispose();
    super.dispose();
  }

  void save() {
    s.title = title.text.replaceAll('\n', ' ');
    s.body = body.text;
    s.touch();
    st.save();
  }

  Item? get beatItem {
    final m = s.music;
    if (m == null || m['type'] != 'inst') return null;
    return st.find('${m['id']}');
  }

  int get beats => (s.m['beats'] as num?)?.toInt() ?? (beatItem?.m['beats'] as num?)?.toInt() ?? 4;
  int get bpm => (s.m['bpm'] as num?)?.toInt() ?? (beatItem?.m['bpm'] as num?)?.toInt() ?? (s.music?['bpm'] as num?)?.toInt() ?? 96;

  String get tempoSource {
    if (s.m['bpm'] != null) return beatItem?.m['bpm'] != null ? 'Set by you · overrides the beat’s tempo' : 'Set by you';
    if (beatItem?.m['bpm'] != null) return 'From your beat';
    if (s.music != null && s.music!['type'] != 'click') return 'Set the tempo of your music so lines land on the bars';
    return 'No beat? Lectern makes a click track so you can sing it in time.';
  }

  void setBpm(num v) {
    s.m['bpm'] = v.round().clamp(50, 200);
    save();
    setState(() {});
    if (metro) _metroStart();
  }

  void _caret() {
    final v = body.text;
    final p = body.selection.baseOffset < 0 ? v.length : body.selection.baseOffset.clamp(0, v.length);
    final before = v.substring(0, p).split('\n');
    final li = before.length - 1;
    final all = v.split('\n');
    final cur = li < all.length ? all[li].trim() : '';
    var target = cur.isNotEmpty && !cur.startsWith('[') ? (lineWords(cur).isNotEmpty ? lineWords(cur).last : '') : '';
    if (target.isEmpty) {
      for (var k = li - 1; k >= 0; k--) {
        final t = all[k].trim();
        if (t.isNotEmpty && !t.startsWith('[')) {
          target = lineWords(t).last;
          break;
        }
      }
    }
    target = target.replaceAll(RegExp(r"[^A-Za-z'\-а-яёА-ЯЁ]"), '');
    setState(() {
      line = li + 1;
      syl = cur.startsWith('[') ? 0 : lineSyllables(cur);
    });
    if (target == rhymeWord) return;
    rhymeWord = target;
    _rt?.cancel();
    if (target.isEmpty) {
      setState(() => rhymes = (<String>[], ''));
      return;
    }
    _rt = Timer(const Duration(milliseconds: 300), () async {
      final r = await rhymesFor(target, v);
      if (mounted && rhymeWord == target) setState(() => rhymes = r);
    });
  }

  void insert(String text, {bool word = false}) {
    final v = body.text;
    final p = body.selection.baseOffset < 0 ? v.length : body.selection.baseOffset.clamp(0, v.length);
    final before = v.substring(0, p), after = v.substring(p);
    final ins = word ? ((before.isNotEmpty && !RegExp(r'\s$').hasMatch(before)) ? ' ' : '') + text : (before.isNotEmpty && !before.endsWith('\n') ? '\n\n' : before.isNotEmpty ? '\n' : '') + text;
    body.value = TextEditingValue(text: before + ins + after, selection: TextSelection.collapsed(offset: p + ins.length));
    save();
  }

  void tapTempo() {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (taps.isNotEmpty && now - taps.last > 2000) taps.clear();
    taps.add(now);
    if (taps.length > 8) taps.removeAt(0);
    if (taps.length >= 3) {
      final iv = [for (var i = 1; i < taps.length; i++) taps[i] - taps[i - 1]]..sort();
      setBpm(60000 / iv[iv.length ~/ 2]);
    } else {
      setState(() {});
    }
  }

  Future<void> _metroStart() async {
    final path = '${st.dir.path}/cache/click-$bpm-$beats.wav';
    if (!File(path).existsSync()) await clickInIsolate(bpm, beats, (bpm * 3 / beats).ceil(), path);
    if (!mounted || !metro) return;
    if (await Engine.i.load(path: path)) {
      await Engine.i.seek(0);
      await Engine.i.setVolume(0.8);
      await Engine.i.play();
    }
  }

  Future<void> toggleMetro() async {
    setState(() => metro = !metro);
    if (metro) {
      await _metroStart();
    } else {
      await Engine.i.pause();
    }
  }

  void chooseMusic() {
    actionSheet(context, 'Music for this song', [
      for (final x in instruments())
        SheetAction(Icons.graphic_eq, x.title, () {
          s.music = {'type': 'inst', 'id': x.id, 'name': x.title};
          s.dur = x.dur;
          save();
          setState(() {});
        }, sub: [if (x.m['mood'] != null) '${x.m['mood']}', if (!x.isCat) 'Yours', fmtTime(x.dur)].join(' · ')),
      SheetAction(Icons.upload_file, 'Upload an audio file', () async {
        final r = await Engine.i.pickFile('audio/*');
        if (r == null || !mounted) return;
        s.music = {'type': 'file', 'path': r['path'], 'name': r['name']};
        if (await Engine.i.load(path: '${r['path']}')) s.dur = Engine.i.duration;
        save();
        setState(() {});
      }),
      if (s.music != null)
        SheetAction(Icons.close, 'No music (click track)', () {
          s.music = null;
          save();
          setState(() {});
        }, danger: true),
    ]);
  }

  Future<void> place() async {
    save();
    final lines = lyricLines(s.body);
    if (lines.isEmpty) {
      toast(context, 'Write some lyrics first');
      return;
    }
    final bpb = beats, tempo = bpm, bar = 60 * bpb / tempo;
    if (s.music == null || s.music!['type'] == 'click') {
      final bars = (intro + lines.length * per + 2).ceil();
      final file = 'click-${s.id}.wav';
      toast(context, 'Making a click track…');
      final dur = await clickInIsolate(tempo, bpb, bars, st.mediaPath(file));
      s.music = {'type': 'file', 'path': st.mediaPath(file), 'name': 'Click track · $tempo BPM', 'click': true, 'bpm': tempo};
      s.dur = dur;
    }
    final t0 = 0.05 + intro * bar;
    final times = [for (var i = 0; i < lines.length; i++) double.parse((t0 + i * per * bar).toStringAsFixed(3))];
    final ends = [
      for (var i = 0; i < lines.length; i++) double.parse(((i + 1 < times.length ? times[i + 1] : times[i] + per * bar) - 0.1).clamp(0, times[i] + per * bar * 0.92).toStringAsFixed(3))
    ];
    s.times = times;
    s.ends = ends;
    s.wt = [for (var i = 0; i < lines.length; i++) distributeWords(lines[i], times[i], ends[i])];
    markTimed(s);
    s.refined = 9;
    s.touch();
    st.save();
    if (!mounted) return;
    setState(() {});
    await actionSheet(context, 'Lines placed on the beat', [
      SheetAction(Icons.mic_external_on, 'Sing it now', () => perform(context, s)),
      SheetAction(Icons.check, 'Keep writing', () {}),
    ], note: '${lines.length} lines · $tempo BPM · ${per == 0.5 ? 'half a' : per.toString().replaceAll('.0', '')} bar${per > 1 ? 's' : ''} per line');
  }

  @override
  Widget build(BuildContext context) {
    final src = musicFor(s);
    final rows = body.text.split('\n');
    final nLines = lyricLines(body.text).length;
    return Scaffold(
      appBar: AppBar(title: const Text('Lyric pad'), actions: [
        TextButton.icon(
          onPressed: () {
            save();
            if (lyricLines(s.body).isEmpty) {
              toast(context, 'Write some lyrics first');
              return;
            }
            perform(context, s);
          },
          icon: const Icon(Icons.mic_external_on, color: Colors.white),
          label: const Text('Sing', style: TextStyle(color: Colors.white)),
        ),
      ]),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 48), children: [
        TextField(controller: title, onChanged: (_) => save(), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700), decoration: const InputDecoration(hintText: 'Song title', border: InputBorder.none)),
        _card(Row(children: [
          const Icon(Icons.graphic_eq, color: C.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(src.none ? 'No beat yet' : (src.label.isEmpty ? 'Music attached' : src.label), style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(beatItem?.m['bpm'] != null ? '${beatItem!.m['bpm']} BPM · lines snap to bars' : 'Pick a beat you made or an instrumental', style: const TextStyle(color: C.muted, fontSize: 13)),
            ]),
          ),
          TextButton(onPressed: chooseMusic, child: const Text('Choose')),
        ])),
        const SizedBox(height: 16),
        Row(children: [const Text('Lyrics', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17)), const SizedBox(width: 8), Text('$nLines lines', style: const TextStyle(color: C.muted))]),
        const SizedBox(height: 8),
        SizedBox(
          height: 40,
          child: ListView(scrollDirection: Axis.horizontal, children: [
            for (final x in const ['Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Outro']) Padding(padding: const EdgeInsets.only(right: 8), child: Pill(x, icon: Icons.add, onTap: () => insert('[$x]\n'))),
          ]),
        ),
        TextField(
          controller: body,
          onChanged: (_) => save(),
          onTap: _caret,
          maxLines: null,
          minLines: 10,
          style: const TextStyle(fontSize: 17, height: 1.5),
          decoration: const InputDecoration(hintText: 'Write one lyric line per row.\nTip: keep lines in a section to similar syllable counts.', border: InputBorder.none),
        ),
        if (line > 0)
          Text('Line $line · $syl syllables${rhymeWord.isNotEmpty ? ' · rhymes for “$rhymeWord”' : ''}', style: const TextStyle(color: C.muted, fontSize: 13)),
        if (rhymes.$1.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              for (final w in rhymes.$1) ActionChip(label: Text(w), onPressed: () => insert(w, word: true), backgroundColor: C.s2, side: BorderSide.none),
              Text(rhymes.$2 == 'offline' ? 'offline suggestions' : 'via Datamuse', style: const TextStyle(color: C.faint, fontSize: 11.5)),
            ]),
          ),
        const SizedBox(height: 20),
        const Text('Tempo', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
        _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            IconButton.filledTonal(onPressed: () => setBpm(bpm - 1), icon: const Icon(Icons.remove)),
            Expanded(child: Column(children: [Text('$bpm', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)), const Text('BPM', style: TextStyle(color: C.muted, fontSize: 12))])),
            IconButton.filledTonal(onPressed: () => setBpm(bpm + 1), icon: const Icon(Icons.add)),
            const SizedBox(width: 10),
            FilledButton.tonal(onPressed: tapTempo, child: Text(taps.length >= 3 ? 'Tap · ${taps.length}' : taps.length == 1 ? 'Keep tapping' : 'Tap')),
          ]),
          Slider(value: bpm.toDouble().clamp(50.0, 200.0), min: 50, max: 200, divisions: 150, onChanged: (v) => setBpm(v)),
          Text(tempoSource, style: const TextStyle(color: C.muted, fontSize: 12.5)),
          const SizedBox(height: 10),
          Row(children: [
            const Expanded(child: Text('Beats per bar')),
            for (final v in const [3, 4, 6])
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Pill('$v', selected: beats == v, onTap: () {
                  s.m['beats'] = v;
                  save();
                  setState(() {});
                  if (metro) _metroStart();
                }),
              ),
          ]),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Metronome'), subtitle: const Text('Hear the tempo while you write', style: TextStyle(color: C.muted)), value: metro, onChanged: (_) => toggleMetro()),
        ])),
        const SizedBox(height: 20),
        const Text('Place on the beat', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
        _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Expanded(child: Text('Bars per line')),
            for (final v in const [0.5, 1.0, 2.0, 4.0])
              Padding(padding: const EdgeInsets.only(left: 6), child: Pill(v == 0.5 ? '½' : '${v.round()}', selected: per == v, onTap: () => setState(() => per = v))),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            const Expanded(child: Text('Intro bars')),
            for (final v in const [0, 1, 2, 4]) Padding(padding: const EdgeInsets.only(left: 6), child: Pill('$v', selected: intro == v, onTap: () => setState(() => intro = v))),
          ]),
          const SizedBox(height: 12),
          SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: place, icon: const Icon(Icons.auto_fix_high), label: const Text('Auto-place lines'))),
          const Padding(padding: EdgeInsets.only(top: 6), child: Text('Each line lands on a bar line, with word timing.', style: TextStyle(color: C.muted, fontSize: 12.5))),
        ])),
        const SizedBox(height: 20),
        const Text('Structure', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
        const SizedBox(height: 8),
        if (nLines == 0) const Text('Your sections and syllable counts appear here.', style: TextStyle(color: C.muted)),
        for (final r in rows)
          if (r.trim().isNotEmpty)
            RegExp(r'^\[[^\]]*\]$').hasMatch(r.trim())
                ? Padding(padding: const EdgeInsets.only(top: 10, bottom: 4), child: Text(r.trim().substring(1, r.trim().length - 1).toUpperCase(), style: const TextStyle(color: C.brand, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.6)))
                : Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(children: [
                      SizedBox(width: 30, child: Text('${lineSyllables(r.trim())}', style: const TextStyle(color: C.muted, fontWeight: FontWeight.w700))),
                      Expanded(child: Text(r.trim(), style: const TextStyle(color: C.ink2))),
                    ]),
                  ),
      ]),
    );
  }

  Widget _card(Widget child) => Container(
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(18)),
        child: child,
      );
}
