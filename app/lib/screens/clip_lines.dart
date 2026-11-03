// Clip to lines: import a movie clip and get the spoken lines as performance text, using
// whisper.cpp on the device (a background job; see core/jobs.dart).
import 'dart:io';

import 'package:flutter/material.dart';

import '../core/jobs.dart';
import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../widgets/ui.dart';

class SttModel {
  final String id, name, file, size, note;
  const SttModel(this.id, this.name, this.file, this.size, this.note);
  String get url => 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$file';
}

const sttModels = [
  SttModel('base', 'Whisper Base', 'ggml-base-q5_1.bin', '57 MB', 'Fast. Good on clear dialogue.'),
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

Future<File> _modelFile(SttModel m) async => File(Store.i.mediaPath('../models/${m.file}'));

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
              decoration: const InputDecoration(labelText: 'Language spoken in the clip'),
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

/// Starts a background transcription job for [it] (see core/jobs.dart). The user can keep using
/// the app; a floating indicator shows progress and a notification says when it's ready.
/// Returns true when a job was started (or one was already running for this item).
Future<bool> startTranscription(BuildContext context, Item it, {required String purpose, required String title, required String what, MusicSource? source}) async {
  final src = source ?? musicFor(it);
  if (src.none) {
    toast(context, 'Pick a clip first');
    return false;
  }
  final running = Jobs.i.forItem(it.id);
  if (running != null && running.active) {
    toast(context, 'Already working on this one: ${running.label}');
    return true;
  }
  final opt = await _pickOptions(context, title, what);
  if (opt == null || !context.mounted) return false;
  final m = sttModels.firstWhere((x) => x.id == opt['model'], orElse: () => sttModels.first);
  final f = await _modelFile(m);
  // notifications tell the user when the job is done (Android 13+ asks once)
  await Engine.i.requestPermissions(['android.permission.POST_NOTIFICATIONS']).catchError((_) => false);
  try {
    await Jobs.i.transcribe(
      item: it,
      purpose: purpose,
      src: src,
      title: '${title.replaceAll('…', '')}: ${it.title}',
      modelPath: f.path,
      modelUrl: m.url,
      language: opt['lang'] ?? 'auto',
    );
  } catch (e) {
    if (context.mounted) toast(context, 'Couldn’t start: $e');
    return false;
  }
  if (context.mounted) {
    toast(context, (await f.exists()) ? 'Working in the background. Keep using Lectern; you’ll be notified when it’s ready.' : 'Downloading the speech model (${m.size}, once), then working in the background.');
  }
  return true;
}

/// Picks a video, then transcribes it into a new movie-line project and opens it.
Future<void> clipToLines(BuildContext context, {required Future<void> Function(Item) open}) async {
  final r = await Engine.i.pickFile('video/*');
  if (r == null || !context.mounted) return;
  final it = Store.i.create(Kind.line);
  it.title = '${r['name'] ?? 'Movie clip'}'.replaceAll(RegExp(r'\.[A-Za-z0-9]+$'), '');
  it.m['clip'] = r['path'];
  Store.i.save();
  final ok = await startTranscription(context, it,
      purpose: 'clip', title: 'Finding the lines', what: 'Lectern listens to the clip and writes out what is said.', source: MusicSource(path: '${r['path']}'));
  if (!context.mounted) return;
  if (!ok) {
    Store.i.deleteItem(it);
    return;
  }
  await open(it);
}
