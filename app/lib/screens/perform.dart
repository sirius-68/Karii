// The performance studio: camera, teleprompter, background music, rehearsing and recording a take.
// The teleprompter is drawn over the camera preview only; the video file is the camera picture,
// so the script never appears in a recording. The voice is recorded on its own (with the music
// the performer heard, sample-aligned) and mixed when the take is finished.
import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../core/media.dart';
import '../core/model.dart';
import '../core/store.dart';
import '../core/text.dart';
import '../engine/engine.dart';
import '../widgets/job_pill.dart';
import '../widgets/prompter.dart';
import '../widgets/ui.dart';
import 'appearance.dart';
import 'music_screen.dart';
import 'take_editor.dart';

enum Phase { loading, ready, countdown, recording, paused, saving }

class PerformScreen extends StatefulWidget {
  final Item item;
  const PerformScreen({super.key, required this.item});
  @override
  State<PerformScreen> createState() => _PerformScreenState();
}

class _PerformScreenState extends State<PerformScreen> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  Item get it => widget.item;
  Engine get e => Engine.i;
  Store get st => Store.i;
  MusicSettings get ms => it.musicSettings;
  ScriptStyle get style => it.style;
  PrompterSettings get ps => it.prompter;

  CameraController? cam;
  List<CameraDescription> cams = [];
  String? camErr;
  bool camOn = true;
  bool camBusy = false;

  Phase phase = Phase.loading;
  MusicSource music = MusicSource.empty;
  bool hasMusic = false;
  late final Ticker _ticker;
  bool _polling = false;
  // the audio clock (seconds into the music the performer hears now), updated every frame
  final ValueNotifier<double> clockT = ValueNotifier(0);
  double get t => clockT.value;
  double _lastPos = 0;
  Duration _lastHeader = Duration.zero, _lastTick = Duration.zero;
  StreamSubscription<String>? _audioEv;
  double dur = 0, micDb = -90;
  bool playing = false;
  int count = 0;
  Timer? _countT;
  double? seekDrag;

  // teleprompter
  final ScrollController scroll = ScrollController();
  late final List<GlobalKey> keys = lineKeys(it.body);
  bool rehearsing = false, scrollPaused = false, dragging = false;
  bool showScript = true, focus = false, landscape = false;

  // take
  final Stopwatch watch = Stopwatch();
  String? takeId, voicePath, musicPath;
  RecMode mode = RecMode.mic;
  bool videoRecording = false;

  bool get recordingNow => phase == Phase.recording || phase == Phase.paused;
  bool get busy => recordingNow || phase == Phase.countdown || phase == Phase.saving;
  bool get _scrolling => ps.autoScroll && !scrollPaused && !dragging && ((rehearsing && phase == Phase.ready) || phase == Phase.recording);
  double get regionStart => ms.trimStart.clamp(0.0, dur > 0 ? dur : 0.0);
  double get regionEnd => ms.trimEnd > 0 && ms.trimEnd < dur ? ms.trimEnd : dur;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _ticker = createTicker(_tick);
    e.addListener(_onEngine);
    JobPill.hiddenBy.value++;
    // a phone call or another app took the audio: pause instead of recording silence
    _audioEv = e.audioEvents.listen((ev) {
      if (ev != 'interrupted' || !mounted) return;
      if (phase == Phase.recording) {
        pauseTake();
        toast(context, 'Paused: another app is using the audio');
      } else if (phase == Phase.countdown) {
        _cancelCountdown();
      } else if (phase == Phase.ready && rehearsing) {
        toggleRehearse();
      }
    });
    _setup();
  }

  void _onEngine() {
    if (mounted) setState(() {});
  }

  Future<void> _setup() async {
    e.keepAwake(true);
    final micOk = await e.requestPermissions(['android.permission.RECORD_AUDIO']);
    if (!micOk && mounted) toast(context, 'Lectern needs the microphone to record. You can still rehearse.');
    final camOk = await e.requestPermissions(['android.permission.CAMERA']);
    if (camOk) {
      await _initCam();
    } else {
      camOn = false;
      camErr = 'Camera permission is off, so takes are audio only.';
    }
    await _loadMusic();
    if (!mounted) return;
    setState(() => phase = Phase.ready);
    _ticker.start();
  }

  Future<void> _loadMusic() async {
    music = musicFor(it);
    hasMusic = false;
    if (!music.none) {
      final ok = await e.load(asset: music.asset, path: music.path, url: music.url);
      if (ok) {
        hasMusic = true;
        dur = e.duration;
        await e.pause();
        await _shapeMusic();
        await e.seek(regionStart);
        await e.setRate(1);
        await e.setVolume(ms.volume);
      } else if (mounted) {
        toast(context, 'Couldn’t load the music${music.url != null ? '. Are you online?' : '.'}');
      }
    } else {
      await e.unload();
      dur = 0;
    }
    clockT.value = hasMusic ? regionStart : 0;
    _lastPos = clockT.value;
  }

  Future<void> _shapeMusic() => e.setMusic(start: ms.trimStart, end: ms.trimEnd, loop: ms.loop, fadeIn: ms.fadeIn, fadeOut: ms.fadeOut);

  DeviceOrientation get _orientation => landscape ? DeviceOrientation.landscapeLeft : DeviceOrientation.portraitUp;

  Future<void> _initCam({CameraLensDirection? dir}) async {
    if (camBusy) return;
    camBusy = true;
    try {
      if (cams.isEmpty) cams = await availableCameras();
      if (cams.isEmpty) throw 'No camera';
      final want = dir ?? (st.s<String>('facing') == 'back' ? CameraLensDirection.back : CameraLensDirection.front);
      final d = cams.firstWhere((c) => c.lensDirection == want, orElse: () => cams.first);
      final old = cam;
      cam = null;
      if (mounted) setState(() {});
      await old?.dispose();
      final c = CameraController(d, ResolutionPreset.high, enableAudio: false);
      await c.initialize();
      try {
        await c.lockCaptureOrientation(_orientation);
      } catch (_) {}
      cam = c;
      camErr = null;
    } catch (err) {
      camErr = 'The camera couldn’t start, so takes are audio only.';
      cam = null;
    } finally {
      camBusy = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> flipCam() async {
    if (cam == null || busy) return;
    final now = cam!.description.lensDirection;
    final next = now == CameraLensDirection.front ? CameraLensDirection.back : CameraLensDirection.front;
    st.set('facing', next == CameraLensDirection.back ? 'back' : 'front');
    await _initCam(dir: next);
  }

  Future<void> toggleLandscape() async {
    if (busy) return;
    setState(() => landscape = !landscape);
    await SystemChrome.setPreferredOrientations([_orientation]);
    try {
      await cam?.lockCaptureOrientation(_orientation);
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.inactive || s == AppLifecycleState.paused) {
      if (phase == Phase.recording) {
        pauseTake();
      } else if (phase == Phase.countdown) {
        _cancelCountdown();
      } else if (phase == Phase.ready) {
        if (rehearsing) toggleRehearse();
        if (cam != null && s == AppLifecycleState.paused) {
          final c = cam;
          cam = null;
          c?.dispose();
        }
      }
    } else if (s == AppLifecycleState.resumed) {
      if (cam == null && camOn && phase == Phase.ready) _initCam();
    }
  }

  // ------------------------------------------------------------------ frame loop
  void _tick(Duration elapsed) {
    final dt = ((elapsed - _lastTick).inMicroseconds / 1e6).clamp(0.0, 0.1);
    _lastTick = elapsed;
    if (_scrolling && scroll.hasClients) {
      // speed 1..20 ≈ 0.07..1.3 lines a second, whatever the text size
      final pxs = ps.speed * style.size * style.lineHeight / 15;
      final max = scroll.position.maxScrollExtent;
      if (scroll.offset < max) scroll.jumpTo(math.min(max, scroll.offset + pxs * dt));
    }
    if (!e.clock.ok) {
      _pollFallback();
      return;
    }
    _apply(e.clock.state, elapsed);
  }

  Future<void> _pollFallback() async {
    if (_polling) return;
    _polling = true;
    final s = await e.state();
    _polling = false;
    if (mounted) _apply(s, _lastTick);
  }

  void _apply(EngineState s, Duration elapsed) {
    // the audio hardware clock; sub-frame jitter from a fresh timestamp is held back (but a loop
    // going back to the start is followed at once)
    var pos = s.pos;
    if (s.playing && pos < _lastPos && _lastPos - pos < 0.03) pos = _lastPos;
    _lastPos = pos;
    clockT.value = hasMusic ? pos : watch.elapsedMilliseconds / 1000;
    micDb = s.micDb;
    var rebuild = false;
    if (s.playing != playing) {
      playing = s.playing;
      rebuild = true;
    }
    if (recordingNow && elapsed - _lastHeader > const Duration(milliseconds: 200)) {
      _lastHeader = elapsed;
      rebuild = true; // recording time and level meter
    }
    if (rebuild && mounted) setState(() {});
  }

  // ------------------------------------------------------------------ rehearsal
  Future<void> toggleRehearse() async {
    if (phase != Phase.ready) return;
    setState(() {
      rehearsing = !rehearsing;
      scrollPaused = false;
    });
    if (hasMusic) {
      if (rehearsing) {
        await _shapeMusic();
        await e.play();
      } else {
        await e.pause();
      }
    }
  }

  Future<void> restart() async {
    if (phase != Phase.ready) return;
    if (hasMusic) await e.seek(regionStart);
    if (scroll.hasClients) scroll.jumpTo(0);
    _lastPos = hasMusic ? regionStart : 0;
    clockT.value = _lastPos;
  }

  void jumpTo(int line) {
    if (line < 0 || line >= keys.length) return;
    final c = keys[line].currentContext;
    if (c == null) return;
    Scrollable.ensureVisible(c, alignment: ps.readingLine, duration: const Duration(milliseconds: 350), curve: Curves.easeOutCubic);
  }

  void jumpSheet() {
    final rows = prompterLines(it.body);
    sheet(
      context,
      (c) => SizedBox(
        height: MediaQuery.of(c).size.height * 0.6,
        child: Column(children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Align(alignment: Alignment.centerLeft, child: Text('Jump to a line', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)))),
          Expanded(
            child: ListView(children: [
              for (final r in rows)
                r.header
                    ? Padding(
                        padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
                        child: Text(r.text.toUpperCase(), style: const TextStyle(color: C.brand, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                      )
                    : ListTile(
                        dense: true,
                        leading: SizedBox(width: 28, child: Text('${r.index + 1}', style: const TextStyle(color: C.faint))),
                        title: Text(r.text, maxLines: 1, overflow: TextOverflow.ellipsis),
                        onTap: () {
                          Navigator.pop(c);
                          setState(() => showScript = true);
                          jumpTo(r.index);
                        },
                      ),
            ]),
          ),
        ]),
      ),
    );
  }

  void _prompter(Map<String, dynamic> c) {
    it.prompter = ps.copyWith(c);
    st.save();
    setState(() {});
  }

  void _style(Map<String, dynamic> c) {
    it.style = style.copyWith(c);
    st.save();
    setState(() {});
  }

  // ------------------------------------------------------------------ recording
  RecMode _plan() {
    if (!hasMusic) return RecMode.mic;
    if (e.route.headphones) return RecMode.mix;
    return st.s<String>('speakerMusic') == 'clean' ? RecMode.mixAec : RecMode.acoustic;
  }

  Future<void> startTake() async {
    if (phase != Phase.ready) return;
    if (!await e.requestPermissions(['android.permission.RECORD_AUDIO'])) {
      if (mounted) toast(context, 'Allow the microphone to record a take.');
      return;
    }
    rehearsing = false;
    scrollPaused = false;
    if (hasMusic) {
      await e.pause();
      await _shapeMusic();
      await e.seek(regionStart);
    }
    _lastPos = hasMusic ? regionStart : 0;
    if (scroll.hasClients) scroll.jumpTo(0);
    mode = _plan();
    final r = await e.openMic(mode: mode, nc: st.s<bool>('noiseCancel'), gainDb: st.sd('micGain'));
    if (r['ok'] != true) {
      if (mounted) toast(context, 'The microphone couldn’t start. Close other apps using it and try again.');
      return;
    }
    count = st.s<int>('countdown');
    setState(() => phase = count > 0 ? Phase.countdown : Phase.recording);
    if (count > 0) {
      HapticFeedback.lightImpact();
      _countT = Timer.periodic(const Duration(seconds: 1), (tm) {
        if (!mounted) return tm.cancel();
        count--;
        HapticFeedback.selectionClick();
        if (count <= 0) {
          tm.cancel();
          _go();
        }
        setState(() {});
      });
    } else {
      _go();
    }
  }

  void _cancelCountdown() {
    _countT?.cancel();
    e.closeMic();
    setState(() => phase = Phase.ready);
  }

  Future<void> _go() async {
    takeId = Store.uid();
    voicePath = st.mediaPath('take-$takeId-voice.wav');
    // clean mixes keep the music the performer heard, sample-aligned with the voice
    musicPath = (mode == RecMode.mix || mode == RecMode.mixAec) ? st.mediaPath('take-$takeId-music.wav') : null;
    videoRecording = false;
    if (camOn && cam != null && cam!.value.isInitialized) {
      try {
        await cam!.startVideoRecording();
        videoRecording = true;
      } catch (err) {
        debugPrint('video start: $err');
      }
    }
    final ok = await e.startRecord(voicePath!, music: musicPath ?? '');
    if (!ok) {
      if (videoRecording) {
        try {
          await cam!.stopVideoRecording();
        } catch (_) {}
      }
      await e.closeMic();
      if (mounted) {
        toast(context, 'Recording couldn’t start (storage full?)');
        setState(() => phase = Phase.ready);
      }
      return;
    }
    watch
      ..reset()
      ..start();
    if (hasMusic) await e.play();
    if (mounted) {
      setState(() {
        phase = Phase.recording;
        showScript = ps.showWhileRecording;
      });
    }
  }

  Future<void> pauseTake() async {
    if (phase != Phase.recording) return;
    watch.stop();
    await e.pauseRecord(true);
    if (hasMusic) await e.pause();
    if (videoRecording) {
      try {
        await cam!.pauseVideoRecording();
      } catch (_) {}
    }
    if (mounted) setState(() => phase = Phase.paused);
  }

  Future<void> resumeTake() async {
    if (phase != Phase.paused) return;
    if (videoRecording) {
      try {
        await cam!.resumeVideoRecording();
      } catch (_) {}
    }
    await e.pauseRecord(false);
    if (hasMusic) await e.play();
    watch.start();
    if (mounted) setState(() => phase = Phase.recording);
  }

  Future<void> stopTake({bool discard = false}) async {
    if (!recordingNow) return;
    setState(() => phase = Phase.saving);
    watch.stop();
    // stop the camera and the mic together and note when each stopped, so the two can be lined
    // up exactly (the mic's last sample has a hardware capture time)
    final videoStopNs = e.clock.monoNs;
    final fv = videoRecording
        ? cam!.stopVideoRecording().then<XFile?>((x) => x, onError: (err) {
            debugPrint('video stop: $err');
            return null;
          })
        : Future<XFile?>.value(null);
    final res = await e.stopRecord();
    final vf = await fv;
    if (hasMusic) await e.pause();
    await e.closeMic();
    if (discard) {
      for (final p in [voicePath, musicPath, vf?.path]) {
        if (p != null) _rm(p);
      }
      if (mounted) setState(() => phase = Phase.ready);
      if (hasMusic) await e.seek(regionStart);
      return;
    }
    final video = vf != null;
    final out = st.mediaPath(video ? 'take-$takeId.mp4' : 'take-$takeId.m4a');
    final musicMix = {'fadeIn': ms.fadeIn, 'fadeOut': ms.fadeOut, 'duckDb': ms.duck ? ms.duckDb : 0.0, 'balance': ms.balanceDb};
    TakeMix mix;
    try {
      mix = await e.finishTake(
        voice: voicePath!,
        music: musicPath,
        mode: mode.index,
        wav: st.mediaPath('take-$takeId-mix.wav'),
        out: out,
        video: vf?.path,
        videoStopNs: videoStopNs,
        audioEndNs: res.lastCaptureNs,
        balance: ms.balanceDb,
        fadeIn: ms.fadeIn,
        fadeOut: ms.fadeOut,
        duckDb: ms.duck ? ms.duckDb : 0,
      );
    } catch (err) {
      if (mounted) {
        toast(context, 'The take couldn’t be put together: $err');
        setState(() => phase = Phase.ready);
      }
      return;
    }
    final d = Draft({
      'id': takeId,
      'title': it.title,
      'itemId': it.id,
      'video': out,
      'isVideo': video,
      'landscape': landscape,
      'voice': voicePath,
      'music': musicPath,
      'raw': vf?.path,
      'dur': res.seconds,
      'created': DateTime.now().millisecondsSinceEpoch,
      'edit': musicMix,
      'meta': {
        'mode': mode.name,
        'modeIndex': mode.index,
        'route': e.route.label,
        'nc': st.s<bool>('noiseCancel'),
        'offset': mix.offset,
        'mix': mix.toJson(),
        'musicLabel': music.label,
        'rate': res.rate,
        'health': res.toJson(),
        'struggled': res.struggled,
      },
    });
    st.drafts.insert(0, d);
    final days = ((st.stats['days'] as List?) ?? []).map((x) => '$x').toList();
    final today = DateTime.now().toIso8601String().substring(0, 10);
    if (!days.contains(today)) days.add(today);
    st.stats = {
      ...st.stats,
      'days': days,
      'seconds': ((st.stats['seconds'] as num?) ?? 0) + res.seconds,
      'takes': ((st.stats['takes'] as num?) ?? 0) + 1,
    };
    st.save(now: true);
    if (!mounted) return;
    await Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => TakeEditor(draft: d)));
  }

  void _rm(String p) {
    try {
      final f = File(p);
      if (f.existsSync()) f.deleteSync();
    } catch (_) {}
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ticker.dispose();
    _countT?.cancel();
    _audioEv?.cancel();
    e.removeListener(_onEngine);
    JobPill.hiddenBy.value--;
    // leaving mid-take: release the mic and the recorder (the take is dropped)
    if (busy && phase != Phase.saving) e.closeMic();
    clockT.dispose();
    e.pause();
    e.keepAwake(false);
    cam?.dispose();
    scroll.dispose();
    st.save();
    SystemChrome.setPreferredOrientations([]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  // ------------------------------------------------------------------ sheets
  Future<void> openMusic() async {
    if (phase != Phase.ready) return;
    if (rehearsing) await toggleRehearse();
    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => MusicScreen(item: it)));
    await _loadMusic();
    if (mounted) setState(() {});
  }

  void tune() {
    sheet(
      context,
      (c) => StatefulBuilder(builder: (c, set) {
        void upd(String k, dynamic v) {
          st.set(k, v);
          set(() {});
          setState(() {});
        }

        void pr(Map<String, dynamic> m) {
          _prompter(m);
          set(() {});
        }

        return SafeArea(
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), children: [
            const Text('Teleprompter', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Scroll automatically'),
              subtitle: const Text('Off: scroll the script with your finger', style: TextStyle(color: C.muted)),
              value: ps.autoScroll,
              onChanged: (v) => pr({'autoScroll': v}),
            ),
            _label('Scroll speed', '${ps.speed.round()}'),
            Slider(value: ps.speed.clamp(1.0, 20.0), min: 1, max: 20, divisions: 19, onChanged: (v) => pr({'speed': v.roundToDouble()})),
            _label('Text size', '${style.size.round()}'),
            Slider(
                value: style.size.clamp(16.0, 80.0),
                min: 16,
                max: 80,
                divisions: 64,
                onChanged: (v) {
                  _style({'size': v.roundToDouble()});
                  set(() {});
                }),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show the script while recording'),
              subtitle: const Text('It is never part of the video either way', style: TextStyle(color: C.muted)),
              value: ps.showWhileRecording,
              onChanged: (v) => pr({'showWhileRecording': v}),
            ),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Mirror'), value: ps.mirror, onChanged: (v) => pr({'mirror': v})),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => editAppearance(context, it, changed: () => setState(() {})),
                icon: const Icon(Icons.text_fields),
                label: const Text('Font, colours, position and transparency…'),
              ),
            ),
            const Divider(height: 24),
            const Text('Recording', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            _label('Countdown', st.s<int>('countdown') == 0 ? 'Off' : '${st.s<int>('countdown')} s'),
            const SizedBox(height: 6),
            Wrap(spacing: 8, children: [
              for (final v in const [0, 3, 5, 10]) Pill(v == 0 ? 'Off' : '$v s', selected: st.s<int>('countdown') == v, onTap: () => upd('countdown', v)),
            ]),
            _label('Mic level', '${st.sd('micGain') >= 0 ? '+' : ''}${st.sd('micGain').toStringAsFixed(0)} dB'),
            Slider(
                value: st.sd('micGain').clamp(-12.0, 12.0),
                min: -12,
                max: 12,
                divisions: 24,
                onChanged: (v) {
                  upd('micGain', v);
                  e.setMicGain(v);
                }),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Noise cancellation'),
              subtitle: const Text('Reduces steady background noise like fans and traffic', style: TextStyle(color: C.muted)),
              value: st.s<bool>('noiseCancel'),
              onChanged: (v) {
                upd('noiseCancel', v);
                e.setNC(v);
              },
            ),
            if (hasMusic) ...[
              _label('Music on the phone speaker', ''),
              const Text('Used when no headphones are connected.', style: TextStyle(color: C.muted, fontSize: 13)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                Pill('Clean mix (echo cancel)', selected: st.s<String>('speakerMusic') == 'clean', onTap: () => upd('speakerMusic', 'clean')),
                Pill('Record the room', selected: st.s<String>('speakerMusic') != 'clean', onTap: () => upd('speakerMusic', 'acoustic')),
              ]),
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('With headphones your voice is always recorded on its own and the music mixed in cleanly, so there is no echo or feedback.',
                    style: TextStyle(color: C.faint, fontSize: 12.5)),
              ),
            ],
            const SizedBox(height: 4),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Camera'),
              subtitle: Text(camOn ? 'Record video' : 'Audio only', style: const TextStyle(color: C.muted)),
              value: camOn,
              onChanged: phase == Phase.ready
                  ? (v) async {
                      camOn = v;
                      set(() {});
                      if (v && cam == null) {
                        await _initCam();
                      } else if (!v) {
                        final c0 = cam;
                        cam = null;
                        await c0?.dispose();
                      }
                      if (mounted) setState(() {});
                    }
                  : null,
            ),
          ]),
        );
      }),
    ).then((_) => st.save());
  }

  Widget _label(String a, String b) => Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Row(children: [Text(a, style: const TextStyle(fontWeight: FontWeight.w600)), const Spacer(), Text(b, style: const TextStyle(color: C.muted))]),
      );

  // ------------------------------------------------------------------ UI
  Future<void> _askLeave() async {
    if (phase == Phase.countdown) {
      _cancelCountdown();
      return;
    }
    if (phase == Phase.recording) await pauseTake();
    if (!mounted) return;
    await actionSheet(context, 'Stop recording?', [
      SheetAction(Icons.check, 'Stop and keep the take', () => stopTake()),
      SheetAction(Icons.play_arrow, 'Keep recording', resumeTake),
      SheetAction(Icons.delete_outline, 'Discard the take', () => stopTake(discard: true), danger: true),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final pad = mq.padding;
    final size = mq.size;
    // the band the script may use: between the top bar and the controls
    final sideW = landscape ? 132.0 : 0.0;
    final bandTop = pad.top + (focus ? 12 : 60);
    final bandBottom = size.height - pad.bottom - (focus ? 112 : (landscape ? 12 : 250));
    final band = math.max(120.0, bandBottom - bandTop);
    final areaH = math.max(110.0, band * ps.areaHeight);
    final areaTop = switch (ps.position) {
      'top' => bandTop,
      'bottom' => bandTop + band - areaH,
      _ => bandTop + (band - areaH) / 2,
    };
    return PopScope(
      canPop: !busy,
      onPopInvokedWithResult: (did, _) {
        if (!did && phase != Phase.saving) _askLeave();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(fit: StackFit.expand, children: [
          _background(),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x88000000), Color(0x00000000), Color(0x00000000), Color(0xBB000000)], stops: [0, 0.2, 0.6, 1]),
            ),
          ),
          // hidden, the script keeps its place (and keeps scrolling) so it comes back where you are
          if (it.body.trim().isNotEmpty)
            Positioned(
              top: areaTop,
              left: pad.left + 8,
              right: pad.right + 8 + sideW,
              height: areaH,
              child: IgnorePointer(
               ignoring: !showScript,
               child: GestureDetector(
                onTap: () {
                  if (rehearsing || recordingNow) setState(() => scrollPaused = !scrollPaused);
                },
                child: NotificationListener<ScrollNotification>(
                  onNotification: (n) {
                    if (n is ScrollStartNotification && n.dragDetails != null) dragging = true;
                    if (n is ScrollEndNotification) dragging = false;
                    return false;
                  },
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Opacity(
                      opacity: showScript ? ps.opacity.clamp(0.2, 1.0) : 0.0,
                      child: PrompterView(body: it.body, style: style, readingLine: ps.readingLine, controller: scroll, keys: keys, mirror: ps.mirror),
                    ),
                  ),
                ),
               ),
              ),
            ),
          if (scrollPaused && (rehearsing || recordingNow) && showScript)
            Positioned(
              top: areaTop + 8,
              right: pad.right + 16 + sideW,
              child: const _Badge(Icons.pause, 'Scroll paused · tap to go on'),
            ),
          if (!showScript)
            Positioned(
              top: bandTop + 8,
              left: 0,
              right: sideW,
              child: Center(child: GestureDetector(onTap: () => setState(() => showScript = true), child: const _Badge(Icons.visibility_off_outlined, 'Script hidden · tap to show'))),
            ),
          if (!focus) Positioned(top: pad.top + 6, left: pad.left + 8, right: pad.right + 8 + sideW, child: _topBar()),
          if (focus)
            Positioned(
              top: pad.top + 4,
              right: pad.right + 4 + sideW,
              child: IconButton(onPressed: () => setState(() => focus = false), icon: const Icon(Icons.fullscreen_exit, color: Colors.white70), tooltip: 'Show controls'),
            ),
          if (focus && recordingNow) Positioned(top: pad.top + 16, left: pad.left + 16, child: _recBadge()),
          if (landscape)
            Positioned(top: pad.top + 8, bottom: pad.bottom + 8, right: pad.right + 4, width: sideW - 8, child: _sideControls())
          else
            Positioned(left: 0, right: 0, bottom: pad.bottom + 10, child: _controls()),
          if (phase == Phase.countdown)
            Center(
              child: Text('$count', style: const TextStyle(fontSize: 120, fontWeight: FontWeight.w800, shadows: [Shadow(blurRadius: 24, color: Colors.black)])),
            ),
          if (phase == Phase.loading || phase == Phase.saving)
            Container(
              color: Colors.black54,
              child: Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const CircularProgressIndicator(color: Colors.white),
                  const SizedBox(height: 14),
                  Text(phase == Phase.saving ? 'Putting your take together…' : 'Getting the studio ready…', style: const TextStyle(color: Colors.white70)),
                ]),
              ),
            ),
        ]),
      ),
    );
  }

  Widget _background() {
    final c = cam;
    if (c != null && c.value.isInitialized && camOn) {
      final s = c.value.previewSize;
      if (s != null) {
        return ClipRect(
          child: FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(width: landscape ? s.width : s.height, height: landscape ? s.height : s.width, child: CameraPreview(c)),
          ),
        );
      }
      return CameraPreview(c);
    }
    return Stack(fit: StackFit.expand, children: [
      Cover.of(it, radius: 0),
      if (camErr != null)
        Positioned(
          left: 24,
          right: 24,
          bottom: 300,
          child: Text(camErr!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, fontSize: 13)),
        ),
    ]);
  }

  Widget _recBadge() => Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.circle, size: 10, color: phase == Phase.recording ? C.hot : C.amber),
        const SizedBox(width: 6),
        Text('${phase == Phase.paused ? 'Paused · ' : ''}${fmtTime(watch.elapsedMilliseconds / 1000)}',
            style: const TextStyle(fontSize: 13, fontFeatures: [FontFeature.tabularFigures()], shadows: [Shadow(blurRadius: 6, color: Colors.black)])),
        const SizedBox(width: 10),
        _meter(),
      ]);

  Widget _topBar() {
    return Row(children: [
      IconButton(onPressed: () => busy ? _askLeave() : Navigator.maybePop(context), icon: const Icon(Icons.close)),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(it.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          if (recordingNow)
            _recBadge()
          else
            AnimatedBuilder(
              animation: e,
              builder: (_, __) => Row(children: [
                Icon(e.route.headphones ? Icons.headphones : Icons.volume_up_outlined, size: 13, color: C.muted),
                const SizedBox(width: 5),
                Flexible(
                  child: Text(rehearsing ? 'Rehearsing · not recording' : (e.route.name.isNotEmpty ? e.route.name : e.route.label),
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: C.muted, fontSize: 12.5)),
                ),
              ]),
            ),
        ]),
      ),
      if (cam != null && !busy) IconButton(onPressed: flipCam, icon: const Icon(Icons.cameraswitch_outlined), tooltip: 'Switch camera'),
      if (!busy) IconButton(onPressed: toggleLandscape, icon: Icon(landscape ? Icons.stay_current_portrait : Icons.stay_current_landscape), tooltip: landscape ? 'Portrait' : 'Landscape'),
      IconButton(onPressed: () => setState(() => focus = true), icon: const Icon(Icons.fullscreen), tooltip: 'Focus mode'),
      if (!busy) IconButton(onPressed: tune, icon: const Icon(Icons.tune), tooltip: 'Settings'),
    ]);
  }

  Widget _meter() {
    final v = ((micDb + 60) / 60).clamp(0.0, 1.0);
    return Container(
      width: 60,
      height: 5,
      decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(3)),
      alignment: Alignment.centerLeft,
      child: FractionallySizedBox(
        widthFactor: v,
        child: Container(decoration: BoxDecoration(color: micDb > -3 ? C.hot : C.green, borderRadius: BorderRadius.circular(3))),
      ),
    );
  }

  /// Speed, size, jump, pause scrolling, hide the script.
  Widget _prompterTools() {
    Widget b(IconData i, String tip, VoidCallback? on, {bool active = false}) => IconButton(
          onPressed: on,
          tooltip: tip,
          visualDensity: VisualDensity.compact,
          style: IconButton.styleFrom(backgroundColor: active ? Colors.white : Colors.black45, foregroundColor: active ? Colors.black : Colors.white),
          icon: Icon(i, size: 20),
        );
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(children: [
        b(scrollPaused ? Icons.play_arrow : Icons.pause, scrollPaused ? 'Resume scrolling' : 'Pause scrolling', (rehearsing || recordingNow) ? () => setState(() => scrollPaused = !scrollPaused) : null),
        const SizedBox(width: 6),
        b(Icons.remove, 'Slower', ps.speed > 1 ? () => _prompter({'speed': ps.speed - 1}) : null),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(10)),
          child: Text('Speed ${ps.speed.round()}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
        ),
        b(Icons.add, 'Faster', ps.speed < 20 ? () => _prompter({'speed': ps.speed + 1}) : null),
        const SizedBox(width: 6),
        b(Icons.text_decrease, 'Smaller text', style.size > 16 ? () => _style({'size': style.size - 2}) : null),
        b(Icons.text_increase, 'Larger text', style.size < 80 ? () => _style({'size': style.size + 2}) : null),
        const SizedBox(width: 6),
        b(Icons.format_list_numbered, 'Jump to a line', it.body.trim().isEmpty ? null : jumpSheet),
        b(showScript ? Icons.visibility_outlined : Icons.visibility_off_outlined, showScript ? 'Hide the script' : 'Show the script', () => setState(() => showScript = !showScript)),
        b(Icons.flip, 'Mirror', () => _prompter({'mirror': !ps.mirror}), active: ps.mirror),
      ]),
    );
  }

  Widget _controls() {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (!focus) ...[
        _prompterTools(),
        const SizedBox(height: 6),
        if (hasMusic && phase == Phase.ready) _seekBar(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [
            if (hasMusic) ...[
              const Icon(Icons.music_note, size: 18, color: Colors.white70),
              Expanded(
                child: Slider(
                  value: ms.volume.clamp(0.0, 1.0),
                  onChanged: (v) {
                    e.setVolume(v);
                    it.musicSettings = ms.copyWith({'volume': double.parse(v.toStringAsFixed(2))});
                    setState(() {});
                  },
                  onChangeEnd: (_) => st.save(),
                ),
              ),
            ] else
              const Spacer(),
            const SizedBox(width: 6),
            _chip(st.s<bool>('noiseCancel') ? 'Noise cancel on' : 'Noise cancel', Icons.auto_fix_high, st.s<bool>('noiseCancel'), () {
              final v = !st.s<bool>('noiseCancel');
              st.set('noiseCancel', v);
              e.setNC(v);
              toast(context, v ? 'Noise cancellation on: steady background noise is reduced' : 'Noise cancellation off');
              setState(() {});
            }),
            if (phase == Phase.ready) ...[
              const SizedBox(width: 6),
              _chip(hasMusic ? 'Music' : 'Add music', Icons.queue_music, hasMusic, openMusic),
            ],
          ]),
        ),
        const SizedBox(height: 8),
      ],
      Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
        SizedBox(width: 72, child: _leftAction()),
        _recButton(),
        SizedBox(width: 72, child: focus ? const SizedBox() : _rightAction()),
      ]),
    ]);
  }

  Widget _sideControls() => Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        if (!focus) ...[
          _rightAction(),
          const SizedBox(height: 14),
        ],
        _recButton(),
        const SizedBox(height: 14),
        _leftAction(),
        if (!focus) ...[
          const SizedBox(height: 10),
          IconButton(
            onPressed: () => setState(() => scrollPaused = !scrollPaused),
            icon: Icon(scrollPaused ? Icons.play_circle_outline : Icons.pause_circle_outline),
            tooltip: 'Pause scrolling',
          ),
          IconButton(onPressed: it.body.trim().isEmpty ? null : jumpSheet, icon: const Icon(Icons.format_list_numbered), tooltip: 'Jump to a line'),
        ],
      ]);

  Widget _leftAction() {
    if (recordingNow) return _round(phase == Phase.paused ? Icons.play_arrow : Icons.pause, phase == Phase.paused ? resumeTake : pauseTake, phase == Phase.paused ? 'Resume' : 'Pause');
    if (phase == Phase.ready) return _round(rehearsing ? Icons.stop : Icons.play_arrow, toggleRehearse, rehearsing ? 'Stop' : 'Rehearse');
    return const SizedBox();
  }

  Widget _rightAction() {
    if (recordingNow) {
      return _round(Icons.delete_outline, () async {
        if (phase == Phase.recording) await pauseTake();
        if (!mounted) return;
        if (await confirm(context, 'Discard this take?', 'The recording will be deleted.', 'Discard', danger: true)) {
          stopTake(discard: true);
        }
      }, 'Discard');
    }
    if (phase == Phase.ready) return _round(Icons.replay, restart, 'Restart');
    return const SizedBox();
  }

  Widget _seekBar() => ValueListenableBuilder<double>(
        valueListenable: clockT,
        builder: (_, t, __) {
          final a = regionStart, b = regionEnd > a ? regionEnd : a + 1;
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(children: [
              SizedBox(width: 44, child: Text(fmtTime((seekDrag ?? t) - a), style: const TextStyle(color: Colors.white70, fontSize: 12.5, fontFeatures: [FontFeature.tabularFigures()]))),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(trackHeight: 3, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6)),
                  child: Slider(
                    value: (seekDrag ?? t).clamp(a, b),
                    min: a,
                    max: b,
                    onChanged: (v) => setState(() => seekDrag = v),
                    onChangeEnd: (v) {
                      e.seek(v);
                      setState(() => seekDrag = null);
                    },
                  ),
                ),
              ),
              SizedBox(
                width: 54,
                child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                  if (ms.loop) const Padding(padding: EdgeInsets.only(right: 3), child: Icon(Icons.repeat, size: 13, color: Colors.white70)),
                  Text(fmtTime(b - a), style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
                ]),
              ),
            ]),
          );
        },
      );

  Widget _chip(String label, IconData icon, bool on, VoidCallback onTap) => Material(
        color: on ? Colors.white : Colors.black45,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 15, color: on ? Colors.black : Colors.white),
              const SizedBox(width: 5),
              Text(label, style: TextStyle(color: on ? Colors.black : Colors.white, fontSize: 12.5, fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      );

  Widget _round(IconData icon, VoidCallback onTap, String label) => Column(mainAxisSize: MainAxisSize.min, children: [
        IconButton.filled(
          onPressed: onTap,
          style: IconButton.styleFrom(backgroundColor: Colors.white24, foregroundColor: Colors.white, fixedSize: const Size(52, 52)),
          icon: Icon(icon),
        ),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(fontSize: 11.5, color: Colors.white70)),
      ]);

  Widget _recButton() {
    final enabled = phase == Phase.ready || recordingNow || phase == Phase.countdown;
    return GestureDetector(
      onTap: !enabled
          ? null
          : () {
              if (phase == Phase.ready) {
                startTake();
              } else if (phase == Phase.countdown) {
                _cancelCountdown();
              } else {
                stopTake();
              }
            },
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 4)),
          alignment: Alignment.center,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            width: recordingNow ? 30 : 60,
            height: recordingNow ? 30 : 60,
            decoration: BoxDecoration(color: C.hot, borderRadius: BorderRadius.circular(recordingNow ? 8 : 40)),
          ),
        ),
        const SizedBox(height: 4),
        Text(recordingNow ? 'Stop' : phase == Phase.countdown ? 'Cancel' : 'Record', style: const TextStyle(fontSize: 11.5, color: Colors.white70)),
      ]),
    );
  }
}

class _Badge extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Badge(this.icon, this.text);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(99)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: Colors.white),
          const SizedBox(width: 6),
          Text(text, style: const TextStyle(fontSize: 12.5)),
        ]),
      );
}
