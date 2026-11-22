// Runs on a real Android system (an emulator in CI): records takes back to back through the real
// recording screen, camera, microphone, mixer and player, and checks that every finished take
// has a picture and sound and that it plays. Also the situations that used to leave the camera
// in a bad state: a double tap on Record, leaving the app mid-take, pause/resume, a take
// stopped at once, and switching cameras.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:lectern/core/catalog.dart';
import 'package:lectern/core/log.dart';
import 'package:lectern/core/model.dart';
import 'package:lectern/core/report.dart';
import 'package:lectern/core/store.dart';
import 'package:lectern/engine/engine.dart';
import 'package:lectern/screens/perform.dart';
import 'package:lectern/screens/take_editor.dart';
import 'package:lectern/widgets/ui.dart';

class _Home extends StatelessWidget {
  final Item item;
  const _Home(this.item);
  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: TextButton(
            key: const ValueKey('go'),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PerformScreen(item: item))),
            child: const Text('go'),
          ),
        ),
      );
}

final failures = <String>[];
void fail_(String where, String what) {
  failures.add('$where: $what');
  // ignore: avoid_print
  print('FAILED  $where: $what');
}

Future<void> pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<bool> waitFor(WidgetTester t, bool Function() ok, {Duration timeout = const Duration(seconds: 40)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 50));
    try {
      if (ok()) return true;
    } catch (_) {}
  }
  return false;
}

dynamic studio(WidgetTester t) => t.state(find.byType(PerformScreen));
bool onStudio(WidgetTester t) => find.byType(PerformScreen).evaluate().isNotEmpty;
bool onEditor(WidgetTester t) => find.byType(TakeEditor).evaluate().isNotEmpty;

Future<void> tapRecord(WidgetTester t) async {
  await t.tap(find.byKey(const ValueKey('record')), warnIfMissed: false);
}

