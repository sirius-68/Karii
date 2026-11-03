// Lectern audio core, independent of Android so it can be unit-tested on a desktop:
//  - Player: plays a track at its own sample rate through any output rate (windowed-sinc),
//    and keeps a history of clock anchors so "what the listener hears now" is exact after
//    seeks, pauses, speed changes and output-stream restarts.
//  - StreamClock: maps a monotonic time to the frame being presented/captured, from the
//    platform's hardware timestamps.
//  - Recorder: mic-driven recording. The input callback only copies samples and a timeline
//    mark; a worker thread does the processing and writes the voice and the music the singer
//    heard (read from the track by the timeline), so the two stay sample-aligned.
//  - finalizeTake: offline mix with loudness normalisation (BS.1770) and a true-peak limiter.
//  - analyzeVocals: where the voice is (centre-channel vocal band energy), for lyric timing.
#pragma once
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "dsp.h"

namespace lectern {

int64_t monoNs();

struct Track {
  std::vector<int16_t> pcm;  // interleaved stereo
  int rate = 48000;
  int64_t frames = 0;
};

std::shared_ptr<Track> makeTrack(const int16_t* pcm, int64_t frames, int channels, int rate);

// ---------------------------------------------------------------- clock of one audio stream
// Hardware timestamp of a stream: frame `tsFrame` was presented (output) or captured (input)
// at monotonic time `tsNs`. Written by the audio thread, read anywhere.
class StreamClock {
 public:
  void reset(int rate) {
    rate_.store(rate);
    tsValid_.store(false);
    frames_.store(0);
  }
  void setTimestamp(int64_t frame, int64_t ns) {
    seq_.fetch_add(1, std::memory_order_acq_rel);
    tsFrame_.store(frame, std::memory_order_relaxed);
    tsNs_.store(ns, std::memory_order_relaxed);
    seq_.fetch_add(1, std::memory_order_acq_rel);
    tsValid_.store(true, std::memory_order_release);
  }
  void setFrames(int64_t f) { frames_.store(f, std::memory_order_release); }  // frames transferred so far
  void setLatencyFrames(int64_t l) { latency_.store(l); }
  int64_t frames() const { return frames_.load(std::memory_order_acquire); }
  int rate() const { return rate_.load(); }
  // Monotonic time of frame f (inverse of frameAt); 0 when there is no timestamp yet.
  int64_t nsAtFrame(double f) const {
    if (!tsValid_.load(std::memory_order_acquire)) return 0;
    int64_t tf, t;
    uint32_t s0, s1;
    do {
      s0 = seq_.load(std::memory_order_acquire);
      tf = tsFrame_.load(std::memory_order_relaxed);
      t = tsNs_.load(std::memory_order_relaxed);
      s1 = seq_.load(std::memory_order_acquire);
    } while (s0 != s1 || (s0 & 1));
    return t + int64_t((f - double(tf)) * 1e9 / rate_.load());
  }
  bool hasTimestamp() const { return tsValid_.load(std::memory_order_acquire); }
  // Fractional frame index at the given monotonic time (presented for output, captured for input).
  double frameAt(int64_t ns, bool output) const {
    const int rate = rate_.load();
    if (tsValid_.load(std::memory_order_acquire)) {
      int64_t f, t;
      uint32_t s0, s1;
      do {
        s0 = seq_.load(std::memory_order_acquire);
        f = tsFrame_.load(std::memory_order_relaxed);
        t = tsNs_.load(std::memory_order_relaxed);
        s1 = seq_.load(std::memory_order_acquire);
      } while (s0 != s1 || (s0 & 1));
      return double(f) + double(ns - t) * rate / 1e9;
    }
    // no hardware timestamp yet: frames written minus the estimated latency
    const double f = double(frames_.load(std::memory_order_acquire));
    return output ? f - double(latency_.load()) : f + double(latency_.load());
  }

