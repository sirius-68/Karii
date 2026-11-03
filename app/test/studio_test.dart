// Script text, sections, teleprompter rows, undo history and the migration of older projects.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectern/core/media.dart';
import 'package:lectern/core/model.dart';
import 'package:lectern/core/text.dart';
import 'package:lectern/screens/editor.dart' show TextHistory;
import 'package:lectern/widgets/prompter.dart';

void main() {
  group('sections and directions', () {
    const body = '[Intro]\nGood evening.\n[pause]\nI am here.\n\n[Verse 1]\nLine one\nLine two\n\n[look away]\nLast words.';

    test('capitalised bracket lines are sections, lower-case ones are directions', () {
      expect(sectionTag.hasMatch('[Verse 1]'), isTrue);
      expect(sectionTag.hasMatch('[Сцена]'), isTrue);
      expect(sectionTag.hasMatch('[pause]'), isFalse);
      expect(sectionTag.hasMatch('[look away]'), isFalse);
      expect(scriptLines(body), ['Good evening.', '[pause]', 'I am here.', 'Line one', 'Line two', '[look away]', 'Last words.']);
    });

    test('parse and join keep every line and the order', () {
      final s = parseSections(body);
      expect(s.map((x) => x.title), ['Intro', 'Verse 1']);
      expect(scriptLines(joinSections(s)), scriptLines(body));
    });

    test('reorder and duplicate sections', () {
      final s = parseSections(body);
      final moved = [s[1], s[0], s[1].copy()..title = 'Verse 1 (copy)'];
      final out = joinSections(moved);
      expect(parseSections(out).map((x) => x.title), ['Verse 1', 'Intro', 'Verse 1 (copy)']);
      expect(scriptLines(out).first, 'Line one');
      expect(scriptLines(out).length, scriptLines(body).length + 4);
    });

    test('text before the first header is its own untitled section', () {
      final s = parseSections('Hello\nthere\n\n[Chorus]\nla');
      expect(s.length, 2);
      expect(s.first.title, '');
      expect(s.first.text, 'Hello\nthere');
    });

    test('section names are cleaned and capitalised', () {
      expect(sectionName(' verse [2]\n'), 'Verse 2');
      expect(sectionTag.hasMatch('[${sectionName('scene three')}]'), isTrue);
    });
  });

  test('teleprompter rows keep headers, paragraph breaks and line indexes', () {
    final rows = prompterLines('[Intro]\nA\nB\n\nC\n[Verse]\nD');
    expect(rows.map((r) => r.header ? '#${r.text}' : r.text), ['#Intro', 'A', 'B', 'C', '#Verse', 'D']);
    expect(rows.where((r) => !r.header).map((r) => r.index), [0, 1, 2, 3]);
    expect(rows[3].paraStart, isTrue); // C follows a blank line
    expect(rows[2].paraStart, isFalse);
  });

  test('reading time and word count', () {
    expect(wordCount('[Intro]\none two three\n[pause] four'), 5);
    expect(readingSeconds('word ' * 140), closeTo(60, 0.01));
  });

  group('undo history', () {
    TextEditingValue v(String t) => TextEditingValue(text: t, selection: TextSelection.collapsed(offset: t.length));

    test('tool actions undo and redo one step at a time', () {
      final h = TextHistory(v('a'));
      h.changed(v('a\nb'), step: true);
      h.changed(v('b\na'), step: true);
      expect(h.undo(v('b\na'))!.text, 'a\nb');
      expect(h.undo(v('a\nb'))!.text, 'a');
      expect(h.canUndo, isFalse);
      expect(h.redo(v('a'))!.text, 'a\nb');
      expect(h.redo(v('a\nb'))!.text, 'b\na');
      expect(h.canRedo, isFalse);
    });

    test('quick typing is one step; a new change clears redo', () {
      final h = TextHistory(v(''));
      for (final t in ['h', 'he', 'hel', 'hell', 'hello']) {
        h.changed(v(t));
      }
      expect(h.undo(v('hello'))!.text, '');
      h.changed(v('x'), step: true);
      expect(h.canRedo, isFalse);
    });
  });

  group('projects from older versions', () {
    test('karaoke songs become spoken-word lyrics, keeping text and music', () {
      final it = Item.migrate({
        'id': 's1',
        'kind': 'song',
        'title': 'My song',
        'body': '[Chorus]\nla la',
        'music': {'type': 'file', 'path': '/x.m4a', 'name': 'x'},
        'times': [1.0],
        'wt': [
          [0.1]
        ],
        'offset': 0.2,
        'sttWords': [],
        'audioGuide': 'a',
      });
      expect(it.kind, Kind.lyrics);
      expect(it.m['kind'], 'lyrics');
      expect(it.body, '[Chorus]\nla la');
      expect(it.music?['path'], '/x.m4a');
      for (final k in ['times', 'wt', 'offset', 'sttWords', 'audioGuide']) {
        expect(it.m.containsKey(k), isFalse, reason: k);
      }
    });

    test('poems and scripts are untouched', () {
      final m = {'id': 'p', 'kind': 'poem', 'title': 'T', 'body': 'b', 'style': {'size': 40}};
      final it = Item.migrate(Map<String, dynamic>.from(m));
      expect(it.kind, Kind.poem);
      expect(it.style.size, 40);
    });

    test('defaults for projects without settings', () {
      final it = Item.create(Kind.script, 'n');
      expect(it.musicSettings.loop, isTrue);
      expect(it.musicSettings.duck, isTrue);
      expect(it.prompter.autoScroll, isTrue);
      expect(it.prompter.showWhileRecording, isTrue);
      expect(it.style.size, 34);
    });

    test('music removed from a project stays removed', () {
      final it = Item.create(Kind.poem, 'q')..music = {'type': 'none'};
      expect(musicFor(it).none, isTrue);
    });
  });
}
