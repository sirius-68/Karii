// Dart facade for the native audio engine (C++ via Kotlin; see native/).
// The playback clock is read synchronously through dart:ffi every frame: it is the hardware
// presentation clock of the audio output, so the teleprompter and recordings follow exactly what the listener hears.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class EngineState {
  final double pos, duration, micDb;
  final bool playing, recording;
  const EngineState(this.pos, this.playing, this.duration, this.micDb, this.recording);
  static const zero = EngineState(0, false, 0, -90, false);
}

/// Direct, synchronous access to the C++ engine's clock (no platform-channel round trip).
class NativeClock {
  NativeClock._() {
    if (!Platform.isAndroid) return;
    try {
      final l = DynamicLibrary.open('liblectern.so');
      _pos = l.lookupFunction<Double Function(), double Function()>('lectern_position');
      _dur = l.lookupFunction<Double Function(), double Function()>('lectern_duration');
      _playing = l.lookupFunction<Int32 Function(), int Function()>('lectern_playing');
      _rec = l.lookupFunction<Int32 Function(), int Function()>('lectern_recording');
      _mic = l.lookupFunction<Double Function(), double Function()>('lectern_mic_db');
      _mono = l.lookupFunction<Int64 Function(), int Function()>('lectern_mono_ns');
      ok = true;
    } catch (e) {
      debugPrint('native clock unavailable: $e');
    }
  }
  static final NativeClock i = NativeClock._();
  bool ok = false;
  double Function()? _pos, _dur, _mic;
  int Function()? _playing, _rec, _mono;

  double get position => _pos?.call() ?? 0;
  double get duration => _dur?.call() ?? 0;
  bool get playing => (_playing?.call() ?? 0) != 0;
  bool get recording => (_rec?.call() ?? 0) != 0;
  double get micDb => _mic?.call() ?? -90;
  int get monoNs => _mono?.call() ?? DateTime.now().microsecondsSinceEpoch * 1000;
  EngineState get state => EngineState(position, playing, duration, micDb, recording);
}

class AudioRoute {
  final String output, name;
  final List<Map<String, dynamic>> inputs;
  final bool musicActive;
  const AudioRoute(this.output, this.name, this.inputs, this.musicActive);
  bool get headphones => output != 'speaker';
  static const speaker = AudioRoute('speaker', '', [], false);
  static AudioRoute from(dynamic m) {
    if (m is! Map) return speaker;
    return AudioRoute(
      '${m['output'] ?? 'speaker'}',
      '${m['name'] ?? ''}',
      ((m['inputs'] as List?) ?? []).map((e) => (e as Map).cast<String, dynamic>()).toList(),
      m['musicActive'] == true,
    );
  }

  String get label => const {
        'speaker': 'Phone speaker',
        'wired': 'Wired headphones',
        'usb': 'USB audio',
        'bluetooth': 'Bluetooth',
        'hdmi': 'HDMI',
      }[output] ??
      'Phone speaker';
}

/// How a take is captured.
///  mic: the microphone only (no music, or music the user doesn't want in the take)
///  acoustic: the mic hears the music from the phone speaker (natural room sound)
///  mix: headphones; the voice is recorded alone and the music is mixed in cleanly
///  mixAec: speaker with echo cancellation, then a clean mix
enum RecMode { mic, acoustic, mix, mixAec }

class RecResult {
  final double seconds, rate, gapSec, lostSec;
  final int firstCaptureNs, lastCaptureNs, musicJumps, outXruns, inXruns;
  final bool hasMusic;
  RecResult(List<dynamic> v)
      : seconds = (v[0] as num).toDouble(),
        rate = (v[1] as num).toDouble(),
        firstCaptureNs = (v[2] as num).toInt(),
        lastCaptureNs = (v[3] as num).toInt(),
        gapSec = (v[4] as num).toDouble(),
        lostSec = (v[5] as num).toDouble(),
        musicJumps = (v[6] as num).toInt(),
        hasMusic = (v[7] as num) > 0.5,
        outXruns = (v[8] as num).toInt(),
        inXruns = (v[9] as num).toInt();
  bool get struggled => gapSec > 0.25 || lostSec > 0;
  Map<String, dynamic> toJson() => {
        'seconds': seconds,
        'rate': rate,
        'gap': gapSec,
        'lost': lostSec,
        'jumps': musicJumps,
        'outXruns': outXruns,
        'inXruns': inXruns,
      };
}

