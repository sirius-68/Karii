// Script editor: write or paste poems, monologues, movie lines, speeches and lyrics. Autosaves,
// with undo/redo, find and replace, line tools, sections, text-file import, and the project's
// music and teleprompter appearance one tap away.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/jobs.dart';
import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../core/text.dart';
import '../engine/engine.dart';
import '../widgets/ui.dart';
import 'appearance.dart';
import 'music_screen.dart';
import 'nav.dart';
import 'sections.dart';

/// Undo/redo for the script text. Typing is grouped into steps (a pause of 0.8 s or a new line
/// starts a new step); tool actions (move line, replace all, import...) are one step each.
class TextHistory {
  final List<TextEditingValue> _undo = [], _redo = [];
  TextEditingValue _last;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
  TextHistory(this._last);

  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;

  /// Called after every change of the text.
  void changed(TextEditingValue v, {bool step = false}) {
    if (v.text == _last.text) {
      _last = v;
      return;
    }
    final now = DateTime.now();
    final newLine = v.text.length > _last.text.length && v.text.length - _last.text.length == 1 && v.selection.baseOffset > 0 && v.text[v.selection.baseOffset - 1] == '\n';
    if (step || newLine || _undo.isEmpty || now.difference(_lastAt) > const Duration(milliseconds: 800)) {
      _undo.add(_last);
      if (_undo.length > 300) _undo.removeAt(0);
    }
    _redo.clear();
    _last = v;
    _lastAt = now;
  }

  TextEditingValue? undo(TextEditingValue cur) {
    if (_undo.isEmpty) return null;
    _redo.add(cur);
    _last = _undo.removeLast();
    _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
    return _last;
  }

  TextEditingValue? redo(TextEditingValue cur) {
    if (_redo.isEmpty) return null;
    _undo.add(cur);
    _last = _redo.removeLast();
    _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
    return _last;
  }
}

