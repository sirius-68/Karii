// Speech-timing test: transcribes a song with known word times and measures how far the word
// starts are from the truth, for the new pipeline (DTW + vocal map) and the previous app's.
// Usage: asr_test <model.bin> <song.wav> <truth.txt> <out_dir>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "core.h"
#include "transcribe.h"

using namespace lectern;

struct W {
  std::string w;
  double s;
};

static std::string norm(const std::string& x) {
  std::string o;
  for (char c : x)
    if (std::isalnum(static_cast<unsigned char>(c))) o += char(std::tolower(static_cast<unsigned char>(c)));
  return o;
}

// minimal parse of {"words":[{"text":"..","start":x,"end":y},...]}
static std::vector<W> parseWords(const std::string& j) {
  std::vector<W> out;
  size_t p = 0;
  while ((p = j.find("\"text\":\"", p)) != std::string::npos) {
    p += 8;
    std::string t;
    while (p < j.size() && j[p] != '"') {
      if (j[p] == '\\' && p + 1 < j.size()) p++;
      t += j[p++];
    }
    const size_t s = j.find("\"start\":", p);
    if (s == std::string::npos) break;
    out.push_back({t, std::atof(j.c_str() + s + 8)});
    p = s;
  }
  return out;
}

struct Score {
  int matched = 0, intro = 0, breakWords = 0;
  double mean = 0, median = 0, p90 = 0, max = 0, first = 0;
};

static Score score(const std::vector<W>& got, const std::vector<W>& truth, double firstTruth, double brkA, double brkB) {
  const size_t n = truth.size(), m = got.size();
  std::vector<std::vector<int>> dp(n + 1, std::vector<int>(m + 1, 0));
  for (size_t i = 1; i <= n; i++)
    for (size_t j = 1; j <= m; j++)
      dp[i][j] = norm(truth[i - 1].w) == norm(got[j - 1].w) ? dp[i - 1][j - 1] + 1 : std::max(dp[i - 1][j], dp[i][j - 1]);
  std::vector<double> err;
  Score sc;
  bool firstSet = false;
  for (size_t i = n, j = m; i > 0 && j > 0;) {
    if (norm(truth[i - 1].w) == norm(got[j - 1].w)) {
      err.push_back(std::fabs(got[j - 1].s - truth[i - 1].s));
      if (i == 1) { sc.first = got[j - 1].s - truth[0].s; firstSet = true; }
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  if (!firstSet && !got.empty()) sc.first = got[0].s - truth[0].s;
  for (const auto& g : got) {
    if (g.s < firstTruth - 0.25) sc.intro++;
    if (g.s >= brkA && g.s < brkB) sc.breakWords++;
  }
  sc.matched = int(err.size());
  if (!err.empty()) {
    std::sort(err.begin(), err.end());
    double s = 0;
    for (double e : err) s += e;
    sc.mean = s / err.size();
    sc.median = err[err.size() / 2];
    sc.p90 = err[size_t(err.size() * 0.9)];
    sc.max = err.back();
  }
  return sc;
}

int main(int argc, char** argv) {
  if (argc < 5) { std::fprintf(stderr, "usage: asr_test model song.wav truth.txt out_dir\n"); return 2; }
  Wav w;
  if (!readWav(argv[2], &w)) { std::fprintf(stderr, "can't read %s\n", argv[2]); return 2; }
  std::vector<int16_t> pcm(w.data.size());
  for (size_t i = 0; i < pcm.size(); i++) pcm[i] = int16_t(std::lrint(std::max(-1.f, std::min(1.f, w.data[i])) * 32767));
  auto track = makeTrack(pcm.data(), w.frames(), w.ch, w.rate);
  std::vector<W> truth;
  {
    std::ifstream f(argv[3]);
    std::string word;
    double s;
    while (f >> word >> s) truth.push_back({word, s});
  }
  const double firstTruth = truth.front().s;
  // instrumental break in the generated song: after the 3rd line until 38 s
  double brkA = 0;
  for (const auto& t : truth) if (t.s < 30) brkA = t.s + 0.8;
  const double brkB = 37.9;
  int fails = 0;
  auto run = [&](const char* name, TranscribeOptions o, const char* file) {
    const std::string j = transcribeJson(track, argv[1], "en", o);
    std::ofstream(std::string(argv[4]) + "/" + file) << j;
    if (j.find("\"error\"") == 1) { std::printf("%s: %s\n", name, j.c_str()); fails++; return Score(); }
    auto got = parseWords(j);
    if (o.legacy) {  // old segments are single words with spaces/punctuation around them
      for (auto& g : got) g.w = norm(g.w);
    }
    Score s = score(got, truth, firstTruth, brkA, brkB);
    std::printf("%-34s matched %2d/%zu  start error mean %.3f s, median %.3f, p90 %.3f, max %.3f | first word %+.2f s | words in intro %d, in break %d\n",
                name, s.matched, truth.size(), s.mean, s.median, s.p90, s.max, s.first, s.intro, s.breakWords);
    return s;
  };
  TranscribeOptions legacy;
  legacy.legacy = true;
  legacy.dtw = false;
  legacy.refine = false;
  TranscribeOptions dtwOnly;
  dtwOnly.refine = false;
  TranscribeOptions full;
  std::printf("song: %zu words, first word at %.2f s, instrumental break %.1f-%.1f s\n", truth.size(), firstTruth, brkA, brkB);
  const Score a = run("previous app (segment timestamps)", legacy, "words_legacy.json");
  const Score b = run("DTW token timestamps", dtwOnly, "words_dtw.json");
  const Score c = run("DTW + vocal map (new)", full, "words_new.json");
  auto check = [&](bool ok, const char* what, double v, double tol) {
    std::printf("  [%s] %-48s %.3f (tol %.3f)\n", ok ? "PASS" : "FAIL", what, v, tol);
    if (!ok) fails++;
  };
  check(c.matched >= int(truth.size() * 0.8), "words recognised and matched (fraction)", double(c.matched) / truth.size(), 0.8);
  check(c.intro == 0, "words placed in the instrumental intro", c.intro, 0);
  check(c.breakWords == 0, "words placed in the instrumental break", c.breakWords, 0);
  check(std::fabs(c.first) < 0.25, "first word start error (s)", std::fabs(c.first), 0.25);
  check(c.median < 0.15, "median word start error (s)", c.median, 0.15);
  check(c.p90 < 0.35, "90th percentile word start error (s)", c.p90, 0.35);
  (void)a; (void)b;
  std::printf("%s\n", fails ? "ASR TIMING: FAIL" : "ASR TIMING: PASS");
  return fails ? 1 : 0;
}
