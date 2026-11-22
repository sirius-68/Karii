// The camera queue: operations run strictly in order across callers, a failed or hung one does
// not block the next, and the flight-recorder log keeps what happened.
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lectern/core/cam.dart';
import 'package:lectern/core/log.dart';
import 'package:lectern/core/text.dart';

void main() {
  test('operations run one after another, in the order they were asked for', () async {
    final order = <String>[];
    Future<void> op(String name, int ms) => Cam.run(name, () async {
          order.add('$name+');
          await Future<void>.delayed(Duration(milliseconds: ms));
          order.add('$name-');
        });
    // a slow close asked first, a fast open asked second: the open must not overtake the close
    final a = op('close', 60), b = op('open', 5), c = op('start', 1);
    await Future.wait([a, b, c]);
    expect(order, ['close+', 'close-', 'open+', 'open-', 'start+', 'start-']);
    expect(Cam.pending, 0);
  });

  test('a failing operation reports its error and the queue goes on', () async {
    final failed = Cam.run<void>('bad', () async => throw StateError('camera busy'));
    final next = Cam.run('next', () async => 42);
    await expectLater(failed, throwsStateError);
    expect(await next, 42);
  });

  test('an operation that hangs times out and does not block the next one', () async {
    final never = Completer<void>();
    final hung = Cam.run('hang', () => never.future, timeout: const Duration(milliseconds: 80));
    final next = Cam.run('after', () async => 'ok');
    await expectLater(hung, throwsA(isA<TimeoutException>()));
    expect(await next, 'ok');
  });

  test('the log keeps lines written before it has a file', () async {
    Log.add('test', 'early line', {'n': 1});
    final lines = await Log.tail(50);
    expect(lines.any((l) => l.contains('[test] early line') && l.contains('"n":1')), isTrue);
  });

  test('sizes are written for people', () {
    expect(fmtBytes(1536 * 1000 * 1000), '1.5 GB');
    expect(fmtBytes(82 * 1000 * 1000), '82 MB');
    expect(fmtBytes(4000), '4 KB');
  });
}
