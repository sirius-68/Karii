import 'package:flutter/material.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../lyrics/retime.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';
import 'ai_sync.dart';
import 'nav.dart';
import 'sync_screen.dart';

class EditorScreen extends StatefulWidget {
  final Item item;
  final bool fresh;
  const EditorScreen({super.key, required this.item, this.fresh = false});
  @override
  State<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends State<EditorScreen> {
  late final TextEditingController title = TextEditingController(text: widget.item.rawTitle);
  late final TextEditingController body = TextEditingController(text: widget.item.body);
  Item get it => widget.item;

  void save() {
    it.title = title.text.replaceAll('\n', ' ');
    it.body = body.text;
    it.touch();
    Store.i.save();
  }

  @override
  void dispose() {
    save();
    final msg = retimeIfLyricsChanged(it);
    if (msg != null) Store.i.save();
    if (it.rawTitle.trim().isEmpty && it.body.trim().isEmpty && it.music == null) Store.i.deleteItem(it);
    title.dispose();
    body.dispose();
    super.dispose();
  }

  Future<void> pickAudio() async {
    final r = await Engine.i.pickFile('audio/*');
    if (r == null || !mounted) return;
    it.music = {'type': 'file', 'path': r['path'], 'name': r['name']};
    toast(context, 'Loading “${r['name']}”…');
    final ok = await Engine.i.load(path: '${r['path']}');
    if (!mounted) return;
    if (ok) {
      it.dur = Engine.i.duration;
      toast(context, 'Music attached. Now sync the lyrics: Tap sync, or Sync with AI.');
    } else {
      toast(context, 'That file couldn’t be read. Try MP3, M4A or WAV.');
      it.music = null;
    }
    save();
    setState(() {});
  }

  void chooseInstrumental() {
    actionSheet(context, 'Use an instrumental', [
      for (final x in instruments())
        SheetAction(Icons.graphic_eq, x.title, () {
          it.music = {'type': 'inst', 'id': x.id, 'name': x.title};
          it.dur = x.dur;
          save();
          setState(() {});
        }, sub: [if (x.m['mood'] != null) '${x.m['mood']}', if (!x.isCat) 'Yours', fmtTime(x.dur)].join(' · ')),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final song = it.kind == Kind.song;
    final lines = lyricLines(body.text);
    final timed = it.times.where((t) => t != null).length;
    final src = musicFor(it);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.fresh ? 'New ${kindLabel(it.kind).toLowerCase()}' : 'Edit'),
        actions: [
          TextButton.icon(
            onPressed: () {
              save();
              perform(context, it);
            },
            icon: Icon(song ? Icons.mic_external_on : Icons.videocam_outlined, color: Colors.white),
            label: Text(song ? 'Sing' : 'Perform', style: const TextStyle(color: Colors.white)),
          ),
        ],
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 40), children: [
        TextField(
          controller: title,
          onChanged: (_) => save(),
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
          decoration: const InputDecoration(hintText: 'Title', border: InputBorder.none),
        ),
        if (song) ...[
          _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.music_note_outlined, color: C.muted),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Music', style: TextStyle(fontWeight: FontWeight.w600)),
                  Text(src.none ? 'None yet' : (src.label.isEmpty ? 'Attached' : src.label), style: const TextStyle(color: C.muted, fontSize: 13)),
                ]),
              ),
              TextButton(
                  onPressed: () => actionSheet(context, 'Music for this song', [
                        SheetAction(Icons.upload_file, 'Upload an audio file', pickAudio, sub: 'MP3, M4A, WAV… stays on this device'),
                        SheetAction(Icons.graphic_eq, 'Use an instrumental', chooseInstrumental),
                        if (it.music != null)
                          SheetAction(Icons.close, 'Remove music', () {
                            it.music = null;
                            save();
                            setState(() {});
                          }, danger: true),
                      ]),
                  child: Text(src.none ? 'Add' : 'Change')),
            ]),
          ])),
          _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.timer_outlined, color: C.muted),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Lyric timing', style: TextStyle(fontWeight: FontWeight.w600)),
                  Text(lines.isEmpty ? 'Write or paste the lyrics below' : timed == 0 ? 'Not synced yet' : '$timed of ${lines.length} lines timed',
                      style: const TextStyle(color: C.muted, fontSize: 13)),
                ]),
              ),
            ]),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              FilledButton.tonalIcon(
                onPressed: lines.isEmpty || src.none
                    ? null
                    : () async {
                        save();
                        retimeIfLyricsChanged(it);
                        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SyncScreen(item: it)));
                        setState(() {});
                      },
                icon: const Icon(Icons.touch_app_outlined),
                label: Text(timed > 0 ? 'Re-tap' : 'Tap sync'),
              ),
              FilledButton.tonalIcon(
                onPressed: src.none
                    ? null
                    : () async {
                        save();
                        await aiSync(context, it, generate: lines.isEmpty);
                        body.text = it.body;
                        setState(() {});
                      },
                icon: const Icon(Icons.auto_awesome),
                label: Text(lines.isEmpty ? 'Lyrics from audio' : 'Sync with AI'),
              ),
              if (timed > 0)
                TextButton(
                    onPressed: () async {
                      if (!await confirm(context, 'Clear timing?', 'The lyrics stay; only their timing is removed.', 'Clear')) return;
                      it.times = [];
                      it.ends = [];
                      it.wt = [];
                      it.timedText = null;
                      save();
                      setState(() {});
                    },
                    child: const Text('Clear timing', style: TextStyle(color: C.muted))),
            ]),
            if (src.none) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Add music first to sync the lyrics to it.', style: TextStyle(color: C.faint, fontSize: 12.5))),
          ])),
        ],
        const SizedBox(height: 8),
        TextField(
          controller: body,
          onChanged: (_) {
            save();
            setState(() {});
          },
          maxLines: null,
          minLines: 12,
          keyboardType: TextInputType.multiline,
          style: TextStyle(fontSize: 17, height: 1.5, fontFamily: it.kind == Kind.poem ? 'serif' : null),
          decoration: InputDecoration(
            hintText: song ? 'Paste or write the lyrics, one line per line.\n[Chorus] and other tags in brackets are skipped.' : 'Write here…',
            border: InputBorder.none,
          ),
        ),
      ]),
    );
  }

  Widget _card(Widget child) => Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(18)),
        child: child,
      );
}
