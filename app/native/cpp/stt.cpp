// On-device speech recognition with whisper.cpp: word-level timestamps for AI lyric sync.
#include <android/log.h>
#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

#include "dsp.h"
#include "whisper.h"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "lectern-stt", __VA_ARGS__)

static std::atomic<int> g_progress{0};
static std::atomic<bool> g_abort{false};

static std::string jstr(JNIEnv* env, jstring s) {
  if (!s) return "";
  const char* c = env->GetStringUTFChars(s, nullptr);
  std::string r(c ? c : "");
  if (c) env->ReleaseStringUTFChars(s, c);
  return r;
}

static void jsonEscape(std::string& out, const char* s) {
  for (const char* p = s; *p; ++p) {
    const unsigned char c = static_cast<unsigned char>(*p);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char b[8];
          std::snprintf(b, sizeof b, "\\u%04x", c);
          out += b;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
}

// whisper.cpp splits multi-byte characters across tokens sometimes; drop broken UTF-8 bytes.
static std::string validUtf8(const std::string& s) {
  std::string o;
  size_t i = 0;
  while (i < s.size()) {
    const unsigned char c = s[i];
    int n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 0;
    if (n == 0 || i + n > s.size()) {
      i++;
      continue;
    }
    bool ok = true;
    for (int k = 1; k < n; k++) ok = ok && (static_cast<unsigned char>(s[i + k]) >> 6) == 2;
    if (ok) o.append(s, i, n);
    i += ok ? n : 1;
  }
  return o;
}

extern "C" {

JNIEXPORT jint JNICALL Java_com_lectern_lectern_NativeEngine_nativeTranscribeProgress(JNIEnv*, jobject) { return g_progress.load(); }

JNIEXPORT void JNICALL Java_com_lectern_lectern_NativeEngine_nativeTranscribeCancel(JNIEnv*, jobject) { g_abort.store(true); }

// pcm: interleaved 16-bit PCM in a direct buffer. Returns a JSON array of {text,start,end} or {"error":...}.
JNIEXPORT jstring JNICALL Java_com_lectern_lectern_NativeEngine_nativeTranscribe(JNIEnv* env, jobject, jstring jmodel, jobject buf, jlong frames,
                                                                                 jint channels, jint rate, jstring jlang) {
  g_progress.store(0);
  g_abort.store(false);
  const auto* p = static_cast<const int16_t*>(env->GetDirectBufferAddress(buf));
  if (!p || frames <= 0 || channels <= 0) return env->NewStringUTF("{\"error\":\"no audio\"}");

  // mono, then 16 kHz
  std::vector<int16_t> mono(static_cast<size_t>(frames));
  for (jlong i = 0; i < frames; i++) {
    int s = 0;
    for (int c = 0; c < channels; c++) s += p[i * channels + c];
    mono[static_cast<size_t>(i)] = static_cast<int16_t>(s / channels);
  }
  int64_t outFrames = frames;
  std::vector<int16_t> r16 = rate == WHISPER_SAMPLE_RATE ? mono : lectern::resample(mono.data(), frames, 1, rate, WHISPER_SAMPLE_RATE, &outFrames);
  std::vector<float> pcm(static_cast<size_t>(outFrames));
  for (int64_t i = 0; i < outFrames; i++) pcm[static_cast<size_t>(i)] = r16[static_cast<size_t>(i)] / 32768.f;
  mono.clear();
  mono.shrink_to_fit();
  r16.clear();
  r16.shrink_to_fit();

  const std::string model = jstr(env, jmodel);
  std::string lang = jstr(env, jlang);
  if (lang.empty()) lang = "auto";

  whisper_context_params cp = whisper_context_default_params();
  cp.use_gpu = false;
  whisper_context* ctx = whisper_init_from_file_with_params(model.c_str(), cp);
  if (!ctx) return env->NewStringUTF("{\"error\":\"the speech model could not be opened\"}");

  whisper_full_params wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  const int hw = static_cast<int>(std::thread::hardware_concurrency());
  wp.n_threads = std::max(2, std::min(hw > 0 ? hw - 1 : 4, 6));
  wp.language = lang.c_str();
  wp.translate = false;
  wp.no_context = true;
  wp.print_progress = false;
  wp.print_realtime = false;
  wp.print_special = false;
  wp.print_timestamps = false;
  wp.token_timestamps = true;
  wp.max_len = 1;  // one word per segment
  wp.split_on_word = true;
  wp.suppress_blank = true;
  wp.suppress_nst = true;  // no "[music]"-style tokens
  wp.temperature_inc = 0.2f;
  wp.progress_callback = [](whisper_context*, whisper_state*, int progress, void*) { g_progress.store(progress); };
  wp.abort_callback = [](void*) -> bool { return g_abort.load(); };

  const int rc = whisper_full(ctx, wp, pcm.data(), static_cast<int>(pcm.size()));
  if (rc != 0) {
    whisper_free(ctx);
    return env->NewStringUTF(g_abort.load() ? "{\"error\":\"cancelled\"}" : "{\"error\":\"transcription failed\"}");
  }
  std::string out = "[";
  const int n = whisper_full_n_segments(ctx);
  bool first = true;
  for (int i = 0; i < n; i++) {
    const std::string t = validUtf8(whisper_full_get_segment_text(ctx, i));
    // skip empty segments and bracketed noise markers
    size_t a = t.find_first_not_of(" \t");
    if (a == std::string::npos) continue;
    std::string w = t.substr(a);
    if (!w.empty() && (w[0] == '[' || w[0] == '(' || w[0] == '*' || w[0] == '\xE2')) {
      if (w.find(']') != std::string::npos || w.find(')') != std::string::npos || w[0] == '*' || w[0] == '\xE2') continue;
    }
    const double s = whisper_full_get_segment_t0(ctx, i) / 100.0;
    double e = whisper_full_get_segment_t1(ctx, i) / 100.0;
    if (e < s + 0.05) e = s + 0.05;
    if (!first) out += ',';
    first = false;
    char num[64];
    out += "{\"text\":\"";
    jsonEscape(out, w.c_str());
    std::snprintf(num, sizeof num, "\",\"start\":%.3f,\"end\":%.3f}", s, e);
    out += num;
  }
  out += "]";
  whisper_free(ctx);
  g_progress.store(100);
  LOGI("transcribed %d segments", n);
  return env->NewStringUTF(out.c_str());
}

}  // extern "C"
