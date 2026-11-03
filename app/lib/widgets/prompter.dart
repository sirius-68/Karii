// The teleprompter: a script shown in the performer's chosen style, with a reading line.
// It is drawn over the camera preview only; the camera records the picture without it.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/text.dart';
import 'ui.dart';

/// One row of the teleprompter: a section header or a line of text.
class PLine {
  final String text;
  final int index; // index among the text lines (scriptLines), -1 for headers
  final bool header, paraStart;
  const PLine(this.text, this.index, {this.header = false, this.paraStart = false});
}

/// Rows of a script, keeping its sections and paragraph breaks.
List<PLine> prompterLines(String body) {
  final out = <PLine>[];
  var idx = 0;
  var para = false;
  for (final raw in body.split(RegExp(r'\r?\n'))) {
    final l = raw.trim();
    if (l.isEmpty) {
      para = out.isNotEmpty;
      continue;
    }
    final m = sectionTag.firstMatch(l);
    if (m != null) {
      out.add(PLine(m.group(1)!.trim(), -1, header: true, paraStart: out.isNotEmpty));
    } else {
      out.add(PLine(l, idx++, paraStart: para));
    }
    para = false;
  }
  return out;
}

FontWeight weightOf(int w) => FontWeight.values[((w / 100).round() - 1).clamp(0, 8)];

TextAlign alignOf(String a) => a == 'left' ? TextAlign.left : a == 'right' ? TextAlign.right : TextAlign.center;

/// Text style of the script (without outline, which is painted separately).
TextStyle scriptTextStyle(ScriptStyle s, {double scale = 1}) => TextStyle(
      fontFamily: s.font,
      fontSize: s.size * scale,
      fontWeight: weightOf(s.weight),
      height: s.lineHeight,
      color: s.color,
      shadows: s.shadow ? const [Shadow(blurRadius: 10, color: Color(0xDD000000), offset: Offset(0, 1))] : null,
    );

/// [stage directions] are shown smaller and dimmer.
List<InlineSpan> directionSpans(String p, double size, {Paint? foreground}) {
  final out = <InlineSpan>[];
  final re = RegExp(r'\[[^\]]*\]');
  var last = 0;
  for (final m in re.allMatches(p)) {
    if (m.start > last) out.add(TextSpan(text: p.substring(last, m.start)));
    out.add(TextSpan(
      text: m.group(0),
      style: TextStyle(fontSize: size * 0.55, color: foreground == null ? C.amber : null, foreground: foreground, fontStyle: FontStyle.italic, fontWeight: FontWeight.w500),
    ));
    last = m.end;
  }
  if (last < p.length) out.add(TextSpan(text: p.substring(last)));
  return out;
}

/// One styled line: fill, plus an outline under it when the style asks for one.
class StyledLine extends StatelessWidget {
  final String text;
  final ScriptStyle style;
  final double scale;
  const StyledLine(this.text, this.style, {super.key, this.scale = 1});
  @override
  Widget build(BuildContext context) {
    final base = scriptTextStyle(style, scale: scale);
    final align = alignOf(style.align);
    final fill = Text.rich(TextSpan(children: directionSpans(text, base.fontSize!)), style: base, textAlign: align);
    if (!style.outline) return fill;
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = (base.fontSize! / 9).clamp(1.5, 6.0)
      ..strokeJoin = StrokeJoin.round
      ..color = Colors.black;
    return Stack(children: [
      Text.rich(TextSpan(children: directionSpans(text, base.fontSize!, foreground: stroke)), style: base.copyWith(foreground: stroke, color: null, shadows: const []), textAlign: align),
      fill,
    ]);
  }
}

/// The scrolling script. [keys] get one key per text line so the performer can jump to a line.
class PrompterView extends StatelessWidget {
  final String body;
  final ScriptStyle style;
  final double readingLine; // where the eyes rest, fraction of the height from the top
  final ScrollController? controller;
  final List<GlobalKey>? keys;
  final bool mirror, guide;
  final ScrollPhysics? physics;
  const PrompterView({
    super.key,
    required this.body,
    required this.style,
    this.readingLine = 0.33,
    this.controller,
    this.keys,
    this.mirror = false,
    this.guide = true,
    this.physics,
  });

  @override
  Widget build(BuildContext context) {
    final rows = prompterLines(body);
    return LayoutBuilder(builder: (context, box) {
      final h = box.maxHeight.isFinite ? box.maxHeight : 400.0;
      final guideY = h * readingLine;
      final list = ShaderMask(
        shaderCallback: (r) => const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.transparent, Colors.white, Colors.white, Colors.transparent],
          stops: [0, 0.08, 0.9, 1],
        ).createShader(r),
        blendMode: BlendMode.dstIn,
        child: ListView(
          controller: controller,
          physics: physics,
          // the first line starts on the reading line; the last can scroll up past it
          padding: EdgeInsets.fromLTRB(20, math.max(0.0, guideY - style.size * style.lineHeight * 0.5), 20, h - guideY + 24),
          children: [
            for (final r in rows)
              Padding(
                key: r.index >= 0 && keys != null && r.index < keys!.length ? keys![r.index] : null,
                padding: EdgeInsets.only(top: r.paraStart ? style.paragraphSpacing : 0, bottom: 2),
                child: r.header
                    ? Text(r.text.toUpperCase(),
                        textAlign: alignOf(style.align),
                        style: TextStyle(color: style.highlight, fontSize: (style.size * 0.42).clamp(11.0, 22.0), fontWeight: FontWeight.w800, letterSpacing: 1.2))
                    : StyledLine(r.text, style),
              ),
          ],
        ),
      );
      Widget view = Stack(children: [
        Positioned.fill(child: list),
        if (guide) ...[
          Positioned(left: 2, top: guideY - 9, child: Icon(Icons.play_arrow_rounded, size: 18, color: style.highlight)),
          Positioned(right: 2, top: guideY - 9, child: Transform.flip(flipX: true, child: Icon(Icons.play_arrow_rounded, size: 18, color: style.highlight))),
        ],
      ]);
      if (mirror) view = Transform.flip(flipX: true, child: view);
      return Container(color: style.background.withValues(alpha: style.backgroundOpacity), child: view);
    });
  }
}

/// A key per text line of [body].
List<GlobalKey> lineKeys(String body) => List.generate(scriptLines(body).length, (_) => GlobalKey());
