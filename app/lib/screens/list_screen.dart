import 'package:flutter/material.dart';

import '../core/catalog.dart';
import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../widgets/ui.dart';
import 'nav.dart';

class ListScreen extends StatelessWidget {
  final Kind kind;
  const ListScreen({super.key, required this.kind});
  @override
  Widget build(BuildContext context) {
    final title = const {Kind.song: 'Karaoke', Kind.poem: 'Poems', Kind.line: 'Movie lines', Kind.inst: 'Instrumentals', Kind.script: 'Scripts'}[kind]!;
    return Scaffold(
      appBar: AppBar(title: Row(children: [Text(title), if (kind == Kind.song) const BetaTag()])),
      body: AnimatedBuilder(
        animation: Store.i,
        builder: (context, _) {
          final items = kind == Kind.inst ? instruments() : [...Catalog.i.list(kind), ...Store.i.items.where((x) => x.kind == kind)];
          return ListView(children: [
            if (kind == Kind.song) const Padding(padding: EdgeInsets.only(top: 8), child: BetaNote()),
            for (final it in items) ItemRow(it, onTap: () => openItem(context, it), onMore: kind == Kind.inst && it.isCat ? null : () => itemMenu(context, it)),
            if (kind != Kind.inst)
              Padding(
                padding: const EdgeInsets.all(20),
                child: OutlinedButton.icon(onPressed: () => createItem(context, kind), icon: const Icon(Icons.add), label: Text('New ${kindLabel(kind).toLowerCase()}')),
              ),
          ]);
        },
      ),
    );
  }
}
