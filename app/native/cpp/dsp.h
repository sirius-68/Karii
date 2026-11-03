// DSP building blocks used by the engine. Everything used on a real-time audio thread is
// allocation-free after construction. Platform independent (unit-tested on Linux).
#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace lectern {

// Single-producer single-consumer ring buffer.
template <typename T>
class SpscRing {
 public:
  explicit SpscRing(size_t capacityPow2 = 1 << 17) : buf_(capacityPow2), mask_(capacityPow2 - 1) {}
  size_t available() const { return w_.load(std::memory_order_acquire) - r_.load(std::memory_order_acquire); }
  size_t capacity() const { return buf_.size(); }
  size_t write(const T* src, size_t n) {
    const size_t w = w_.load(std::memory_order_relaxed);
    const size_t free = buf_.size() - (w - r_.load(std::memory_order_acquire));
    if (n > free) n = free;
    for (size_t i = 0; i < n; i++) buf_[(w + i) & mask_] = src[i];
    w_.store(w + n, std::memory_order_release);
    return n;
  }
  size_t read(T* dst, size_t n) {
    const size_t r = r_.load(std::memory_order_relaxed);
    const size_t avail = w_.load(std::memory_order_acquire) - r;
    if (n > avail) n = avail;
    for (size_t i = 0; i < n; i++) dst[i] = buf_[(r + i) & mask_];
    r_.store(r + n, std::memory_order_release);
    return n;
  }
  void clear() { r_.store(w_.load(std::memory_order_acquire), std::memory_order_release); }

 private:
  std::vector<T> buf_;
  size_t mask_;
  std::atomic<size_t> w_{0}, r_{0};
};
using Ring = SpscRing<float>;

struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  double z1 = 0, z2 = 0;
  void highpass(double fs, double f, double q = 0.7071) {
    const double w = 2 * M_PI * f / fs, c = std::cos(w), al = std::sin(w) / (2 * q), a0 = 1 + al;
    b0 = (1 + c) / 2 / a0; b1 = -(1 + c) / a0; b2 = b0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  void lowpass(double fs, double f, double q = 0.7071) {
    const double w = 2 * M_PI * f / fs, c = std::cos(w), al = std::sin(w) / (2 * q), a0 = 1 + al;
    b0 = (1 - c) / 2 / a0; b1 = (1 - c) / a0; b2 = b0; a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  void peaking(double fs, double f, double q, double gainDb) {
    const double A = std::pow(10.0, gainDb / 40), w = 2 * M_PI * f / fs, c = std::cos(w), al = std::sin(w) / (2 * q), a0 = 1 + al / A;
    b0 = (1 + al * A) / a0; b1 = -2 * c / a0; b2 = (1 - al * A) / a0; a1 = -2 * c / a0; a2 = (1 - al / A) / a0;
  }
  inline float process(float x) {
    const double y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return float(y);
  }
  void reset() { z1 = z2 = 0; }
};

// Feed-forward compressor with a smooth envelope.
struct Compressor {
  float thresh = -26, ratio = 2.5f, env = 0, ka = 0, kr = 0, makeup = 1;
  void setup(float fs, float t, float r, float a, float rel, float makeupDb) {
    thresh = t; ratio = r; ka = std::exp(-1.f / (a * fs)); kr = std::exp(-1.f / (rel * fs)); makeup = std::pow(10.f, makeupDb / 20.f); env = 0;
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

// Sample-by-sample peak limiter (used live, for the level meter path).
struct Limiter {
  float ceil = 0.95f, env = 1, kr = 0.9995f;
  void setup(float fs, float ceilDb = -0.5f) { ceil = std::pow(10.f, ceilDb / 20.f); kr = std::exp(-1.f / (0.08f * fs)); env = 1; }
  inline float gainFor(float peak) {
    const float need = peak > ceil ? ceil / peak : 1.f;
    env = need < env ? need : kr * env + (1 - kr) * need;
    return env;
  }
};

// Windowed-sinc interpolation kernel (Kaiser window, 24 taps, 512 phases). Used to play a track
// at any output rate and speed, and to read music for the recording, without changing pitch or
// duration unless the speed is changed on purpose.
class Kernel {
 public:
  static constexpr int TAPS = 24, PHASES = 512;
  explicit Kernel(double cutoff) : cutoff_(std::min(1.0, std::max(0.05, cutoff))), table_(size_t(PHASES + 1) * TAPS) {
    const double beta = 8.0;
    auto bessel0 = [](double x) {
      double s = 1, t = 1;
      for (int k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; }
      return s;
    };
    const double i0b = bessel0(beta);
    for (int p = 0; p <= PHASES; p++) {
      const double frac = double(p) / PHASES;
      double sum = 0;
      for (int k = 0; k < TAPS; k++) {
        const double d = double(k - TAPS / 2 + 1) - frac;          // tap position relative to x
        const double u = d / (TAPS / 2.0);
        const double win = std::fabs(u) >= 1 ? 0 : bessel0(beta * std::sqrt(1 - u * u)) / i0b;
        const double sx = cutoff_ * d;
        const double sinc = std::fabs(sx) < 1e-12 ? 1.0 : std::sin(M_PI * sx) / (M_PI * sx);
        table_[size_t(p) * TAPS + k] = float(cutoff_ * sinc * win);
        sum += cutoff_ * sinc * win;
      }
      for (int k = 0; k < TAPS; k++) table_[size_t(p) * TAPS + k] = float(table_[size_t(p) * TAPS + k] / sum);  // unity DC gain
    }
  }
  double cutoff() const { return cutoff_; }
  // Interleaved stereo int16 source of `frames` frames, read at fractional position x.
  inline void stereo(const int16_t* src, int64_t frames, double x, float* l, float* r) const {
    const int64_t i0 = int64_t(std::floor(x));
    const double fr = x - double(i0);
    const double ph = fr * PHASES;
    const int p = std::min(PHASES - 1, int(ph));
    const float a = float(ph - p);
    const float* w0 = &table_[size_t(p) * TAPS];
    const float* w1 = w0 + TAPS;
    float L = 0, R = 0;
    const int64_t j0 = i0 - TAPS / 2 + 1;
    if (j0 >= 0 && j0 + TAPS <= frames) {
      const int16_t* s = src + j0 * 2;
      for (int k = 0; k < TAPS; k++) {
        const float w = w0[k] + (w1[k] - w0[k]) * a;
        L += w * s[k * 2];
        R += w * s[k * 2 + 1];
      }
    } else {
      for (int k = 0; k < TAPS; k++) {
        const int64_t j = j0 + k;
        if (j < 0 || j >= frames) continue;
        const float w = w0[k] + (w1[k] - w0[k]) * a;
        L += w * src[j * 2];
        R += w * src[j * 2 + 1];
      }
    }
    *l = L * (1.f / 32768.f);
    *r = R * (1.f / 32768.f);
  }

 private:
  double cutoff_;
  std::vector<float> table_;
};

// Noise cancellation: STFT Wiener filter with decision-directed a-priori SNR (Ephraim–Malah),
// noise floor by minimum statistics over ~8 s, at most 12 dB of reduction. The decision-directed
// estimate is what avoids the warbling "musical noise" (radio-like artefacts) that plain spectral
// gating produces. Constant latency of N samples.
class NoiseCancel {
 public:
  explicit NoiseCancel(float fs) {
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
    block_ = std::max(1, int(fs * 0.5f / H));
    w_ = N;
  }
  void setAmount(float a) { target_.store(a); }
  inline float process(float x) {
    fifo_[fp_++] = x;
    if (fp_ == H) { frame(); fp_ = 0; }
    const float y = ring_[r_];
    ring_[r_] = 0;
    r_ = (r_ + 1) & (Q - 1);
    return y;
  }
  // output sample t carries input sample t - (2N - H) (frames are finalised once fully overlapped)
  static constexpr int latency() { return 2 * N - H; }

 private:
  static constexpr int N = 1024, H = 256, B = N / 2 + 1, M = 16, Q = 16384;
  static constexpr float kBias = 3.0f;
  float win_[N], cos_[N / 2], sin_[N / 2];
  int rev_[N];
  float fifo_[H] = {}, ana_[N] = {}, ola_[N] = {}, re_[N] = {}, im_[N] = {};
  float P_[B] = {}, cur_[B], hist_[M][B], hmin_[B], G_[B], prevS_[B] = {};
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
      P_[k] = first ? p : P_[k] * 0.7f + p * 0.3f;
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
      const float p = re_[k] * re_[k] + im_[k] * im_[k];
      // the minimum of the smoothed spectrum underestimates the mean noise power: compensate
      const float noise = std::max(1e-12f, std::min(hmin_[k], cur_[k]) * kBias);
      const float post = p / noise;                                        // a-posteriori SNR
      const float prio = 0.98f * prevS_[k] / noise + 0.02f * std::max(post - 1.f, 0.f);  // decision-directed
      float g = off ? 1.f : std::max(floorG, prio / (1.f + prio));         // Wiener gain
      G_[k] += (g - G_[k]) * 0.5f;
      prevS_[k] = G_[k] * G_[k] * p;
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

// ---------------------------------------------------------------- loudness (ITU-R BS.1770-4)
struct KWeight {
  Biquad shelf, hp;
  explicit KWeight(double fs) {
    {  // stage 1: high shelf
      const double f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
      const double K = std::tan(M_PI * f0 / fs), Vh = std::pow(10.0, G / 20.0), Vb = std::pow(Vh, 0.4996667741545416);
      const double a0 = 1.0 + K / Q + K * K;
      shelf.b0 = (Vh + Vb * K / Q + K * K) / a0;
      shelf.b1 = 2.0 * (K * K - Vh) / a0;
      shelf.b2 = (Vh - Vb * K / Q + K * K) / a0;
      shelf.a1 = 2.0 * (K * K - 1.0) / a0;
      shelf.a2 = (1.0 - K / Q + K * K) / a0;
    }
    {  // stage 2: RLB high-pass
      const double f0 = 38.13547087602444, Q = 0.5003270373238773;
      const double K = std::tan(M_PI * f0 / fs), a0 = 1.0 + K / Q + K * K;
      hp.b0 = 1; hp.b1 = -2; hp.b2 = 1;
      hp.a1 = 2.0 * (K * K - 1.0) / a0;
      hp.a2 = (1.0 - K / Q + K * K) / a0;
    }
  }
  inline float process(float x) { return hp.process(shelf.process(x)); }
};

// Integrated loudness (LUFS) of planar channels, with the absolute (-70) and relative (-10) gates.
inline double integratedLoudness(const std::vector<const float*>& ch, int64_t frames, int fs) {
  const int64_t blk = int64_t(0.4 * fs), hop = int64_t(0.1 * fs);
  if (frames < blk || ch.empty()) return -120;
  std::vector<std::vector<double>> sq(ch.size());
  for (size_t c = 0; c < ch.size(); c++) {
    KWeight k(fs);
    sq[c].resize(size_t(frames / hop) + 1, 0.0);
    for (int64_t i = 0; i < frames; i++) {
      const double y = k.process(ch[c][i]);
      sq[c][size_t(i / hop)] += y * y;
    }
  }
  std::vector<double> z;  // per 400 ms block: sum over channels of mean square
  for (int64_t s = 0; s + blk <= frames; s += hop) {
    double acc = 0;
    for (size_t c = 0; c < ch.size(); c++)
      for (int64_t h = s / hop; h < (s + blk) / hop; h++) acc += sq[c][size_t(h)];
    z.push_back(acc / double(blk));
  }
  auto lufs = [](double v) { return -0.691 + 10.0 * std::log10(std::max(v, 1e-20)); };
  double sum = 0;
  int n = 0;
  for (double v : z) if (lufs(v) > -70) { sum += v; n++; }
  if (n == 0) return -120;
  const double rel = lufs(sum / n) - 10;
  sum = 0; n = 0;
  for (double v : z) if (lufs(v) > -70 && lufs(v) > rel) { sum += v; n++; }
  return n ? lufs(sum / n) : -120;
}

// True-peak estimate by 4x oversampling (BS.1770 Annex 2 style), per sample position.
class TruePeak {
 public:
  TruePeak() {
    const int taps = 12;  // per phase
    for (int p = 0; p < 4; p++) {
      double s = 0;
      for (int k = 0; k < taps; k++) {
        const double d = double(k - taps / 2 + 1) - p / 4.0;
        const double u = d / (taps / 2.0);
        const double win = std::fabs(u) >= 1 ? 0 : 0.5 + 0.5 * std::cos(M_PI * u);
        const double sinc = std::fabs(d) < 1e-12 ? 1 : std::sin(M_PI * d) / (M_PI * d);
        h_[p][k] = float(sinc * win);
        s += sinc * win;
      }
      for (int k = 0; k < taps; k++) h_[p][k] = float(h_[p][k] / s);
    }
  }
  // max |x| over the 4 sub-sample positions between sample i and i+1
  float at(const float* x, int64_t n, int64_t i) const {
    float m = std::fabs(x[i]);
    for (int p = 1; p < 4; p++) {
      float acc = 0;
      for (int k = 0; k < 12; k++) {
        const int64_t j = i + k - 6 + 1;
        if (j >= 0 && j < n) acc += h_[p][k] * x[j];
      }
      m = std::max(m, std::fabs(acc));
    }
    return m;
  }

 private:
  float h_[4][12];
};

}  // namespace lectern
