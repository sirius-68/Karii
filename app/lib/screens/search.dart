import 'package:flutter/material.dart';

import '../core/catalog.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../widgets/ui.dart';
import 'nav.dart';

class SearchTab extends StatefulWidget {
  const SearchTab({super.key});
  @override
  State<SearchTab> createState() => _SearchTabState();
}

class _SearchTabState extends State<SearchTab> {
  final ctl = TextEditingController();
  String q = '';

  List<Item> results() {
    final s = q.trim().toLowerCase();
    if (s.isEmpty) return [];
    final all = [...Store.i.items, ...Catalog.i.all];
    return all.where((it) => '${it.title} ${it.sub} ${it.body}'.toLowerCase().contains(s)).take(60).toList();
  }

  @override
  Widget build(BuildContext context) {
    final r = results();
    return SafeArea(
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
          child: TextField(
            controller: ctl,
            onChanged: (v) => setState(() => q = v),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Songs, poems, movie lines',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: q.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        ctl.clear();
                        setState(() => q = '');
                      }),
              filled: true,
              fillColor: C.s2,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
            ),
          ),
        ),
        Expanded(
          child: q.trim().isEmpty
              ? ListView(padding: const EdgeInsets.all(20), children: [
                  const Text('Browse', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.6,
                    children: [
                      for (final k in [Kind.song, Kind.poem, Kind.line, Kind.inst])
                        GestureDetector(
                          onTap: () => openList(context, k),
                          child: Cover(
                            seed: 'browse-${k.name}',
                            kind: k,
                            radius: 16,
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Align(
                                alignment: Alignment.bottomLeft,
                                child: Row(mainAxisSize: MainAxisSize.min, children: [
                                  Text(k == Kind.song ? 'Karaoke' : k == Kind.poem ? 'Poems' : k == Kind.line ? 'Movie lines' : 'Instrumentals',
                                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                                  if (k == Kind.song) const BetaTag(size: 9),
                                ]),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ])
              : r.isEmpty
                  ? const Center(child: Text('Nothing found', style: TextStyle(color: C.muted)))
                  : ListView(children: [for (final it in r) ItemRow(it, subtitle: '${kindLabel(it.kind)} · ${it.sub}', onTap: () => openItem(context, it))]),
        ),
      ]),
    );
  }
}
