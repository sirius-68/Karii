// AI lyric sync and lyrics-from-audio, using whisper.cpp on the device.
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../lyrics/retime.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';

class SttModel {
  final String id, name, file, size, note;
  const SttModel(this.id, this.name, this.file, this.size, this.note);
  String get url => 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$file';
}

const sttModels = [
  SttModel('base', 'Whisper Base', 'ggml-base-q5_1.bin', '57 MB', 'Fast. Good on clear vocals.'),
  SttModel('small', 'Whisper Small', 'ggml-small-q5_1.bin', '181 MB', 'More accurate, about 3× slower.'),
];

const sttLanguages = {
  'auto': 'Detect automatically',
  'en': 'English',
  'ru': 'Russian',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'uk': 'Ukrainian',
  'tr': 'Turkish',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh': 'Chinese',
};

const _ch = MethodChannel('lectern/engine');

Future<File> _modelFile(SttModel m) async => File(Store.i.mediaPath('../models/${m.file}'));

Future<bool> _download(BuildContext context, SttModel m, File f) async {
  final progress = ValueNotifier<double>(0);
  var cancelled = false;
  final client = HttpClient();
  final dialog = showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (c) => AlertDialog(
      backgroundColor: C.s2,
      title: Text('Downloading ${m.name}'),
      content: ValueListenableBuilder<double>(
        valueListenable: progress,
        builder: (_, p, __) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          LinearProgressIndicator(value: p > 0 ? p : null),
          const SizedBox(height: 10),
          Text('${(p * 100).round()}% of ${m.size}. This happens once; after that it works offline.', style: const TextStyle(color: C.muted)),
        ]),
      ),
      actions: [
        TextButton(
            onPressed: () {
              cancelled = true;
              client.close(force: true);
              Navigator.pop(c);
            },
            child: const Text('Cancel')),
      ],
    ),
  );
  try {
    await f.parent.create(recursive: true);
    final req = await client.getUrl(Uri.parse(m.url));
    final res = await req.close();
    if (res.statusCode != 200) throw HttpException('HTTP ${res.statusCode}');
    final total = res.contentLength;
    final tmp = File('${f.path}.part');
    final sink = tmp.openWrite();
    var got = 0;
    await for (final chunk in res) {
      if (cancelled) break;
      sink.add(chunk);
      got += chunk.length;
      if (total > 0) progress.value = got / total;
    }
    await sink.close();
    if (cancelled) {
      if (await tmp.exists()) await tmp.delete();
      return false;
    }
    await tmp.rename(f.path);
    if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
    await dialog;
    return true;
  } catch (e) {
    if (context.mounted && !cancelled) {
      Navigator.of(context, rootNavigator: true).pop();
      toast(context, 'The speech model couldn’t download. Check your connection and try again.');
    }
    return false;
  } finally {
    client.close();
  }
}

Future<Map<String, String>?> _pickOptions(BuildContext context, String title, String what) {
  var model = Store.i.settings['sttModel'] as String? ?? 'base';
  var lang = Store.i.settings['sttLanguage'] as String? ?? 'auto';
  return sheet<Map<String, String>>(
    context,
    (c) => StatefulBuilder(
      builder: (c, set) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(what, style: const TextStyle(color: C.muted)),
            const SizedBox(height: 14),
            for (final m in sttModels)
              RadioListTile<String>(
                contentPadding: EdgeInsets.zero,
                value: m.id,
                groupValue: model,
                onChanged: (v) => set(() => model = v!),
                title: Text(m.name),
                subtitle: Text('${m.note} ${m.size} download, runs on your phone.', style: const TextStyle(color: C.muted)),
              ),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              initialValue: lang,
              decoration: const InputDecoration(labelText: 'Language of the song'),
              items: [for (final e in sttLanguages.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
              onChanged: (v) => lang = v ?? 'auto',
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  Store.i.set('sttModel', model);
                  Store.i.set('sttLanguage', lang);
                  Navigator.pop(c, {'model': model, 'lang': lang});
                },
                child: const Text('Start'),
              ),
            ),
          ]),
        ),
      ),
    ),
  );
}

