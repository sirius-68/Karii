#include "core.h"

#include <chrono>
#include <cmath>
#include <ctime>
#include <deque>
#include <limits>

namespace lectern {

int64_t monoNs() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return int64_t(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}

std::shared_ptr<Track> makeTrack(const int16_t* pcm, int64_t frames, int channels, int rate) {
  auto t = std::make_shared<Track>();
  t->rate = rate > 0 ? rate : 48000;
  t->frames = frames;
  t->pcm.resize(size_t(frames) * 2);
  for (int64_t i = 0; i < frames; i++) {
    if (channels <= 1) {
      t->pcm[size_t(i) * 2] = t->pcm[size_t(i) * 2 + 1] = pcm[i];
    } else {
      t->pcm[size_t(i) * 2] = pcm[i * channels];
      t->pcm[size_t(i) * 2 + 1] = pcm[i * channels + 1];
    }
  }
  return t;
}

// ================================================================ Player
Player::Player() { kernel_ = std::make_shared<Kernel>(0.97); }

std::shared_ptr<const Kernel> Player::kernelFor(double step) {
  const double cutoff = std::min(1.0, step > 0 ? 1.0 / step : 1.0) * 0.97;
  auto k = std::atomic_load(&kernel_);
  if (k && std::fabs(k->cutoff() - cutoff) < 1e-6) return k;
  return std::make_shared<Kernel>(cutoff);
}

void Player::setTrack(std::shared_ptr<Track> t) {
  std::lock_guard<std::mutex> g(kmu_);
  playing_.store(false);
  if (t) std::atomic_store(&kernel_, kernelFor(double(t->rate) / outRate_.load() * speed_.load()));
  std::atomic_store(&track_, t);
  seekTo_.store(0.0);
  renderedPos_.store(0);
  trackGen_.fetch_add(1);
}

void Player::clearTrack() { setTrack(nullptr); }

std::shared_ptr<Track> Player::track() const { return std::atomic_load(&track_); }

double Player::duration() const {
  auto t = std::atomic_load(&track_);
  return t && t->rate > 0 ? double(t->frames) / t->rate : 0;
}

void Player::play() {
  auto t = std::atomic_load(&track_);
  if (!t || t->frames == 0) return;
  if (renderedPos_.load() >= duration() - 0.02 && seekTo_.load() < 0) seekTo_.store(0.0);
  playing_.store(true);
}

void Player::pause() { playing_.store(false); }

void Player::seek(double sec) { seekTo_.store(std::max(0.0, std::min(duration(), sec))); }

void Player::setSpeed(double s) {
  s = std::max(0.25, std::min(2.0, s));
  std::lock_guard<std::mutex> g(kmu_);
  speed_.store(s);
  auto t = std::atomic_load(&track_);
  if (t) std::atomic_store(&kernel_, kernelFor(double(t->rate) / outRate_.load() * s));
}

void Player::prepare(int outRate) {
  std::lock_guard<std::mutex> g(kmu_);
  outRate_.store(outRate > 0 ? outRate : 48000);
  auto t = std::atomic_load(&track_);
  if (t) std::atomic_store(&kernel_, kernelFor(double(t->rate) / outRate_.load() * speed_.load()));
  // a new stream counts frames from 0: forget anchors of the old one
  for (auto& s : slots_) {
    s.seq.fetch_add(1);
    s.outFrame.store(std::numeric_limits<int64_t>::max());
    s.seq.fetch_add(1);
  }
  head_.store(0);
  reanchor_.store(true);
}

void Player::pushAnchor(int64_t outFrame, double srcSec, double spf) {
  const uint32_t h = head_.load(std::memory_order_relaxed);
  Slot& s = slots_[h % H];
  s.seq.fetch_add(1, std::memory_order_acq_rel);
  s.outFrame.store(outFrame, std::memory_order_relaxed);
  s.srcSec.store(srcSec, std::memory_order_relaxed);
  s.spf.store(spf, std::memory_order_relaxed);
  s.seq.fetch_add(1, std::memory_order_acq_rel);
  head_.store(h + 1, std::memory_order_release);
  lastAnchorFrame_ = outFrame;
  lastSpf_ = spf;
}

void Player::render(float* out, int n, int64_t outFrame0) {
  auto t = std::atomic_load(&track_);
  auto k = std::atomic_load(&kernel_);
  const uint32_t gen = trackGen_.load(std::memory_order_acquire);
  bool force = reanchor_.exchange(false);
  if (gen != seenGen_) { seenGen_ = gen; srcPos_ = 0; force = true; }
  const double sk = seekTo_.exchange(-1.0);
  if (sk >= 0 && t) { srcPos_ = sk * t->rate; force = true; }
  bool play = playing_.load(std::memory_order_relaxed) && t && t->frames > 0;
  const int outRate = outRate_.load(std::memory_order_relaxed);
  const double sp = speed_.load(std::memory_order_relaxed);
  const double step = t ? double(t->rate) / outRate * sp : 0;
  const double spf = play ? sp / outRate : 0;
  const double rate = t ? double(t->rate) : 48000.0;
  if (force || play != wasPlaying_ || spf != lastSpf_ || outFrame0 - lastAnchorFrame_ > outRate / 2)
    pushAnchor(outFrame0, srcPos_ / rate, spf);
  wasPlaying_ = play;
  const float volT = volTarget_.load(std::memory_order_relaxed);
  for (int i = 0; i < n; i++) {
    float l = 0, r = 0;
    if (play) {
      if (srcPos_ >= double(t->frames - 1)) {
        play = false;
        playing_.store(false);
        wasPlaying_ = false;
        pushAnchor(outFrame0 + i, srcPos_ / rate, 0);
      } else {
        k->stereo(t->pcm.data(), t->frames, srcPos_, &l, &r);
        srcPos_ += step;
      }
    }
    vol_ += (volT - vol_) * 0.002f;
    out[i * 2] = l * vol_;
    out[i * 2 + 1] = r * vol_;
  }
  renderedPos_.store(srcPos_ / rate, std::memory_order_relaxed);
}

double Player::posAtOutFrame(double presented, bool* playing) const {
  if (playing) *playing = false;
  const uint32_t h = head_.load(std::memory_order_acquire);
  if (h == 0) return renderedPos_.load();
  const double dur = duration();
  double oldest = renderedPos_.load();
  const uint32_t lo = h > uint32_t(H) - 2 ? h - (H - 2) : 0;  // leave room for a slot being written
  for (uint32_t i = h; i-- > lo;) {
    const Slot& s = slots_[i % H];
    int64_t f;
    double src, spf;
    uint32_t a, b;
    int tries = 0;
    do {
      a = s.seq.load(std::memory_order_acquire);
      f = s.outFrame.load(std::memory_order_relaxed);
      src = s.srcSec.load(std::memory_order_relaxed);
      spf = s.spf.load(std::memory_order_relaxed);
      b = s.seq.load(std::memory_order_acquire);
    } while ((a != b || (a & 1)) && ++tries < 100);
    if (f == std::numeric_limits<int64_t>::max()) continue;
    oldest = src;
    if (double(f) <= presented) {
      if (playing) *playing = spf > 0;
      return std::max(0.0, std::min(dur, src + (presented - double(f)) * spf));
    }
  }
  return oldest;
}

// ================================================================ WAV
static void put32(std::FILE* f, uint32_t v) { std::fwrite(&v, 4, 1, f); }
template <typename T>
static bool rd(std::FILE* f, T* v, size_t n = 1) { return std::fread(v, sizeof(T), n, f) == n; }
static void put16(std::FILE* f, uint16_t v) { std::fwrite(&v, 2, 1, f); }

// 32-bit float WAV (format 3) when ch > 0 for stems; header rewritten by finishWav.
bool writeWavHeader(std::FILE* f, int ch, int rate, uint32_t dataBytes, bool isFloat) {
  if (!f) return false;
  const int bps = isFloat ? 4 : 2;
  std::fwrite("RIFF", 1, 4, f); put32(f, 36 + dataBytes); std::fwrite("WAVE", 1, 4, f);
  std::fwrite("fmt ", 1, 4, f); put32(f, 16); put16(f, isFloat ? 3 : 1); put16(f, uint16_t(ch)); put32(f, uint32_t(rate));
  put32(f, uint32_t(rate * ch * bps)); put16(f, uint16_t(ch * bps)); put16(f, uint16_t(bps * 8));
  std::fwrite("data", 1, 4, f); put32(f, dataBytes);
  return true;
}

void finishWav(std::FILE* f, int ch, int rate, bool isFloat) {
  if (!f) return;
  std::fflush(f);
  const long end = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  writeWavHeader(f, ch, rate, uint32_t(std::max(0L, end - 44)), isFloat);
  std::fclose(f);
}

bool readWav(const std::string& path, Wav* out) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  char id[4];
  uint32_t sz;
  if (!rd(f, id, 4) || std::memcmp(id, "RIFF", 4) != 0 || !rd(f, &sz) || !rd(f, id, 4)) { std::fclose(f); return false; }
  int fmt = 0, ch = 0, rate = 0, bits = 0;
  bool ok = false;
  while (std::fread(id, 1, 4, f) == 4 && std::fread(&sz, 4, 1, f) == 1) {
    if (std::memcmp(id, "fmt ", 4) == 0) {
      uint16_t a, c, ba, b;
      uint32_t r, br;
      if (!rd(f, &a) || !rd(f, &c) || !rd(f, &r) || !rd(f, &br) || !rd(f, &ba) || !rd(f, &b)) break;
      fmt = a; ch = c; rate = int(r); bits = b;
      if (fmt == 0xFFFE) fmt = bits == 32 ? 3 : 1;  // WAVE_FORMAT_EXTENSIBLE: assume the obvious
      if (sz > 16) std::fseek(f, long(sz - 16), SEEK_CUR);
    } else if (std::memcmp(id, "data", 4) == 0) {
      if (ch <= 0) break;
      // a header left at 0 (crash before finishing): read to the end of the file
      const long here = std::ftell(f);
      std::fseek(f, 0, SEEK_END);
      const long avail = std::ftell(f) - here;
      std::fseek(f, here, SEEK_SET);
      const long bytes = (sz == 0 || long(sz) > avail) ? avail : long(sz);
      if (fmt == 3 && bits == 32) {
        out->data.resize(size_t(bytes / 4));
        out->data.resize(std::fread(out->data.data(), 4, out->data.size(), f));
        ok = true;
      } else if (fmt == 1 && bits == 16) {
        std::vector<int16_t> s(size_t(bytes / 2));
        s.resize(std::fread(s.data(), 2, s.size(), f));
        out->data.resize(s.size());
        for (size_t i = 0; i < s.size(); i++) out->data[i] = s[i] / 32768.f;
        ok = true;
      }
      break;
    } else {
      std::fseek(f, long(sz + (sz & 1)), SEEK_CUR);
    }
  }
  std::fclose(f);
  out->ch = ch;
  out->rate = rate;
  if (ok) out->data.resize(size_t(out->frames()) * ch);
  return ok;
}

