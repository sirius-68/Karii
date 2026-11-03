// Sections of a script ([Verse], [Scene 2]...): reorder by dragging, rename, duplicate, edit, delete.
import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../core/text.dart';
import '../widgets/ui.dart';

class SectionsScreen extends StatefulWidget {
  final Item item;
  const SectionsScreen({super.key, required this.item});
  @override
  State<SectionsScreen> createState() => _SectionsScreenState();
}

class _SectionsScreenState extends State<SectionsScreen> {
  Item get it => widget.item;
  late List<Section> secs = it.sections;
  late List<int> ids = List.generate(secs.length, (i) => i);
  int _next = 1000;

  void _save() {
    // only the first section may be untitled: an untitled section further down would merge into the one above it
    for (var i = 1; i < secs.length; i++) {
      if (secs[i].title.trim().isEmpty) secs[i].title = 'Section ${i + 1}';
    }
    it.body = joinSections(secs);
    it.touch();
    Store.i.save();
    setState(() {});
  }

  String _name(int i) => secs[i].title.isEmpty ? 'Opening' : secs[i].title;

  Future<void> rename(int i) async {
    final n = await prompt(context, 'Rename section', initial: secs[i].title);
    if (n == null) return;
    secs[i].title = sectionName(n);
    _save();
  }

  void duplicate(int i) {
    final c = secs[i].copy();
    if (c.title.isNotEmpty) c.title = '${c.title} (copy)';
    if (c.title.isEmpty) c.title = 'Copy';
    secs.insert(i + 1, c);
    ids.insert(i + 1, _next++);
    _save();
  }

  Future<void> remove(int i) async {
    if (!await confirm(context, 'Delete “${_name(i)}”?', 'Its text is removed from the script. You can undo it in the editor.', 'Delete', danger: true)) return;
    secs.removeAt(i);
    ids.removeAt(i);
    _save();
  }

  Future<void> editText(int i) async {
    final ctl = TextEditingController(text: secs[i].text);
    final r = await Navigator.of(context).push<String>(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (c) => Scaffold(
        appBar: AppBar(title: Text(_name(i)), actions: [TextButton(onPressed: () => Navigator.pop(c, ctl.text), child: const Text('Done'))]),
        body: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: TextField(
            controller: ctl,
            autofocus: true,
            maxLines: null,
            expands: true,
            textAlignVertical: TextAlignVertical.top,
            style: const TextStyle(fontSize: 17, height: 1.5),
            decoration: const InputDecoration(border: InputBorder.none, hintText: 'Text of this section'),
          ),
        ),
      ),
    ));
    ctl.dispose();
    if (r == null) return;
    // a [header] line typed here would start a new section; keep it as text in brackets instead
    secs[i].text = r.split('\n').map((l) => sectionTag.hasMatch(l.trim()) ? '(${l.trim().substring(1, l.trim().length - 1)})' : l).join('\n').trim();
    _save();
  }

  Future<void> add() async {
    final n = await prompt(context, 'New section', hint: 'e.g. Verse 2, Scene 3, Closing');
    if (n == null || n.trim().isEmpty) return;
    secs.add(Section(sectionName(n), ''));
    ids.add(_next++);
    _save();
    await editText(secs.length - 1);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sections')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: add,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        icon: const Icon(Icons.add),
        label: const Text('Section'),
      ),
      body: secs.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text('No sections yet. Add one, or type [Name] on its own line in the editor.', textAlign: TextAlign.center, style: TextStyle(color: C.muted)),
              ),
            )
          : ReorderableListView.builder(
              padding: const EdgeInsets.only(bottom: 96),
              itemCount: secs.length,
              header: const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Text('Hold and drag to reorder.', style: TextStyle(color: C.muted)),
              ),
              onReorder: (a, b) {
                if (b > a) b--;
                final s = secs.removeAt(a), id = ids.removeAt(a);
                secs.insert(b, s);
                ids.insert(b, id);
                // the untitled opening can't move down without a name
                if (b > 0 && s.title.isEmpty) s.title = 'Opening';
                _save();
              },
              itemBuilder: (_, i) {
                final lines = scriptLines(secs[i].text);
                return ListTile(
                  key: ValueKey(ids[i]),
                  contentPadding: const EdgeInsets.fromLTRB(20, 4, 4, 4),
                  title: Text(_name(i), style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(lines.isEmpty ? 'Empty' : '${lines.first}${lines.length > 1 ? '  ·  ${lines.length} lines' : ''}',
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: C.muted)),
                  onTap: () => editText(i),
                  trailing: PopupMenuButton<String>(
                    onSelected: (v) {
                      switch (v) {
                        case 'edit':
                          editText(i);
                        case 'rename':
                          rename(i);
                        case 'dup':
                          duplicate(i);
                        case 'del':
                          remove(i);
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Edit text')),
                      PopupMenuItem(value: 'rename', child: Text('Rename')),
                      PopupMenuItem(value: 'dup', child: Text('Duplicate')),
                      PopupMenuItem(value: 'del', child: Text('Delete', style: TextStyle(color: C.hot))),
                    ],
                  ),
                );
              },
            ),
    );
  }
}
