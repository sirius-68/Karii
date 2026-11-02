// Shared look: colours, procedural cover art, section headers, rows, cards, tags, sheets.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/model.dart';
import '../lyrics/timing.dart';

class C {
  static const bg = Color(0xFF0E0E10);
  static const s1 = Color(0xFF151518);
  static const s2 = Color(0xFF1C1C21);
  static const s3 = Color(0xFF26262C);
  static const s4 = Color(0xFF34343C);
  static const line = Color(0x1AFFFFFF);
  static const ink = Colors.white;
  static const ink2 = Color(0xFFE4E4E7);
  static const muted = Color(0xFFA1A1AA);
  static const faint = Color(0xFF71717A);
  static const brand = Color(0xFFEC4899);
  static const violet = Color(0xFF8B5CF6);
  static const green = Color(0xFF34D399);
  static const amber = Color(0xFFFCD34D);
  static const hot = Color(0xFFF43F5E);
}

ThemeData lecternTheme() {
  final base = ThemeData(brightness: Brightness.dark, useMaterial3: true, colorSchemeSeed: C.violet);
  return base.copyWith(
    scaffoldBackgroundColor: C.bg,
    canvasColor: C.bg,
    colorScheme: base.colorScheme.copyWith(surface: C.s1, primary: Colors.white, onPrimary: Colors.black, secondary: C.brand),
    appBarTheme: const AppBarTheme(backgroundColor: C.bg, elevation: 0, scrolledUnderElevation: 0, centerTitle: false),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: C.s1, showDragHandle: true),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: C.s3, contentTextStyle: TextStyle(color: Colors.white)),
    sliderTheme: base.sliderTheme.copyWith(activeTrackColor: Colors.white, thumbColor: Colors.white, inactiveTrackColor: C.s4, overlayColor: Colors.white24),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.all(Colors.white),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? C.green : C.s4),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.black, minimumSize: const Size(48, 48), shape: const StadiumBorder()),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: C.s4), minimumSize: const Size(48, 48), shape: const StadiumBorder()),
    ),
  );
}

void toast(BuildContext context, String msg) {
  final m = ScaffoldMessenger.maybeOf(context);
  if (m == null) return;
  m.hideCurrentSnackBar();
  m.showSnackBar(SnackBar(content: Text(msg), duration: const Duration(milliseconds: 2800)));
}

int _hash(String s) {
  var h = 2166136261;
  for (final c in s.codeUnits) {
    h ^= c;
    h = (h * 16777619) & 0xFFFFFFFF;
  }
  return h;
}

/// Procedural cover art: a gradient scene seeded by the item's id, with a glyph per kind.
class Cover extends StatelessWidget {
  final String seed;
  final Kind kind;
  final String title;
  final double radius;
  final Widget? child;
  const Cover({super.key, required this.seed, required this.kind, this.title = '', this.radius = 14, this.child});
  factory Cover.of(Item it, {double radius = 14, Widget? child}) => Cover(seed: it.id, kind: it.kind, title: it.title, radius: radius, child: child);

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: CustomPaint(painter: _CoverPainter(seed, kind, title), child: child ?? const SizedBox.expand()),
    );
  }
}

class _CoverPainter extends CustomPainter {
  final String seed, title;
  final Kind kind;
  _CoverPainter(this.seed, this.kind, this.title);

  static const palettes = [
    [Color(0xFF1E3A8A), Color(0xFF7C3AED), Color(0xFFF59E0B)],
    [Color(0xFF064E3B), Color(0xFF65A30D), Color(0xFFFDE68A)],
    [Color(0xFF831843), Color(0xFFDB2777), Color(0xFFFCD34D)],
    [Color(0xFF0F172A), Color(0xFF0E7490), Color(0xFFA5F3FC)],
    [Color(0xFF312E81), Color(0xFFC026D3), Color(0xFFFDA4AF)],
    [Color(0xFF3F1D0B), Color(0xFFC2410C), Color(0xFFFDBA74)],
  ];