// 16-bit PCM WAV with TPDF dither (the format the AAC encoder takes).
bool writeWav(const std::string& path, const Wav& w) {
  std::FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return false;
  const uint32_t bytes = uint32_t(w.data.size() * 2);
  std::fwrite("RIFF", 1, 4, f); put32(f, 36 + bytes); std::fwrite("WAVE", 1, 4, f);
  std::fwrite("fmt ", 1, 4, f); put32(f, 16); put16(f, 1); put16(f, uint16_t(w.ch)); put32(f, uint32_t(w.rate));
  put32(f, uint32_t(w.rate * w.ch * 2)); put16(f, uint16_t(w.ch * 2)); put16(f, 16);
  std::fwrite("data", 1, 4, f); put32(f, bytes);
  std::vector<int16_t> buf(8192);
  uint32_t seed = 22222;
  auto rnd = [&seed]() { seed = seed * 1664525u + 1013904223u; return float(seed >> 8) / 16777216.f; };
  size_t i = 0;
  while (i < w.data.size()) {
    const size_t n = std::min(buf.size(), w.data.size() - i);
    for (size_t j = 0; j < n; j++) {
      const float d = (rnd() - rnd()) / 32768.f;
      const float v = std::max(-1.f, std::min(1.f, w.data[i + j] + d));
      buf[j] = int16_t(std::lrint(v * 32767.f));
    }
    std::fwrite(buf.data(), 2, n, f);
    i += n;
  }
  std::fclose(f);
  return true;
}

