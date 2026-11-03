// How the script looks on the teleprompter: font, size, weight, colours, spacing, background,
// shadow/outline, and where the reading area sits on the screen. Saved with the project.
import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../widgets/prompter.dart';
import '../widgets/ui.dart';

const _textColors = [0xFFFFFFFF, 0xFFFDE68A, 0xFFE4E4E7, 0xFFA5F3FC, 0xFFF9A8D4, 0xFFBBF7D0, 0xFF111111];
const _bgColors = [0xFF000000, 0xFF111827, 0xFF1E1B4B, 0xFF3F1D0B, 0xFFFFFFFF, 0xFF064E3B];
const _hiColors = [0xFFEC4899, 0xFFFCD34D, 0xFF34D399, 0xFF60A5FA, 0xFFF43F5E, 0xFFFFFFFF];

Future<void> editAppearance(BuildContext context, Item it, {VoidCallback? changed}) => sheet(
      context,
      (c) => _AppearanceSheet(item: it, changed: changed),
    ).then((_) => Store.i.save());

class _AppearanceSheet extends StatefulWidget {
  final Item item;
  final VoidCallback? changed;
  const _AppearanceSheet({required this.item, this.changed});
  @override
  State<_AppearanceSheet> createState() => _AppearanceSheetState();
}

class _AppearanceSheetState extends State<_AppearanceSheet> {
  Item get it => widget.item;

  void style(Map<String, dynamic> c) {
    setState(() => it.style = it.style.copyWith(c));
    widget.changed?.call();
    Store.i.save();
  }

  void prompter(Map<String, dynamic> c) {
    setState(() => it.prompter = it.prompter.copyWith(c));
    widget.changed?.call();
    Store.i.save();
  }

  String get sample {
    final b = it.body.trim();
    if (b.isEmpty) return 'This is how your words will look.\n\nThe arrows mark the reading line.';
    return b.split('\n').take(10).join('\n');
  }

