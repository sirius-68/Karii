// JNI bridge for com.lectern.lectern.NativeEngine (a Kotlin object).
#include <jni.h>

#include <string>

#include "engine.h"

using lectern::Engine;

#define FN(name) Java_com_lectern_lectern_NativeEngine_##name

static std::string str(JNIEnv* env, jstring s) {
  if (!s) return "";
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string r(c ? c : "");
  if (c) env->ReleaseStringUTFChars(s, c);
  return r;
}

extern "C" {

JNIEXPORT jboolean JNICALL FN(nativeStart)(JNIEnv*, jobject) { return Engine::get().start(); }

JNIEXPORT jint JNICALL FN(nativeSampleRate)(JNIEnv*, jobject) { return Engine::get().sampleRate(); }

JNIEXPORT jboolean JNICALL FN(nativeLoad)(JNIEnv* env, jobject, jobject buf, jlong frames, jint channels, jint rate) {
  auto* p = static_cast<int16_t*>(env->GetDirectBufferAddress(buf));
  if (!p) return false;
  return Engine::get().loadPcm(p, frames, channels, rate);
}

JNIEXPORT void JNICALL FN(nativeUnload)(JNIEnv*, jobject) { Engine::get().unload(); }
JNIEXPORT void JNICALL FN(nativePlay)(JNIEnv*, jobject) { Engine::get().play(); }
JNIEXPORT void JNICALL FN(nativePause)(JNIEnv*, jobject) { Engine::get().pause(); }
JNIEXPORT void JNICALL FN(nativeSeek)(JNIEnv*, jobject, jdouble s) { Engine::get().seek(s); }
JNIEXPORT void JNICALL FN(nativeSetRate)(JNIEnv*, jobject, jdouble r) { Engine::get().setRate(r); }
JNIEXPORT void JNICALL FN(nativeSetVolume)(JNIEnv*, jobject, jfloat v) { Engine::get().setVolume(v); }

// [position, playing, duration, micLevelDb, recording]
JNIEXPORT jdoubleArray JNICALL FN(nativeState)(JNIEnv* env, jobject) {
  Engine& e = Engine::get();
  jdouble v[5] = {e.position(), e.playing() ? 1.0 : 0.0, e.duration(), e.micLevelDb(), e.recording() ? 1.0 : 0.0};
  jdoubleArray a = env->NewDoubleArray(5);
  env->SetDoubleArrayRegion(a, 0, 5, v);
  return a;
}

JNIEXPORT jstring JNICALL FN(nativeOpenMic)(JNIEnv* env, jobject, jint mode, jboolean nc, jfloat gainDb, jint preset, jint deviceId) {
  lectern::RecordConfig c;
  c.mode = mode;
  c.nc = nc;
  c.micGainDb = gainDb;
  c.inputPreset = preset;
  c.deviceId = deviceId;
  return env->NewStringUTF(Engine::get().openMic(c).c_str());
}

JNIEXPORT void JNICALL FN(nativeCloseMic)(JNIEnv*, jobject) { Engine::get().closeMic(); }

JNIEXPORT jboolean JNICALL FN(nativeStartRecord)(JNIEnv* env, jobject, jstring mix, jstring stem) {
  return Engine::get().startRecord(str(env, mix), str(env, stem));
}

JNIEXPORT void JNICALL FN(nativePauseRecord)(JNIEnv*, jobject, jboolean p) { Engine::get().pauseRecord(p); }

// [mixSeconds, musicOffset, micUnderrunSec, micDropSec, outXruns, inXruns]
JNIEXPORT jdoubleArray JNICALL FN(nativeStopRecord)(JNIEnv* env, jobject) {
  double secs = 0, off = 0;
  Engine& e = Engine::get();
  lectern::Health h = e.stopRecord(&secs, &off);
  const double r = e.sampleRate();
  jdouble v[6] = {secs, off, h.micUnderrunFrames / r, h.micDropFrames / r, double(h.outXruns), double(h.inXruns)};
  jdoubleArray a = env->NewDoubleArray(6);
  env->SetDoubleArrayRegion(a, 0, 6, v);
  return a;
}

JNIEXPORT void JNICALL FN(nativeSetNC)(JNIEnv*, jobject, jboolean on) { Engine::get().setNC(on); }
JNIEXPORT void JNICALL FN(nativeSetMicGain)(JNIEnv*, jobject, jfloat db) { Engine::get().setMicGain(db); }
JNIEXPORT jdouble JNICALL FN(nativeOutputLatency)(JNIEnv*, jobject) { return Engine::get().outputLatencySec(); }

}  // extern "C"