// ================================================================ Recorder
Recorder::Recorder() {}
Recorder::~Recorder() {
  if (recording_.load()) stop();
}

void Recorder::configure(int inRate, const RecConfig& c) {
  if (recording_.load()) return;  // an input stream reopened mid-take keeps the take's processing
  rate_ = inRate > 0 ? inRate : 48000;
  cfg_ = c;
  const float fs = float(rate_);
  nc_.reset(new NoiseCancel(fs));
  ncOn_.store(c.nc);
  nc_->setAmount(c.nc ? 1.f : 0.f);
  hpf_ = Biquad();
  hpf_.highpass(fs, c.mode >= 2 ? 90.0 : 50.0);
  ess_ = Biquad();
  ess_.peaking(fs, 6800, 2, -2);
  pres_ = Biquad();
  pres_.peaking(fs, 3000, 0.9, 1.5);
  comp_.setup(fs, c.mode >= 2 ? -24.f : -22.f, c.mode >= 2 ? 2.5f : 2.f, 0.008f, 0.2f, 0.f);
  lim_.setup(fs, -0.3f);
  setGain(c.gainDb);
}

void Recorder::setNC(bool on) {
  ncOn_.store(on);
  if (nc_) nc_->setAmount(on ? 1.f : 0.f);
}

float Recorder::levelDb() const {
  const float p = peak_.load();
  return p > 1e-6f ? 20.f * std::log10(p) : -90.f;
}

