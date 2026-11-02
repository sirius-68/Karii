// After a take: watch it, fix audio/video sync, save it (and to the gallery), share or discard it.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';

void _rm(String? p) {
  if (p == null) return;
  try {
    final f = File(p);
    if (f.existsSync()) f.deleteSync();
  } catch (_) {}
}

/// Deletes a draft's working files (not its finished video if [keepOut]).
void deleteDraftFiles(Draft d, {bool keepOut = false}) {
  _rm(d.mix);
  _rm(d.stem);
  _rm(d.m['raw'] as String?);
  if (!keepOut) _rm(d.video);
}

class Player extends StatefulWidget {
  final String path;
  final bool video;
  final double aspect, maxHeight;
  const Player({super.key, required this.path, this.video = true, this.aspect = 9 / 16, this.maxHeight = 480});
  @override
  State<Player> createState() => PlayerState();
}

class PlayerState extends State<Player> {
  VideoPlayerController? c;
  String? err;

  @override
  void initState() {
    super.initState();
    open();
  }

  Future<void> open() async {
    final old = c;
    c = null;
    if (mounted) setState(() {});
    await old?.dispose();
    final n = VideoPlayerController.file(File(widget.path));
    try {
      await n.initialize();
      await n.setLooping(true);
      n.addListener(() {
        if (mounted) setState(() {});
      });
      c = n;
      err = null;
    } catch (e) {
      err = 'This take can’t be played: $e';
      await n.dispose();
    }
    if (mounted) setState(() {});
  }

  Future<void> pause() async => c?.pause();

  @override
  void dispose() {
    c?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final v = c;
    if (err != null) return SizedBox(height: 200, child: Center(child: Text(err!, style: const TextStyle(color: C.muted))));
    if (v == null || !v.value.isInitialized) return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
    final pos = v.value.position.inMilliseconds / 1000, dur = v.value.duration.inMilliseconds / 1000;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      GestureDetector(
        onTap: () => v.value.isPlaying ? v.pause() : v.play(),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: widget.video
              ? ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: widget.maxHeight),
                  child: AspectRatio(
                  aspectRatio: v.value.aspectRatio,
                  child: Stack(fit: StackFit.expand, children: [
                    VideoPlayer(v),
                    if (!v.value.isPlaying) const Center(child: CircleAvatar(radius: 30, backgroundColor: Colors.black45, child: Icon(Icons.play_arrow, size: 36, color: Colors.white))),
                  ]),
                ))
              : Container(
                  height: 140,
                  color: C.s2,
                  alignment: Alignment.center,
                  child: Icon(v.value.isPlaying ? Icons.pause_circle : Icons.play_circle, size: 64),
                ),
        ),
      ),
      Row(children: [
        Text(fmtTime(pos), style: const TextStyle(color: C.muted, fontSize: 12.5)),
        Expanded(
          child: Slider(
            value: pos.clamp(0.0, dur > 0 ? dur : 1.0),
            max: dur > 0 ? dur : 1,
            onChanged: (x) => v.seekTo(Duration(milliseconds: (x * 1000).round())),
          ),
        ),
        Text(fmtTime(dur), style: const TextStyle(color: C.muted, fontSize: 12.5)),
      ]),
    ]);
  }
}

class TakeEditor extends StatefulWidget {
  final Draft draft;
  const TakeEditor({super.key, required this.draft});
  @override
  State<TakeEditor> createState() => _TakeEditorState();
}

class _TakeEditorState extends State<TakeEditor> {
  Draft get d => widget.draft;
  final GlobalKey<PlayerState> player = GlobalKey();
  late final TextEditingController title = TextEditingController(text: d.title);
  late double delta = ((d.edit['delta'] as num?) ?? 0).toDouble();
  late bool gallery = Store.i.s<bool>('saveToGallery');
  bool busy = false;

  bool get isVideo => d.m['isVideo'] == true;
  bool get canResync => isVideo && d.m['raw'] != null && File('${d.m['raw']}').existsSync() && d.mix != null && File(d.mix!).existsSync();