 private:
  std::atomic<uint32_t> seq_{0};
  std::atomic<int64_t> tsFrame_{0}, tsNs_{0}, frames_{0}, latency_{0};
  std::atomic<int> rate_{48000};
  std::atomic<bool> tsValid_{false};
};

// ---------------------------------------------------------------- player
class Player {
 public:
  Player();
  void setTrack(std::shared_ptr<Track> t);  // stops playback, position 0
  void clearTrack();
  std::shared_ptr<Track> track() const;
  void play();
  void pause();
  void seek(double sec);
  void setSpeed(double s);
  double speed() const { return speed_.load(); }
  void setVolume(float v) { volTarget_.store(std::max(0.f, std::min(1.5f, v))); }
  double duration() const;
  bool playing() const { return playing_.load(); }
  // Called before rendering into a (new) stream at outRate; frame counting restarts at 0.
  void prepare(int outRate);
  // Audio thread: render n stereo frames whose first frame has stream index outFrame0.
  void render(float* out, int n, int64_t outFrame0);
  // Track position (seconds) at output frame index `presented` (may be fractional).
  // `playing` (optional) tells whether the music was moving at that frame.
  double posAtOutFrame(double presented, bool* playing = nullptr) const;
  // Last position rendered (no latency compensation).
  double renderedPos() const { return renderedPos_.load(); }

 private:
  struct Anchor {
    int64_t outFrame;
    double srcSec;
    double secPerFrame;  // track seconds per output frame (0 when paused)
  };
  void pushAnchor(int64_t outFrame, double srcSec, double spf);
  std::shared_ptr<const Kernel> kernelFor(double step);

  mutable std::mutex kmu_;  // guards building kernels (never taken on the audio thread)
  std::shared_ptr<Track> track_;
  std::shared_ptr<const Kernel> kernel_, kernelNext_;
  std::atomic<uint32_t> trackGen_{0};
  uint32_t seenGen_ = 0;
  std::atomic<double> seekTo_{-1};
  std::atomic<bool> playing_{false};
  std::atomic<double> speed_{1.0};
  std::atomic<float> volTarget_{0.8f};
  std::atomic<int> outRate_{48000};
  std::atomic<double> renderedPos_{0};
  // audio thread state
  double srcPos_ = 0;  // source frames
  float vol_ = 0.8f;
  bool wasPlaying_ = false;
  double lastSpf_ = -1;
  int64_t lastAnchorFrame_ = 0;
  // anchor history (seqlock per slot)
  static constexpr int H = 64;
  struct Slot {
    std::atomic<uint32_t> seq{0};
    std::atomic<int64_t> outFrame{0};
    std::atomic<double> srcSec{0}, spf{0};
  } slots_[H];
  std::atomic<uint32_t> head_{0};  // number of anchors pushed
  std::atomic<bool> reanchor_{true};
};

// ---------------------------------------------------------------- recorder
struct RecConfig {
  int mode = 0;        // 0 mic only, 1 mic hears the speaker, 2 clean mix (headphones), 3 clean mix + echo cancellation
  bool nc = false;     // noise cancellation
  float gainDb = 0;    // mic level
};

struct RecStats {
  double seconds = 0;          // recorded duration
  int64_t frames = 0;
  int rate = 48000;
  int64_t firstCaptureNs = 0;  // capture time of the first recorded sample (monotonic)
  int64_t lastCaptureNs = 0;   // capture time of the last recorded sample
  int64_t gapFrames = 0;       // input discontinuities seen by timestamps (OS-side dropouts)
  int64_t overflowFrames = 0;  // samples lost because the worker fell behind (should be 0)
  int musicJumps = 0;          // music timeline corrections (seek/pause/route change)
  bool hasMusic = false;
};

class Recorder {
 public:
  Recorder();
  ~Recorder();
  void configure(int inRate, const RecConfig& c);  // sets up processing for a (new) input stream
  int rate() const { return rate_; }
  void setNC(bool on);
  void setGain(float db) { gain_.store(std::pow(10.f, db / 20.f)); }
  float levelDb() const;
  // Input thread: n mono samples; captureNs = capture time of the first one (0 if unknown);
  // musicPos = track seconds the singer heard at that moment (NaN when the music is not playing);
  // musicSpeed = playback speed of the music.
  void onInput(const float* x, int n, int64_t captureNs, double musicPos, double musicSpeed);
  bool start(const std::string& voiceWav, const std::string& musicWav, std::shared_ptr<Track> music);
  void setPaused(bool p) { paused_.store(p); }
  bool recording() const { return recording_.load(); }
  size_t backlog() const { return raw_.available(); }  // samples waiting for the worker
  RecStats stop();