  @override
  Widget build(BuildContext context) {
    final s = it.style, p = it.prompter;
    final h = MediaQuery.of(context).size.height;
    return SizedBox(
      height: h * 0.88,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 8, 8),
          child: Row(children: [
            const Expanded(child: Text('Script appearance', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700))),
            TextButton(
              onPressed: () {
                setState(() {
                  it.style = ScriptStyle({});
                  it.prompter = PrompterSettings({'speed': p.speed, 'autoScroll': p.autoScroll});
                });
                widget.changed?.call();
                Store.i.save();
              },
              child: const Text('Reset', style: TextStyle(color: C.muted)),
            ),
          ]),
        ),
        // live preview over a camera-like backdrop
        Container(
          height: h * 0.26,
          margin: const EdgeInsets.symmetric(horizontal: 16),
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), gradient: const LinearGradient(colors: [Color(0xFF3B3B46), Color(0xFF15151B)], begin: Alignment.topLeft, end: Alignment.bottomRight)),
          child: Opacity(
            opacity: p.opacity,
            child: PrompterView(body: sample, style: s, readingLine: p.readingLine, mirror: p.mirror, physics: const NeverScrollableScrollPhysics()),
          ),
        ),
        Expanded(
          child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
            _h('Font'),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final f in ScriptStyle.fonts.entries)
                ChoiceChip(
                  label: Text(f.value, style: TextStyle(fontFamily: f.key)),
                  selected: s.font == f.key,
                  onSelected: (_) => style({'font': f.key}),
                ),
            ]),
            _row('Size', '${s.size.round()}'),
            Slider(value: s.size.clamp(16.0, 80.0), min: 16, max: 80, divisions: 64, onChanged: (v) => style({'size': v.roundToDouble()})),
            _h('Weight'),
            Wrap(spacing: 8, children: [
              for (final w in const [(400, 'Regular'), (500, 'Medium'), (700, 'Bold'), (900, 'Black')])
                ChoiceChip(label: Text(w.$2), selected: s.weight == w.$1, onSelected: (_) => style({'weight': w.$1})),
            ]),
            _h('Alignment'),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'left', icon: Icon(Icons.format_align_left)),
                ButtonSegment(value: 'center', icon: Icon(Icons.format_align_center)),
                ButtonSegment(value: 'right', icon: Icon(Icons.format_align_right)),
              ],
              selected: {s.align},
              onSelectionChanged: (v) => style({'align': v.first}),
            ),
            _row('Line spacing', s.lineHeight.toStringAsFixed(2)),
            Slider(value: s.lineHeight.clamp(1.0, 2.4), min: 1.0, max: 2.4, divisions: 28, onChanged: (v) => style({'lineHeight': double.parse(v.toStringAsFixed(2))})),
            _row('Paragraph spacing', '${s.paragraphSpacing.round()}'),
            Slider(value: s.paragraphSpacing.clamp(0.0, 80.0), min: 0, max: 80, divisions: 40, onChanged: (v) => style({'paragraphSpacing': v.roundToDouble()})),
            _h('Text colour'),
            _swatches(_textColors, s.color.toARGB32(), (c) => style({'color': c})),
            _h('Highlight colour'),
            const Text('Section names and the reading-line markers.', style: TextStyle(color: C.muted, fontSize: 12.5)),
            const SizedBox(height: 6),
            _swatches(_hiColors, s.highlight.toARGB32(), (c) => style({'highlight': c})),
            _h('Background'),
            _swatches(_bgColors, s.background.toARGB32(), (c) => style({'background': c})),
            _row('Background opacity', '${(s.backgroundOpacity * 100).round()}%'),
            Slider(value: s.backgroundOpacity.clamp(0.0, 1.0), onChanged: (v) => style({'backgroundOpacity': double.parse(v.toStringAsFixed(2))})),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Shadow'), value: s.shadow, onChanged: (v) => style({'shadow': v})),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Outline'), value: s.outline, onChanged: (v) => style({'outline': v})),
            const Divider(height: 28),
            const Text('On the recording screen', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            _h('Position'),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'top', label: Text('Top')),
                ButtonSegment(value: 'center', label: Text('Middle')),
                ButtonSegment(value: 'bottom', label: Text('Bottom')),
              ],
              selected: {p.position},
              onSelectionChanged: (v) => prompter({'position': v.first}),
            ),
            const Padding(padding: EdgeInsets.only(top: 6), child: Text('Top keeps your eyes close to the front camera.', style: TextStyle(color: C.muted, fontSize: 12.5))),
            _row('Reading area', '${(p.areaHeight * 100).round()}% of the screen'),
            Slider(value: p.areaHeight.clamp(0.2, 1.0), min: 0.2, max: 1.0, divisions: 16, onChanged: (v) => prompter({'areaHeight': double.parse(v.toStringAsFixed(2))})),
            _row('Reading line', '${(p.readingLine * 100).round()}% down'),
            Slider(value: p.readingLine.clamp(0.1, 0.8), min: 0.1, max: 0.8, divisions: 14, onChanged: (v) => prompter({'readingLine': double.parse(v.toStringAsFixed(2))})),
            _row('Script transparency', '${((1 - p.opacity) * 100).round()}%'),
            Slider(value: (1 - p.opacity).clamp(0.0, 0.8), min: 0, max: 0.8, divisions: 16, onChanged: (v) => prompter({'opacity': double.parse((1 - v).toStringAsFixed(2))})),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mirror'),
              subtitle: const Text('For a teleprompter glass that reflects the screen', style: TextStyle(color: C.muted)),
              value: p.mirror,
              onChanged: (v) => prompter({'mirror': v}),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _h(String t) => Padding(padding: const EdgeInsets.only(top: 16, bottom: 8), child: Text(t, style: const TextStyle(fontWeight: FontWeight.w600)));

  Widget _row(String a, String b) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Row(children: [Text(a, style: const TextStyle(fontWeight: FontWeight.w600)), const Spacer(), Text(b, style: const TextStyle(color: C.muted))]),
      );

  Widget _swatches(List<int> colors, int current, ValueChanged<int> on) => Wrap(spacing: 10, runSpacing: 10, children: [
        for (final c in colors)
          GestureDetector(
            onTap: () => on(c),
            child: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: Color(c),
                shape: BoxShape.circle,
                border: Border.all(color: current == c ? C.brand : C.s4, width: current == c ? 3 : 1),
              ),
            ),
          ),
      ]);
}