class EditorScreen extends StatefulWidget {
  final Item item;
  final bool fresh;
  const EditorScreen({super.key, required this.item, this.fresh = false});
  @override
  State<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends State<EditorScreen> {
  late final TextEditingController title = TextEditingController(text: widget.item.rawTitle);
  late final TextEditingController body = TextEditingController(text: widget.item.body);
  final FocusNode bodyFocus = FocusNode();
  late final TextHistory history = TextHistory(body.value);
  final TextEditingController find = TextEditingController(), replace = TextEditingController();
  bool searching = false;
  int hit = -1;
  bool _applying = false;
  bool saved = true;
  Timer? _savedT;
  Item get it => widget.item;
  StreamSubscription<Job>? _jobDone;

  @override
  void initState() {
    super.initState();
    body.addListener(_onBody);
    // a background Clip to lines job for this project finished: show its text
    _jobDone = Jobs.i.finished.listen((j) {
      if (j.itemId != it.id || !mounted) return;
      title.text = it.rawTitle;
      _set(it.body, step: true);
    });
  }

  void _onBody() {
    if (_applying) return;
    final changed = body.text != it.body;
    history.changed(body.value);
    if (changed) {
      save();
      setState(() {});
    }
  }

  void save() {
    it.title = title.text.replaceAll('\n', ' ');
    it.body = body.text;
    it.touch();
    Store.i.save();
    saved = false;
    _savedT?.cancel();
    _savedT = Timer(const Duration(milliseconds: 700), () {
      if (mounted) setState(() => saved = true);
    });
  }

  /// Replaces the text as one undo step.
  void _set(String text, {TextSelection? sel, bool step = true}) {
    final v = TextEditingValue(text: text, selection: sel ?? TextSelection.collapsed(offset: math.min(body.selection.baseOffset.clamp(0, text.length), text.length)));
    _applying = true;
    body.value = v;
    _applying = false;
    history.changed(v, step: step);
    save();
    setState(() {});
  }

  @override
  void dispose() {
    _jobDone?.cancel();
    _savedT?.cancel();
    save();
    if (it.rawTitle.trim().isEmpty && it.body.trim().isEmpty && it.music == null && Jobs.i.forItem(it.id) == null) Store.i.deleteItem(it);
    title.dispose();
    body.dispose();
    bodyFocus.dispose();
    find.dispose();
    replace.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------------ undo / redo
  void undo() {
    final v = history.undo(body.value);
    if (v == null) return;
    _applying = true;
    body.value = v;
    _applying = false;
    save();
    setState(() {});
  }

  void redo() {
    final v = history.redo(body.value);
    if (v == null) return;
    _applying = true;
    body.value = v;
    _applying = false;
    save();
    setState(() {});
  }

  // ------------------------------------------------------------------ line tools
  int get _caret {
    final o = body.selection.baseOffset;
    return o < 0 ? body.text.length : o.clamp(0, body.text.length);
  }

  /// [start, end) of the line the caret is on (end excludes the newline).
  (int, int) _lineAt(int p) {
    final t = body.text;
    final s = p == 0 ? 0 : t.lastIndexOf('\n', p - 1) + 1;
    var e = t.indexOf('\n', p);
    if (e < 0) e = t.length;
    return (s, e);
  }

  void moveLine(int dir) {
    final t = body.text;
    final p = _caret;
    final (s, e) = _lineAt(p);
    final col = p - s;
    final line = t.substring(s, e);
    if (dir < 0) {
      if (s == 0) return;
      final (ps, pe) = _lineAt(s - 1);
      final prev = t.substring(ps, pe);
      final nt = t.replaceRange(ps, e, '$line\n$prev');
      _set(nt, sel: TextSelection.collapsed(offset: ps + math.min(col, line.length)));
    } else {
      if (e >= t.length) return;
      final (ns, ne) = _lineAt(e + 1);
      final next = t.substring(ns, ne);
      final nt = t.replaceRange(s, ne, '$next\n$line');
      final ls = s + next.length + 1;
      _set(nt, sel: TextSelection.collapsed(offset: ls + math.min(col, line.length)));
    }
  }

  void duplicateLine() {
    final t = body.text;
    final (s, e) = _lineAt(_caret);
    final line = t.substring(s, e);
    _set(t.replaceRange(e, e, '\n$line'), sel: TextSelection.collapsed(offset: e + 1 + line.length));
  }

  void deleteLine() {
    final t = body.text;
    final (s, e) = _lineAt(_caret);
    final nt = e < t.length ? t.replaceRange(s, e + 1, '') : (s > 0 ? t.replaceRange(s - 1, e, '') : t.replaceRange(s, e, ''));
    _set(nt, sel: TextSelection.collapsed(offset: math.min(s, nt.length)));
  }

  void insertBlock(String text) {
    final t = body.text;
    final (s, _) = _lineAt(_caret);
    final before = s > 0 && !t.substring(0, s).endsWith('\n\n') ? '\n' : '';
    final ins = '$before$text\n';
    _set(t.replaceRange(s, s, ins), sel: TextSelection.collapsed(offset: s + ins.length));
    bodyFocus.requestFocus();
  }

  void addSection() async {
    final name = await _sectionName();
    if (name == null || name.isEmpty) return;
    insertBlock('[${sectionName(name)}]');
  }

  Future<String?> _sectionName() async {
    String? picked;
    await actionSheet(context, 'Add a section', [
      for (final n in const ['Intro', 'Verse', 'Chorus', 'Scene', 'Stanza', 'Bridge', 'Outro'])
        SheetAction(Icons.label_outline, n, () => picked = n),
      SheetAction(Icons.edit_outlined, 'Custom name…', () => picked = ''),
    ]);
    if (picked == '' && mounted) picked = await prompt(context, 'Section name', hint: 'e.g. Act two');
    return picked;
  }

  // ------------------------------------------------------------------ find and replace
  List<int> get hits {
    final q = find.text;
    if (q.isEmpty) return const [];
    final t = body.text.toLowerCase(), ql = q.toLowerCase();
    final out = <int>[];
    var i = t.indexOf(ql);
    while (i >= 0) {
      out.add(i);
      i = t.indexOf(ql, i + math.max(1, ql.length));
    }
    return out;
  }

  void goHit(int d) {
    final h = hits;
    if (h.isEmpty) return;
    hit = ((hit < 0 ? (d > 0 ? -1 : 0) : hit) + d) % h.length;
    if (hit < 0) hit += h.length;
    bodyFocus.requestFocus();
    body.selection = TextSelection(baseOffset: h[hit], extentOffset: h[hit] + find.text.length);
    setState(() {});
  }

  void replaceOne() {
    final h = hits;
    if (h.isEmpty) return;
    final i = hit >= 0 && hit < h.length ? h[hit] : h.first;
    final nt = body.text.replaceRange(i, i + find.text.length, replace.text);
    _set(nt, sel: TextSelection.collapsed(offset: i + replace.text.length));
    hit = hit - 1;
    goHit(1);
  }

  void replaceAll() {
    final h = hits;
    if (h.isEmpty) return;
    var t = body.text;
    for (final i in h.reversed) {
      t = t.replaceRange(i, i + find.text.length, replace.text);
    }
    _set(t);
    toast(context, 'Replaced ${h.length}');
    hit = -1;
  }

  // ------------------------------------------------------------------ import
  Future<void> importText() async {
    final r = await Engine.i.pickFile('text/*');
    if (r == null || !mounted) return;
    String text;
    final f = File('${r['path']}');
    try {
      final bytes = await f.readAsBytes();
      text = utf8.decode(bytes, allowMalformed: true).replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceFirst('﻿', '');
    } catch (e) {
      if (mounted) toast(context, 'That file couldn’t be read.');
      return;
    } finally {
      try {
        f.deleteSync();
      } catch (_) {}
    }
    if (!mounted) return;
    if (text.trim().isEmpty) {
      toast(context, 'That file has no text.');
      return;
    }
    if (body.text.trim().isEmpty) {
      _set(text.trim());
      if (title.text.trim().isEmpty) {
        title.text = '${r['name'] ?? ''}'.replaceAll(RegExp(r'\.[A-Za-z0-9]+$'), '');
        save();
      }
      return;
    }
    await actionSheet(context, 'Import “${r['name']}”', [
      SheetAction(Icons.playlist_add, 'Add to the end', () => _set('${body.text.trimRight()}\n\n${text.trim()}')),
      SheetAction(Icons.swap_horiz, 'Replace the text', () => _set(text.trim()), sub: 'You can undo this'),
    ]);
  }

  // ------------------------------------------------------------------ project
  Future<void> openSections() async {
    save();
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SectionsScreen(item: it)));
    if (mounted && it.body != body.text) _set(it.body);
  }

