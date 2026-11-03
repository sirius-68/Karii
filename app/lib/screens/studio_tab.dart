import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../core/text.dart';
import '../studio/beat_maker.dart';
import '../studio/lyric_pad.dart';
import '../studio/recorder.dart';
import '../widgets/ui.dart';
import 'clip_lines.dart';
import 'editor.dart';
import 'nav.dart';

class StudioTab extends StatelessWidget {
  const StudioTab({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Store.i,
      builder: (context, _) {
        final mine = Store.i.items.where((x) => x.kind == Kind.inst).toList()..sort((a, b) => b.updated.compareTo(a.updated));
        final drafts = Store.i.items.where((x) => x.kind != Kind.inst).toList()..sort((a, b) => b.updated.compareTo(a.updated));
        Widget tile(String seed, Kind kind, IconData icon, String title, String sub, VoidCallback onTap, {bool wide = false}) => GestureDetector(
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
                      Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
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
                    SheetAction(Icons.history_edu_outlined, 'Poem', () => createItem(context, Kind.poem)),
                    SheetAction(Icons.movie_outlined, 'Movie line', () => createItem(context, Kind.line)),
                    SheetAction(Icons.description_outlined, 'Script', () => openScripts(context)),
                    SheetAction(Icons.lyrics_outlined, 'Lyrics (spoken word)', () => createItem(context, Kind.lyrics)),
                  ]),
                  icon: const Icon(Icons.add),
                ),
              ]),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 16),
              child: Text('Write scripts and lyrics, make background music, record sounds.', style: TextStyle(color: C.muted)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(children: [
                tile('st-script', Kind.script, Icons.description_outlined, 'Script writer', 'Templates for talks and videos', () => openScripts(context), wide: true),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: tile('st-lyric', Kind.poem, Icons.edit_note, 'Lyric pad', 'Syllables, rhymes and a metronome', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LyricPad())))),
                  const SizedBox(width: 12),
                  Expanded(child: tile('st-rec', Kind.lyrics, Icons.mic_none, 'Sound recorder', 'Hums, vocals, foley, ideas', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const Recorder())))),
                ]),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: tile('st-beat', Kind.inst, Icons.album_outlined, 'Beat maker', 'Chords, drums and grooves in six styles', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BeatMaker())))),
                  const SizedBox(width: 12),
                  Expanded(child: tile('st-clip', Kind.line, Icons.movie_filter_outlined, 'Clip to lines', 'Import a movie clip, get the lines', () => clipToLines(context, open: (it) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => EditorScreen(item: it)))))),
                ]),
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