class TakeMix {
  final double offset, lufs, truePeak, voiceLufs, musicLufs, gain, seconds, duckMin;
  final bool hasVideo; // the finished file has the camera's picture
  final String? videoProblem; // why the picture couldn't be used
  TakeMix(Map m)
      : offset = (m['offset'] as num?)?.toDouble() ?? 0,
        lufs = (m['lufs'] as num?)?.toDouble() ?? -120,
        truePeak = (m['truePeak'] as num?)?.toDouble() ?? -120,
        voiceLufs = (m['voiceLufs'] as num?)?.toDouble() ?? -120,
        musicLufs = (m['musicLufs'] as num?)?.toDouble() ?? -120,
        gain = (m['gain'] as num?)?.toDouble() ?? 0,
        seconds = (m['seconds'] as num?)?.toDouble() ?? 0,
        duckMin = (m['duckMin'] as num?)?.toDouble() ?? 0,
        hasVideo = m['hasVideo'] != false,
        videoProblem = m['videoProblem'] as String?;
  Map<String, dynamic> toJson() => {'offset': offset, 'lufs': lufs, 'truePeak': truePeak, 'voiceLufs': voiceLufs, 'musicLufs': musicLufs, 'gain': gain};
}

class Engine extends ChangeNotifier {
  Engine._() {
    _route.receiveBroadcastStream().listen((e) {
      if (e is Map && e['event'] != null) {
        _events.add('${e['event']}');
        return;
      }
      route = AudioRoute.from(e);
      notifyListeners();
    }, onError: (_) {});
  }
  static final Engine i = Engine._();
  static const _ch = MethodChannel('lectern/engine');
  static const _route = EventChannel('lectern/route');
  final _events = StreamController<String>.broadcast();

  /// "interrupted" (a call or another app took the audio) and "resumed".
  Stream<String> get audioEvents => _events.stream;

  String? loadedKey;
  double duration = 0;
  bool loading = false;
  double rate = 1;
  double volume = 0.8;
  AudioRoute route = AudioRoute.speaker;
  int _loadSeq = 0;

  NativeClock get clock => NativeClock.i;

  Future<void> start() async {
    try {
      await _ch.invokeMethod('start');
      await refreshRoute();
    } catch (e) {
      debugPrint('engine start: $e');
    }
  }

