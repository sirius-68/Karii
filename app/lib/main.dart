import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/catalog.dart';
import 'core/store.dart';
import 'engine/engine.dart';
import 'screens/shell.dart';
import 'widgets/ui.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light));
  await Catalog.i.load();
  await Store.i.load();
  Engine.i.start();
  runApp(const LecternApp());
}

class LecternApp extends StatelessWidget {
  const LecternApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Lectern',
        debugShowCheckedModeBanner: false,
        theme: lecternTheme(),
        home: const Shell(),
      );
}
