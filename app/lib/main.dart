import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/catalog.dart';
import 'core/jobs.dart';
import 'core/store.dart';
import 'engine/engine.dart';
import 'screens/editor.dart';
import 'screens/shell.dart';
import 'widgets/job_pill.dart';
import 'widgets/ui.dart';

final navKey = GlobalKey<NavigatorState>();
final messengerKey = GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light));
  await Catalog.i.load();
  await Store.i.load();
  Engine.i.start();
  runApp(const LecternApp());
  // after the first frame: pick up background jobs (and results finished while the app was closed)
  WidgetsBinding.instance.addPostFrameCallback((_) {
    Jobs.i.init();
    Store.i.cleanup();
  });
}

/// Opens the project a finished job belongs to.
void openJobResult(Job j) {
  final it = Store.i.find(j.itemId);
  final nav = navKey.currentState;
  if (it == null || nav == null) return;
  nav.push(MaterialPageRoute(builder: (_) => EditorScreen(item: it)));
}

class LecternApp extends StatefulWidget {
  const LecternApp({super.key});
  @override
  State<LecternApp> createState() => _LecternAppState();
}

class _LecternAppState extends State<LecternApp> {
  StreamSubscription? _open, _done;

  @override
  void initState() {
    super.initState();
    _open = Jobs.i.opens.listen(openJobResult);
    _done = Jobs.i.finished.listen((j) {
      final m = messengerKey.currentState;
      if (m == null) return;
      m.hideCurrentSnackBar();
      m.showSnackBar(SnackBar(
        content: Text('The lines from “${Store.i.find(j.itemId)?.title ?? 'your clip'}” are ready'),
        action: SnackBarAction(label: 'Open', onPressed: () => openJobResult(j)),
        duration: const Duration(seconds: 6),
      ));
    });
  }

  @override
  void dispose() {
    _open?.cancel();
    _done?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Lectern',
        debugShowCheckedModeBanner: false,
        theme: lecternTheme(),
        navigatorKey: navKey,
        scaffoldMessengerKey: messengerKey,
        home: const Shell(),
        builder: (context, child) => Stack(children: [
          child ?? const SizedBox(),
          Positioned(
            right: 12,
            bottom: MediaQuery.of(context).padding.bottom + 76,
            child: JobPill(onOpen: openJobResult, navContext: () => navKey.currentContext),
          ),
        ]),
      );
}
