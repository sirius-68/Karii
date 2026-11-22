// After a take: watch it, fix audio/video sync, rebalance the music under the voice (level,
// fades, ducking: the voice and music are kept separately until the take is saved), save it
// (and to the gallery), share or discard it.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../core/log.dart';
import '../core/model.dart';
import '../core/report.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../core/text.dart';
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
  _rm(d.voice);
  _rm(d.music);
  _rm(d.m['raw'] as String?);
  if (!keepOut) {
    _rm(d.video);
    _rm(d.m['thumb'] as String?);
  }
}

class Player extends StatefulWidget {
  final String path;
  final bool video;
  final double aspect, maxHeight;
  final String? poster; // a frame of the video, shown until playback starts
  const Player({super.key, required this.path, this.video = true, this.aspect = 9 / 16, this.maxHeight = 480, this.poster});
  @override
  State<Player> createState() => PlayerState();
}

class PlayerState extends State<Player> {
  VideoPlayerController? c;
  String? err;
  bool _gone = false;
  int _gen = 0, _retries = 0;

  @override
  void initState() {
    super.initState();
    open();
  }

  void _onPlayer() {
    final v = c;
    if (v == null || _gone) return;
    if (v.value.hasError && err == null) {
      // the phone's video decoder gave up (often right after the camera was in use): try again
      Log.add('player', 'error', {'error': v.value.errorDescription, 'retry': _retries});
      if (_retries < 2) {
        _retries++;
        Future.delayed(const Duration(milliseconds: 700), () {
          if (!_gone) open();
        });
      } else {
        setState(() => err = 'This phone’s player couldn’t show the take (${v.value.errorDescription ?? 'unknown error'}). The file itself is kept: share it or save it to the gallery to watch it in another player.');
      }
      return;
    }
    if (mounted) setState(() {});
  }

  /// Opens (or re-opens) the file. A player that finishes opening after this widget is gone, or
  /// after a newer open started, is closed again so no decoder is left behind.
  Future<void> open() async {
    final gen = ++_gen;
    final old = c;
    c = null;
    if (mounted) setState(() => err = null);
    old?.removeListener(_onPlayer);
    await old?.dispose();
    if (_gone || gen != _gen) return;
    final f = File(widget.path);
    if (!f.existsSync()) {
      Log.add('player', 'file missing', {'file': widget.path.split('/').last});
      if (mounted) setState(() => err = 'This take’s file is no longer on the phone.');
      return;
    }
    final n = VideoPlayerController.file(f);
    final sw = Stopwatch()..start();
    try {
      await n.initialize().timeout(const Duration(seconds: 15));
      if (_gone || gen != _gen) {
        await n.dispose();
        return;
      }
      await n.setLooping(true);
      // some Android players draw nothing until the first seek or play
      await n.seekTo(Duration.zero);
      if (_gone || gen != _gen) {
        await n.dispose();
        return;
      }
      n.addListener(_onPlayer);
      c = n;
      Log.add('player', 'open', {'ms': sw.elapsedMilliseconds, 'size': '${n.value.size.width.round()}x${n.value.size.height.round()}', 'seconds': n.value.duration.inMilliseconds / 1000, 'bytes': f.lengthSync()});
    } catch (e) {
      Log.add('player', 'open failed', {'error': '$e', 'ms': sw.elapsedMilliseconds});
      try {
        await n.dispose();
      } catch (_) {}
      if (_gone || gen != _gen) return;
      err = 'This take can’t be played here: $e';
    }
    if (mounted) setState(() {});
  }

  Future<void> pause() async => c?.pause();

  /// Closes the player and waits until the decoder is released.
  Future<void> close() async {
    _gen++;
    final v = c;
    c = null;
    v?.removeListener(_onPlayer);
    await v?.dispose();
  }

