// A small flight recorder: what the app did around each take (camera, recorder, files, player),
// kept in a text file so a problem on a phone can be reported as facts instead of a description.
// "Send a problem report" (Profile, and on a take that went wrong) shares this file together
// with the phone model, storage and the app's own recent system log.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

class Log {
  static File? _file;
  static final List<String> _early = [];
  static const _maxBytes = 400 * 1024;

  static Future<void> init(Directory dir) async {
    try {
      final f = File('${dir.path}/log.txt');
      if (await f.exists() && await f.length() > _maxBytes) {
        // keep the newer half
        final s = await f.readAsString();
        final cut = s.indexOf('\n', s.length ~/ 2);
        await f.writeAsString(cut > 0 ? s.substring(cut + 1) : '');
      }
      _file = f;
      add('app', 'started');
      for (final l in _early) {
        _write(l);
      }
      _early.clear();
    } catch (e) {
      debugPrint('log init: $e');
    }
  }

  /// One line: time, area, what happened, and any values worth keeping.
  static void add(String area, String what, [Map<String, Object?>? data]) {
    final t = DateTime.now().toIso8601String().substring(5, 23).replaceFirst('T', ' ');
    var line = '$t [$area] $what';
    if (data != null && data.isNotEmpty) {
      try {
        line += ' ${jsonEncode(data, toEncodable: (o) => '$o')}';
      } catch (_) {
        line += ' $data';
      }
    }
    debugPrint(line);
    if (_file == null) {
      if (_early.length < 200) _early.add(line);
    } else {
      _write(line);
    }
  }

  static void _write(String line) {
    try {
      _file!.writeAsStringSync('$line\n', mode: FileMode.append);
    } catch (_) {}
  }

  static Future<String> text() async {
    try {
      return await _file?.readAsString() ?? _early.join('\n');
    } catch (_) {
      return '';
    }
  }

  /// The last [n] lines, for showing in the app.
  static Future<List<String>> tail(int n) async {
    final l = const LineSplitter().convert(await text());
    return l.length > n ? l.sublist(l.length - n) : l;
  }

  /// Writes the full report (facts about the phone and app, the log, the system log) to a file.
  static Future<File> report(Directory dir, Map<String, Object?> facts, String systemLog) async {
    final sb = StringBuffer()
      ..writeln('Lectern problem report')
      ..writeln(DateTime.now().toIso8601String())
      ..writeln();
    facts.forEach((k, v) => sb.writeln('$k: $v'));
    sb
      ..writeln()
      ..writeln('---- what the app did ----')
      ..writeln(await text())
      ..writeln('---- system log (this app only) ----')
      ..writeln(systemLog);
    final f = File('${dir.path}/lectern-report.txt');
    await f.writeAsString(sb.toString());
    return f;
  }
}
