// Small DSP building blocks used by the engine. Everything here is allocation-free after
// construction so it is safe on the real-time audio thread.
#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace lectern {

// Single-producer single-consumer ring buffer of floats.
class Ring {
 public:
  explicit Ring(size_t capacityPow2 = 1 << 17) : buf_(capacityPow2), mask_(capacityPow2 - 1) {}
  size_t available() const { return w_.load(std::memory_order_acquire) - r_.load(std::memory_order_acquire); }
  size_t space() const { return buf_.size() - available(); }
  size_t write(const float* src, size_t n) {
    const size_t w = w_.load(std::memory_order_relaxed);
    const size_t free = buf_.size() - (w - r_.load(std::memory_order_acquire));
    if (n > free) n = free;
    for (size_t i = 0; i < n; i++) buf_[(w + i) & mask_] = src[i];
    w_.store(w + n, std::memory_order_release);
    return n;
  }
  size_t read(float* dst, size_t n) {
    const size_t r = r_.load(std::memory_order_relaxed);
    const size_t avail = w_.load(std::memory_order_acquire) - r;
    if (n > avail) n = avail;
    for (size_t i = 0; i < n; i++) dst[i] = buf_[(r + i) & mask_];
    r_.store(r + n, std::memory_order_release);
    return n;
  }
  void skip(size_t n) {
    const size_t r = r_.load(std::memory_order_relaxed);
    const size_t avail = w_.load(std::memory_order_acquire) - r;
    if (n > avail) n = avail;
    r_.store(r + n, std::memory_order_release);
  }
  void clear() { r_.store(w_.load(std::memory_order_acquire), std::memory_order_release); }

 private:
  std::vector<float> buf_;
  size_t mask_;
  std::atomic<size_t> w_{0}, r_{0};
};

