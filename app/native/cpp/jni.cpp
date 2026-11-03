// JNI bridge for com.lectern.lectern.NativeEngine (a Kotlin object), plus a small C API that
// Dart reads directly through dart:ffi for the per-frame playback clock (no platform-channel
// round trip, so the lyrics follow the audio clock exactly).
#include <jni.h>

#include <cmath>
#include <string>

#include "engine.h"

using lectern::Engine;

#define FN(name) Java_com_lectern_lectern_NativeEngine_##name
#define API extern "C" __attribute__((visibility("default"))) __attribute__((used))

static std::string str(JNIEnv* env, jstring s) {
  if (!s) return "";
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string r(c ? c : "");
  if (c) env->ReleaseStringUTFChars(s, c);
  return r;
}

// ---------------------------------------------------------------- dart:ffi
API void lectern_state(double* out8) { Engine::get().state(out8); }
API double lectern_position() { return Engine::get().position(); }
API double lectern_duration() { return Engine::get().duration(); }
API int32_t lectern_playing() { return Engine::get().playing() ? 1 : 0; }
API int32_t lectern_recording() { return Engine::get().recording() ? 1 : 0; }
API double lectern_mic_db() { return Engine::get().micLevelDb(); }
API int64_t lectern_mono_ns() { return lectern::monoNs(); }

extern "C" {

JNIEXPORT jboolean JNICALL FN(nativeStart)(JNIEnv*, jobject) { return Engine::get().start(); }
JNIEXPORT jint JNICALL FN(nativeSampleRate)(JNIEnv*, jobject) { return Engine::get().outputRate(); }

JNIEXPORT jboolean JNICALL FN(nativeLoad)(JNIEnv* env, jobject, jobject buf, jlong frames, jint channels, jint rate) {
  auto* p = static_cast<int16_t*>(env->GetDirectBufferAddress(buf));
  if (!p) return false;
  return Engine::get().loadPcm(p, frames, channels, rate);
}

JNIEXPORT void JNICALL FN(nativeUnload)(JNIEnv*, jobject) { Engine::get().unload(); }
JNIEXPORT void JNICALL FN(nativePlay)(JNIEnv*, jobject) { Engine::get().play(); }
JNIEXPORT void JNICALL FN(nativePause)(JNIEnv*, jobject) { Engine::get().pause(); }
JNIEXPORT void JNICALL FN(nativeSeek)(JNIEnv*, jobject, jdouble s) { Engine::get().seek(s); }
JNIEXPORT void JNICALL FN(nativeSetRate)(JNIEnv*, jobject, jdouble r) { Engine::get().setSpeed(r); }
JNIEXPORT void JNICALL FN(nativeSetVolume)(JNIEnv*, jobject, jfloat v) { Engine::get().setVolume(v); }

JNIEXPORT jdoubleArray JNICALL FN(nativeState)(JNIEnv* env, jobject) {
  double v[8];
  Engine::get().state(v);
  jdoubleArray a = env->NewDoubleArray(8);
  env->SetDoubleArrayRegion(a, 0, 8, v);
  return a;
}

JNIEXPORT jstring JNICALL FN(nativeOpenMic)(JNIEnv* env, jobject, jint mode, jboolean nc, jfloat gainDb, jint, jint) {
  lectern::RecConfig c;
  c.mode = mode;
  c.nc = nc;
  c.gainDb = gainDb;
  return env->NewStringUTF(Engine::get().openMic(c).c_str());
}

JNIEXPORT void JNICALL FN(nativeCloseMic)(JNIEnv*, jobject) { Engine::get().closeMic(); }

JNIEXPORT jboolean JNICALL FN(nativeStartRecord)(JNIEnv* env, jobject, jstring voice, jstring music) {
  return Engine::get().startRecord(str(env, voice), str(env, music));
}

JNIEXPORT void JNICALL FN(nativePauseRecord)(JNIEnv*, jobject, jboolean p) { Engine::get().pauseRecord(p); }

// [seconds, rate, firstCaptureNs, lastCaptureNs, gapSeconds, lostSeconds, musicJumps, hasMusic, outXruns, inXruns]
JNIEXPORT jdoubleArray JNICALL FN(nativeStopRecord)(JNIEnv* env, jobject) {
  int32_t ox = 0, ix = 0;
  const lectern::RecStats s = Engine::get().stopRecord(&ox, &ix);
  double v[10] = {s.seconds, double(s.rate), double(s.firstCaptureNs), double(s.lastCaptureNs), double(s.gapFrames) / s.rate,
                  double(s.overflowFrames) / s.rate, double(s.musicJumps), s.hasMusic ? 1.0 : 0.0, double(ox), double(ix)};
  jdoubleArray a = env->NewDoubleArray(10);
  env->SetDoubleArrayRegion(a, 0, 10, v);
  return a;
}

JNIEXPORT void JNICALL FN(nativeSetNC)(JNIEnv*, jobject, jboolean on) { Engine::get().setNC(on); }
JNIEXPORT void JNICALL FN(nativeSetMicGain)(JNIEnv*, jobject, jfloat db) { Engine::get().setMicGain(db); }
JNIEXPORT jdouble JNICALL FN(nativeOutputLatency)(JNIEnv*, jobject) { return Engine::get().outputLatencySec(); }
JNIEXPORT jlong JNICALL FN(nativeMonoNs)(JNIEnv*, jobject) { return lectern::monoNs(); }

JNIEXPORT jstring JNICALL FN(nativeFinalize)(JNIEnv* env, jobject, jstring voice, jstring music, jstring out, jint mode, jdouble balanceDb) {
  lectern::FinalizeOptions o;
  o.mode = mode;
  o.musicBalanceDb = balanceDb;
  const auto r = lectern::finalizeTake(str(env, voice), str(env, music), str(env, out), o);
  return env->NewStringUTF(lectern::toJson(r).c_str());
}

}  // extern "C"
