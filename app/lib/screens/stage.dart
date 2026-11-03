// The stage: camera, lyrics (karaoke or teleprompter), music, and recording a take.
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
import '../engine/engine.dart';
import '../lyrics/karaoke.dart';
import '../widgets/job_pill.dart';
import '../lyrics/timing.dart';
import '../widgets/ui.dart';
import 'take_editor.dart';

enum Phase { loading, ready, countdown, recording, paused, saving }

class StageScreen extends StatefulWidget {
  final Item item;
  const StageScreen({super.key, required this.item});
  @override
  State<StageScreen> createState() => _StageScreenState();
}

class _StageScreenState extends State<StageScreen> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  Item get it => widget.item;
  bool get song => it.kind == Kind.song;
  Engine get e => Engine.i;
  Store get st => Store.i;

  CameraController? cam;
  List<CameraDescription> cams = [];
  String? camErr;
  bool camOn = true;
  bool camBusy = false;

  Phase phase = Phase.loading;
  MusicSource music = MusicSource.empty;
  bool hasMusic = false;
  LyricTrack lyr = LyricTrack.empty;
  late final Ticker _ticker;
  bool _polling = false;
  // the audio clock (seconds into the song the listener hears now), updated every frame;
  // only the widgets that depend on it rebuild
  final ValueNotifier<double> clockT = ValueNotifier(0);
  double get t => clockT.value;
  double _lastPos = 0;
  Duration _lastHeader = Duration.zero;
  StreamSubscription<String>? _audioEv;
  double dur = 0, micDb = -90;
  bool playing = false;
  int count = 0;
  Timer? _countT;
  double? seekDrag;

  // teleprompter
  final ScrollController scroll = ScrollController();
  bool prompting = false;
  Duration _lastTick = Duration.zero;

  // take
  final Stopwatch watch = Stopwatch();
  String? takeId, voicePath, musicPath;
  int engineRate = 48000;
  RecMode mode = RecMode.mic;
  bool videoRecording = false;

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
      } else if (phase == Phase.ready && playing) {
        e.pause();
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
    if (!micOk && mounted) toast(context, 'Lectern needs the microphone to record. You can still practise.');
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
    if (song) {
      music = musicFor(it, guide: st.s<bool>('guide') && hasGuide(it));
    } else {
      final bedId = st.settings['bed'] as String?;
      final bed = bedId != null ? st.find(bedId) : null;
      music = bed != null ? instSource(bed) : MusicSource.empty;
    }
    hasMusic = false;
    if (!music.none) {
      final ok = await e.load(asset: music.asset, path: music.path, url: music.url);
      if (ok) {
        hasMusic = true;
        dur = e.duration;
        await e.pause();
        await e.seek(0);
        await e.setRate(1);
        await e.setVolume(song ? st.sd('karVol') : st.sd('bedVol') / 100);
      } else if (mounted) {
        toast(context, 'Couldn’t load the music${music.url != null ? '. Are you online?' : '.'}');
      }
    } else {
      await e.unload();
    }
    if (song) {
      // all lyric sources become one normalised track; stale timing is re-aligned first
      lyr = LyricTrack.of(it, dur > 0 ? dur : it.dur);
      if (!it.isCat) st.save();
    }
    clockT.value = 0;
    _lastPos = 0;
  }

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
        await c.lockCaptureOrientation(DeviceOrientation.portraitUp);
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
    if (cam == null || phase == Phase.recording || phase == Phase.paused) return;
    final now = cam!.description.lensDirection;
    final next = now == CameraLensDirection.front ? CameraLensDirection.back : CameraLensDirection.front;
    st.set('facing', next == CameraLensDirection.back ? 'back' : 'front');
    await _initCam(dir: next);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.inactive || s == AppLifecycleState.paused) {
      if (phase == Phase.recording) {
        pauseTake();
      } else if (phase == Phase.countdown) {
        _cancelCountdown();
      } else if (phase == Phase.ready) {
        e.pause();
        prompting = false;
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
    if (!song && (prompting || phase == Phase.recording) && scroll.hasClients) {
      final pxs = st.sd('speed') * 9;
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
    // The position is the audio hardware clock: no smoothing, no timers. Only sub-frame jitter
    // from a fresh hardware timestamp is held back so a word never flickers backwards.
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
    if (s.duration > 0 && (s.duration - dur).abs() > 0.01) {
      dur = s.duration;
      rebuild = true;
    }
    if ((phase == Phase.recording || phase == Phase.paused) && elapsed - _lastHeader > const Duration(milliseconds: 200)) {
      _lastHeader = elapsed;
      rebuild = true;  // recording time and level meter
    }
    if (rebuild && mounted) setState(() {});
    // the song finished: end the take
    if (phase == Phase.recording && hasMusic && song && !s.playing && dur > 0 && s.pos >= dur - 0.35) stopTake();
  }

  // ------------------------------------------------------------------ practice
  Future<void> togglePractice() async {
    if (phase != Phase.ready) return;
    final on = song ? !playing : !prompting;
    if (!song) setState(() => prompting = on);
    if (hasMusic) {
      if (on) {
        if (dur > 0 && t >= dur - 0.5) await e.seek(0);
        await e.play();
      } else {
        await e.pause();
      }
    }
  }

  Future<void> restart() async {
    if (phase != Phase.ready) return;
    await e.seek(0);
    if (scroll.hasClients) scroll.jumpTo(0);
    _lastPos = 0;
    clockT.value = 0;
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
    prompting = false;
    await e.pause();
    await e.seek(0);
    _lastPos = 0;
    if (scroll.hasClients) scroll.jumpTo(0);
    mode = _plan();
    final r = await e.openMic(mode: mode, nc: st.s<bool>('noiseCancel'), gainDb: st.sd('micGain'));
    if (r['ok'] != true) {
      if (mounted) toast(context, 'The microphone couldn’t start. Close other apps using it and try again.');
      return;
    }
    engineRate = (r['rate'] as num?)?.toInt() ?? 48000;
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
    // clean mixes keep the music the singer heard, sample-aligned with the voice
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
    if (mounted) setState(() => phase = Phase.recording);
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
    if (phase != Phase.recording && phase != Phase.paused) return;
    setState(() => phase = Phase.saving);
    watch.stop();
    // stop the camera and the mic together and note when each stopped, so the two can be lined
    // up exactly (the mic's last sample has a hardware capture time)
    final videoStopNs = e.clock.monoNs;
    final fv = videoRecording ? cam!.stopVideoRecording().then<XFile?>((x) => x, onError: (err) {
      debugPrint('video stop: $err');
      return null;
    }) : Future<XFile?>.value(null);
    final fa = e.stopRecord();
    final res = await fa;
    final vf = await fv;
    if (hasMusic) await e.pause();
    await e.closeMic();
    if (discard) {
      for (final p in [voicePath, musicPath, vf?.path]) {
        if (p != null) _rm(p);
      }
      if (mounted) setState(() => phase = Phase.ready);
      await e.seek(0);
      return;
    }
    final video = vf != null;
    final out = st.mediaPath(video ? 'take-$takeId.mp4' : 'take-$takeId.m4a');
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
      'voice': voicePath,
      'music': musicPath,
      'raw': vf?.path,
      'dur': res.seconds,
      'created': DateTime.now().millisecondsSinceEpoch,
      'meta': {
        'mode': mode.name,
        'modeIndex': mode.index,
        'route': e.route.label,
        'nc': st.s<bool>('noiseCancel'),
        'offset': mix.offset,
        'mix': mix.toJson(),
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
    if (phase == Phase.recording || phase == Phase.paused || phase == Phase.countdown) e.closeMic();
    clockT.dispose();
    e.pause();
    e.keepAwake(false);
    cam?.dispose();
    scroll.dispose();
    SystemChrome.setPreferredOrientations([]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  // ------------------------------------------------------------------ sheets
  void tune() {
    sheet(
      context,
      (c) => StatefulBuilder(builder: (c, set) {
        void upd(String k, dynamic v) {
          st.set(k, v);
          set(() {});
          setState(() {});
        }

        return SafeArea(
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), children: [
            const Text('Tune', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            _label('Text size', '${st.sd('textSize').round()}'),
            Slider(value: st.sd('textSize').clamp(20.0, 60.0), min: 20, max: 60, onChanged: (v) => upd('textSize', v)),
            if (!song) ...[
              _label('Scroll speed', '${st.s<int>('speed')}'),
              Slider(value: st.s<int>('speed').toDouble(), min: 1, max: 20, divisions: 19, onChanged: (v) => upd('speed', v.round())),
            ],
            if (song) ...[
              _label('Lyrics timing', '${it.offset >= 0 ? '+' : ''}${it.offset.toStringAsFixed(1)} s'),
              Row(children: [
                Expanded(child: OutlinedButton(onPressed: () => set(() => it.offset = (it.offset - 0.1)), child: const Text('Earlier'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(onPressed: () => set(() => it.offset = 0), child: const Text('Reset'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton(onPressed: () => set(() => it.offset = (it.offset + 0.1)), child: const Text('Later'))),
              ]),
              if (hasGuide(it))
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Guide melody'),
                  subtitle: const Text('Play the arrangement with the tune on top', style: TextStyle(color: C.muted)),
                  value: st.s<bool>('guide'),
                  onChanged: phase == Phase.ready
                      ? (v) async {
                          upd('guide', v);
                          await _loadMusic();
                          if (mounted) setState(() {});
                        }
                      : null,
                ),
            ],
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show lyrics over the camera'),
              value: st.s<bool>('lyrShow'),
              onChanged: (v) => upd('lyrShow', v),
            ),
            _label('Countdown', '${st.s<int>('countdown')} s'),
            Wrap(spacing: 8, children: [
              for (final v in const [0, 3, 5, 10]) Pill(v == 0 ? 'Off' : '$v s', selected: st.s<int>('countdown') == v, onTap: () => upd('countdown', v)),
            ]),
            const SizedBox(height: 12),
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
            if (hasMusic) ...[
              _label('Music on the phone speaker', ''),
              const Text('Used when no headphones are connected.', style: TextStyle(color: C.muted, fontSize: 13)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                Pill('Record the room', selected: st.s<String>('speakerMusic') != 'clean', onTap: () => upd('speakerMusic', 'acoustic')),
                Pill('Clean mix (echo cancel)', selected: st.s<String>('speakerMusic') == 'clean', onTap: () => upd('speakerMusic', 'clean')),
              ]),
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('With headphones, Lectern always records your voice and mixes the music in cleanly.', style: TextStyle(color: C.faint, fontSize: 12.5)),
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

  void pickBed() {
    actionSheet(context, 'Music bed', [
      SheetAction(Icons.music_off_outlined, 'No music', () async {
        st.set('bed', null);
        await _loadMusic();
        if (mounted) setState(() {});
      }),
      for (final x in instruments())
        SheetAction(st.settings['bed'] == x.id ? Icons.check : Icons.graphic_eq, x.title, () async {
          st.set('bed', x.id);
          await _loadMusic();
          if (mounted) setState(() {});
        }, sub: [if (!x.isCat) 'Yours', if (x.dur > 0) fmtTime(x.dur)].join(' · ')),
    ]);
  }

  // ------------------------------------------------------------------ UI
  bool get busy => phase == Phase.recording || phase == Phase.paused || phase == Phase.countdown || phase == Phase.saving;

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
    final pad = MediaQuery.of(context).padding;
    return PopScope(
      canPop: !busy,
      onPopInvokedWithResult: (did, _) {
        if (!did && phase != Phase.saving) _askLeave();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(fit: StackFit.expand, children: [
          _background(),
          // dim the camera under the text
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x99000000), Color(0x22000000), Color(0x22000000), Color(0xCC000000)], stops: [0, 0.25, 0.55, 1]),
            ),
          ),
          if (st.s<bool>('lyrShow') || cam == null) Positioned.fill(top: pad.top + 64, bottom: 210 + pad.bottom, child: song ? _karaoke() : _prompter()),
          Positioned(top: pad.top + 6, left: 8, right: 8, child: _topBar()),
          Positioned(left: 0, right: 0, bottom: pad.bottom + 12, child: _controls()),
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
                  Text(phase == Phase.saving ? 'Putting your take together…' : 'Getting the stage ready…', style: const TextStyle(color: Colors.white70)),
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
      final ps = c.value.previewSize;
      if (ps != null) {
        return ClipRect(
          child: FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(width: ps.height, height: ps.width, child: CameraPreview(c)),
          ),
        );
      }
      return CameraPreview(c);
    }
    return Cover.of(it, radius: 0);
  }

  Widget _topBar() {
    final rec = phase == Phase.recording || phase == Phase.paused;
    return Row(children: [
      IconButton(onPressed: () => busy ? _askLeave() : Navigator.maybePop(context), icon: const Icon(Icons.close)),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(it.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          if (rec)
            Row(children: [
              Icon(Icons.circle, size: 10, color: phase == Phase.recording ? C.hot : C.amber),
              const SizedBox(width: 6),
              Text('${phase == Phase.paused ? 'Paused · ' : ''}${fmtTime(watch.elapsedMilliseconds / 1000)}', style: const TextStyle(fontSize: 13, fontFeatures: [FontFeature.tabularFigures()])),
              const SizedBox(width: 10),
              _meter(),
            ])
          else
            AnimatedBuilder(
              animation: e,
              builder: (_, __) => Row(children: [
                Icon(e.route.headphones ? Icons.headphones : Icons.volume_up_outlined, size: 13, color: C.muted),
                const SizedBox(width: 5),
                Flexible(
                  child: Text(e.route.name.isNotEmpty ? e.route.name : e.route.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: C.muted, fontSize: 12.5)),
                ),
              ]),
            ),
        ]),
      ),
      if (cam != null && !busy) IconButton(onPressed: flipCam, icon: const Icon(Icons.cameraswitch_outlined), tooltip: 'Flip camera'),
      if (!busy) IconButton(onPressed: tune, icon: const Icon(Icons.tune), tooltip: 'Tune'),
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

  // ---- karaoke lyrics (rebuilt every frame from the audio clock; nothing else is)
  Widget _karaoke() {
    if (lyr.length == 0) return const SizedBox();
    return ValueListenableBuilder<double>(valueListenable: clockT, builder: (_, t, __) => _karaokeAt(t));
  }

  Widget _karaokeAt(double t) {
    final k = lyr;
    final f = k.at(t - it.offset);
    final size = st.sd('textSize');
    final base = TextStyle(fontSize: size, fontWeight: FontWeight.w800, height: 1.2, shadows: const [Shadow(blurRadius: 12, color: Colors.black87)]);
    final show = f.show < 0 ? 0 : f.show;
    // only the line actually being sung is lit; the upcoming line during intros and pauses is not
    final lit = !f.intro && f.show == f.line;
    Widget line(int i, {double scale = 0.62, double alpha = 0.55}) => i < 0 || i >= k.length
        ? SizedBox(height: size * scale * 1.3)
        : Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Text(k.lines[i].text, textAlign: TextAlign.center, style: base.copyWith(fontSize: size * scale, color: Colors.white.withValues(alpha: alpha))),
          );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        if (!k.synced) const Padding(padding: EdgeInsets.only(bottom: 10), child: Text('Lyrics aren’t synced yet, so they move evenly', style: TextStyle(color: C.amber, fontSize: 13))),
        line(show - 1, alpha: 0.35),
        const SizedBox(height: 8),
        if (f.hint != null) Text(f.hint!, style: const TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.w600)),
        if (f.dots > 0)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var d = 0; d < 3; d++) Container(margin: const EdgeInsets.all(4), width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: d < f.dots ? C.brand : Colors.white24)),
            ]),
          ),
        _kLine(k.lines[show], lit ? f.fill : const [], base, lit),
        const SizedBox(height: 12),
        line(show + 1, alpha: 0.6),
        line(show + 2, scale: 0.52, alpha: 0.35),
      ]),
    );
  }

  Widget _kLine(LLine l, List<double> fill, TextStyle base, bool active) {
    final space = (base.fontSize ?? 30) * 0.28;
    return Wrap(alignment: WrapAlignment.center, spacing: space, runSpacing: 2, children: [
      for (var i = 0; i < l.words.length; i++) _KWord(l.words[i].text, i < fill.length ? fill[i] : 0, base, active),
    ]);
  }

  // ---- teleprompter
  Widget _prompter() {
    final size = st.sd('textSize');
    final paras = it.body.split(RegExp(r'\n\s*\n'));
    return ShaderMask(
      shaderCallback: (r) => const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.white, Colors.white, Colors.transparent], stops: [0, 0.12, 0.85, 1]).createShader(r),
      blendMode: BlendMode.dstIn,
      child: ListView(controller: scroll, padding: EdgeInsets.fromLTRB(24, 120, 24, MediaQuery.of(context).size.height * 0.5), children: [
        for (final p in paras)
          Padding(
            padding: const EdgeInsets.only(bottom: 22),
            child: Text.rich(
              TextSpan(children: _directions(p.trim(), size)),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: size * 0.82, fontWeight: FontWeight.w700, height: 1.35, fontFamily: it.kind == Kind.poem ? 'serif' : null, shadows: const [Shadow(blurRadius: 10, color: Colors.black87)]),
            ),
          ),
      ]),
    );
  }

  // [stage directions] are shown smaller and dimmer
  List<InlineSpan> _directions(String p, double size) {
    final out = <InlineSpan>[];
    final re = RegExp(r'\[[^\]]*\]');
    var last = 0;
    for (final m in re.allMatches(p)) {
      if (m.start > last) out.add(TextSpan(text: p.substring(last, m.start)));
      out.add(TextSpan(text: m.group(0), style: TextStyle(fontSize: size * 0.5, color: C.amber, fontStyle: FontStyle.italic, fontWeight: FontWeight.w500)));
      last = m.end;
    }
    if (last < p.length) out.add(TextSpan(text: p.substring(last)));
    return out;
  }

  // ---- bottom controls
  Widget _controls() {
    final rec = phase == Phase.recording || phase == Phase.paused;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      if (hasMusic)
        ValueListenableBuilder<double>(
          valueListenable: clockT,
          builder: (_, t, __) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(children: [
            SizedBox(width: 44, child: Text(fmtTime(seekDrag ?? t), style: const TextStyle(color: Colors.white70, fontSize: 12.5, fontFeatures: [FontFeature.tabularFigures()]))),
            Expanded(
              child: SliderTheme(
                data: SliderTheme.of(context).copyWith(trackHeight: 3, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6)),
                child: Slider(
                  value: (seekDrag ?? t).clamp(0.0, dur > 0 ? dur : 1.0),
                  max: dur > 0 ? dur : 1,
                  onChanged: phase == Phase.ready ? (v) => setState(() => seekDrag = v) : null,
                  onChangeEnd: phase == Phase.ready
                      ? (v) {
                          e.seek(v);
                          setState(() => seekDrag = null);
                        }
                      : null,
                ),
              ),
            ),
            SizedBox(width: 44, child: Text(fmtTime(dur), textAlign: TextAlign.right, style: const TextStyle(color: Colors.white70, fontSize: 12.5))),
          ]),
        )),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(children: [
          if (hasMusic) ...[
            const Icon(Icons.music_note, size: 18, color: Colors.white70),
            Expanded(
              child: Slider(
                value: (song ? st.sd('karVol') : st.sd('bedVol') / 100).clamp(0.0, 1.0),
                onChanged: (v) {
                  e.setVolume(v);
                  if (song) {
                    st.settings['karVol'] = v;
                  } else {
                    st.settings['bedVol'] = (v * 100).round();
                  }
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
          if (!song && phase == Phase.ready) ...[
            const SizedBox(width: 6),
            _chip(hasMusic ? 'Music' : 'Add music', Icons.queue_music, hasMusic, pickBed),
          ],
        ]),
      ),
      const SizedBox(height: 10),
      Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
        SizedBox(
          width: 64,
          child: rec
              ? _round(phase == Phase.paused ? Icons.play_arrow : Icons.pause, phase == Phase.paused ? resumeTake : pauseTake, phase == Phase.paused ? 'Resume' : 'Pause')
              : (phase == Phase.ready ? _round(Icons.replay, restart, 'Restart') : const SizedBox()),
        ),
        _recButton(),
        SizedBox(
          width: 64,
          child: rec
              ? _round(Icons.delete_outline, () async {
                  if (phase == Phase.recording) await pauseTake();
                  if (!mounted) return;
                  if (await confirm(context, 'Discard this take?', 'The recording will be deleted.', 'Discard', danger: true)) {
                    stopTake(discard: true);
                  }
                }, 'Discard')
              : (phase == Phase.ready && (hasMusic || !song) ? _round(playing || prompting ? Icons.pause : Icons.play_arrow, togglePractice, 'Practise') : const SizedBox()),
        ),
      ]),
    ]);
  }

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
    final rec = phase == Phase.recording || phase == Phase.paused;
    final enabled = phase == Phase.ready || rec || phase == Phase.countdown;
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
          width: 84,
          height: 84,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 4)),
          alignment: Alignment.center,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            width: rec ? 32 : 64,
            height: rec ? 32 : 64,
            decoration: BoxDecoration(color: C.hot, borderRadius: BorderRadius.circular(rec ? 8 : 40)),
          ),
        ),
        const SizedBox(height: 4),
        Text(rec ? 'Stop' : phase == Phase.countdown ? 'Cancel' : 'Record', style: const TextStyle(fontSize: 11.5, color: Colors.white70)),
      ]),
    );
  }
}

/// One karaoke word, filled left to right as it is sung.
class _KWord extends StatelessWidget {
  final String word;
  final double fill;
  final TextStyle style;
  final bool active;
  const _KWord(this.word, this.fill, this.style, this.active);
  @override
  Widget build(BuildContext context) {
    final txt = Text(word, style: style.copyWith(color: Colors.white));
    if (!active || fill <= 0) return Opacity(opacity: active ? 1 : 0.92, child: txt);
    if (fill >= 1) return Text(word, style: style.copyWith(color: C.brand));
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (r) => LinearGradient(colors: const [C.brand, C.brand, Colors.white, Colors.white], stops: [0, fill, fill, 1]).createShader(r),
      child: txt,
    );
  }
}
