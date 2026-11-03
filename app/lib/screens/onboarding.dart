import 'package:flutter/material.dart';

import '../core/store.dart';
import '../engine/engine.dart';
import '../widgets/ui.dart';

class Onboarding extends StatefulWidget {
  const Onboarding({super.key});
  @override
  State<Onboarding> createState() => _OnboardingState();
}

class _OnboardingState extends State<Onboarding> {
  final name = TextEditingController(text: '${Store.i.profile['name'] ?? ''}');
  int page = 0;

  void finish() {
    Store.i.profile = {...Store.i.profile, 'name': name.text.trim(), 'onboarded': true, 'since': DateTime.now().millisecondsSinceEpoch};
    Store.i.save(now: true);
    Navigator.pop(context);
  }

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      _page(
        Icons.videocam_outlined,
        'Write it, perform it',
        'Poems, monologues, movie lines, speeches and spoken-word lyrics on a teleprompter, with background music under your voice. Record, polish and share, all on your phone.',
      ),
      _page(
        Icons.headphones,
        'Headphones sound best',
        'With headphones, Lectern records only your voice and mixes the music in cleanly afterwards, so you can still change levels, fades and ducking. On the speaker it cancels the echo.',
      ),
      Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('What should we call you?', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
          const SizedBox(height: 8),
          const Text('Used in greetings and script templates. Stays on this phone.', style: TextStyle(color: C.muted)),
          const SizedBox(height: 20),
          TextField(controller: name, autofocus: true, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(hintText: 'Your name'), onSubmitted: (_) => finish()),
          const SizedBox(height: 18),
          OutlinedButton.icon(
            onPressed: () async {
              final ok = await Engine.i.requestPermissions(['android.permission.RECORD_AUDIO', 'android.permission.CAMERA']);
              if (context.mounted) toast(context, ok ? 'Microphone and camera are ready' : 'You can allow them later when you record');
            },
            icon: const Icon(Icons.videocam_outlined),
            label: const Text('Allow microphone and camera'),
          ),
        ]),
      ),
    ];
    return Scaffold(
      body: SafeArea(
        child: Column(children: [
          Align(alignment: Alignment.topRight, child: TextButton(onPressed: finish, child: const Text('Skip', style: TextStyle(color: C.muted)))),
          Expanded(child: pages[page]),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Row(children: [
              for (var i = 0; i < pages.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.only(right: 6),
                  width: i == page ? 22 : 8,
                  height: 8,
                  decoration: BoxDecoration(color: i == page ? Colors.white : C.s4, borderRadius: BorderRadius.circular(4)),
                ),
              const Spacer(),
              FilledButton(onPressed: page < pages.length - 1 ? () => setState(() => page++) : finish, child: Text(page < pages.length - 1 ? 'Next' : 'Start')),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _page(IconData icon, String title, String body) => Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(radius: 34, backgroundColor: C.s3, child: Icon(icon, size: 34, color: C.brand)),
          const SizedBox(height: 24),
          Text(title, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.6)),
          const SizedBox(height: 12),
          Text(body, style: const TextStyle(color: C.muted, fontSize: 16, height: 1.45)),
        ]),
      );
}