  @override
  void dispose() {
    d.m['title'] = title.text.trim().isEmpty ? d.title : title.text.trim();
    Store.i.save();
    title.dispose();
    super.dispose();
  }

  Future<void> resync() async {
    setState(() => busy = true);
    await player.currentState?.pause();
    try {
      final base = ((d.meta['offset'] as num?) ?? 0).toDouble();
      final tmp = '${d.video}.tmp.mp4';
      await Engine.i.mux(video: '${d.m['raw']}', audio: d.mix!, out: tmp, offset: base + delta, rate: ((d.meta['rate'] as num?) ?? 48000).toInt());
      await File(tmp).rename(d.video);
      d.edit = {...d.edit, 'delta': delta};
      Store.i.save();
      await player.currentState?.open();
      if (mounted) toast(context, delta == 0 ? 'Sync reset' : 'Sync adjusted by ${(delta * 1000).round()} ms');
    } catch (e) {
      if (mounted) toast(context, 'Couldn’t adjust the sync: $e');
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> save() async {
    setState(() => busy = true);
    await player.currentState?.pause();
    final name = title.text.trim().isEmpty ? d.title : title.text.trim();
    final rec = Rec({
      'id': d.id,
      'title': name,
      'path': d.video,
      'isVideo': isVideo,
      'dur': d.dur,
      'created': d.created,
      'itemId': d.itemId,
      'meta': d.meta,
    });
    String? galleryNote;
    if (gallery) {
      try {
        await Engine.i.saveToGallery(d.video, name);
        galleryNote = isVideo ? ' and to your gallery' : ' and to Music';
      } catch (e) {
        galleryNote = ' (the gallery copy failed)';
      }
    }
    Store.i.set('saveToGallery', gallery);
    Store.i.recs.insert(0, rec);
    Store.i.drafts.removeWhere((x) => x.id == d.id);
    deleteDraftFiles(d, keepOut: true);
    Store.i.save(now: true);
    if (!mounted) return;
    Navigator.pop(context);
    toast(context, 'Saved to Recordings${galleryNote ?? ''}');
  }

  Future<void> share() async {
    await player.currentState?.pause();
    await SharePlus.instance.share(ShareParams(files: [XFile(d.video)], text: title.text.trim().isEmpty ? null : title.text.trim()));
  }

  Future<void> discard() async {
    if (!await confirm(context, 'Discard this take?', 'It will be deleted from this phone.', 'Discard', danger: true)) return;
    Store.i.drafts.removeWhere((x) => x.id == d.id);
    deleteDraftFiles(d);
    Store.i.save(now: true);
    if (mounted) Navigator.pop(context);
  }

  String get modeText {
    switch (d.meta['mode']) {
      case 'mix':
        return 'Your voice with the music mixed in cleanly';
      case 'mixAec':
        return 'Clean mix with echo cancellation (music on the speaker)';
      case 'acoustic':
        return 'Voice and music as the mic heard them in the room';
      default:
        return 'Microphone only';
    }
  }

  @override
  Widget build(BuildContext context) {
    final h = (d.meta['health'] as Map?)?.cast<String, dynamic>() ?? {};
    final struggled = d.meta['struggled'] == true;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your take'),
        actions: [IconButton(onPressed: busy ? null : share, icon: const Icon(Icons.ios_share), tooltip: 'Share')],
      ),
      body: AbsorbPointer(
        absorbing: busy,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 40), children: [
          Player(key: player, path: d.video, video: isVideo, maxHeight: MediaQuery.of(context).size.height * 0.55),
          TextField(
            controller: title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(hintText: 'Name this take', border: InputBorder.none),
          ),
          Text('${fmtTime(d.dur)} · $modeText${d.meta['nc'] == true ? ' · noise cancellation' : ''}', style: const TextStyle(color: C.muted, fontSize: 13)),
          if (struggled)
            Container(
              margin: const EdgeInsets.only(top: 14),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0x22F43F5E), borderRadius: BorderRadius.circular(14)),
              child: Text(
                'The phone struggled to keep up during this take (${((h['underrun'] as num?) ?? 0).toStringAsFixed(1)} s of audio gaps). '
                'Closing other apps or turning off battery saver helps.',
                style: const TextStyle(color: C.ink2, fontSize: 13.5),
              ),
            ),
          if (canResync) ...[
            const SizedBox(height: 18),
            const Text('Audio sync', style: TextStyle(fontWeight: FontWeight.w700)),
            const Text('If your voice and lips don’t match, move the audio and apply.', style: TextStyle(color: C.muted, fontSize: 13)),
            Row(children: [
              const Text('Earlier', style: TextStyle(color: C.muted, fontSize: 12)),
              Expanded(
                child: Slider(value: delta, min: -0.5, max: 0.5, divisions: 50, label: '${(delta * 1000).round()} ms', onChanged: (v) => setState(() => delta = v)),
              ),
              const Text('Later', style: TextStyle(color: C.muted, fontSize: 12)),
            ]),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: resync, child: Text('Apply ${delta >= 0 ? '+' : ''}${(delta * 1000).round()} ms')),
            ),
          ],
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(isVideo ? 'Also save to the gallery' : 'Also save to Music'),
            value: gallery,
            onChanged: (v) => setState(() => gallery = v),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(onPressed: save, icon: busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check), label: const Text('Save take')),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Keep as draft'))),
            const SizedBox(width: 10),
            Expanded(child: OutlinedButton(onPressed: discard, style: OutlinedButton.styleFrom(foregroundColor: C.hot), child: const Text('Discard'))),
          ]),
        ]),
      ),
    );
  }
}

