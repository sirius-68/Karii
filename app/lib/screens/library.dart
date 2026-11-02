import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';
import 'nav.dart';
import 'take_editor.dart';

class LibraryTab extends StatefulWidget {
  const LibraryTab({super.key});
  @override
  State<LibraryTab> createState() => _LibraryTabState();
}

class _LibraryTabState extends State<LibraryTab> {
  String filter = 'all';

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Store.i,
      builder: (context, _) {
        final st = Store.i;
        final mine = st.items.where((x) => x.kind != Kind.inst).toList()..sort((a, b) => b.updated.compareTo(a.updated));
        final liked = st.likes.map(st.find).whereType<Item>().toList();
        final show = <Widget>[];
        if (filter == 'all' || filter == 'recs') {
          if (st.drafts.isNotEmpty) {
            show.add(const SectionHead('Drafts'));
            for (final d in st.drafts) {
              show.add(_takeRow(context, d.title, 'Draft · ${fmtTime(d.dur)} · ${dateLabel(d.created)}', d.m['isVideo'] == true, () {
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => TakeEditor(draft: d)));
              }));
            }
          }
          if (st.recs.isNotEmpty) {
            show.add(const SectionHead('Recordings'));
            for (final r in st.recs) {
              show.add(_takeRow(context, r.title, '${fmtTime(r.dur)} · ${dateLabel(r.created)}', r.m['isVideo'] != false, () {
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => RecViewer(rec: r)));
              }));
            }
          }
        }
        if (filter == 'all' || filter == 'mine') {
          if (mine.isNotEmpty) {
            show.add(const SectionHead('Made by you'));
            for (final it in mine) {
              show.add(ItemRow(it, subtitle: '${kindLabel(it.kind)}${it.kind == Kind.song && it.hasTiming ? ' · synced' : ''}', onTap: () => openItem(context, it), onMore: () => itemMenu(context, it)));
            }
          }
        }
        if (filter == 'all' || filter == 'liked') {
          if (liked.isNotEmpty) {
            show.add(const SectionHead('Liked'));
            for (final it in liked) {
              show.add(ItemRow(it, onTap: () => openItem(context, it), onMore: () => itemMenu(context, it)));
            }
          }
        }
        if (show.isEmpty) {
          show.add(const Padding(
            padding: EdgeInsets.fromLTRB(32, 80, 32, 0),
            child: Column(children: [
              Icon(Icons.library_music_outlined, size: 48, color: C.faint),
              SizedBox(height: 12),
              Text('Nothing here yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              SizedBox(height: 6),
              Text('Your recordings, songs, scripts and likes show up here.', textAlign: TextAlign.center, style: TextStyle(color: C.muted)),
            ]),
          ));
        }
        return SafeArea(
          bottom: false,
          child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 0),
              child: Row(children: [
                const Text('Library', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.6)),
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
            SizedBox(
              height: 56,
              child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(20, 8, 20, 8), children: [
                for (final f in const [('all', 'All'), ('recs', 'Recordings'), ('mine', 'Made by you'), ('liked', 'Liked')])
                  Padding(padding: const EdgeInsets.only(right: 8), child: Pill(f.$2, selected: filter == f.$1, onTap: () => setState(() => filter = f.$1))),
              ]),
            ),
            ...show,
          ]),
        );
      },
    );
  }

  Widget _takeRow(BuildContext context, String title, String sub, bool video, VoidCallback onTap) => ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
        leading: Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(color: C.s3, borderRadius: BorderRadius.circular(12)),
          child: Icon(video ? Icons.videocam_outlined : Icons.graphic_eq, color: C.ink2),
        ),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(sub, style: const TextStyle(color: C.muted, fontSize: 13)),
        onTap: onTap,
      );
}