void Recorder::onInput(const float* x, int n, int64_t captureNs, double musicPos, double musicSpeed) {
  const float g = gain_.load(std::memory_order_relaxed);
  float pk = 0;
  for (int i = 0; i < n; i++) pk = std::max(pk, std::fabs(x[i]) * g);
  peak_.store(std::max(pk, peak_.load(std::memory_order_relaxed) * 0.85f), std::memory_order_relaxed);
  if (!recording_.load(std::memory_order_acquire)) return;
  if (paused_.load(std::memory_order_relaxed)) { wasPaused_ = true; return; }
  if (captureNs > 0 && lastCapNs_ > 0 && !wasPaused_) {
    const double expect = double(lastCapNs_) + double(lastBlockN_.load(std::memory_order_relaxed)) * 1e9 / rate_;
    const double gapNs = double(captureNs) - expect;
    if (gapNs > 0.015e9) gaps_.fetch_add(int64_t(gapNs * rate_ / 1e9));
  }
  wasPaused_ = false;
  const int64_t k = k_.load(std::memory_order_relaxed);
  Mark m{k, musicPos, musicSpeed, captureNs};
  marks_.write(&m, 1);
  if (firstCapNs_.load(std::memory_order_relaxed) == 0 && captureNs > 0) firstCapNs_.store(captureNs);
  const size_t w = raw_.write(x, size_t(n));
  if (w < size_t(n)) overflow_.fetch_add(int64_t(n) - int64_t(w));
  k_.store(k + int64_t(w), std::memory_order_release);
  lastCapNs_ = captureNs;
  lastBlockN_.store(n, std::memory_order_relaxed);
  if (captureNs > 0) lastBlockCapNs_.store(captureNs + int64_t(double(n) * 1e9 / rate_));
}

bool Recorder::start(const std::string& voiceWav, const std::string& musicWav, std::shared_ptr<Track> music) {
  if (recording_.load()) stop();
  raw_.clear();
  marks_.clear();
  k_.store(0);
  overflow_.store(0);
  gaps_.store(0);
  firstCapNs_.store(0);
  lastBlockCapNs_.store(0);
  lastCapNs_ = 0;
  wasPaused_ = false;
  written_ = 0;
  jumps_ = 0;
  mPos_ = NAN;
  mK_ = 0;
  pending_.clear();
  vf_ = std::fopen(voiceWav.c_str(), "wb");
  if (!vf_) return false;
  writeWavHeader(vf_, 1, rate_, 0);
  music_ = (cfg_.mode >= 2 && music && !musicWav.empty()) ? music : nullptr;
  mf_ = nullptr;
  if (music_) {
    mf_ = std::fopen(musicWav.c_str(), "wb");
    if (mf_) writeWavHeader(mf_, 2, rate_, 0, false);
    else music_ = nullptr;
    if (music_) mk_.reset(new Kernel(std::min(1.0, double(rate_) / music_->rate) * 0.97));
  }
  paused_.store(false);
  run_.store(true);
  th_ = std::thread([this] { worker(); });
  recording_.store(true, std::memory_order_release);
  return true;
}

