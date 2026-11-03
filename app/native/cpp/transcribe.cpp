// On-device speech recognition (whisper.cpp) for AI lyric sync.
// Word timing:
//  1. Token times from DTW over Whisper's alignment cross-attention heads (whisper.cpp
//     dtw_token_timestamps), which are much closer to when a word is actually sung than the
//     decoder's timestamp tokens (those tend to put a phrase's first word at the start of the
//     audio window, i.e. inside an instrumental intro).
//  2. A vocal map of the song (centre-channel vocal-band energy): words the recogniser put where
//     nobody sings are moved to the next vocal onset, and hallucinated text in intros/breaks
//     ("thank you for watching") is dropped.

#include <algorithm>
#include <cctype>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "transcribe.h"
#include "whisper.h"

#ifdef __ANDROID__
#include <android/log.h>
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "lectern-stt", __VA_ARGS__)
#else
#define LOGI(...) (std::fprintf(stderr, __VA_ARGS__), std::fprintf(stderr, "\n"))
#endif

using namespace lectern;

namespace lectern {
std::atomic<int> g_sttProgress{0};
std::atomic<bool> g_sttAbort{false};
}
#define g_progress g_sttProgress
#define g_abort g_sttAbort

static void jsonEscape(std::string& out, const std::string& s) {
  for (unsigned char c : s) {
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
          out += char(c);
        }
    }
  }
}

// whisper.cpp can split a multi-byte character across tokens; drop broken UTF-8 bytes.
static std::string validUtf8(const std::string& s) {
  std::string o;
  size_t i = 0;
  while (i < s.size()) {
    const unsigned char c = s[i];
    const int n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 0;
    if (n == 0 || i + n > s.size()) { i++; continue; }
    bool ok = true;
    for (int k = 1; k < n; k++) ok = ok && (static_cast<unsigned char>(s[i + k]) >> 6) == 2;
    if (ok) o.append(s, i, n);
    i += ok ? n : 1;
  }
  return o;
}

