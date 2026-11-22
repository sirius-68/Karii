// "Send a problem report": the app's own record of what happened (camera, recorder, files,
// player), the phone model, storage and this app's recent system log, as one text file handed
// to the share sheet. It contains no script text, audio or video.
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../engine/engine.dart';
import '../widgets/ui.dart';
import 'log.dart';
import 'store.dart';
import 'text.dart';

/// Builds the report file and returns its text (also used by tests).
Future<XFile> buildProblemReport({String? about}) async {
  final st = Store.i;
  final diag = await Engine.i.diagnostics(lines: 800);
  final facts = <String, Object?>{
    if (about != null) 'about': about,
    'phone': diag['device'],
    'chip': diag['soc'],
    'android': diag['android'],
    'app': diag['app'],
    'storage free': diag['free'] is num ? fmtBytes(diag['free'] as num) : '?',
    'storage total': diag['total'] is num ? fmtBytes(diag['total'] as num) : '?',
    'app files': diag['files'] is num ? fmtBytes(diag['files'] as num) : '?',
    'app cache': diag['cache'] is num ? fmtBytes(diag['cache'] as num) : '?',
    'drafts': '${st.drafts.length} (${fmtBytes(st.draftBytes())})',
    'recordings': st.recs.length,
    'takes ever': st.stats['takes'],
    'audio route': Engine.i.route.label,
    'settings': {
      for (final k in const ['noiseCancel', 'speakerMusic', 'countdown', 'facing', 'micGain', 'saveToGallery']) k: st.settings[k] ?? Store.defaults[k],
    },
  };
  Log.add('report', 'built', {'about': about});
  final f = await Log.report(st.dir, facts, '${diag['log'] ?? ''}');
  return XFile(f.path, mimeType: 'text/plain', name: 'lectern-report.txt');
}

Future<void> sendProblemReport(BuildContext context, {String? about}) async {
  try {
    final x = await buildProblemReport(about: about);
    await SharePlus.instance.share(ShareParams(files: [x], subject: 'Lectern problem report', text: 'Lectern problem report'));
  } catch (e) {
    if (context.mounted) toast(context, 'The report couldn’t be made: $e');
  }
}
