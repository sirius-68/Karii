// Navigation helpers shared by the tabs.
import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../widgets/ui.dart';
import '../studio/beat_maker.dart';
import '../studio/lyric_pad.dart';
import 'detail.dart';
import 'editor.dart';
import 'list_screen.dart';
import 'scripts.dart';
import 'stage.dart';

Future<void> openItem(BuildContext context, Item it) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DetailScreen(item: it)));

Future<void> perform(BuildContext context, Item it) async {
  if (it.kind == Kind.inst) {
    toast(context, 'Instrumentals play as a music bed: open a poem or script and pick it in Music.');
    return;
  }
  if (it.body.trim().isEmpty) {
    toast(context, it.kind == Kind.song ? 'Add some lyrics first.' : 'Write something first.');
    if (!it.isCat) await editItem(context, it);
    return;
  }
  Store.i.played(it);
  await Navigator.of(context).push(MaterialPageRoute(fullscreenDialog: true, builder: (_) => StageScreen(item: it)));
}

Future<void> editItem(BuildContext context, Item it, {bool fresh = false}) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => EditorScreen(item: it, fresh: fresh)));

Future<void> openList(BuildContext context, Kind k) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ListScreen(kind: k)));

Future<void> openScripts(BuildContext context) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ScriptsScreen()));

Future<void> createItem(BuildContext context, Kind k) async {
  final it = Store.i.create(k);
  await editItem(context, it, fresh: true);
}

void itemMenu(BuildContext context, Item it, {VoidCallback? changed}) {
  if (it.kind == Kind.inst && !it.isCat) return _userInstMenu(context, it, changed);
  final liked = Store.i.likes.contains(it.id);
  actionSheet(context, it.title, [
    SheetAction(Icons.mic_external_on_outlined, it.kind == Kind.song ? 'Sing' : 'Perform', () => perform(context, it)),
    SheetAction(liked ? Icons.favorite : Icons.favorite_border, liked ? 'Remove from Liked' : 'Like', () {
      Store.i.toggleLike(it.id);
      changed?.call();
    }),
    if (!it.isCat) SheetAction(Icons.edit_outlined, 'Edit', () => editItem(context, it)),
    if (it.isCat && it.kind != Kind.inst)
      SheetAction(Icons.copy_outlined, 'Make an editable copy', () {
        final c = Store.i.create(it.kind);
        c.m.addAll(Map<String, dynamic>.from(it.m)..remove('cat')..remove('id'));
        c.m['title'] = '${it.title} (my copy)';
        if (it.audioAsset != null) c.music = {'type': 'asset', 'asset': it.audioAsset, 'name': it.title};
        Store.i.save();
        editItem(context, c);
      }),
    if (!it.isCat)
      SheetAction(Icons.delete_outline, 'Delete', () async {
        if (await confirm(context, 'Delete “${it.title}”?', 'This can’t be undone.', 'Delete', danger: true)) {
          Store.i.deleteItem(it);
          changed?.call();
        }
      }, danger: true),
  ]);
}

void _userInstMenu(BuildContext context, Item it, VoidCallback? changed) {
  actionSheet(context, it.title, [
    SheetAction(Icons.play_arrow, 'Open', () => openItem(context, it)),
    SheetAction(Icons.queue_music, Store.i.settings['bed'] == it.id ? 'Music bed (current)' : 'Use as music bed', () {
      Store.i.set('bed', it.id);
      toast(context, '“${it.title}” is now your music bed');
    }, sub: 'Plays under poems, scripts and lines'),
    SheetAction(Icons.edit_note, 'Write lyrics on it', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LyricPad(beat: it)))),
    if (it.m['store'] == 'beat') SheetAction(Icons.album_outlined, 'Open in beat maker', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BeatMaker(edit: it)))),
    SheetAction(Icons.drive_file_rename_outline, 'Rename', () async {
      final n = await prompt(context, 'Rename', initial: it.title);
      if (n != null && n.isNotEmpty) {
        it.title = n;
        Store.i.save();
        changed?.call();
      }
    }),
    SheetAction(Icons.delete_outline, 'Delete', () async {
      if (await confirm(context, 'Delete “${it.title}”?', 'Songs using it will lose their music.', 'Delete', danger: true)) {
        if (Store.i.settings['bed'] == it.id) Store.i.settings['bed'] = null;
        Store.i.deleteItem(it);
        changed?.call();
      }
    }, danger: true),
  ]);
}