  /// Loads a track once; key identifies it (asset path, file path or URL). Only the newest
  /// request wins, so a slow decode can never replace a song that was asked for later.
  Future<bool> load({String? asset, String? path, String? url}) async {
    final key = asset ?? path ?? url;
    if (key == null) return false;
    if (loadedKey == key && duration > 0 && clock.duration > 0) {
      // already loaded: start from the whole track again (a project may have trimmed it)
      await setMusic();
      return true;
    }
    final seq = ++_loadSeq;
    loading = true;
    notifyListeners();
    try {
      final r = await _ch.invokeMapMethod<String, dynamic>('load', {'asset': asset, 'path': path, 'url': url});
      if (seq != _loadSeq || r?['stale'] == true) return false;
      duration = (r?['duration'] as num?)?.toDouble() ?? 0;
      loadedKey = key;
      return duration > 0;
    } catch (e) {
      debugPrint('load failed: $e');
      if (seq == _loadSeq) {
        loadedKey = null;
        duration = 0;
      }
      return false;
    } finally {
      if (seq == _loadSeq) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> unload() async {
    _loadSeq++;
    loadedKey = null;
    duration = 0;
    await _ch.invokeMethod('unload');
  }

  Future<void> play() => _ch.invokeMethod('play');
  Future<void> pause() => _ch.invokeMethod('pause');
  Future<void> seek(double sec) => _ch.invokeMethod('seek', {'sec': sec.toDouble()});

  Future<void> setRate(double r) {
    rate = r;
    return _ch.invokeMethod('rate', {'rate': r.toDouble()});
  }

  Future<void> setVolume(double v) {
    volume = v;
    return _ch.invokeMethod('volume', {'v': v.toDouble()});
  }

  /// Background-music playback: only [start, end) of the track plays (end 0 = to the end),
  /// optionally looping with a click-free seam, with a fade-in at the start and a fade-out at
  /// the end of a non-looping region. The playback clock follows the loop.
  Future<void> setMusic({double start = 0, double end = 0, bool loop = false, double fadeIn = 0, double fadeOut = 0}) =>
      _ch.invokeMethod('music', {'start': start.toDouble(), 'end': end.toDouble(), 'loop': loop, 'fadeIn': fadeIn.toDouble(), 'fadeOut': fadeOut.toDouble()});

  /// Current state, read synchronously from the engine (falls back to the platform channel).
  Future<EngineState> state() async {
    if (clock.ok) return clock.state;
    try {
      final v = await _ch.invokeListMethod<dynamic>('state');
      if (v == null || v.length < 5) return EngineState.zero;
      return EngineState((v[0] as num).toDouble(), (v[1] as num) > 0.5, (v[2] as num).toDouble(), (v[3] as num).toDouble(), (v[4] as num) > 0.5);
    } catch (_) {
      return EngineState.zero;
    }
  }

  // ---------------------------------------------------------------- recording
  Future<Map<String, dynamic>> openMic({required RecMode mode, bool nc = false, double gainDb = 0}) async {
    final s = await _ch.invokeMethod<String>('openMic', {'mode': mode.index, 'nc': nc, 'gainDb': gainDb.toDouble(), 'preset': 0, 'deviceId': 0});
    try {
      return Map<String, dynamic>.from(jsonDecode(s ?? '{}') as Map);
    } catch (_) {
      return {'ok': false};
    }
  }

  Future<void> closeMic() => _ch.invokeMethod('closeMic');

  /// Records the voice to [voice] (32-bit float WAV) and, for clean mixes, the music the singer
  /// heard to [music], sample-aligned with the voice.
  Future<bool> startRecord(String voice, {String music = ''}) async => (await _ch.invokeMethod<bool>('startRecord', {'voice': voice, 'music': music})) ?? false;
  Future<void> pauseRecord(bool paused) => _ch.invokeMethod('pauseRecord', {'paused': paused});
  Future<RecResult> stopRecord() async => RecResult((await _ch.invokeListMethod<dynamic>('stopRecord'))!);
  Future<void> setNC(bool on) => _ch.invokeMethod('nc', {'on': on});
  Future<void> setMicGain(double db) => _ch.invokeMethod('micGain', {'db': db.toDouble()});

  /// Mixes a take with loudness normalisation (-14 LUFS, -1 dBTP) and puts it into the video
  /// (or an .m4a when there is no video). [offset] null = line up video and audio from the
  /// measured stop times.
  Future<TakeMix> finishTake({
    required String voice,
    String? music,
    required int mode,
    required String wav,
    required String out,
    String? video,
    double? offset,
    int? videoStopNs,
    int? audioEndNs,
    double balance = 0,
    double fadeIn = 0,
    double fadeOut = 0,
    double duckDb = 0,
  }) async {
    final r = await _ch.invokeMapMethod<String, dynamic>('finishTake', {
      'voice': voice,
      'music': music ?? '',
      'mode': mode,
      'wav': wav,
      'out': out,
      'video': video,
      'offset': offset,
      'videoStopNs': videoStopNs,
      'audioEndNs': audioEndNs,
      'balance': balance,
      'fadeIn': fadeIn,
      'fadeOut': fadeOut,
      'duckDb': duckDb,
    });
    return TakeMix(r ?? {});
  }

  /// What a recorded video contains (size, rotation, brightness of the picture) and a poster
  /// frame written to [thumb].
  Future<Map<String, dynamic>> videoInfo(String path, {String? thumb}) async =>
      (await _ch.invokeMapMethod<String, dynamic>('videoInfo', {'path': path, 'thumb': thumb})) ?? {};

  Future<void> wavToM4a(String wav, String out) => _ch.invokeMethod('wavToM4a', {'wav': wav, 'out': out});
  Future<String?> saveToGallery(String path, String name) => _ch.invokeMethod<String>('saveToGallery', {'path': path, 'name': name});

  Future<AudioRoute> refreshRoute() async {
    try {
      route = AudioRoute.from(await _ch.invokeMethod('route'));
      notifyListeners();
    } catch (_) {}
    return route;
  }

  // ---------------------------------------------------------------- system helpers
  Future<bool> requestPermissions(List<String> perms) async => (await _ch.invokeMethod<bool>('permissions', {'perms': perms})) ?? false;
  Future<void> keepAwake(bool on) => _ch.invokeMethod('keepAwake', {'on': on});

  /// Opens the system file picker; the chosen file is copied into the app and its path returned.
  Future<Map<String, dynamic>?> pickFile(String mime) => _ch.invokeMapMethod<String, dynamic>('pickFile', {'mime': mime});
}
