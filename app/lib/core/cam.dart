// The camera plugin keeps ONE camera for the whole app: disposing any controller unbinds every
// camera use, and a start that follows an unfinished stop is silently ignored. So every camera
// operation (open, close, start/stop recording) goes through this queue and runs strictly in
// order, across screens. Each operation has a time limit so one that hangs can't block the rest.
import 'dart:async';

import 'log.dart';

class Cam {
  static Future<void> _tail = Future.value();
  static int _pending = 0;

  static int get pending => _pending;

  static Future<T> run<T>(String what, Future<T> Function() op, {Duration timeout = const Duration(seconds: 12)}) {
    final done = Completer<T>();
    _pending++;
    _tail = _tail.then((_) async {
      final sw = Stopwatch()..start();
      try {
        final r = await op().timeout(timeout);
        Log.add('camera', what, {'ms': sw.elapsedMilliseconds});
        done.complete(r);
      } on TimeoutException {
        Log.add('camera', '$what timed out', {'ms': sw.elapsedMilliseconds});
        done.completeError(TimeoutException('The camera did not respond ($what)'));
      } catch (e) {
        Log.add('camera', '$what failed', {'ms': sw.elapsedMilliseconds, 'error': '$e'});
        done.completeError(e);
      } finally {
        _pending--;
      }
    });
    return done.future;
  }
}
