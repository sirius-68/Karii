import 'dart:async';

import 'package:flutter/material.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../engine/engine.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';
import 'nav.dart';

class DetailScreen extends StatefulWidget {
  final Item item;
  const DetailScreen({super.key, required this.item});
  @override
  State<DetailScreen> createState() => _DetailScreenState();
}

class _DetailScreenState extends State<DetailScreen> {
  bool previewing = false, loading = false;
  Timer? _t;
  double pos = 0;

  Item get it => widget.item;

  Future<void> togglePreview() async {
    final e = Engine.i;
    if (previewing) {
      await e.pause();
      _t?.cancel();
      setState(() => previewing = false);
      return;
    }
    final src = musicFor(it);
    if (src.none) {
      toast(context, 'No music attached yet');
      return;
    }
    setState(() => loading = true);
    final ok = await e.load(asset: src.asset, path: src.path, url: src.url);
    if (!mounted) return;
    setState(() => loading = false);
    if (!ok) {
      toast(context, 'Couldn’t load the music. Are you online?');
      return;
    }
    await e.setRate(1);
    await e.setVolume(1);
    await e.play();
    setState(() => previewing = true);
    _t = Timer.periodic(const Duration(milliseconds: 250), (_) async {
      final s = await e.state();
      if (!mounted) return;
      setState(() {
        pos = s.pos;
        if (!s.playing) previewing = false;
      });
    });
  }

  Widget listenButton() => OutlinedButton.icon(
        onPressed: loading ? null : togglePreview,
        icon: loading ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(previewing ? Icons.pause : Icons.play_arrow),
        label: Text(previewing ? fmtTime(pos) : 'Listen'),
      );

  @override
  void dispose() {
    _t?.cancel();
    if (previewing) Engine.i.pause();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Store.i,
      builder: (context, _) {
        final liked = Store.i.likes.contains(it.id);
        final hasMusic = !musicFor(it).none;
        return Scaffold(
          body: CustomScrollView(slivers: [
            SliverAppBar(
              expandedHeight: 300,
              pinned: true,
              backgroundColor: C.bg,
              actions: [IconButton(onPressed: () => itemMenu(context, it, changed: () => setState(() {})), icon: const Icon(Icons.more_vert))],
              flexibleSpace: FlexibleSpaceBar(background: Cover.of(it, radius: 0)),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(child: Text(it.title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5))),
                    if (it.kind == Kind.song) const BetaTag(),
                  ]),
                  const SizedBox(height: 4),
                  Text([it.sub, if (it.dur > 0) fmtTime(it.dur), kindLabel(it.kind)].join(' · '), style: const TextStyle(color: C.muted)),
                  if (it.m['credit'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${it.m['credit']}', style: const TextStyle(color: C.faint, fontSize: 12.5))),
                  const SizedBox(height: 18),
                  Row(children: [
                    if (it.kind != Kind.inst)
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () => perform(context, it),
                          icon: Icon(it.kind == Kind.song ? Icons.mic_external_on : Icons.videocam_outlined),
                          label: Text(it.kind == Kind.song ? 'Sing' : 'Perform'),
                        ),
                      ),
                    if (hasMusic && it.kind != Kind.inst) ...[const SizedBox(width: 10), listenButton()],
                    if (hasMusic && it.kind == Kind.inst) Expanded(child: listenButton()),
                    const SizedBox(width: 6),
                    IconButton(onPressed: () => Store.i.toggleLike(it.id), icon: Icon(liked ? Icons.favorite : Icons.favorite_border, color: liked ? C.brand : null)),
                    if (!it.isCat && it.kind != Kind.inst) IconButton(onPressed: () => editItem(context, it), icon: const Icon(Icons.edit_outlined)),
                  ]),
                  if (it.kind == Kind.song) const Padding(padding: EdgeInsets.only(top: 14), child: _InlineBeta()),
                  const SizedBox(height: 18),
                  if (it.body.trim().isNotEmpty)
                    SelectableText(it.body, style: TextStyle(fontSize: 16, height: 1.55, color: C.ink2, fontFamily: it.kind == Kind.poem ? 'serif' : null)),
                  const SizedBox(height: 40),
                ]),
              ),
            ),
          ]),
        );
      },
    );
  }
}

class _InlineBeta extends StatelessWidget {
  const _InlineBeta();
  @override
  Widget build(BuildContext context) => const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.science_outlined, size: 16, color: C.amber),
        SizedBox(width: 8),
        Expanded(child: Text('Karaoke is in beta, so you may run into errors while you use it.', style: TextStyle(color: C.muted, fontSize: 13))),
      ]);
}