  @override
  void paint(Canvas c, Size s) {
    final h = _hash(seed);
    final p = palettes[h % palettes.length];
    final r = math.Random(h);
    final rect = Offset.zero & s;
    c.drawRect(rect, Paint()..shader = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [p[0], p[1]]).createShader(rect));
    // soft glow
    final g = Offset(s.width * (0.2 + r.nextDouble() * 0.6), s.height * (0.2 + r.nextDouble() * 0.4));
    c.drawCircle(g, s.shortestSide * 0.6, Paint()..shader = RadialGradient(colors: [p[2].withValues(alpha: 0.45), p[2].withValues(alpha: 0)]).createShader(Rect.fromCircle(center: g, radius: s.shortestSide * 0.6)));
    final w = s.shortestSide;
    switch (kind) {
      case Kind.song:
        // a sun or moon over a horizon
        final sun = Offset(s.width * 0.5, s.height * 0.42);
        c.drawCircle(sun, w * 0.18, Paint()..color = p[2].withValues(alpha: 0.9));
        if (h % 2 == 0) c.drawCircle(sun + Offset(w * 0.07, -w * 0.04), w * 0.16, Paint()..color = p[0].withValues(alpha: 0.95));
        c.drawRect(Rect.fromLTWH(0, s.height * 0.72, s.width, s.height * 0.28), Paint()..color = Colors.black.withValues(alpha: 0.28));
        for (var k = 0; k < 4; k++) {
          final y = s.height * (0.76 + k * 0.05);
          c.drawLine(Offset(s.width * (0.35 - k * 0.03), y), Offset(s.width * (0.65 + k * 0.03), y), Paint()..color = Colors.white.withValues(alpha: 0.25)..strokeWidth = 1.2);
        }
        break;
      case Kind.poem:
        // stars and a large serif initial
        final sp = Paint()..color = Colors.white.withValues(alpha: 0.7);
        for (var k = 0; k < 14; k++) {
          c.drawCircle(Offset(r.nextDouble() * s.width, r.nextDouble() * s.height * 0.6), 0.6 + r.nextDouble() * 1.2, sp);
        }
        _glyph(c, s, title.isNotEmpty ? title.substring(0, 1).toUpperCase() : 'P', w * 0.5, FontStyle.italic, 'serif');
        break;
      case Kind.line:
        // a spotlight cone and film perforations
        final path = Path()
          ..moveTo(s.width * 0.45, 0)
          ..lineTo(s.width * 0.55, 0)
          ..lineTo(s.width * 0.8, s.height)
          ..lineTo(s.width * 0.2, s.height)
          ..close();
        c.drawPath(path, Paint()..color = Colors.white.withValues(alpha: 0.12));
        final pf = Paint()..color = Colors.black.withValues(alpha: 0.35);
        for (var x = 4.0; x < s.width; x += 12) {
          c.drawRect(Rect.fromLTWH(x, 4, 6, 4), pf);
          c.drawRect(Rect.fromLTWH(x, s.height - 8, 6, 4), pf);
        }
        break;
      case Kind.script:
        _glyph(c, s, '“', w * 0.6, FontStyle.normal, null);
        final lp = Paint()..color = Colors.white.withValues(alpha: 0.35)..strokeWidth = 2;
        for (var k = 0; k < 4; k++) {
          final y = s.height * (0.68 + k * 0.06);
          c.drawLine(Offset(s.width * 0.15, y), Offset(s.width * (0.85 - (k == 3 ? 0.3 : 0)), y), lp);
        }
        break;
      case Kind.inst:
        // a waveform
        final wp = Paint()..color = Colors.white.withValues(alpha: 0.55)..strokeWidth = 2..strokeCap = StrokeCap.round;
        final n = 18;
        for (var k = 0; k < n; k++) {
          final x = s.width * (0.12 + 0.76 * k / (n - 1));
          final a = (0.15 + 0.35 * (0.5 + 0.5 * math.sin(k * 0.9 + h))) * s.height;
          c.drawLine(Offset(x, s.height * 0.55 - a / 2), Offset(x, s.height * 0.55 + a / 2), wp);
        }
        break;
    }
  }

  void _glyph(Canvas c, Size s, String g, double size, FontStyle st, String? family) {
    final tp = TextPainter(
      text: TextSpan(text: g, style: TextStyle(fontSize: size, color: Colors.white.withValues(alpha: 0.85), fontStyle: st, fontFamily: family, fontWeight: FontWeight.w700)),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(c, Offset(s.width * 0.12, s.height * 0.08));
  }

  @override
  bool shouldRepaint(covariant _CoverPainter o) => o.seed != seed || o.kind != kind;
}

class BetaTag extends StatelessWidget {
  final double size;
  const BetaTag({super.key, this.size = 11});
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(left: 8),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: const Color(0x29FBBF24), borderRadius: BorderRadius.circular(99)),
        child: Text('BETA', style: TextStyle(color: C.amber, fontSize: size, fontWeight: FontWeight.w800, letterSpacing: 0.5)),
      );
}

class BetaNote extends StatelessWidget {
  const BetaNote({super.key});
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: EdgeInsets.only(top: 2, right: 8), child: Icon(Icons.science_outlined, size: 16, color: C.amber)),
          Expanded(
            child: Text.rich(TextSpan(children: [
              TextSpan(text: 'Karaoke is in beta. ', style: TextStyle(color: C.ink2, fontWeight: FontWeight.w600)),
              TextSpan(text: 'It’s still being tested, so you may run into errors while you use it.'),
            ]), style: TextStyle(color: C.muted, fontSize: 13.5, height: 1.4)),
          ),
        ]),
      );
}