/// A saved recording.
class RecViewer extends StatelessWidget {
  final Rec rec;
  const RecViewer({super.key, required this.rec});
  @override
  Widget build(BuildContext context) {
    final video = rec.m['isVideo'] != false && rec.path.endsWith('.mp4');
    return Scaffold(
      appBar: AppBar(title: Text(rec.title, overflow: TextOverflow.ellipsis), actions: [
        IconButton(
          onPressed: () => SharePlus.instance.share(ShareParams(files: [XFile(rec.path)])),
          icon: const Icon(Icons.ios_share),
          tooltip: 'Share',
        ),
        PopupMenuButton<String>(
          onSelected: (v) async {
            if (v == 'gallery') {
              try {
                await Engine.i.saveToGallery(rec.path, rec.title);
                if (context.mounted) toast(context, video ? 'Saved to your gallery' : 'Saved to Music');
              } catch (e) {
                if (context.mounted) toast(context, 'Couldn’t save: $e');
              }
            } else if (v == 'rename') {
              final n = await prompt(context, 'Rename', initial: rec.title);
              if (n != null && n.isNotEmpty) {
                rec.m['title'] = n;
                Store.i.save();
              }
            } else if (v == 'delete') {
              if (await confirm(context, 'Delete “${rec.title}”?', 'It will be removed from this phone (copies in your gallery stay).', 'Delete', danger: true)) {
                Store.i.recs.removeWhere((x) => x.id == rec.id);
                _rm(rec.path);
                Store.i.save();
                if (context.mounted) Navigator.pop(context);
              }
            }
          },
          itemBuilder: (_) => [
            PopupMenuItem(value: 'gallery', child: Text(video ? 'Save to gallery' : 'Save to Music')),
            const PopupMenuItem(value: 'rename', child: Text('Rename')),
            const PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: C.hot))),
          ],
        ),
      ]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Player(path: rec.path, video: video, maxHeight: MediaQuery.of(context).size.height * 0.65),
        const SizedBox(height: 10),
        Text('${fmtTime(rec.dur)} · ${_date(rec.created)}', style: const TextStyle(color: C.muted)),
      ]),
    );
  }
}

String _date(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${m[d.month - 1]} ${d.year}, ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

String dateLabel(int ms) => _date(ms);