 private:
  struct Mark {
    int64_t k;         // recorded frame index of the block start
    double musicPos;   // NaN if not playing
    double speed;
    int64_t captureNs;
  };
  void worker();
  void processVoice(float* x, int n);

  int rate_ = 48000;
  RecConfig cfg_;
  std::unique_ptr<NoiseCancel> nc_;
  std::atomic<bool> ncOn_{false};
  Biquad hpf_, ess_, pres_;
  Compressor comp_;
  Limiter lim_;
  std::atomic<float> gain_{1}, peak_{0};

  SpscRing<float> raw_{1 << 21};
  SpscRing<Mark> marks_{1 << 12};
  std::atomic<bool> recording_{false}, paused_{false}, run_{false};
  std::atomic<int64_t> k_{0}, overflow_{0}, gaps_{0};
  int64_t lastCapNs_ = 0, lastCapK_ = -1;  // input thread
  std::atomic<int64_t> firstCapNs_{0}, lastBlockCapNs_{0};
  std::atomic<int> lastBlockN_{0};
  bool wasPaused_ = false;                 // input thread

  // worker state
  std::thread th_;
  std::FILE* vf_ = nullptr;
  std::FILE* mf_ = nullptr;
  int64_t written_ = 0;
  std::shared_ptr<Track> music_;
  std::unique_ptr<Kernel> mk_;
  double mPos_ = NAN, mSpeed_ = 1;
  int64_t mK_ = 0;
  int jumps_ = 0;
  std::vector<Mark> pending_;
};

// ---------------------------------------------------------------- WAV helpers
bool writeWavHeader(std::FILE* f, int ch, int rate, uint32_t dataBytes, bool isFloat = true);
void finishWav(std::FILE* f, int ch, int rate, bool isFloat = true);
struct Wav {
  int ch = 0, rate = 0;
  std::vector<float> data;  // interleaved
  int64_t frames() const { return ch ? int64_t(data.size()) / ch : 0; }
};
bool readWav(const std::string& path, Wav* out);
bool writeWav(const std::string& path, const Wav& w);

// ---------------------------------------------------------------- finishing a take
struct FinalizeOptions {
  int mode = 0;               // RecConfig::mode of the take
  double musicBalanceDb = 0;  // user's music level relative to the default balance
  double targetLufs = -14;    // integrated loudness of the result
  double ceilingDb = -1;      // true-peak ceiling (dBTP)
  double maxGainDb = 30;      // never amplify more than this (keeps room noise down)
};
struct FinalizeResult {
  bool ok = false;
  double voiceLufs = -120, musicLufs = -120, outLufs = -120, truePeakDb = -120, gainDb = 0, seconds = 0;
  std::string error;
};
FinalizeResult finalizeTake(const std::string& voiceWav, const std::string& musicWav, const std::string& outWav, const FinalizeOptions& o);
std::string toJson(const FinalizeResult& r);

// ---------------------------------------------------------------- vocal analysis
struct VocalMap {
  double hop = 0.01;                                // seconds per frame
  std::vector<float> score;                         // vocal-band centre energy, dB
  float on = 0, off = 0;                            // thresholds
  std::vector<std::pair<double, double>> regions;   // where the voice is
  std::vector<double> onsets;                       // vocal onsets
  std::vector<float> rise;                          // onset strength per frame (dB rise over 30 ms)
  bool vocalAt(double t) const;
  // time of the strongest rise in [a, b) of at least minDb, or NaN
  double strongestOnset(double a, double b, float minDb) const;
  double nextOnset(double t, double limit) const;   // first region start in [t, limit), or NaN
};
VocalMap analyzeVocals(const Track& t);
// Moves word starts that sit before the voice (intro, instrumental break) to the vocal onset
// that follows, never past the next word. words: [start, end] pairs in order.
int refineStarts(std::vector<std::pair<double, double>>& words, const VocalMap& v);

}  // namespace lectern
