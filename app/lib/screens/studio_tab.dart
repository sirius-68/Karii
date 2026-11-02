import 'package:flutter/material.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../lyrics/timing.dart';
import '../studio/beat_maker.dart';
import '../studio/lyric_pad.dart';
import '../studio/recorder.dart';
import '../widgets/ui.dart';
import 'ai_sync.dart';
import 'editor.dart';
import 'nav.dart';

class StudioTab extends StatelessWidget {
  const StudioTab({super.key});

  Future<void> clipToLines(BuildContext context) async {
    final r = await Engine.i.pickFile('video/*');
    if (r == null || !context.mounted) return;
    final words = await transcribe(context, MusicSource(path: '${r['path']}'), title: 'Finding the lines', what: 'Lectern listens to the clip and writes out what is said.');
    if (words == null || !context.mounted) return;
    final g = wordsToLines(words);
    final it = Store.i.create(Kind.line);
    it.title = '${r['name'] ?? 'Movie clip'}'.replaceAll(RegExp(r'\.[A-Za-z0-9]+$'), '');
    it.body = g.lines.join('\n');
    Store.i.save();
    toast(context, 'Found ${g.lines.length} lines. Edit them, then perform.');
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => EditorScreen(item: it)));
  }

  Future<void> songToLyrics(BuildContext context) async {
    final r = await Engine.i.pickFile('audio/*');
    if (r == null || !context.mounted) return;
    final it = Store.i.create(Kind.song);
    it.title = '${r['name'] ?? ''}'.replaceAll(RegExp(r'\.[A-Za-z0-9]+$'), '');
    it.music = {'type': 'file', 'path': r['path'], 'name': r['name']};
    if (await Engine.i.load(path: '${r['path']}')) it.dur = Engine.i.duration;
    Store.i.save();
    if (!context.mounted) return;
    await aiSync(context, it, generate: true);
    if (!context.mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => EditorScreen(item: it)));
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Store.i,
      builder: (context, _) {
        final mine = Store.i.items.where((x) => x.kind == Kind.inst).toList()..sort((a, b) => b.updated.compareTo(a.updated));
        final drafts = Store.i.items.where((x) => x.kind != Kind.inst).toList()..sort((a, b) => b.updated.compareTo(a.updated));
        Widget tile(String seed, Kind kind, IconData icon, String title, String sub, VoidCallback onTap, {bool wide = false, bool beta = false}) => GestureDetector(
              onTap: onTap,
              child: SizedBox(
                height: wide ? 150 : 170,
                child: Cover(
                  seed: seed,
                  kind: kind,
                  radius: 20,
                  child: Container(
                    decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black87])),
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      CircleAvatar(radius: 18, backgroundColor: Colors.black38, child: Icon(icon, size: 18, color: Colors.white)),
                      const Spacer(),
                      Row(children: [Flexible(child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))), if (beta) const BetaTag(size: 9)]),
                      Text(sub, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
                    ]),
                  ),
                ),
              ),
            );
        return SafeArea(
          bottom: false,
          child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 0),
              child: Row(children: [
                const Text('Studio', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.6)),
                const Spacer(),
                IconButton(
                  onPressed: () => actionSheet(context, 'Create', [
                    SheetAction(Icons.mic_external_on_outlined, 'Karaoke song', () => createItem(context, Kind.song)),
                    SheetAction(Icons.history_edu_outlined, 'Poem', () => createItem(context, Kind.poem)),
                    SheetAction(Icons.movie_outlined, 'Movie line', () => createItem(context, Kind.line)),
                    SheetAction(Icons.description_outlined, 'Script', () => openScripts(context)),
                  ]),
                  icon: const Icon(Icons.add),
                ),
              ]),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 16),
              child: Text('Write lyrics, build beats, record sounds and draft scripts.', style: TextStyle(color: C.muted)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(children: [
                tile('st-script', Kind.script, Icons.description_outlined, 'Script writer', 'Templates for talks and videos', () => openScripts(context), wide: true),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: tile('st-lyric', Kind.poem, Icons.edit_note, 'Lyric pad', 'Syllables, rhymes, auto-placed on the beat', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LyricPad())))),
                  const SizedBox(width: 12),
                  Expanded(child: tile('st-rec', Kind.song, Icons.mic_none, 'Sound recorder', 'Hums, vocals, foley, ideas', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const Recorder())))),
                ]),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: tile('st-beat', Kind.inst, Icons.album_outlined, 'Beat maker', 'Chords, drums and grooves in six styles', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BeatMaker())))),
                  const SizedBox(width: 12),
                  Expanded(child: tile('st-clip', Kind.line, Icons.movie_filter_outlined, 'Clip to lines', 'Import a movie clip, get the lines', () => clipToLines(context))),
                ]),
                const SizedBox(height: 12),
                tile('st-song2', Kind.song, Icons.auto_awesome, 'Song to lyrics', 'Transcribe a song into karaoke', () => songToLyrics(context), wide: true, beta: true),
              ]),
            ),
            const SectionHead('Your beats & sounds'),
            if (mine.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20),
                child: Text('Beats and sounds you make show up here and in every music picker.', style: TextStyle(color: C.muted)),
              ),
            for (final x in mine) ItemRow(x, subtitle: '${x.m['mood'] ?? (x.m['store'] == 'beat' ? 'Beat' : 'Sound')} · ${fmtTime(x.dur)}', onTap: () => openItem(context, x), onMore: () => itemMenu(context, x)),
            if (drafts.isNotEmpty) ...[
              const SectionHead('Recent drafts'),
              for (final s in drafts.take(5)) ItemRow(s, subtitle: kindLabel(s.kind), onTap: () => openItem(context, s), onMore: () => itemMenu(context, s)),
            ],
          ]),
        );
      },
    );
  }
}