static std::string lower(std::string s) {
  for (auto& c : s) c = char(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

static std::string vadJson(const VocalMap& v) {
  std::string o = "[";
  char b[64];
  for (size_t i = 0; i < v.regions.size(); i++) {
    std::snprintf(b, sizeof b, "%s[%.2f,%.2f]", i ? "," : "", v.regions[i].first, v.regions[i].second);
    o += b;
  }
  return o + "]";
}

struct Word {
  std::string text;
  double s, e;
  int seg;
  double t0 = -1, dtw = -1;  // decoder timestamp and DTW time of the first token (diagnostics)
};

std::string lectern::vocalMapJson(const Track& t) { return vadJson(analyzeVocals(t)); }

std::string lectern::transcribeJson(std::shared_ptr<Track> track, const std::string& model, std::string lang, const TranscribeOptions& opt) {
  g_progress.store(0);
  g_abort.store(false);
  if (!track || track->frames <= 0) return "{\"error\":\"no audio\"}";
  const VocalMap vmap = analyzeVocals(*track);

  // mono 16 kHz for Whisper (windowed-sinc decimation)
  const double ratio = double(track->rate) / WHISPER_SAMPLE_RATE;
  const Kernel k(std::min(1.0, 1.0 / ratio) * 0.97);
  const int64_t n16 = int64_t(double(track->frames) / ratio);
  std::vector<float> pcm(static_cast<size_t>(n16));
  for (int64_t i = 0; i < n16; i++) {
    float l, r;
    k.stereo(track->pcm.data(), track->frames, double(i) * ratio, &l, &r);
    pcm[size_t(i)] = 0.5f * (l + r);
  }

  if (lang.empty()) lang = "auto";

  whisper_context_params cp = whisper_context_default_params();
  cp.use_gpu = false;
  cp.flash_attn = false;  // DTW token timestamps need the attention weights
  cp.dtw_token_timestamps = opt.dtw;
  cp.dtw_aheads_preset = model.find("small") != std::string::npos ? WHISPER_AHEADS_SMALL
                         : model.find("tiny") != std::string::npos ? WHISPER_AHEADS_TINY
                                                                     : WHISPER_AHEADS_BASE;
  whisper_context* ctx = whisper_init_from_file_with_params(model.c_str(), cp);
  if (!ctx) return "{\"error\":\"the speech model could not be opened\"}";

  whisper_full_params wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  const int hw = static_cast<int>(std::thread::hardware_concurrency());
  wp.n_threads = opt.threads > 0 ? opt.threads : std::max(2, std::min(hw > 0 ? hw - 1 : 4, 6));
  wp.language = lang.c_str();
  wp.translate = false;
  wp.no_context = true;
  wp.print_progress = false;
  wp.print_realtime = false;
  wp.print_special = false;
  wp.print_timestamps = false;
  wp.token_timestamps = true;
  if (opt.legacy) {  // the previous app: one word per segment from the decoder's timestamps
    wp.max_len = 1;
    wp.split_on_word = true;
  }
  wp.suppress_blank = true;
  wp.suppress_nst = true;
  wp.temperature_inc = 0.2f;
  wp.progress_callback = [](whisper_context*, whisper_state*, int progress, void*) { g_progress.store(progress); };
  wp.abort_callback = [](void*) -> bool { return g_abort.load(); };

  const int rc = whisper_full(ctx, wp, pcm.data(), static_cast<int>(pcm.size()));
  if (rc != 0) {
    whisper_free(ctx);
    return g_abort.load() ? "{\"error\":\"cancelled\"}" : "{\"error\":\"transcription failed\"}";
  }
  const whisper_token eot = whisper_token_eot(ctx);
  std::vector<Word> words;
  std::vector<float> noSpeech;
  const int ns = whisper_full_n_segments(ctx);
  for (int i = 0; i < ns && opt.legacy; i++) {
    noSpeech.push_back(whisper_full_get_segment_no_speech_prob(ctx, i));
    Word w;
    w.text = whisper_full_get_segment_text(ctx, i);
    w.s = whisper_full_get_segment_t0(ctx, i) / 100.0;
    w.e = whisper_full_get_segment_t1(ctx, i) / 100.0;
    w.seg = i;
    words.push_back(w);
  }
  // Tokens of each word. whisper.cpp stamps a token's t_dtw when the alignment path moves on to
  // the next token, i.e. at the END of the token (see dtw_and_backtrace in whisper.cpp), so a
  // word's DTW time is where it ends; where it starts is worked out below.
  for (int i = 0; i < ns && !opt.legacy; i++) {
    noSpeech.push_back(whisper_full_get_segment_no_speech_prob(ctx, i));
    const int nt = whisper_full_n_tokens(ctx, i);
    for (int j = 0; j < nt; j++) {
      if (whisper_full_get_token_id(ctx, i, j) >= eot) continue;  // timestamps and special tokens
      const std::string txt = whisper_full_get_token_text(ctx, i, j);
      const whisper_token_data d = whisper_full_get_token_data(ctx, i, j);
      const bool startsWord = !txt.empty() && txt[0] == ' ';
      if (words.empty() || startsWord || words.back().seg != i) {
        Word w;
        w.text = startsWord ? txt.substr(1) : txt;
        w.t0 = d.t0 / 100.0;
        w.dtw = d.t_dtw / 100.0;
        w.s = w.t0;
        w.e = d.t_dtw >= 0 ? d.t_dtw / 100.0 : d.t1 / 100.0;
        w.seg = i;
        words.push_back(w);
      } else {
        words.back().text += txt;
        // punctuation tokens get late alignment times: they don't move the word's end
        bool letters = false;
        for (unsigned char ch : txt) letters = letters || std::isalnum(ch) || ch >= 0x80;
        if (letters) {
          if (d.t_dtw >= 0) words.back().e = std::max(words.back().e, d.t_dtw / 100.0);
          else words.back().e = std::max(words.back().e, d.t1 / 100.0);
        }
      }
    }
  }
  if (!opt.legacy && opt.dtw) {
    // start of a word: where the previous word ended when the two are sung back to back;
    // after a pause, the vocal onset before the word's end; then onto the nearest onset
    double prevEnd = 0, prevStart = -1;
    for (auto& w : words) {
      if (w.dtw < 0) { prevEnd = w.e; continue; }  // no DTW time: keep the decoder's
      int syl = 0;
      bool inV = false;
      for (char ch : w.text) {
        const bool v = std::strchr("aeiouyAEIOUY", ch) != nullptr;
        if (v && !inV) syl++;
        inV = v;
      }
      const double d = 0.18 + 0.16 * std::max(1, syl);  // typical length of this word
      double st;
      if (w.e > prevEnd && w.e - prevEnd <= d * 1.8 + 0.15) {
        st = prevEnd;
      } else {
        st = std::max(prevEnd, w.e - d);
        const double on = vmap.strongestOnset(w.e - 2 * d, w.e - 0.05, 3.0);
        if (!std::isnan(on) && on >= prevEnd) st = on;
      }
      // inside a phrase the decoder's own timestamp is usually the more precise one; at the start
      // of its 30 s window it can be off by seconds, so it is only taken when the two agree
      if (w.t0 >= 0 && std::fabs(w.t0 - st) < 1.0 && w.t0 > prevStart + 0.05 && w.t0 < w.e - 0.05) st = w.t0;
      const double sn = vmap.strongestOnset(st - 0.2, st + 0.2, 3.0);
      if (!std::isnan(sn) && sn >= prevEnd - 0.05 && sn < w.e - 0.05) st = sn;
      w.s = st;
      prevEnd = w.e;
      prevStart = st;
    }
  }
  const int detected = whisper_full_lang_id(ctx);
  const std::string langOut = detected >= 0 ? whisper_lang_str(detected) : lang;
  whisper_free(ctx);

  // tidy: valid text, ordered starts, believable ends
  std::vector<Word> clean;
  for (auto& w : words) {
    w.text = validUtf8(w.text);
    size_t a = w.text.find_first_not_of(" \t");
    if (a == std::string::npos) continue;
    w.text = w.text.substr(a);
    if (w.text[0] == '[' || w.text[0] == '(' || w.text[0] == '*' || w.text.rfind("\xE2\x99\xAA", 0) == 0) continue;  // [Music], (applause), ♪
    clean.push_back(w);
  }
  for (size_t i = 0; i < clean.size(); i++) {
    if (i > 0 && clean[i].s < clean[i - 1].s + 0.02) clean[i].s = clean[i - 1].s + 0.02;
    const double nx = i + 1 < clean.size() ? clean[i + 1].s : clean[i].s + 2;
    clean[i].e = std::max(clean[i].s + 0.08, std::min(std::max(clean[i].e, clean[i].s + 0.1), nx));
  }
  // drop hallucinations: segments the model itself thinks are not speech and where no voice is
  static const char* kHallu[] = {"thank you for watching", "thanks for watching", "subscribe", "subtitles by", "amara.org", "transcribed by", "you"};
  std::vector<Word> kept;
  for (size_t i = 0; i < clean.size(); i++) {
    const Word& w = clean[i];
    bool voiced = vmap.regions.empty();
    for (double t = w.s; t <= std::max(w.e, w.s + 0.2) && !voiced; t += 0.05) voiced = vmap.vocalAt(t);
    if (opt.refine && !voiced && w.seg < int(noSpeech.size()) && noSpeech[size_t(w.seg)] > 0.5f) continue;
    if (opt.refine && !voiced) {
      // a known hallucinated phrase sitting where nobody sings
      std::string segText;
      for (const auto& x : clean) if (x.seg == w.seg) segText += lower(x.text) + " ";
      bool hallu = false;
      for (const char* h : kHallu) hallu = hallu || (segText.find(h) != std::string::npos && (std::strcmp(h, "you") != 0 || segText == "you "));
      if (hallu) continue;
    }
    kept.push_back(w);
  }
  // move starts that sit before the voice (intro, breaks) to the vocal onset that follows
  std::vector<std::pair<double, double>> se;
  for (const auto& w : kept) se.push_back({w.s, w.e});
  const int moved = opt.refine ? refineStarts(se, vmap) : 0;
  std::string out = "{\"words\":[";
  for (size_t i = 0; i < kept.size(); i++) {
    char num[96];
    out += i ? ",{\"text\":\"" : "{\"text\":\"";
    jsonEscape(out, kept[i].text);
    if (opt.debug) {
      char dbg[160];
      std::snprintf(dbg, sizeof dbg, "\",\"start\":%.3f,\"end\":%.3f,\"t0\":%.3f,\"dtw\":%.3f,\"raw\":%.3f,\"seg\":%d}", se[i].first, se[i].second,
                    kept[i].t0, kept[i].dtw, kept[i].s, kept[i].seg);
      out += dbg;
    } else {
      std::snprintf(num, sizeof num, "\",\"start\":%.3f,\"end\":%.3f}", se[i].first, se[i].second);
      out += num;
    }
  }
  char tail[160];
  std::snprintf(tail, sizeof tail, "],\"refined\":%d,\"dropped\":%d,\"lang\":\"", moved, int(clean.size() - kept.size()));
  out += tail;
  jsonEscape(out, langOut);
  out += "\",\"vad\":" + vadJson(vmap) + "}";
  g_progress.store(100);
  LOGI("transcribed %zu words (%d moved to the voice, %d dropped), %zu vocal regions", kept.size(), moved, int(clean.size() - kept.size()),
       vmap.regions.size());
  return out;
}

