// Dart facade for the native audio engine (C++ via Kotlin; see native/).
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class EngineState {
  final double pos, duration, micDb;
  final bool playing, recording;
  const EngineState(this.pos, this.playing, this.duration, this.micDb, this.recording);
  static const zero = EngineState(0, false, 0, -90, false);
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

/// How a take is captured (see the web app's rec.js for the reasoning).
enum RecMode { mic, acoustic, mix, mixAec }

class TakeResult {
  final double seconds, musicOffset, underrunSec, dropSec;
  final int outXruns, inXruns;
  TakeResult(List<dynamic> v)
      : seconds = (v[0] as num).toDouble(),
        musicOffset = (v[1] as num).toDouble(),
        underrunSec = (v[2] as num).toDouble(),
        dropSec = (v[3] as num).toDouble(),
        outXruns = (v[4] as num).toInt(),
        inXruns = (v[5] as num).toInt();
  bool get struggled => underrunSec > 0.3 || outXruns > 20;
  Map<String, dynamic> toJson() => {
        'seconds': seconds,
        'musicOffset': musicOffset,
        'underrun': underrunSec,
        'drop': dropSec,
        'outXruns': outXruns,
        'inXruns': inXruns,
      };
}

class Engine extends ChangeNotifier {
  Engine._() {
    _route.receiveBroadcastStream().listen((e) {
      route = AudioRoute.from(e);
      notifyListeners();
    }, onError: (_) {});
  }
  static final Engine i = Engine._();
  static const _ch = MethodChannel('lectern/engine');
  static const _route = EventChannel('lectern/route');

  String? loadedKey;
  double duration = 0;
  bool loading = false;
  double rate = 1;
  double volume = 0.8;
  AudioRoute route = AudioRoute.speaker;
  EngineState last = EngineState.zero;

  // smoothed position for drawing lyrics (glides over tiny jumps, takes big ones at once)
  double _vt = 0;
  int _vw = 0;

  Future<void> start() async {
    try {
      await _ch.invokeMethod('start');
      await refreshRoute();
    } catch (e) {
      debugPrint('engine start: $e');
    }
  }

  /// Loads a track once; key identifies it (asset path, file path or URL).
  Future<bool> load({String? asset, String? path, String? url}) async {
    final key = asset ?? path ?? url;
    if (key == null) return false;
    if (loadedKey == key && duration > 0) return true;
    loading = true;
    notifyListeners();
    try {
      final r = await _ch.invokeMapMethod<String, dynamic>('load', {'asset': asset, 'path': path, 'url': url});
      duration = (r?['duration'] as num?)?.toDouble() ?? 0;
      loadedKey = key;
      return duration > 0;
    } catch (e) {
      debugPrint('load failed: $e');
      loadedKey = null;
      duration = 0;
      return false;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> unload() async {
    loadedKey = null;
    duration = 0;
    await _ch.invokeMethod('unload');
  }

  Future<void> play() => _ch.invokeMethod('play');
  Future<void> pause() => _ch.invokeMethod('pause');
  Future<void> seek(double sec) {
    _vt = sec;
    return _ch.invokeMethod('seek', {'sec': sec.toDouble()});
  }

  Future<void> setRate(double r) {
    rate = r;
    return _ch.invokeMethod('rate', {'rate': r.toDouble()});
  }

  Future<void> setVolume(double v) {
    volume = v;
    return _ch.invokeMethod('volume', {'v': v.toDouble()});
  }

  Future<EngineState> state() async {
    try {
      final v = await _ch.invokeListMethod<dynamic>('state');
      if (v == null || v.length < 5) return last;
      last = EngineState((v[0] as num).toDouble(), (v[1] as num) > 0.5, (v[2] as num).toDouble(), (v[3] as num).toDouble(), (v[4] as num) > 0.5);
    } catch (_) {}
    return last;
  }

  /// Visual time: follows the audio clock but never jumps backwards or skips on jitter.
  double visualTime(EngineState s) {
    final now = DateTime.now().microsecondsSinceEpoch;
    if (!s.playing) {
      _vt = s.pos;
      _vw = now;
      return s.pos;
    }
    final dt = ((now - _vw) / 1e6).clamp(0.0, 0.25);
    _vw = now;
    var v = _vt + dt * rate;
    final err = s.pos - v;
    if (err.abs() > 0.6) {
      v = s.pos;
    } else {
      v += err * (dt * 6).clamp(0.0, 1.0);
    }
    _vt = v;
    return v;
  }

  // ---------------------------------------------------------------- recording
  Future<Map<String, dynamic>> openMic({required RecMode mode, bool nc = false, double gainDb = 0, int preset = 0, int deviceId = 0}) async {
    final s = await _ch.invokeMethod<String>('openMic', {
      'mode': mode.index,
      'nc': nc,
      'gainDb': gainDb.toDouble(),
      'preset': preset,
      'deviceId': deviceId,
    });
    try {
      return Map<String, dynamic>.from(jsonDecode(s ?? '{}') as Map);
    } catch (_) {
      return {'ok': false};
    }
  }

  Future<void> closeMic() => _ch.invokeMethod('closeMic');
  Future<bool> startRecord(String mix, String stem) async => (await _ch.invokeMethod<bool>('startRecord', {'mix': mix, 'stem': stem})) ?? false;
  Future<void> pauseRecord(bool paused) => _ch.invokeMethod('pauseRecord', {'paused': paused});
  Future<TakeResult> stopRecord() async => TakeResult((await _ch.invokeListMethod<dynamic>('stopRecord'))!);
  Future<void> setNC(bool on) => _ch.invokeMethod('nc', {'on': on});
  Future<void> setMicGain(double db) => _ch.invokeMethod('micGain', {'db': db.toDouble()});
  Future<double> outputLatency() async => (await _ch.invokeMethod<double>('outputLatency')) ?? 0;

  Future<double> mux({required String video, required String audio, required String out, double? offset, int rate = 48000}) async {
    final r = await _ch.invokeMapMethod<String, dynamic>('mux', {'video': video, 'audio': audio, 'out': out, 'offset': offset, 'rate': rate});
    return (r?['offset'] as num?)?.toDouble() ?? 0;
  }

  Future<void> wavToM4a(String wav, String out) => _ch.invokeMethod('wavToM4a', {'wav': wav, 'out': out});
  Future<String?> saveToGallery(String path, String name) => _ch.invokeMethod<String>('saveToGallery', {'path': path, 'name': name});

  Future<AudioRoute> refreshRoute() async {
    try {
      route = AudioRoute.from(await _ch.invokeMethod('route'));
      notifyListeners();
    } catch (_) {}
    return route;
  }

  Future<void> preferMic(String mic) => _ch.invokeMethod('preferMic', {'mic': mic});

  // ---------------------------------------------------------------- system helpers
  Future<bool> requestPermissions(List<String> perms) async => (await _ch.invokeMethod<bool>('permissions', {'perms': perms})) ?? false;
  Future<void> keepAwake(bool on) => _ch.invokeMethod('keepAwake', {'on': on});

  /// Opens the system file picker; the chosen file is copied into the app and its path returned.
  Future<Map<String, dynamic>?> pickFile(String mime) => _ch.invokeMapMethod<String, dynamic>('pickFile', {'mime': mime});
}