/// Transcribes [src] on the device. Returns the heard words with timing, or null (after telling the user why).
Future<List<HeardWord>?> transcribe(BuildContext context, MusicSource src, {required String title, required String what}) async {
  final opt = await _pickOptions(context, title, what);
  if (opt == null || !context.mounted) return null;
  final m = sttModels.firstWhere((x) => x.id == opt['model'], orElse: () => sttModels.first);
  final f = await _modelFile(m);
  if (!await f.exists()) {
    if (!context.mounted) return null;
    if (!await _download(context, m, f)) return null;
  }
  if (!context.mounted) return null;
  final started = DateTime.now();
  final status = ValueNotifier<String>('Preparing the audio…');
  final tick = Timer.periodic(const Duration(seconds: 1), (_) async {
    final s = DateTime.now().difference(started).inSeconds;
    int p = 0;
    try {
      p = await _ch.invokeMethod<int>('transcribeProgress') ?? 0;
    } catch (_) {}
    if (s > 1) status.value = 'Listening… ${p > 0 ? '$p% · ' : ''}${fmtTime(s.toDouble())}\nRuns on your phone; nothing is uploaded.';
  });
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (c) => PopScope(
      canPop: false,
      child: AlertDialog(
        backgroundColor: C.s2,
        title: Text(title),
        content: ValueListenableBuilder<String>(
          valueListenable: status,
          builder: (_, s, __) => Column(mainAxisSize: MainAxisSize.min, children: [const LinearProgressIndicator(), const SizedBox(height: 12), Text(s, style: const TextStyle(color: C.muted))]),
        ),
        actions: [TextButton(onPressed: () => _ch.invokeMethod('transcribeCancel'), child: const Text('Cancel'))],
      ),
    ),
  );
  List<HeardWord> words = [];
  String? err;
  try {
    final r = await _ch.invokeListMethod<dynamic>('transcribe', {
      'asset': src.asset,
      'path': src.path,
      'url': src.url,
      'model': f.path,
      'language': opt['lang'],
    });
    words = (r ?? []).map((w) => HeardWord.fromJson(w)).where((w) => w.text.trim().isNotEmpty).toList();
    if (words.isEmpty) err = 'No words were recognised. Try the Small model or check the language.';
  } on MissingPluginException {
    err = 'Speech recognition isn’t available in this build.';
  } on PlatformException catch (e) {
    err = e.message == 'cancelled' ? 'Cancelled' : 'The speech engine stopped: ${e.message ?? e.code}';
  } catch (e) {
    err = 'The speech engine stopped: $e';
  } finally {
    tick.cancel();
    if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
  }
  if (err != null) {
    if (context.mounted) toast(context, err);
    return null;
  }
  Store.i.settings['sttLast'] = {'model': m.id, 'language': opt['lang'], 'seconds': DateTime.now().difference(started).inSeconds};
  return words;
}

/// Runs AI sync (or lyrics generation when [generate]) for a song. Returns true when timing changed.
Future<bool> aiSync(BuildContext context, Item it, {bool generate = false}) async {
  final src = musicFor(it);
  if (src.none) {
    toast(context, 'Attach music first');
    return false;
  }
  final words = await transcribe(context, src,
      title: generate ? 'Writing the lyrics' : 'Syncing the lyrics',
      what: generate ? 'Lectern listens to the song and writes the lyrics with word timing.' : 'Lectern listens to the song and times your lyrics word by word.');
  if (words == null) return false;
  it.sttWords = words;
  it.m['stt'] = Store.i.settings['sttLast'];
  final lines = lyricLines(it.body);
  if (generate || lines.isEmpty) {
    final g = wordsToLines(words);
    it.body = g.lines.join('\n');
    it.times = g.times;
    it.ends = g.ends;
    it.wt = g.wt;
    it.genText = it.body;
    it.anch = List<bool>.filled(g.lines.length, true);
    if (it.rawTitle.trim().isEmpty && g.lines.isNotEmpty) it.title = g.lines.first.replaceAll(RegExp(r'[,.!?]+$'), '');
    if (context.mounted) toast(context, 'Transcribed ${g.lines.length} lines with word timing');
  } else {
    final r = alignLyricsToWords(lines, words);
    it.times = r.times;
    it.ends = r.ends;
    it.wt = r.wt;
    it.anch = r.anchored;
    if (context.mounted) toast(context, 'Synced ${lines.length} lines · ${(r.confidence * 100).round()}% of words matched');
  }
  markTimed(it, keepAnch: true);
  it.refined = 0;
  it.touch();
  Store.i.save();
  return true;
}
