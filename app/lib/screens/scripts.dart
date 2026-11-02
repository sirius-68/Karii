// Script writer: templates for talks, videos, toasts and monologues.
import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/store.dart';
import '../widgets/ui.dart';
import 'editor.dart';

class Template {
  final Kind kind;
  final String title, desc, body;
  const Template(this.kind, this.title, this.desc, this.body);
}

const templates = [
  Template(Kind.script, 'Video intro', 'Hook, promise, and a reason to stay',
      "Hey, I'm {name}. [smile]\n\nIn the next few minutes I'm going to show you ____ — and the one mistake almost everyone makes with it.\n\n[beat]\n\nIf you're new here, I make videos about ____ every week.\n\nLet's get into it."),
  Template(Kind.script, 'Product demo', 'Problem, solution, proof, call to action',
      "Here's a problem you probably know: ____.\n\n[pause]\n\nThat's why we built ____. Watch this.\n\n[show product]\n\nIn three taps, ____. No setup, no manual.\n\nTry it today at ____."),
  Template(Kind.script, 'Elevator pitch', 'Thirty seconds that make them ask for more',
      "I help ____ who struggle with ____.\n\nMost people try ____, and it doesn't work because ____.\n\n[beat]\n\nWe do it differently: ____.\n\nIf that sounds useful, I'd love ten minutes of your time."),
  Template(Kind.script, 'Wedding toast', 'Warm, funny, and under two minutes',
      "Good evening, everyone. For those who don't know me, I'm {name}.\n\n[smile]\n\nI've known ____ for ____ years, and I can honestly say ____.\n\nThe first time I met ____, I knew ____ was in trouble — the good kind.\n\n[raise glass]\n\nTo the happy couple."),
  Template(Kind.script, 'Podcast opener', 'Welcome, topic, guest',
      "Welcome back to ____. I'm {name}.\n\nToday we're talking about ____ — and I promise you'll never think about it the same way again.\n\n[pause]\n\nMy guest is ____. Welcome to the show."),
  Template(Kind.script, 'Presentation opener', 'Start with a story, not a slide',
      "Three years ago, ____.\n\n[pause]\n\nThat moment changed how I think about ____.\n\nToday I want to share three things we learned — and one we're still figuring out."),
  Template(Kind.line, 'Audition monologue', 'A one-minute scene with directions',
      "[sit down slowly]\n\nYou want to know why I stayed? ____.\n\n[look away]\n\nEveryone thinks leaving is the brave thing. Sometimes staying is.\n\n[meet their eyes]\n\nSo no. I'm not sorry."),
  Template(Kind.poem, 'Spoken word', 'Three stanzas, a turn, a landing',
      "I used to think ____\nwas something you could ____.\n\nThen ____\nand everything I knew\ngot quieter.\n\nNow I ____.\nNow I ____.\nNow I know."),
  Template(Kind.script, 'Blank script', 'Start from scratch', ''),
];

class ScriptsScreen extends StatelessWidget {
  const ScriptsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Script writer')),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 32), children: [
        const Text('Pick a template. Blanks are marked ____ and directions sit in [brackets].', style: TextStyle(color: C.muted)),
        const SizedBox(height: 16),
        for (final t in templates)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Material(
              color: C.s2,
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () {
                  final it = Store.i.create(t.kind);
                  if (t.body.isNotEmpty) {
                    it.title = t.title;
                    it.body = t.body.replaceAll('{name}', Store.i.firstName.isEmpty ? '____' : Store.i.firstName);
                  }
                  Store.i.save();
                  Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => EditorScreen(item: it, fresh: t.body.isEmpty)));
                },
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Text(t.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                            decoration: BoxDecoration(color: C.s4, borderRadius: BorderRadius.circular(99)),
                            child: Text(kindLabel(t.kind).toUpperCase(), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: C.ink2)),
                          ),
                        ]),
                        const SizedBox(height: 3),
                        Text(t.desc, style: const TextStyle(color: C.muted, fontSize: 13.5)),
                      ]),
                    ),
                    const Icon(Icons.chevron_right, color: C.muted),
                  ]),
                ),
              ),
            ),
          ),
      ]),
    );
  }
}