struct Biquad {
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
  void highpass(float fs, float f, float q = 0.707f) {
    const float w = 2.f * float(M_PI) * f / fs, c = std::cos(w), s = std::sin(w), al = s / (2 * q);
    const float a0 = 1 + al;
    b0 = (1 + c) / 2 / a0; b1 = -(1 + c) / a0; b2 = (1 + c) / 2 / a0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  void peaking(float fs, float f, float q, float gainDb) {
    const float A = std::pow(10.f, gainDb / 40.f), w = 2.f * float(M_PI) * f / fs, c = std::cos(w), s = std::sin(w), al = s / (2 * q);
    const float a0 = 1 + al / A;
    b0 = (1 + al * A) / a0; b1 = -2 * c / a0; b2 = (1 - al * A) / a0; a1 = -2 * c / a0; a2 = (1 - al / A) / a0;
  }
  inline float process(float x) {
    const float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
  void reset() { z1 = z2 = 0; }
};

// Gentle compressor (feed-forward, RMS-ish) used to shape the voice in the digital mix.
struct Compressor {
  float thresh = -26, ratio = 2.5f, attack = 0.01f, release = 0.22f, env = 0, ka = 0, kr = 0, makeup = 1;
  void setup(float fs, float t, float r, float a, float rel, float makeupDb) {
    thresh = t; ratio = r; ka = std::exp(-1.f / (a * fs)); kr = std::exp(-1.f / (rel * fs)); makeup = std::pow(10.f, makeupDb / 20.f);
  }
  inline float process(float x) {
    const float a = std::fabs(x);
    env = a > env ? ka * env + (1 - ka) * a : kr * env + (1 - kr) * a;
    const float db = 20.f * std::log10(env + 1e-9f);
    float g = 1;
    if (db > thresh) g = std::pow(10.f, ((thresh + (db - thresh) / ratio) - db) / 20.f);
    return x * g * makeup;
  }
};

// Brick-wall-ish peak limiter followed by a soft clipper.
struct Limiter {
  float ceil = 0.95f, env = 1, kr = 0.9995f;
  void setup(float fs, float ceilDb = -0.5f) { ceil = std::pow(10.f, ceilDb / 20.f); kr = std::exp(-1.f / (0.08f * fs)); }
  inline float gainFor(float peak) {
    const float need = peak > ceil ? ceil / peak : 1.f;
    env = need < env ? need : kr * env + (1 - kr) * need;
    return env;
  }
  static inline float softclip(float x) {
    const float k = 0.7f, c = 0.966f, a = std::fabs(x);
    if (a <= k) return x;
    const float y = k + (c - k) * std::tanh((a - k) / (c - k));
    return x < 0 ? -y : y;
  }
};

// Music-safe noise cancellation: short-time spectral gating with a noise floor learned by
// minimum statistics over ~8 s, at most 12 dB of reduction, constant 1024-sample latency.
class NoiseCancel {
 public:
  explicit NoiseCancel(float fs) : fs_(fs) {
    for (int i = 0; i < N; i++) win_[i] = std::sqrt(0.5f - 0.5f * std::cos(2 * float(M_PI) * i / N));
    for (int i = 0; i < N / 2; i++) { cos_[i] = std::cos(2 * float(M_PI) * i / N); sin_[i] = std::sin(2 * float(M_PI) * i / N); }
    for (int i = 0, j = 0; i < N; i++) {
      rev_[i] = j;
      int b = N >> 1;
      while (j & b) { j ^= b; b >>= 1; }
      j |= b;
    }
    std::fill(std::begin(cur_), std::end(cur_), 1e9f);
    std::fill(std::begin(hmin_), std::end(hmin_), 1e9f);
    for (auto& h : hist_) std::fill(std::begin(h), std::end(h), 1e9f);
    std::fill(std::begin(G_), std::end(G_), 1.f);
    block_ = int(fs * 0.5f / H);
    w_ = N;
  }
  void setAmount(float a) { target_.store(a); }
  // Processes one sample in, one sample out (delayed by N samples).
  inline float process(float x) {
    fifo_[fp_++] = x;
    if (fp_ == H) { frame(); fp_ = 0; }
    const float y = ring_[r_];
    ring_[r_] = 0;
    r_ = (r_ + 1) & (Q - 1);
    return y;
  }
  static constexpr int latency() { return N; }

 private:
  static constexpr int N = 1024, H = 256, B = N / 2 + 1, M = 16, Q = 16384;
  float fs_;
  float win_[N], cos_[N / 2], sin_[N / 2];
  int rev_[N];
  float fifo_[H] = {}, ana_[N] = {}, ola_[N] = {}, re_[N] = {}, im_[N] = {};
  float P_[B] = {}, cur_[B], hist_[M][B], hmin_[B], G_[B], g_[B] = {};
  float ring_[Q] = {};
  int fp_ = 0, w_ = 0, r_ = 0, frames_ = 0, block_ = 1, hi_ = 0, hn_ = 0;
  float amt_ = 0;
  std::atomic<float> target_{0};

  void fft(float* re, float* im, bool inv) {
    for (int i = 0; i < N; i++) { const int j = rev_[i]; if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); } }
    for (int len = 2; len <= N; len <<= 1) {
      const int h = len >> 1, step = N / len;
      for (int i = 0; i < N; i += len)
        for (int k = 0; k < h; k++) {
          const float cr = cos_[k * step], ci = inv ? sin_[k * step] : -sin_[k * step];
          const int p = i + k, q = p + h;
          const float tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        }
    }
    if (inv) { const float s = 1.f / N; for (int i = 0; i < N; i++) { re[i] *= s; im[i] *= s; } }
  }
  void frame() {
    std::memmove(ana_, ana_ + H, sizeof(float) * (N - H));
    std::memcpy(ana_ + N - H, fifo_, sizeof(float) * H);
    for (int i = 0; i < N; i++) { re_[i] = ana_[i] * win_[i]; im_[i] = 0; }
    fft(re_, im_, false);
    amt_ += (target_.load(std::memory_order_relaxed) - amt_) * 0.08f;
    const float floorG = std::pow(10.f, -12.f * amt_ / 20.f);
    const bool first = frames_ < 4;
    for (int k = 0; k < B; k++) {
      const float p = re_[k] * re_[k] + im_[k] * im_[k];
      P_[k] = first ? p : P_[k] * 0.75f + p * 0.25f;
      if (!first && P_[k] < cur_[k]) cur_[k] = P_[k];
    }
    if (++frames_ % block_ == 0) {
      for (int k = 0; k < B; k++) { hist_[hi_][k] = cur_[k]; cur_[k] = 1e9f; }
      hi_ = (hi_ + 1) % M;
      if (hn_ < M) hn_++;
      for (int k = 0; k < B; k++) { float m = 1e9f; for (int q = 0; q < hn_; q++) m = std::min(m, hist_[q][k]); hmin_[k] = m; }
    }
    const bool off = amt_ < 0.001f;
    for (int k = 0; k < B; k++) {
      float n = std::min(hmin_[k], cur_[k]) * 3.f;
      g_[k] = off ? 1.f : std::max(floorG, 1.f - n / (P_[k] + 1e-12f));
    }
    for (int k = 0; k < B; k++) {
      const float s = (g_[k > 0 ? k - 1 : 0] + 2 * g_[k] + g_[k < B - 1 ? k + 1 : B - 1]) * 0.25f;
      G_[k] += (s - G_[k]) * (s > G_[k] ? 0.6f : 0.18f);
    }
    for (int k = 0; k < B; k++) {
      re_[k] *= G_[k]; im_[k] *= G_[k];
      if (k > 0 && k < B - 1) { re_[N - k] = re_[k]; im_[N - k] = -im_[k]; }
    }
    fft(re_, im_, true);
    for (int i = 0; i < N; i++) ola_[i] += re_[i] * win_[i] * 0.5f;
    for (int i = 0; i < H; i++) { ring_[w_] = ola_[i]; w_ = (w_ + 1) & (Q - 1); }
    std::memmove(ola_, ola_ + H, sizeof(float) * (N - H));
    std::memset(ola_ + N - H, 0, sizeof(float) * H);
  }
};

// High quality one-off resampler (windowed sinc), used when a track is loaded.
std::vector<int16_t> resample(const int16_t* in, int64_t frames, int ch, int inRate, int outRate, int64_t* outFrames);

}  // namespace lectern