void Recorder::processVoice(float* x, int n) {
  const float g = gain_.load(std::memory_order_relaxed);
  const bool digital = cfg_.mode >= 2;
  for (int i = 0; i < n; i++) {
    float v = x[i];
    v = nc_->process(v);
    v = hpf_.process(v);
    v = comp_.process(v);
    if (digital) v = pres_.process(ess_.process(v));
    v *= g;
    x[i] = v;  // stems are float: no clipping here, the final mix limits the peaks
  }
}

void Recorder::worker() {
  std::vector<float> buf(4096);
  std::vector<int16_t> mus(8192);
  Mark m;
  const int ncLat = NoiseCancel::latency();
  int64_t skipLeft = ncLat;  // the noise canceller delays the voice by its latency: drop it
  while (true) {
    while (marks_.read(&m, 1) == 1) pending_.push_back(m);
    const size_t n = raw_.read(buf.data(), buf.size());
    if (n == 0) {
      if (!run_.load(std::memory_order_acquire) && raw_.available() == 0) break;
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      continue;
    }
    processVoice(buf.data(), int(n));
    // voice: written after the NC latency is skipped, so it lines up with the timeline
    size_t from = 0;
    if (skipLeft > 0) {
      from = size_t(std::min<int64_t>(skipLeft, int64_t(n)));
      skipLeft -= int64_t(from);
    }
    if (n > from) std::fwrite(buf.data() + from, 4, n - from, vf_);
    // music the singer heard, for the same recorded frames
    if (music_ && mf_) {
      size_t mi = 0;
      for (size_t i = 0; i < n; i++) {
        const int64_t f = written_ + int64_t(i);
        size_t used = 0;
        for (; used < pending_.size() && pending_[used].k <= f; used++) {
          const Mark& q = pending_[used];
          if (std::isnan(q.musicPos)) {
            mPos_ = NAN;
          } else if (std::isnan(mPos_)) {
            mPos_ = q.musicPos; mK_ = q.k; mSpeed_ = q.speed;
          } else {
            const double pred = mPos_ + double(q.k - mK_) * mSpeed_ / rate_;
            const double d = q.musicPos - pred;
            if (std::fabs(d) > 0.04 || q.speed != mSpeed_) { mPos_ = q.musicPos; jumps_++; }
            else mPos_ = pred + d * 0.02;  // follow the clock gently: no audible jitter
            mK_ = q.k; mSpeed_ = q.speed;
          }
        }
        if (used) pending_.erase(pending_.begin(), pending_.begin() + long(used));
        float l = 0, r = 0;
        double pos = NAN;
        if (!std::isnan(mPos_)) {
          pos = mPos_ + double(f - mK_) * mSpeed_ / rate_;
        } else if (!pending_.empty() && !std::isnan(pending_.front().musicPos) && pending_.front().k - f < 4096) {
          // the music starts within this block: the next mark tells exactly where it began
          const Mark& q = pending_.front();
          const double back = q.musicPos - double(q.k - f) * q.speed / rate_;
          if (back >= 0) pos = back;
        }
        if (!std::isnan(pos)) {
          if (pos >= 0 && pos * music_->rate < double(music_->frames - 1)) mk_->stereo(music_->pcm.data(), music_->frames, pos * music_->rate, &l, &r);
        }
        mus[mi++] = int16_t(std::lrint(std::max(-1.f, std::min(1.f, l)) * 32767.f));
        mus[mi++] = int16_t(std::lrint(std::max(-1.f, std::min(1.f, r)) * 32767.f));
        if (mi == mus.size()) { std::fwrite(mus.data(), 2, mi, mf_); mi = 0; }
      }
      if (mi) std::fwrite(mus.data(), 2, mi, mf_);
    } else {
      // keep the mark list short when there is no music stem
      size_t used = 0;
      for (; used < pending_.size() && pending_[used].k <= written_ + int64_t(n); used++) {}
      if (used) pending_.erase(pending_.begin(), pending_.begin() + long(used));
    }
    written_ += int64_t(n);
  }
  // flush the noise canceller's tail so the voice is as long as the timeline
  std::vector<float> zeros(size_t(ncLat), 0.f);
  processVoice(zeros.data(), ncLat);
  const int64_t tail = std::min<int64_t>(ncLat, ncLat - skipLeft);
  if (tail > 0) std::fwrite(zeros.data(), 4, size_t(tail), vf_);
}

