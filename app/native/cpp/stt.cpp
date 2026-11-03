// JNI wrappers for speech recognition and vocal analysis (see transcribe.cpp).
#include <jni.h>

#include "transcribe.h"

using namespace lectern;

static std::string jstr(JNIEnv* env, jstring s) {
  if (!s) return "";
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string r(c ? c : "");
  if (c) env->ReleaseStringUTFChars(s, c);
  return r;
}

extern "C" {

JNIEXPORT jint JNICALL Java_com_lectern_lectern_NativeEngine_nativeTranscribeProgress(JNIEnv*, jobject) { return g_sttProgress.load(); }
JNIEXPORT void JNICALL Java_com_lectern_lectern_NativeEngine_nativeTranscribeCancel(JNIEnv*, jobject) { g_sttAbort.store(true); }

// Where the voice is in a song: JSON array of [start, end] regions.
JNIEXPORT jstring JNICALL Java_com_lectern_lectern_NativeEngine_nativeAnalyzeVocals(JNIEnv* env, jobject, jobject buf, jlong frames, jint channels, jint rate) {
  const auto* p = static_cast<const int16_t*>(env->GetDirectBufferAddress(buf));
  if (!p || frames <= 0) return env->NewStringUTF("[]");
  return env->NewStringUTF(vocalMapJson(*makeTrack(p, frames, channels, rate)).c_str());
}

JNIEXPORT jstring JNICALL Java_com_lectern_lectern_NativeEngine_nativeTranscribe(JNIEnv* env, jobject, jstring model, jobject buf, jlong frames, jint channels,
                                                                                 jint rate, jstring lang) {
  const auto* p = static_cast<const int16_t*>(env->GetDirectBufferAddress(buf));
  if (!p || frames <= 0 || channels <= 0) return env->NewStringUTF("{\"error\":\"no audio\"}");
  const std::string r = transcribeJson(makeTrack(p, frames, channels, rate), jstr(env, model), jstr(env, lang), TranscribeOptions());
  return env->NewStringUTF(r.c_str());
}

}  // extern "C"