class SectionHead extends StatelessWidget {
  final String title;
  final VoidCallback? onMore;
  final Widget? badge;
  const SectionHead(this.title, {super.key, this.onMore, this.badge});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 28, 12, 12),
        child: Row(children: [
          Flexible(child: Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: -0.4), overflow: TextOverflow.ellipsis)),
          if (badge != null) badge!,
          const Spacer(),
          if (onMore != null)
            TextButton(onPressed: onMore, child: const Row(children: [Text('More', style: TextStyle(color: C.muted)), Icon(Icons.chevron_right, color: C.muted, size: 20)])),
        ]),
      );
}

/// A list row for any item.
class ItemRow extends StatelessWidget {
  final Item it;
  final VoidCallback onTap;
  final VoidCallback? onMore;
  final String? subtitle;
  const ItemRow(this.it, {super.key, required this.onTap, this.onMore, this.subtitle});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          child: Row(children: [
            SizedBox(
              width: 56,
              height: 56,
              child: Cover.of(it,
                  radius: 12,
                  child: it.dur > 0
                      ? Align(
                          alignment: Alignment.bottomCenter,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 4),
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(6)),
                            child: Text(fmtTime(it.dur), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                          ))
                      : null),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(it.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(subtitle ?? it.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: C.muted, fontSize: 13.5)),
              ]),
            ),
            if (onMore != null) IconButton(onPressed: onMore, icon: const Icon(Icons.more_vert, color: C.muted)),
          ]),
        ),
      );
}

/// A square card for horizontal shelves.
class SquareCard extends StatelessWidget {
  final Item it;
  final VoidCallback onTap;
  final double size;
  const SquareCard(this.it, {super.key, required this.onTap, this.size = 150});
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: SizedBox(
          width: size,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: size, height: size, child: Cover.of(it, radius: 16)),
            const SizedBox(height: 8),
            Text(it.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(it.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: C.muted, fontSize: 13)),
          ]),
        ),
      );
}

class Shelf extends StatelessWidget {
  final List<Widget> children;
  final double height;
  const Shelf({super.key, required this.children, this.height = 200});
  @override
  Widget build(BuildContext context) => SizedBox(
        height: height,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: children.length,
          separatorBuilder: (_, __) => const SizedBox(width: 12),
          itemBuilder: (_, i) => children[i],
        ),
      );
}

class Pill extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool selected;
  final VoidCallback? onTap;
  final Widget? trailing;
  const Pill(this.label, {super.key, this.icon, this.selected = false, this.onTap, this.trailing});
  @override
  Widget build(BuildContext context) => Material(
        color: selected ? Colors.white : C.s2,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 40),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              if (icon != null) Padding(padding: const EdgeInsets.only(right: 6), child: Icon(icon, size: 16, color: selected ? Colors.black : C.ink2)),
              Text(label, style: TextStyle(color: selected ? Colors.black : C.ink2, fontWeight: FontWeight.w500)),
              if (trailing != null) trailing!,
            ]),
          ),
        ),
      );
}

Future<T?> sheet<T>(BuildContext context, Widget Function(BuildContext) build) => showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (c) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.of(c).viewInsets.bottom), child: build(c)),
    );

class SheetAction {
  final IconData icon;
  final String label;
  final String? sub;
  final bool danger;
  final VoidCallback run;
  SheetAction(this.icon, this.label, this.run, {this.sub, this.danger = false});
}

Future<void> actionSheet(BuildContext context, String title, List<SheetAction> actions, {String? note}) => sheet(
      context,
      (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
          if (note != null) Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text(note, style: const TextStyle(color: C.muted))),
          Flexible(
            child: ListView(shrinkWrap: true, children: [
              for (final a in actions)
                ListTile(
                  leading: Icon(a.icon, color: a.danger ? C.hot : C.ink2),
                  title: Text(a.label, style: TextStyle(color: a.danger ? C.hot : null)),
                  subtitle: a.sub != null ? Text(a.sub!, style: const TextStyle(color: C.muted)) : null,
                  onTap: () {
                    Navigator.pop(c);
                    a.run();
                  },
                ),
            ]),
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );

Future<bool> confirm(BuildContext context, String title, String body, String ok, {bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      backgroundColor: C.s2,
      title: Text(title),
      content: Text(body, style: const TextStyle(color: C.muted)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, true), child: Text(ok, style: TextStyle(color: danger ? C.hot : Colors.white))),
      ],
    ),
  );
  return r == true;
}

Future<String?> prompt(BuildContext context, String title, {String initial = '', String hint = ''}) async {
  final ctl = TextEditingController(text: initial);
  final r = await showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      backgroundColor: C.s2,
      title: Text(title),
      content: TextField(controller: ctl, autofocus: true, decoration: InputDecoration(hintText: hint)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, ctl.text.trim()), child: const Text('OK')),
      ],
    ),
  );
  return r;
}