RecStats Recorder::stop() {
  RecStats s;
  if (!recording_.exchange(false)) return s;
  run_.store(false);
  if (th_.joinable()) th_.join();
  finishWav(vf_, 1, rate_);
  vf_ = nullptr;
  s.hasMusic = mf_ != nullptr;
  finishWav(mf_, 2, rate_, false);
  mf_ = nullptr;
  music_.reset();
  s.frames = written_;
  s.rate = rate_;
  s.seconds = double(written_) / rate_;
  s.firstCaptureNs = firstCapNs_.load();
  s.lastCaptureNs = lastBlockCapNs_.load();
  s.gapFrames = gaps_.load();
  s.overflowFrames = overflow_.load();
  s.musicJumps = jumps_;
  return s;
}

// ================================================================ finishing a take
static double clampGain(double db, double maxUp) { return std::max(-30.0, std::min(maxUp, db)); }
static float dbToLin(double db) { return float(std::pow(10.0, db / 20.0)); }

FinalizeResult finalizeTake(const std::string& voiceWav, const std::string& musicWav, const std::string& outWav, const FinalizeOptions& o) {
  FinalizeResult res;
  Wav v;
  if (!readWav(voiceWav, &v) || v.ch < 1 || v.frames() == 0) { res.error = "voice recording missing"; return res; }
  const int fs = v.rate;
  const int64_t n = v.frames();
  std::vector<float> voice(static_cast<size_t>(n));
  for (int64_t i = 0; i < n; i++) voice[size_t(i)] = v.data[size_t(i) * v.ch];
  v.data.clear();
  v.data.shrink_to_fit();
  res.seconds = double(n) / fs;

  // evening out the voice for small speakers: slow RMS compressor, 2.5:1 above (loudness + 4 dB)
  {
    const float* p = voice.data();
    const double vl = integratedLoudness({p, p}, n, fs);
    if (vl > -70) {
      const double thr = vl + 4 - 3.01;  // mono duplicated to stereo reads 3 dB louder
      const float ka = std::exp(-1.f / (0.01f * fs)), kr = std::exp(-1.f / (0.15f * fs));
      float env = 0;
      for (auto& x : voice) {
        const float e2 = x * x;
        env = e2 > env ? ka * env + (1 - ka) * e2 : kr * env + (1 - kr) * e2;
        const double db = 10 * std::log10(env + 1e-12);
        if (db > thr) x *= dbToLin(-(db - thr) * (1 - 1 / 2.5));
      }
    }
  }
  std::vector<float> L(static_cast<size_t>(n)), R(static_cast<size_t>(n));
  {
    const float* p = voice.data();
    res.voiceLufs = integratedLoudness({p, p}, n, fs);
  }
  Wav m;
  const bool mix = o.mode >= 2 && !musicWav.empty() && readWav(musicWav, &m) && m.ch == 2 && m.rate == fs;
  if (mix) {
    const int64_t mn = std::min(n, m.frames());
    std::vector<float> ml(static_cast<size_t>(n), 0.f), mr(static_cast<size_t>(n), 0.f);
    for (int64_t i = 0; i < mn; i++) { ml[size_t(i)] = m.data[size_t(i) * 2]; mr[size_t(i)] = m.data[size_t(i) * 2 + 1]; }
    m.data.clear();
    res.musicLufs = integratedLoudness({ml.data(), mr.data()}, n, fs);
    const double gv = res.voiceLufs > -70 ? clampGain(-16 - res.voiceLufs, o.maxGainDb) : 0;
    const double gm = res.musicLufs > -70 ? clampGain(-16 - 4 + o.musicBalanceDb - res.musicLufs, 24) : 0;
    const float a = dbToLin(gv), b = dbToLin(gm);
    for (int64_t i = 0; i < n; i++) {
      L[size_t(i)] = voice[size_t(i)] * a + ml[size_t(i)] * b;
      R[size_t(i)] = voice[size_t(i)] * a + mr[size_t(i)] * b;
    }
  } else {
    for (int64_t i = 0; i < n; i++) L[size_t(i)] = R[size_t(i)] = voice[size_t(i)];
  }
  voice.clear();
  voice.shrink_to_fit();
  // master loudness
  const double before = integratedLoudness({L.data(), R.data()}, n, fs);
  res.gainDb = before > -70 ? clampGain(o.targetLufs - before, o.maxGainDb) : 0;
  const float g = dbToLin(res.gainDb);
  for (int64_t i = 0; i < n; i++) { L[size_t(i)] *= g; R[size_t(i)] *= g; }
  // true-peak limiter: required gain per sample, min over +-W, averaged over +-W, slow release
  const float ceil = dbToLin(o.ceilingDb);
  const TruePeak tp;
  const int W = std::max(1, int(0.0015 * fs));
  std::vector<float> req(static_cast<size_t>(n));
  for (int64_t i = 0; i < n; i++) {
    const float p = std::max(tp.at(L.data(), n, i), tp.at(R.data(), n, i));
    req[size_t(i)] = p > ceil ? ceil / p : 1.f;
  }
  std::vector<float> mn(static_cast<size_t>(n));
  {
    std::deque<int64_t> dq;  // sliding minimum over [i-W, i+W]
    int64_t j = 0;
    for (int64_t i = 0; i < n; i++) {
      for (; j < n && j <= i + W; j++) {
        while (!dq.empty() && req[size_t(dq.back())] >= req[size_t(j)]) dq.pop_back();
        dq.push_back(j);
      }
      while (dq.front() < i - W) dq.pop_front();
      mn[size_t(i)] = req[size_t(dq.front())];
    }
  }
  // moving average of the minimum over [i-W, i+W] (outside the take counts as 1.0): at a peak every
  // value averaged is at most the gain that peak needs, so the result never lets it through
  std::vector<double> ps(static_cast<size_t>(n) + 1, 0.0);
  for (int64_t i = 0; i < n; i++) ps[size_t(i) + 1] = ps[size_t(i)] + mn[size_t(i)];
  {
    const float kr = std::exp(-1.f / (0.06f * fs));
    float env = 1;
    for (int64_t i = 0; i < n; i++) {
      const int64_t a = i - W, b = i + W;
      const double sum = ps[size_t(std::min<int64_t>(b, n - 1)) + 1] - ps[size_t(std::max<int64_t>(a, 0))];
      const double outside = double(a < 0 ? -a : 0) + double(b > n - 1 ? b - (n - 1) : 0);
      const float t = float((sum + outside) / double(2 * W + 1));
      env = t < env ? t : env + (t - env) * (1 - kr);  // instant attack (already smoothed), slow release
      L[size_t(i)] *= env;
      R[size_t(i)] *= env;
    }
  }
  float peak = 0;
  for (int64_t i = 0; i < n; i++) peak = std::max(peak, std::max(tp.at(L.data(), n, i), tp.at(R.data(), n, i)));
  if (peak > ceil) {  // safety net for the rare case the smoothing let something through
    const float k = ceil / peak;
    for (int64_t i = 0; i < n; i++) { L[size_t(i)] *= k; R[size_t(i)] *= k; }
    peak = ceil;
  }
  res.truePeakDb = peak > 0 ? 20 * std::log10(peak) : -120;
  res.outLufs = integratedLoudness({L.data(), R.data()}, n, fs);
  Wav out;
  out.ch = 2;
  out.rate = fs;
  out.data.resize(size_t(n) * 2);
  for (int64_t i = 0; i < n; i++) { out.data[size_t(i) * 2] = L[size_t(i)]; out.data[size_t(i) * 2 + 1] = R[size_t(i)]; }
  if (!writeWav(outWav, out)) { res.error = "couldn't write the mix"; return res; }
  res.ok = true;
  return res;
}