/// One take from the launcher to the take editor and back. Returns the draft (or null).
Future<Draft?> take(
  WidgetTester t,
  String name, {
  double seconds = 3,
  bool doubleTap = false,
  bool pauseMid = false,
  bool background = false,
  bool flip = false,
  bool expectTooShort = false,
  int countdown = 0,
  String leave = 'draft', // draft | save | discard
}) async {
  // ignore: avoid_print
  print('---- $name');
  Store.i.settings['countdown'] = countdown;
  final before = Store.i.drafts.length;
  await t.tap(find.byKey(const ValueKey('go')));
  if (!await waitFor(t, () => onStudio(t) && studio(t).phase == Phase.ready, timeout: const Duration(seconds: 60))) {
    fail_(name, 'the studio did not become ready');
    return null;
  }
  if (!await waitFor(t, () => studio(t).cam != null, timeout: const Duration(seconds: 30))) {
    fail_(name, 'the camera did not open: ${studio(t).camErr}');
  }
  if (flip) {
    await studio(t).flipCam();
    if (!await waitFor(t, () => studio(t).cam != null, timeout: const Duration(seconds: 30))) fail_(name, 'the camera did not reopen after switching');
  }
  await pumpFor(t, const Duration(milliseconds: 800));
  await tapRecord(t);
  if (doubleTap) await tapRecord(t); // an impatient second tap before the app reacted
  if (!await waitFor(t, () => studio(t).phase == Phase.recording, timeout: Duration(seconds: 30 + countdown))) {
    fail_(name, 'recording did not start (phase ${onStudio(t) ? studio(t).phase : 'gone'})');
    return null;
  }
  if (studio(t).videoRecording != true) fail_(name, 'the camera is not recording');
  if (expectTooShort) {
    await pumpFor(t, const Duration(milliseconds: 150));
    await tapRecord(t);
    final back = await waitFor(t, () => onStudio(t) && studio(t).phase == Phase.ready, timeout: const Duration(seconds: 40));
    if (!back) fail_(name, 'a take stopped at once did not return to ready');
    if (Store.i.drafts.length != before) fail_(name, 'a take stopped at once was kept');
    // the same screen must be able to record right away
    await pumpFor(t, const Duration(seconds: 1));
    await tapRecord(t);
    if (!await waitFor(t, () => studio(t).phase == Phase.recording, timeout: const Duration(seconds: 30))) {
      fail_(name, 'recording did not start after a too-short take');
      return null;
    }
  }
  if (pauseMid) {
    await pumpFor(t, Duration(milliseconds: (seconds * 500).round()));
    await studio(t).pauseTake();
    if (studio(t).phase != Phase.paused) fail_(name, 'pause did not pause');
    await pumpFor(t, const Duration(seconds: 2));
    await studio(t).resumeTake();
    if (studio(t).phase != Phase.recording) fail_(name, 'resume did not resume');
    await pumpFor(t, Duration(milliseconds: (seconds * 500).round()));
  } else {
    await pumpFor(t, Duration(milliseconds: (seconds * 1000).round()));
  }
  if (background) {
    // what the app is told when the performer switches to another app mid-take
    // (no frames are drawn while "in the background", so real time is waited here, not frames)
    for (final s in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]) {
      t.binding.handleAppLifecycleStateChanged(s);
      await Future<void>.delayed(const Duration(milliseconds: 150));
    }
    await Future<void>.delayed(const Duration(seconds: 4));
    for (final s in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
      t.binding.handleAppLifecycleStateChanged(s);
    }
  } else {
    await tapRecord(t);
  }
  final done = await waitFor(t, () => onEditor(t), timeout: const Duration(seconds: 90));
  if (!done) {
    fail_(name, 'the take editor did not open (phase ${onStudio(t) ? studio(t).phase : 'gone'})');
    return null;
  }
  if (Store.i.drafts.length != before + 1) fail_(name, 'expected one new take, got ${Store.i.drafts.length - before}');
  final d = Store.i.drafts.first;
  final v = ((d.meta['video'] as Map?) ?? {}).cast<String, dynamic>();
  final mix = ((d.meta['mix'] as Map?) ?? {}).cast<String, dynamic>();
  final f = File(d.video);
  final summary = {
    'isVideo': d.m['isVideo'],
    'bytes': f.existsSync() ? f.lengthSync() : -1,
    'sound s': d.dur,
    'video': {...v}..remove('thumb'),
    'problem': d.meta['videoProblem'],
    'cameraError': d.meta['cameraError'],
    'lufs': mix['lufs'],
    'quiet': mix['quiet'],
    'poster': d.m['thumb'] != null && File('${d.m['thumb']}').existsSync(),
    'cameraCopyKept': d.m['raw'] != null,
  };
  // ignore: avoid_print
  print('TAKE $name ${jsonEncode(summary, toEncodable: (o) => '$o')}');
  if (d.m['isVideo'] != true) fail_(name, 'the take has no picture (${d.meta['videoProblem']}, ${d.meta['cameraError']})');
  if (v['hasVideo'] != true) fail_(name, 'the finished file has no video track');
  final vd = (v['duration'] as num?)?.toDouble() ?? 0;
  if (vd < d.dur * 0.6 || vd > d.dur + 2.5) fail_(name, 'video is $vd s but the sound is ${d.dur} s');
  if (((v['luma'] as num?) ?? -1) < 3) fail_(name, 'the picture is black (brightness ${v['lumas']})');
  if (d.m['thumb'] == null) fail_(name, 'no poster frame');
  if (d.m['raw'] != null && d.m['isVideo'] == true) fail_(name, 'the camera copy was kept although the take has its picture');
  // the player: opens, has a picture size, and time moves when it plays
  final opened = await waitFor(t, () {
    final ps = t.state<PlayerState>(find.byType(Player));
    return ps.err != null || (ps.c != null && ps.c!.value.isInitialized);
  }, timeout: const Duration(seconds: 40));
  final ps = t.state<PlayerState>(find.byType(Player));
  if (!opened || ps.c == null) {
    fail_(name, 'the player did not open: ${ps.err}');
  } else {
    final size = ps.c!.value.size;
    if (d.m['isVideo'] == true && (size.width < 16 || size.height < 16)) fail_(name, 'the player reports no picture size ($size)');
    await ps.c!.play();
    final moved = await waitFor(t, () => ps.c != null && ps.c!.value.position > const Duration(milliseconds: 600), timeout: const Duration(seconds: 20));
    if (!moved) fail_(name, 'playback did not advance (${ps.c?.value.position}, error ${ps.c?.value.errorDescription})');
    if (ps.c != null && ps.c!.value.hasError) fail_(name, 'the player reported ${ps.c!.value.errorDescription}');
    await ps.c?.pause();
  }
  // leave the editor the way a performer would
  if (leave == 'save') {
    await t.ensureVisible(find.text('Save take'));
    await pumpFor(t, const Duration(milliseconds: 400));
    await t.tap(find.text('Save take'), warnIfMissed: false);
    final saved = await waitFor(t, () => !onEditor(t), timeout: const Duration(seconds: 40));
    if (!saved) fail_(name, 'saving the take did not finish');
    if (Store.i.recs.isEmpty || Store.i.recs.first.id != d.id) fail_(name, 'the saved take is not in Recordings');
    if (!File(d.video).existsSync()) fail_(name, 'the saved take lost its file');
  } else {
    if (leave == 'discard') {
      Store.i.drafts.removeWhere((x) => x.id == d.id);
      deleteDraftFiles(d);
    }
    Navigator.of(t.element(find.byType(TakeEditor))).pop();
    await waitFor(t, () => !onEditor(t), timeout: const Duration(seconds: 20));
  }
  await pumpFor(t, const Duration(milliseconds: 600));
  return d;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('takes back to back keep their picture and sound', (t) async {
    // CI grants the camera and microphone permissions from outside shortly after the install
    await Future<void>.delayed(const Duration(seconds: 12));
    await Catalog.i.load();
    await Store.i.load();
    await Engine.i.start();
    Store.i.settings['saveToGallery'] = false;
    final item = Item.create(Kind.script, 'device-test')
      ..title = 'Device test'
      ..body = '[Intro]\nGood evening.\n[pause]\nThis is a test of the studio.\n\n[Close]\nThank you.';
    item.music = {'type': 'none'};
    Store.i.items.add(item);
    await t.pumpWidget(MaterialApp(theme: lecternTheme(), home: _Home(item)));
    await pumpFor(t, const Duration(seconds: 1));

    // the reported sequence: several takes in a row, each watched and left
    await take(t, '1 first take', leave: 'draft');
    await take(t, '2 second take', leave: 'save');
    await take(t, '3 third take', leave: 'draft');
    await take(t, '4 fourth take', leave: 'discard');
    await take(t, '5 with a countdown', countdown: 3, leave: 'save');
    // the situations that could leave the camera in a bad state
    await take(t, '6 double tap on Record', doubleTap: true);
    await take(t, '7 after the double tap');
    await take(t, '8 paused and resumed', pauseMid: true, seconds: 4);
    await take(t, '9 left the app mid-take', background: true);
    await take(t, '10 after leaving the app');
    await take(t, '11 stopped at once, then again', expectTooShort: true);
    await take(t, '12 other camera', flip: true);
    await take(t, '13 back on the first camera', flip: true, leave: 'save');

    // saving to the gallery (a copy outside the app)
    if (Store.i.recs.isNotEmpty) {
      try {
        final uri = await Engine.i.saveToGallery(Store.i.recs.first.path, 'Lectern device test');
        // ignore: avoid_print
        print('GALLERY $uri');
      } catch (e) {
        fail_('gallery', '$e');
      }
    }
    // the problem report can be built and holds the app's record of the takes
    try {
      final x = await buildProblemReport(about: 'device test');
      final text = await File(x.path).readAsString();
      if (!text.contains('[take] finished')) fail_('report', 'the report does not contain the takes');
      // ignore: avoid_print
      print('REPORT ${text.length} characters; phone: ${RegExp(r'phone: .*').firstMatch(text)?.group(0)}');
    } catch (e) {
      fail_('report', '$e');
    }
    await Store.i.flush();
    // ignore: avoid_print
    print('==== app log ====\n${(await Log.tail(260)).join('\n')}\n==== end of app log ====');
    // ignore: avoid_print
    print('SUMMARY ${failures.isEmpty ? 'all checks passed' : '${failures.length} problem(s)'}');
    expect(failures, isEmpty, reason: failures.join('\n'));
  }, timeout: const Timeout(Duration(minutes: 40)));
}