  Future<void> openMusic() async {
    save();
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => MusicScreen(item: it)));
    if (mounted) setState(() {});
  }

  void changeKind() {
    actionSheet(context, 'This is a…', [
      for (final k in const [Kind.poem, Kind.line, Kind.script, Kind.lyrics])
        SheetAction(it.kind == k ? Icons.check : Icons.circle_outlined, kindLabel(k), () {
          it.m['kind'] = k.name;
          save();
          setState(() {});
        }),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final src = musicFor(it);
    final words = wordCount(body.text), lines = scriptLines(body.text).length;
    final secs = parseSections(body.text).where((s) => s.title.isNotEmpty).length;
    final h = hits;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.fresh ? 'New ${kindLabel(it.kind).toLowerCase()}' : 'Edit'),
        actions: [
          IconButton(onPressed: history.canUndo ? undo : null, icon: const Icon(Icons.undo), tooltip: 'Undo'),
          IconButton(onPressed: history.canRedo ? redo : null, icon: const Icon(Icons.redo), tooltip: 'Redo'),
          IconButton(
            onPressed: () => setState(() {
              searching = !searching;
              hit = -1;
            }),
            icon: Icon(searching ? Icons.search_off : Icons.search),
            tooltip: 'Find and replace',
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              switch (v) {
                case 'import':
                  importText();
                case 'copy':
                  Clipboard.setData(ClipboardData(text: body.text));
                  toast(context, 'Copied the whole script');
                case 'kind':
                  changeKind();
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'import', child: Text('Import a text file')),
              PopupMenuItem(value: 'copy', child: Text('Copy all')),
              PopupMenuItem(value: 'kind', child: Text('Change type')),
            ],
          ),
        ],
      ),
      body: Column(children: [
        if (searching) _searchBar(h),
        Expanded(
          child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
            TextField(
              controller: title,
              onChanged: (_) => save(),
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
              decoration: const InputDecoration(hintText: 'Title', border: InputBorder.none),
            ),
            Text(
              [
                kindLabel(it.kind),
                '$words word${words == 1 ? '' : 's'}',
                '$lines line${lines == 1 ? '' : 's'}',
                if (secs > 0) '$secs section${secs == 1 ? '' : 's'}',
                if (words > 0) 'about ${fmtTime(math.max(1.0, readingSeconds(body.text)))} to perform',
                saved ? 'saved' : 'saving…',
              ].join(' · '),
              style: const TextStyle(color: C.muted, fontSize: 13),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 42,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                Pill(src.none ? 'Add music' : src.label.isEmpty ? 'Music' : src.label, icon: Icons.music_note_outlined, onTap: openMusic, selected: !src.none),
                const SizedBox(width: 8),
                Pill('Appearance', icon: Icons.text_fields, onTap: () => editAppearance(context, it)),
                const SizedBox(width: 8),
                Pill('Sections', icon: Icons.view_agenda_outlined, onTap: openSections),
              ]),
            ),
            _jobStatus(),
            const SizedBox(height: 8),
            TextField(
              controller: body,
              focusNode: bodyFocus,
              maxLines: null,
              minLines: 14,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              style: TextStyle(fontSize: 17, height: 1.5, fontFamily: it.kind == Kind.poem ? 'serif' : null),
              decoration: InputDecoration(
                hintText: switch (it.kind) {
                  Kind.poem => 'Write or paste your poem.\nLeave a blank line between stanzas.',
                  Kind.line => 'Write or paste the lines.\n[Directions] in brackets show smaller on the teleprompter.',
                  Kind.lyrics => 'Write or paste your lyrics, one line per row.\n[Verse], [Chorus] on their own line start a section.',
                  _ => 'Write or paste your script.\n[Directions] in brackets show smaller on the teleprompter.',
                },
                border: InputBorder.none,
              ),
            ),
          ]),
        ),
        _lineTools(),
      ]),
      floatingActionButton: MediaQuery.of(context).viewInsets.bottom > 0
          ? null
          : FloatingActionButton.extended(
              onPressed: () {
                save();
                perform(context, it);
              },
              backgroundColor: Colors.white,
              foregroundColor: Colors.black,
              icon: const Icon(Icons.videocam_outlined),
              label: const Text('Perform'),
            ),
    );
  }

  Widget _searchBar(List<int> h) => Container(
        color: C.s1,
        padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
        child: Column(children: [
          Row(children: [
            Expanded(
              child: TextField(
                controller: find,
                autofocus: true,
                onChanged: (_) => setState(() => hit = -1),
                onSubmitted: (_) => goHit(1),
                decoration: InputDecoration(hintText: 'Find', isDense: true, suffixText: find.text.isEmpty ? null : h.isEmpty ? 'none' : '${hit >= 0 ? hit + 1 : 0}/${h.length}'),
              ),
            ),
            IconButton(onPressed: h.isEmpty ? null : () => goHit(-1), icon: const Icon(Icons.keyboard_arrow_up), tooltip: 'Previous'),
            IconButton(onPressed: h.isEmpty ? null : () => goHit(1), icon: const Icon(Icons.keyboard_arrow_down), tooltip: 'Next'),
          ]),
          Row(children: [
            Expanded(child: TextField(controller: replace, decoration: const InputDecoration(hintText: 'Replace with', isDense: true))),
            TextButton(onPressed: h.isEmpty ? null : replaceOne, child: const Text('Replace')),
            TextButton(onPressed: h.isEmpty ? null : replaceAll, child: const Text('All')),
          ]),
        ]),
      );

  Widget _lineTools() => Container(
        decoration: const BoxDecoration(color: C.s1, border: Border(top: BorderSide(color: C.line))),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 48,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
              _tool(Icons.add_box_outlined, 'Section', addSection),
              _tool(Icons.keyboard_arrow_up, 'Line up', () => moveLine(-1)),
              _tool(Icons.keyboard_arrow_down, 'Line down', () => moveLine(1)),
              _tool(Icons.copy_all_outlined, 'Duplicate line', duplicateLine),
              _tool(Icons.backspace_outlined, 'Delete line', deleteLine),
              _tool(Icons.space_bar, 'Blank line', () {
                final t = body.text;
                final (_, e) = _lineAt(_caret);
                _set(t.replaceRange(e, e, '\n'), sel: TextSelection.collapsed(offset: e + 1));
              }),
              _tool(Icons.theater_comedy_outlined, 'Direction', () {
                final t = body.text, p = _caret;
                _set(t.replaceRange(p, p, '[pause]'), sel: TextSelection(baseOffset: p + 1, extentOffset: p + 6));
                bodyFocus.requestFocus();
              }),
            ]),
          ),
        ),
      );

  Widget _tool(IconData icon, String label, VoidCallback onTap) => TextButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18, color: C.ink2),
        label: Text(label, style: const TextStyle(color: C.ink2, fontSize: 13)),
      );

  Widget _jobStatus() => AnimatedBuilder(
        animation: Jobs.i,
        builder: (_, __) {
          final j = Jobs.i.forItem(it.id);
          if (j == null || !(j.active || j.state == JobState.error)) return const SizedBox.shrink();
          return Container(
            margin: const EdgeInsets.only(top: 12),
            padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
            decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(14)),
            child: Row(children: [
              if (j.active)
                SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, value: j.progress > 1 ? j.progress / 100 : null))
              else
                const Icon(Icons.error_outline, size: 18, color: C.hot),
              const SizedBox(width: 10),
              Expanded(child: Text(j.label, style: const TextStyle(color: C.muted, fontSize: 13))),
              if (j.active) TextButton(onPressed: () => Jobs.i.cancel(j), child: const Text('Cancel')),
              if (!j.active) TextButton(onPressed: () => Jobs.i.retry(j), child: const Text('Retry')),
            ]),
          );
        },
      );
}