  @override
  void dispose() {
    _gone = true;
    _gen++;
    c?.removeListener(_onPlayer);
    c?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final v = c;
    if (err != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(children: [
          if (widget.poster != null && File(widget.poster!).existsSync())
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: ClipRRect(borderRadius: BorderRadius.circular(18), child: Image.file(File(widget.poster!), height: 220, fit: BoxFit.cover)),
            ),
          Text(err!, textAlign: TextAlign.center, style: const TextStyle(color: C.muted)),
          TextButton(
              onPressed: () {
                _retries = 0;
                open();
              },
              child: const Text('Try again')),
        ]),
      );
    }
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
                    const ColoredBox(color: Colors.black),
                    VideoPlayer(v),
                    if (!v.value.isPlaying && v.value.position < const Duration(milliseconds: 200) && widget.poster != null && File(widget.poster!).existsSync())
                      Image.file(File(widget.poster!), fit: BoxFit.cover, gaplessPlayback: true),
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
  String? get thumb => d.m['thumb'] as String?;
  Map<String, dynamic> get videoMeta => ((d.meta['video'] as Map?) ?? {}).cast<String, dynamic>();

  @override
  void initState() {
    super.initState();
    // takes from before poster frames were made: make one now
    if (isVideo && (thumb == null || !File(thumb!).existsSync())) _inspect();
  }

  Future<void> _inspect() async {
    try {
      final info = await Engine.i.videoInfo(d.video, thumb: '${d.video}.jpg');
      d.m['thumb'] = info['thumb'];
      d.m['meta'] = {...d.meta, 'video': info};
      Store.i.save();
      if (mounted) setState(() {});
    } catch (_) {}
  }

  /// What happened to the picture, from what the files actually contain.
  String? get pictureProblem {
    final m = d.meta;
    final raw = ((m['rawVideo'] as Map?) ?? {}).cast<String, dynamic>();
    final p = m['videoProblem'] as String?;
    if (m['cameraUsed'] == true && !isVideo) {
      return 'The camera’s picture couldn’t be used${p != null ? ': $p' : ''}, so this take was kept as sound only.\nCamera file: ${_describe(raw)}\n$_context';
    }
    final v = videoMeta;
    if (!isVideo || v.isEmpty) return null;
    if (v['hasVideo'] == false) return 'This take has no picture.\nCamera file: ${_describe(raw)}\nFinished take: ${_describe(v)}\n$_context';
    final l = (v['luma'] as num?)?.toDouble() ?? -1;
    if (l >= 0 && l < 14) {
      return 'The picture in this take is almost black: the camera got very little light. Check that nothing covers the lens, face a light, or switch cameras.\nCamera file: ${_describe(raw)}';
    }
    return null;
  }

  /// Free storage, the camera file's size and any error the camera reported.
  String get _context {
    final m = d.meta;
    final free = (m['freeAtStart'] as num?)?.toInt() ?? -1;
    return [
      if (free >= 0) 'free storage when recording: ${fmtBytes(free)}',
      if (m['rawBytes'] is num) 'camera file ${fmtBytes(m['rawBytes'] as num)}',
      if (m['cameraError'] != null) 'camera error: ${m['cameraError']}',
    ].join(' · ');
  }

  static String _describe(Map<String, dynamic> v) {
    if (v.isEmpty) return 'not checked';
    if (v['hasVideo'] != true) return 'no video track';
    final lum = ((v['lumas'] as List?) ?? []).map((x) => (x as num).round()).join('/');
    return '${v['width']}×${v['height']}, rotation ${v['rotation']}°, ${((v['duration'] as num?) ?? 0).toStringAsFixed(1)} s, brightness $lum of 255';
  }
  late double balance = ((d.edit['balance'] as num?) ?? 0).toDouble();
  late double fadeIn = ((d.edit['fadeIn'] as num?) ?? 0).toDouble();
  late double fadeOut = ((d.edit['fadeOut'] as num?) ?? 0).toDouble();
  late double duckDb = ((d.edit['duckDb'] as num?) ?? 0).toDouble();
  late bool duck = duckDb > 0;
  late double duckAmount = duckDb > 0 ? duckDb : 9;
  bool get hasStems => d.voice != null && File(d.voice!).existsSync();
  // the video of a take is its finished file (older drafts also kept the camera's own copy)
  String? get videoSource {
    final raw = d.m['raw'] as String?;
    if (raw != null && File(raw).existsSync()) return raw;
    return isVideo && File(d.video).existsSync() ? d.video : null;
  }

  bool get canResync => isVideo && videoSource != null && hasStems;
  bool get canRecover => !isVideo && d.meta['cameraUsed'] == true && d.m['raw'] != null && File('${d.m['raw']}').existsSync() && hasStems;
  bool get canBalance => hasStems && d.music != null && File(d.music!).existsSync();
  Map<String, dynamic> get mixInfo => ((d.meta['mix'] as Map?) ?? {}).cast<String, dynamic>();

  @override
  void dispose() {
    d.m['title'] = title.text.trim().isEmpty ? d.title : title.text.trim();
    Store.i.save();
    title.dispose();
    super.dispose();
  }

  /// Re-mixes the take from its stems with the chosen sync and music level.
  Future<void> remix() async {
    setState(() => busy = true);
    await player.currentState?.pause();
    try {
      final base = ((d.meta['offset'] as num?) ?? 0).toDouble();
      final tmp = '${d.video}.tmp${isVideo ? '.mp4' : '.m4a'}';
      final mix = await Engine.i.finishTake(
        voice: d.voice!,
        music: d.music,
        mode: ((d.meta['modeIndex'] as num?) ?? 0).toInt(),
        wav: '${d.video}.mix.wav',
        out: tmp,
        video: isVideo ? videoSource : null,
        offset: isVideo ? base + delta : null,
        balance: balance,
        fadeIn: fadeIn,
        fadeOut: fadeOut,
        duckDb: duck ? duckAmount : 0,
      );
      if (isVideo && !mix.hasVideo) {
        // never replace a take that has its picture with one that lost it
        try {
          File(tmp).deleteSync();
        } catch (_) {}
        throw 'the picture couldn’t be kept (${mix.videoProblem ?? 'unknown reason'})';
      }
      await player.currentState?.close();
      await File(tmp).rename(d.video);
      Log.add('take', 'remixed', {'id': d.id, 'mix': mix.toJson()});
      d.edit = {...d.edit, 'delta': delta, 'balance': balance, 'fadeIn': fadeIn, 'fadeOut': fadeOut, 'duckDb': duck ? duckAmount : 0.0};
      d.m['meta'] = {...d.meta, 'mix': {...mix.toJson(), 'offset': base}};
      Store.i.save();
      await player.currentState?.open();
      if (mounted) toast(context, 'Updated · ${mix.lufs.toStringAsFixed(1)} LUFS');
    } catch (e) {
      Log.add('take', 'remix failed', {'id': d.id, 'error': '$e'});
      if (mounted) toast(context, 'Couldn’t update the take: $e');
      await player.currentState?.open();
    }
    if (mounted) setState(() => busy = false);
  }

  /// The camera's own file is still here but its picture wasn't used: try combining it again.
  Future<void> recoverPicture() async {
    setState(() => busy = true);
    await player.currentState?.close();
    final out = d.video.replaceFirst(RegExp(r'\.m4a$'), '.mp4');
    final tmp = '$out.tmp.mp4';
    try {
      final mix = await Engine.i.finishTake(
        voice: d.voice!,
        music: d.music,
        mode: ((d.meta['modeIndex'] as num?) ?? 0).toInt(),
        wav: '$out.mix.wav',
        out: tmp,
        video: '${d.m['raw']}',
        offset: ((d.meta['offset'] as num?) ?? 0).toDouble(),
        balance: balance,
        fadeIn: fadeIn,
        fadeOut: fadeOut,
        duckDb: duck ? duckAmount : 0,
      );
      if (!mix.hasVideo) throw mix.videoProblem ?? 'the camera’s file has no usable picture';
      final old = d.video;
      await File(tmp).rename(out);
      if (old != out) _rm(old);
      final info = await Engine.i.videoInfo(out, thumb: '$out.jpg');
      d.m['video'] = out;
      d.m['isVideo'] = true;
      d.m['thumb'] = info['thumb'];
      d.m['meta'] = {...d.meta, 'video': info, 'mix': {...mix.toJson(), 'offset': d.meta['offset']}}..remove('videoProblem');
      Store.i.save(now: true);
      Log.add('take', 'picture recovered', {'id': d.id});
      if (mounted) toast(context, 'The picture is back.');
    } catch (e) {
      Log.add('take', 'picture not recovered', {'id': d.id, 'error': '$e'});
      try {
        File(tmp).deleteSync();
      } catch (_) {}
      if (mounted) toast(context, 'The picture couldn’t be recovered: $e');
    }
    if (mounted) setState(() => busy = false);
    await player.currentState?.open();
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
      'thumb': d.m['thumb'],
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
        Log.add('take', 'gallery copy failed', {'error': '$e'});
        galleryNote = ' (the gallery copy failed: is the phone full?)';
      }
    }
    Store.i.set('saveToGallery', gallery);
    Store.i.recs.insert(0, rec);
    Store.i.drafts.removeWhere((x) => x.id == d.id);
    deleteDraftFiles(d, keepOut: true);
    Store.i.save(now: true);
    Log.add('take', 'saved', {'id': d.id, 'gallery': galleryNote ?? 'no'});
    if (!mounted) return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    Navigator.pop(context);
    messenger?.showSnackBar(SnackBar(content: Text('Saved to Recordings${galleryNote ?? ''}'), duration: const Duration(milliseconds: 2800)));
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
          Player(key: player, path: d.video, video: isVideo, poster: thumb, maxHeight: MediaQuery.of(context).size.height * 0.55),
          if (pictureProblem != null)
            Container(
              margin: const EdgeInsets.only(top: 12),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0x22FCD34D), borderRadius: BorderRadius.circular(14)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(pictureProblem!, style: const TextStyle(color: C.ink2, fontSize: 13.5)),
                Wrap(spacing: 4, children: [
                  if (canRecover) TextButton(onPressed: recoverPicture, child: const Text('Try to recover the picture')),
                  TextButton(onPressed: () => sendProblemReport(context, about: 'take ${d.id}'), child: const Text('Send a problem report')),
                ]),
              ]),
            ),
          if (mixInfo['quiet'] == true)
            Container(
              margin: const EdgeInsets.only(top: 12),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(14)),
              child: const Text('Hardly any voice was recorded in this take, so the sound was left quiet instead of turning the room’s hiss up. Speak closer to the phone, or raise Mic level in the recording settings.',
                  style: TextStyle(color: C.ink2, fontSize: 13.5)),
            ),
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
                'The phone struggled to keep up during this take (${((h['gap'] as num?) ?? 0).toStringAsFixed(1)} s of audio gaps). '
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
              child: TextButton(onPressed: remix, child: Text('Apply ${delta >= 0 ? '+' : ''}${(delta * 1000).round()} ms')),
            ),
          ],
          if (canBalance) ...[
            const SizedBox(height: 18),
            const Text('Music under your voice', style: TextStyle(fontWeight: FontWeight.w700)),
            Text('${d.meta['musicLabel'] ?? 'Background music'} · change these and apply; your voice is kept separately.', style: const TextStyle(color: C.muted, fontSize: 13)),
            Row(children: [
              const SizedBox(width: 78, child: Text('Level', style: TextStyle(color: C.muted, fontSize: 12.5))),
              Expanded(child: Slider(value: balance.clamp(-12.0, 6.0), min: -12, max: 6, divisions: 18, label: '${balance >= 0 ? '+' : ''}${balance.round()} dB', onChanged: (v) => setState(() => balance = v))),
              SizedBox(width: 48, child: Text('${balance >= 0 ? '+' : ''}${balance.round()} dB', textAlign: TextAlign.right, style: const TextStyle(color: C.muted, fontSize: 12.5))),
            ]),
            Row(children: [
              const SizedBox(width: 78, child: Text('Fade in', style: TextStyle(color: C.muted, fontSize: 12.5))),
              Expanded(child: Slider(value: fadeIn.clamp(0.0, 8.0), max: 8, divisions: 16, onChanged: (v) => setState(() => fadeIn = v))),
              SizedBox(width: 48, child: Text('${fadeIn.toStringAsFixed(1)} s', textAlign: TextAlign.right, style: const TextStyle(color: C.muted, fontSize: 12.5))),
            ]),
            Row(children: [
              const SizedBox(width: 78, child: Text('Fade out', style: TextStyle(color: C.muted, fontSize: 12.5))),
              Expanded(child: Slider(value: fadeOut.clamp(0.0, 10.0), max: 10, divisions: 20, onChanged: (v) => setState(() => fadeOut = v))),
              SizedBox(width: 48, child: Text('${fadeOut.toStringAsFixed(1)} s', textAlign: TextAlign.right, style: const TextStyle(color: C.muted, fontSize: 12.5))),
            ]),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Lower the music while you speak'),
              value: duck,
              onChanged: (v) => setState(() => duck = v),
            ),
            if (duck)
              Row(children: [
                const SizedBox(width: 78, child: Text('Lower by', style: TextStyle(color: C.muted, fontSize: 12.5))),
                Expanded(child: Slider(value: duckAmount.clamp(3.0, 18.0), min: 3, max: 18, divisions: 15, onChanged: (v) => setState(() => duckAmount = v))),
                SizedBox(width: 48, child: Text('${duckAmount.round()} dB', textAlign: TextAlign.right, style: const TextStyle(color: C.muted, fontSize: 12.5))),
              ]),
            Align(alignment: Alignment.centerRight, child: FilledButton.tonal(onPressed: remix, child: const Text('Apply to the take'))),
          ],
          if (mixInfo['lufs'] is num && mixInfo['truePeak'] is num)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Loudness ${(mixInfo['lufs'] as num).toStringAsFixed(1)} LUFS · peak ${(mixInfo['truePeak'] as num).toStringAsFixed(1)} dBTP',
                  style: const TextStyle(color: C.faint, fontSize: 12)),
            ),
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
                _rm(rec.thumb);
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
        Player(path: rec.path, video: video, poster: rec.thumb, maxHeight: MediaQuery.of(context).size.height * 0.65),
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
