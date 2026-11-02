import 'package:flutter/material.dart';

import '../core/catalog.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../widgets/ui.dart';
import 'nav.dart';

class ExploreTab extends StatelessWidget {
  final void Function(int) onTab;
  const ExploreTab({super.key, required this.onTab});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Store.i,
      builder: (context, _) {
        final st = Store.i;
        final songs = [...Catalog.i.list(Kind.song), ...st.items.where((x) => x.kind == Kind.song)];
        final recent = st.recents.map(st.find).whereType<Item>().where((x) => x.kind != Kind.inst).take(10).toList();
        final hour = DateTime.now().hour;
        final greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        final name = st.firstName;
        return SafeArea(
          bottom: false,
          child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
              child: Row(children: [
                Expanded(
                  child: Material(
                    color: C.s2,
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(18),
                      onTap: () => onTab(1),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                        child: Row(children: [Icon(Icons.search, color: C.muted), SizedBox(width: 10), Text('Search', style: TextStyle(color: C.muted, fontSize: 16))]),
                      ),
                    ),
                  ),
                ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
              child: Text(name.isEmpty ? greet : '$greet, $name', style: const TextStyle(color: C.muted, fontSize: 15)),
            ),
            // Create a script
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: GestureDetector(
                onTap: () => openScripts(context),
                child: SizedBox(
                  height: 180,
                  child: Cover(
                    seed: 'hero-script',
                    kind: Kind.script,
                    radius: 20,
                    child: Container(
                      decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black54])),
                      padding: const EdgeInsets.all(18),
                      child: const Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Expanded(
                          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [Icon(Icons.description_outlined, size: 14, color: Colors.white70), SizedBox(width: 6), Text('SCRIPT WRITER', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6))]),
                            SizedBox(height: 6),
                            Text('Create a script', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
                            Text('Talks, videos and presentations', style: TextStyle(color: Colors.white70), maxLines: 1, overflow: TextOverflow.ellipsis),
                          ]),
                        ),
                        CircleAvatar(radius: 26, backgroundColor: Colors.white, child: Icon(Icons.edit_outlined, color: Colors.black)),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(
              height: 44,
              child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 20), children: [
                Pill('Karaoke', icon: Icons.mic_external_on_outlined, trailing: const BetaTag(size: 9), onTap: () => openList(context, Kind.song)),
                const SizedBox(width: 8),
                Pill('Poems', icon: Icons.history_edu_outlined, onTap: () => openList(context, Kind.poem)),
                const SizedBox(width: 8),
                Pill('Movie lines', icon: Icons.movie_outlined, onTap: () => openList(context, Kind.line)),
                const SizedBox(width: 8),
                Pill('Instrumentals', icon: Icons.graphic_eq, onTap: () => openList(context, Kind.inst)),
              ]),
            ),
            if (recent.isNotEmpty) ...[
              const SectionHead('Jump back in'),
              Shelf(children: [for (final it in recent) SquareCard(it, onTap: () => openItem(context, it))]),
            ],
            SectionHead('Sing now', badge: const BetaTag(), onMore: () => openList(context, Kind.song)),
            const BetaNote(),
            for (final s in songs.take(6)) ItemRow(s, onTap: () => openItem(context, s), onMore: () => itemMenu(context, s)),
            SectionHead('Poems for tonight', onMore: () => openList(context, Kind.poem)),
            Shelf(children: [for (final p in Catalog.i.list(Kind.poem)) SquareCard(p, onTap: () => openItem(context, p))]),
            SectionHead('Movie lines', onMore: () => openList(context, Kind.line)),
            Shelf(children: [for (final p in Catalog.i.list(Kind.line)) SquareCard(p, onTap: () => openItem(context, p))]),
            SectionHead('Instrumentals', onMore: () => openList(context, Kind.inst)),
            for (final s in Catalog.i.list(Kind.inst).take(5)) ItemRow(s, onTap: () => openItem(context, s)),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 0),
              child: Text('Music by Tanner Helland, CC BY 4.0. Use any track as a music bed for poems, scripts and movie lines.', style: TextStyle(color: C.faint, fontSize: 12.5)),
            ),
          ]),
        );
      },
    );
  }
}