std::string toJson(const FinalizeResult& r) {
  char b[512];
  std::snprintf(b, sizeof b,
                "{\"ok\":%s,\"voiceLufs\":%.2f,\"musicLufs\":%.2f,\"outLufs\":%.2f,\"truePeak\":%.2f,\"gain\":%.2f,\"seconds\":%.3f,\"error\":\"%s\"}",
                r.ok ? "true" : "false", r.voiceLufs, r.musicLufs, r.outLufs, r.truePeakDb, r.gainDb, r.seconds, r.error.c_str());
  return b;
}

// ================================================================ vocal analysis
bool VocalMap::vocalAt(double t) const {
  size_t lo = 0, hi = regions.size();
  while (lo < hi) {
    const size_t m = (lo + hi) / 2;
    if (regions[m].second < t) lo = m + 1;
    else hi = m;
  }
  return lo < regions.size() && regions[lo].first <= t && t <= regions[lo].second;
}

double VocalMap::nextOnset(double t, double limit) const {
  for (const auto& r : regions) {
    if (r.first >= t && r.first < limit) return r.first;
    if (r.first >= limit) break;
  }
  return NAN;
}

VocalMap analyzeVocals(const Track& t) {
  VocalMap v;
  const int fs = t.rate;
  const int hop = std::max(1, int(fs * v.hop));
  const int64_t nf = t.frames / hop;
  if (nf < 10) return v;
  Biquad mh1, mh2, ml1, ml2, sh1, sh2, sl1, sl2;
  for (Biquad* b : {&mh1, &mh2, &sh1, &sh2}) b->highpass(fs, 220);
  for (Biquad* b : {&ml1, &ml2, &sl1, &sl2}) b->lowpass(fs, 3800);
  std::vector<double> em(size_t(nf), 0), es(size_t(nf), 0);
  double totM = 0, totS = 0;
  for (int64_t i = 0; i < nf * hop; i++) {
    const float l = t.pcm[size_t(i) * 2] / 32768.f, r = t.pcm[size_t(i) * 2 + 1] / 32768.f;
    const float mid = ml2.process(ml1.process(mh2.process(mh1.process(0.5f * (l + r)))));
    const float side = sl2.process(sl1.process(sh2.process(sh1.process(0.5f * (l - r)))));
    em[size_t(i / hop)] += double(mid) * mid;
    es[size_t(i / hop)] += double(side) * side;
    totM += double(mid) * mid;
    totS += double(side) * side;
  }
  const bool stereo = totS > totM * 1e-3;
  v.score.resize(size_t(nf));
  for (int64_t f = 0; f < nf; f++) {
    // 30 ms window: this hop and its neighbours
    double m = em[size_t(f)], s = es[size_t(f)];
    if (f > 0) { m += em[size_t(f - 1)]; s += es[size_t(f - 1)]; }
    if (f + 1 < nf) { m += em[size_t(f + 1)]; s += es[size_t(f + 1)]; }
    const double c = stereo ? std::max(m - 1.2 * s, 0.03 * m) : m;
    v.score[size_t(f)] = float(10 * std::log10(c / (3.0 * hop) + 1e-12));
  }
  std::vector<float> srt;
  for (float x : v.score) if (x > -90) srt.push_back(x);
  if (srt.size() < 10) return v;
  std::sort(srt.begin(), srt.end());
  auto q = [&](double p) { return srt[size_t(p * (srt.size() - 1))]; };
  const float lo = q(0.2), hi = q(0.95);
  v.on = lo + 0.5f * (hi - lo);
  v.off = lo + 0.33f * (hi - lo);
  // hysteresis: in after 80 ms above "on", out after 250 ms below "off"
  bool in = false;
  int run = 0;
  int64_t start = 0;
  for (int64_t f = 0; f < nf; f++) {
    const float x = v.score[size_t(f)];
    if (!in) {
      run = x > v.on ? run + 1 : 0;
      if (run >= 8) { in = true; start = f - run + 1; run = 0; }
    } else {
      run = x < v.off ? run + 1 : 0;
      if (run >= 25) {
        in = false;
        v.regions.push_back({start * v.hop, (f - run + 1) * v.hop});
        run = 0;
      }
    }
  }
  if (in) v.regions.push_back({start * v.hop, nf * v.hop});
  // merge short gaps, drop blips
  std::vector<std::pair<double, double>> out;
  for (const auto& r : v.regions) {
    if (!out.empty() && r.first - out.back().second < 0.25) out.back().second = r.second;
    else out.push_back(r);
  }
  v.regions.clear();
  for (const auto& r : out) if (r.second - r.first >= 0.15) v.regions.push_back(r);
  for (const auto& r : v.regions) v.onsets.push_back(r.first);
  return v;
}

int refineStarts(std::vector<std::pair<double, double>>& w, const VocalMap& v) {
  if (v.regions.empty()) return 0;
  int moved = 0;
  for (size_t i = 0; i < w.size(); i++) {
    const double s = w[i].first;
    if (v.vocalAt(s) || v.vocalAt(s + 0.12)) continue;
    const double nx = i + 1 < w.size() ? w[i + 1].first : s + 30;
    const double t = v.nextOnset(s, nx - 0.05);
    if (std::isnan(t)) continue;
    w[i].first = t;
    w[i].second = std::max(w[i].second, std::min(nx - 0.01, t + 0.15));
    moved++;
  }
  return moved;
}

}  // namespace lectern
