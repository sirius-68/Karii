import 'package:flutter/material.dart';

import '../core/store.dart';
import '../engine/engine.dart';
import '../widgets/ui.dart';
import 'ai_sync.dart';

class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Store.i,
      builder: (context, _) {
        final st = Store.i;
        final name = '${st.profile['name'] ?? ''}'.trim();
        final secs = ((st.stats['seconds'] as num?) ?? 0).toDouble();
        final takes = ((st.stats['takes'] as num?) ?? 0).toInt();
        final days = ((st.stats['days'] as List?) ?? []).length;
        return SafeArea(
          bottom: false,
          child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 8),
              child: Row(children: [
                CircleAvatar(radius: 32, backgroundColor: C.violet, child: Text(name.isEmpty ? '?' : name.substring(0, 1).toUpperCase(), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Colors.white))),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(name.isEmpty ? 'You' : name, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                    const Text('Everything stays on this phone', style: TextStyle(color: C.muted)),
                  ]),
                ),
                IconButton(
                  onPressed: () async {
                    final n = await prompt(context, 'Your name', initial: name);
                    if (n != null) {
                      st.profile = {...st.profile, 'name': n};
                      st.save();
                    }
                  },
                  icon: const Icon(Icons.edit_outlined),
                ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
              child: Row(children: [
                _stat('$takes', 'takes'),
                _stat('${(secs / 60).round()}', 'minutes'),
                _stat('$days', 'days'),
              ]),
            ),
            const SectionHead('Recording'),
            _switch('Noise cancellation', 'Reduces steady background noise like fans and traffic', st.s<bool>('noiseCancel'), (v) {
              st.set('noiseCancel', v);
              Engine.i.setNC(v);
            }),
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 20),
              title: const Text('Music on the phone speaker'),
              subtitle: Text(st.s<String>('speakerMusic') == 'clean' ? 'Clean mix with echo cancellation' : 'Record the room (voice and music together)', style: const TextStyle(color: C.muted)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => actionSheet(context, 'Music on the phone speaker', [
                SheetAction(Icons.surround_sound_outlined, 'Record the room', () => st.set('speakerMusic', 'acoustic'), sub: 'Most natural; the mic hears the music too'),
                SheetAction(Icons.graphic_eq, 'Clean mix (echo cancellation)', () => st.set('speakerMusic', 'clean'), sub: 'Voice-call processing removes the music from the mic, then mixes it back cleanly'),
              ], note: 'With headphones, Lectern always records your voice and mixes the music in cleanly.'),
            ),
            _slider('Mic level', '${st.sd('micGain') >= 0 ? '+' : ''}${st.sd('micGain').round()} dB', st.sd('micGain').clamp(-12.0, 12.0), -12, 12, (v) => st.set('micGain', v.roundToDouble())),
            _slider('Karaoke music volume', '${(st.sd('karVol') * 100).round()}%', st.sd('karVol').clamp(0.0, 1.0), 0, 1, (v) => st.set('karVol', v)),
            _slider('Music bed volume', '${st.sd('bedVol').round()}%', st.sd('bedVol').clamp(0.0, 100.0), 0, 100, (v) => st.set('bedVol', v.round())),
            _switch('Guide melody', 'Play built-in songs with the tune on top', st.s<bool>('guide'), (v) => st.set('guide', v)),
            _switch('Save takes to the gallery', 'Keep a copy in your phone’s gallery when you save', st.s<bool>('saveToGallery'), (v) => st.set('saveToGallery', v)),
            const SectionHead('Lyrics'),
            _slider('Text size', '${st.sd('textSize').round()}', st.sd('textSize').clamp(20.0, 60.0), 20, 60, (v) => st.set('textSize', v)),
            _slider('Tap sync delay', '${(st.sd('tapLat') * 1000).round()} ms', st.sd('tapLat').clamp(0.0, 0.3), 0, 0.3, (v) => st.set('tapLat', (v * 100).round() / 100)),
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 20),
              title: const Text('AI sync model'),
              subtitle: Text('${sttModels.firstWhere((m) => m.id == st.s<String>('sttModel'), orElse: () => sttModels.first).name} · ${sttLanguages[st.s<String>('sttLanguage')] ?? 'Auto'}',
                  style: const TextStyle(color: C.muted)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => actionSheet(context, 'AI sync model', [
                for (final m in sttModels) SheetAction(st.s<String>('sttModel') == m.id ? Icons.check : Icons.memory, m.name, () => st.set('sttModel', m.id), sub: '${m.note} ${m.size}'),
              ], note: 'Runs on your phone. The model downloads once, the first time you use it.'),
            ),
            const SectionHead('About'),
            const ListTile(
              contentPadding: EdgeInsets.symmetric(horizontal: 20),
              title: Text('Lectern'),
              subtitle: Text('Native build · Flutter with a C++ audio engine (Oboe) and on-device speech recognition (whisper.cpp)', style: TextStyle(color: C.muted)),
            ),
            const ListTile(
              contentPadding: EdgeInsets.symmetric(horizontal: 20),
              title: Text('Credits'),
              subtitle: Text('Instrumentals by Tanner Helland (CC BY 4.0). Karaoke songs are public-domain melodies with arrangements made for Lectern.', style: TextStyle(color: C.muted)),
            ),
          ]),
        );
      },
    );
  }

  Widget _stat(String v, String l) => Expanded(
        child: Container(
          margin: const EdgeInsets.only(right: 8),
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(color: C.s2, borderRadius: BorderRadius.circular(16)),
          child: Column(children: [
            Text(v, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            Text(l, style: const TextStyle(color: C.muted, fontSize: 13)),
          ]),
        ),
      );

  Widget _switch(String t, String s, bool v, ValueChanged<bool> on) => SwitchListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20),
        title: Text(t),
        subtitle: Text(s, style: const TextStyle(color: C.muted)),
        value: v,
        onChanged: on,
      );

  Widget _slider(String t, String val, double v, double min, double max, ValueChanged<double> on) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 12, 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Text(t, style: const TextStyle(fontSize: 16)), const Spacer(), Text(val, style: const TextStyle(color: C.muted))]),
          Slider(value: v, min: min, max: max, onChanged: on),
        ]),
      );
}
