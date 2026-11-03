// Reproducible tests for the audio core (runs on a desktop; no Android needed).
// Build: see run_tests.sh. Every check prints a measured value and its tolerance.
#include <cmath>
#include <cstdio>
#include <functional>
#include <random>
#include <string>
#include <vector>

#include "core.h"

using namespace lectern;

static int fails = 0, passes = 0;
static void check(bool ok, const char* name, const char* fmt, double v, double tol) {
  char buf[256];
  std::snprintf(buf, sizeof buf, fmt, v, tol);
  std::printf("  [%s] %-58s %s\n", ok ? "PASS" : "FAIL", name, buf);
  ok ? passes++ : fails++;
}

static std::string tmp(const char* n) { return std::string(getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp") + "/" + n; }

static std::shared_ptr<Track> sineTrack(int rate, double secs, double hz, double amp) {
  const int64_t n = int64_t(secs * rate);
  std::vector<int16_t> s(size_t(n) * 2);
  for (int64_t i = 0; i < n; i++) s[size_t(i) * 2] = s[size_t(i) * 2 + 1] = int16_t(std::lrint(32767 * amp * std::sin(2 * M_PI * hz * i / rate)));
  return makeTrack(s.data(), n, 2, rate);
}

// Frequency by linear-interpolated rising zero crossings.
static double freqOf(const std::vector<float>& x, int rate) {
  double first = -1, last = -1;
  int count = 0;
  for (size_t i = 1; i < x.size(); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const double t = (i - 1) + x[i - 1] / (x[i - 1] - x[i]);
      if (first < 0) first = t;
      last = t;
      count++;
    }
  }
  return count > 1 ? (count - 1) / ((last - first) / rate) : 0;
}

// Error of x against the best-fitting sine of frequency hz, in dB relative to the signal.
static double sineSnr(const std::vector<float>& x, int rate, double hz) {
  double ss = 0, sc = 0, cc = 0, xs = 0, xc = 0;
  for (size_t i = 0; i < x.size(); i++) {
    const double s = std::sin(2 * M_PI * hz * i / rate), c = std::cos(2 * M_PI * hz * i / rate);
    ss += s * s; cc += c * c; sc += s * c; xs += x[i] * s; xc += x[i] * c;
  }
  const double det = ss * cc - sc * sc, a = (xs * cc - xc * sc) / det, b = (xc * ss - xs * sc) / det;
  double sig = 0, err = 0;
  for (size_t i = 0; i < x.size(); i++) {
    const double f = a * std::sin(2 * M_PI * hz * i / rate) + b * std::cos(2 * M_PI * hz * i / rate);
    sig += f * f;
    err += (x[i] - f) * (x[i] - f);
  }
  return 10 * std::log10(sig / std::max(err, 1e-30));
}

// ---------------------------------------------------------------- 1. playback speed and quality
static void testPlaybackRate() {
  std::printf("\n1. Playback speed and pitch across output rates (44.1 kHz song)\n");
  auto t = sineTrack(44100, 30, 1000, 0.5);
  Player p;
  p.prepare(48000);
  p.setTrack(t);
  p.setVolume(1);
  p.play();
  std::mt19937 rng(1);
  std::vector<float> out, block(2 * 4096);
  int64_t f = 0;
  // let the volume ramp settle, then measure 4 s
  for (int i = 0; i < 20; i++) { p.render(block.data(), 480, f); f += 480; }
  while (out.size() < size_t(4 * 48000)) {
    const int n = 96 + int(rng() % 1825);
    p.render(block.data(), n, f);
    f += n;
    for (int i = 0; i < n; i++) out.push_back(block[size_t(i) * 2]);
  }
  const double hz48 = freqOf(out, 48000);
  check(std::fabs(hz48 - 1000) < 0.5, "1 kHz tone through a 48 kHz output", "%.3f Hz (tol ±%.1f)", hz48, 0.5);
  const double snr = sineSnr(out, 48000, 1000);
  check(snr > 80, "interpolation noise/distortion", "SNR %.1f dB (need > %.0f)", snr, 80);
  // the output stream is reopened at 44.1 kHz (Bluetooth connected): pitch and position kept
  const double posBefore = p.renderedPos();
  p.prepare(44100);
  out.clear();
  f = 0;
  while (out.size() < size_t(4 * 44100)) {
    const int n = 1024;
    p.render(block.data(), n, f);
    f += n;
    for (int i = 0; i < n; i++) out.push_back(block[size_t(i) * 2]);
  }
  const double hz44 = freqOf(out, 44100);
  check(std::fabs(hz44 - 1000) < 0.5, "after the output switches to 44.1 kHz", "%.3f Hz (tol ±%.1f)", hz44, 0.5);
  const double adv = p.renderedPos() - posBefore;
  check(std::fabs(adv - 4.0) < 0.03, "track time advanced over 4 s of output", "%.4f s (tol ±%.2f)", adv, 0.03);
  // what the previous engine did: track resampled once to 48 kHz, then played by a 44.1 kHz stream
  const double oldHz = 1000.0 * 44100 / 48000;
  std::printf("  [INFO] previous engine after the same route change: %.2f Hz (%.1f%% slow, pitch down)\n", oldHz, (1 - oldHz / 1000) * 100);
  // full-length duration check at 48 kHz
  Player q;
  q.prepare(48000);
  q.setTrack(sineTrack(44100, 10, 440, 0.3));
  q.play();
  int64_t frames = 0;
  while (q.playing() || frames == 0) { q.render(block.data(), 512, frames); frames += 512; if (frames > 48000 * 20) break; }
  const double secs = double(frames) / 48000;
  check(std::fabs(secs - 10.0) < 0.02, "10 s song plays for 10 s", "%.4f s (tol ±%.2f)", secs, 0.02);
}

// ---------------------------------------------------------------- 2. clock: what the listener hears
static void testClock() {
  std::printf("\n2. Playback clock vs what is actually heard (180 ms Bluetooth latency, jittery timestamps)\n");
  const int rate = 48000;
  const double latency = 0.180;
  // the track encodes its own time: L = sin, R = cos of a 0.1 Hz phase, so the position of any
  // rendered sample can be read back from the audio itself (independent ground truth)
  const int trate = 44100;
  const int64_t tn = int64_t(600.0 * trate);
  std::vector<int16_t> pcm(size_t(tn) * 2);
  for (int64_t i = 0; i < tn; i++) {
    const double ph = 2 * M_PI * 0.1 * double(i) / trate;
    pcm[size_t(i) * 2] = int16_t(std::lrint(16000 * std::sin(ph)));
    pcm[size_t(i) * 2 + 1] = int16_t(std::lrint(16000 * std::cos(ph)));
  }
  Player p;
  p.prepare(rate);
  p.setTrack(makeTrack(pcm.data(), tn, 2, trate));
  p.setVolume(1);
  StreamClock clk;
  clk.reset(rate);
  std::mt19937 rng(7);
  std::normal_distribution<double> jit(0, 0.0004);
  std::vector<float> block(2 * 2048);
  const int R = 1 << 16;
  std::vector<float> hl(R, 0), hr(R, 0);
  int64_t f = 0;
  const int64_t t0 = 1000000000LL;
  double maxErr = 0, sumErr = 0;
  int nErr = 0;
  std::vector<std::pair<double, std::function<void()>>> evs = {
      {1.0, [&] { p.play(); }},          {40.0, [&] { p.seek(120.0); }}, {70.0, [&] { p.pause(); }},
      {75.0, [&] { p.play(); }},         {100.0, [&] { p.seek(30.0); }}, {130.0, [&] { p.setSpeed(0.75); }},
      {160.0, [&] { p.setSpeed(1.0); }}, {300.0, [&] { p.seek(450.0); }}, {400.0, [&] { p.pause(); }},
  };
  size_t ei = 0;
  const int n = 1024;
  while (f < int64_t(420.0 * rate)) {
    const double now = double(f) / rate;
    while (ei < evs.size() && evs[ei].first <= now) evs[ei++].second();
    p.render(block.data(), n, f);
    for (int i = 0; i < n; i++) { hl[size_t((f + i) % R)] = block[size_t(i) * 2]; hr[size_t((f + i) % R)] = block[size_t(i) * 2 + 1]; }
    f += n;
    clk.setFrames(f);
    const double presentedNow = (now - latency) * rate;
    if (presentedNow > 0) clk.setTimestamp(int64_t(presentedNow), t0 + int64_t((now + jit(rng)) * 1e9));
    for (int k = 0; k < 3; k++) {
      const double q = now + k * (double(n) / rate / 3);
      if (q - latency < 1.0) continue;
      const double pos = p.posAtOutFrame(clk.frameAt(t0 + int64_t(q * 1e9), true));
      const int64_t hf = int64_t(std::floor((q - latency) * rate));
      if (hf < 0 || f - hf >= R - 2) continue;
      const float L = hl[size_t(hf % R)], Rr = hr[size_t(hf % R)];
      if (L * L + Rr * Rr < 0.05f) continue;  // silence (paused): nothing to read the time from
      double truth = std::atan2(L, Rr) / (2 * M_PI * 0.1);
      if (truth < 0) truth += 10;
      truth += 10 * std::round((pos - truth) / 10);  // unwrap near the reported position
      const double err = std::fabs(pos - truth);
      maxErr = std::max(maxErr, err);
      sumErr += err;
      nErr++;
    }
  }
  check(maxErr < 0.003, "clock vs heard audio, max error over 7 min", "%.4f s (tol %.3f)", maxErr, 0.003);
  std::printf("  [INFO] mean error %.5f s over %d queries (seeks, pause/resume, 0.75x speed included)\n", sumErr / nErr, nErr);
  std::printf("  [INFO] previous app polled the position over a platform channel each frame and glided toward it\n");
}

// ---------------------------------------------------------------- 3. recording with independent clocks
struct Sim {
  // previous engine's approach, for comparison: output callback pulls the mic from a ring
  int64_t oldUnderrun = 0, oldDropped = 0;
};

static void testRecording(double minutes, int outBlock, double drift) {
  std::printf("\n3. Recording %.0f min: Bluetooth-style %d-frame output bursts, mic clock off by %+.0f ppm\n", minutes, outBlock, drift * 1e6);
  const int rOut = 48000;
  const double rIn = 48000 * (1 + drift);
  const double latOut = 0.180, latIn = 0.012;
  // music: clicks every 0.5 s (a short decaying 2 kHz burst) over quiet noise
  const int mrate = 44100;
  const double msecs = minutes * 60 + 20;
  const int64_t mn = int64_t(msecs * mrate);
  std::vector<int16_t> m(size_t(mn) * 2);
  std::mt19937 rng(3);
  std::uniform_real_distribution<float> u(-1, 1);
  auto clickAt = [](double tsec) {  // value of the click train at time tsec (seconds into the track)
    const double ph = std::fmod(tsec, 0.5);
    return ph < 0.004 ? std::sin(2 * M_PI * 2000 * ph) * std::exp(-ph * 600) : 0.0;
  };
  for (int64_t i = 0; i < mn; i++) {
    const float v = float(0.6 * clickAt(double(i) / mrate) + 0.002 * u(rng));
    m[size_t(i) * 2] = m[size_t(i) * 2 + 1] = int16_t(std::lrint(v * 32767));
  }
  auto track = makeTrack(m.data(), mn, 2, mrate);
  Player p;
  p.prepare(rOut);
  p.setTrack(track);
  p.setVolume(1);
  StreamClock out, in;
  out.reset(rOut);
  in.reset(48000);
  Recorder rec;
  RecConfig cfg;
  cfg.mode = 2;
  rec.configure(48000, cfg);
  const std::string vw = tmp("lectern_voice.wav"), mw = tmp("lectern_music.wav");
  const int64_t t0 = 5000000000LL;
  std::vector<float> ob(2 * size_t(outBlock)), ib(512);
  int64_t of = 0, inf = 0;
  double tOut = 0, tIn = 0.05;  // next callback times (s)
  bool started = false, playing = false;
  double playStartFrame = -1;   // output frame index where the song starts (for ground truth)
  // old engine model: ring between the input and output callbacks
  int64_t ring = 0, oldUnder = 0, oldDrop = 0;
  const int inBlock = 192;
  std::normal_distribution<double> jit(0, 0.0003);
  std::uniform_real_distribution<double> stall(0, 1);
  int64_t micFrames = 0;
  int64_t outN = 0;
  while (true) {
    const bool outFirst = tOut <= tIn;
    const double now = outFirst ? tOut : tIn;
    if (now > minutes * 60 + 2) break;
    if (!started && now > 0.5) { rec.start(vw, mw, track); started = true; }
    if (started && !playing && now > 0.7) { p.play(); playing = true; }
    if (outFirst) {
      // Bluetooth sinks pull two bursts back to back, then wait
      p.render(ob.data(), outBlock, of);
      if (playStartFrame < 0 && p.playing()) playStartFrame = double(of);
      of += outBlock;
      out.setFrames(of);
      const double pres = (now - latOut) * rOut;
      if (pres > 0) out.setTimestamp(int64_t(pres), t0 + int64_t((now + jit(rng)) * 1e9));
      // old engine: output consumes outBlock mic frames from the ring
      if (started) {
        if (ring < outBlock) { oldUnder += outBlock - ring; ring = 0; } else ring -= outBlock;
        if (ring > outBlock * 6) { oldDrop += ring - outBlock * 2; ring = outBlock * 2; }
      }
      // Bluetooth sinks pull two bursts back to back; a busy phone (camera + encoder) runs a
      // callback late now and then, and the following ones catch up (the DAC keeps time)
      outN++;
      const double nominal = double(outN / 2) * 2.0 * outBlock / rOut + (outN % 2 ? 0.0005 : 0.0);
      tOut = std::max(tOut, nominal + (stall(rng) < 0.03 ? 0.012 * stall(rng) : 0.0));
    } else {
      // input block: frames inf..inf+inBlock-1, captured at t = j / rIn (+ jitter in the report)
      const double cap0 = double(inf) / rIn;
      const int64_t capNs = t0 + int64_t(cap0 * 1e9);
      in.setTimestamp(inf, t0 + int64_t((cap0 + jit(rng)) * 1e9));
      bool mp = false;
      const double mpos = p.posAtOutFrame(out.frameAt(capNs, true), &mp);
      for (int i = 0; i < inBlock; i++) {
        const double tc = double(inf + i) / rIn;  // capture time of this sample
        // the singer is perfectly on the beat: their voice at capture time tc is the click they hear
        double v = 0.01 * std::sin(2 * M_PI * 440 * tc);
        if (playStartFrame >= 0) {
          const double heardFrame = (tc - latOut) * rOut;
          if (heardFrame >= playStartFrame) v += 0.5 * clickAt((heardFrame - playStartFrame) / rOut * double(mrate) / mrate);
        }
        ib[size_t(i)] = float(v);
      }
      rec.onInput(ib.data(), inBlock, capNs, mp ? mpos : NAN, 1.0);
      inf += inBlock;
      if (started) { ring += inBlock; micFrames += inBlock; }
      // the input callback runs once its block is captured (+ input latency), sometimes late
      tIn = std::max(tIn, double(inf) / rIn + latIn + (stall(rng) < 0.03 ? 0.010 * stall(rng) : 0.0));
      while (rec.backlog() > (1 << 19)) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  }
  const RecStats st = rec.stop();
  Wav v, mu;
  readWav(vw, &v);
  readWav(mw, &mu);
  check(std::llabs(v.frames() - micFrames) <= 1, "voice length == mic samples captured (nothing inserted/dropped)", "%.0f frames off (tol %.0f)",
        double(std::llabs(v.frames() - micFrames)), 1);
  check(st.overflowFrames == 0, "no samples lost in the recorder", "%.0f lost (tol %.0f)", double(st.overflowFrames), 0);
  check(mu.frames() == v.frames(), "music stem length == voice length", "%.0f frames off (tol %.0f)", double(std::llabs(mu.frames() - v.frames())), 0);
  // alignment: for each voice click, the music stem must have its click at the same sample
  auto peaks = [](const std::vector<float>& x, int ch) {
    std::vector<int64_t> pk;
    const int64_t n = int64_t(x.size()) / ch;
    for (int64_t i = 1; i + 1 < n;) {
      if (std::fabs(x[size_t(i) * ch]) > 0.12) { pk.push_back(i); i += 4000; } else i++;
    }
    return pk;
  };
  auto vp = peaks(v.data, 1), mp2 = peaks(mu.data, 2);
  double maxOff = 0, sum = 0;
  int cnt = 0;
  size_t j = 0;
  for (int64_t a : vp) {
    while (j + 1 < mp2.size() && std::llabs(mp2[j + 1] - a) < std::llabs(mp2[j] - a)) j++;
    if (j < mp2.size() && std::llabs(mp2[j] - a) < 4800) {
      const double off = double(std::llabs(mp2[j] - a)) / 48000;
      if (off > maxOff && getenv("DEBUG_CLICKS")) std::printf("    worst so far: voice click at %.3f s, music at %.3f s\n", a / 48000.0, mp2[j] / 48000.0);
      maxOff = std::max(maxOff, off);
      sum += off;
      cnt++;
    }
  }
  check(cnt > minutes * 100, "clicks matched between voice and music", "%.0f (need > %.0f)", double(cnt), minutes * 100);
  check(maxOff < 0.002, "voice vs music alignment, worst click", "%.4f s (tol %.3f)", maxOff, 0.002);
  std::printf("  [INFO] mean offset %.5f s over %d clicks; timeline corrections: %d\n", cnt ? sum / cnt : 0, cnt, st.musicJumps);
  std::printf("  [INFO] previous engine, same conditions: %.2f s of silence inserted, %.2f s of voice dropped (%lld + %lld frames)\n",
              double(oldUnder) / 48000, double(oldDrop) / 48000, (long long)oldUnder, (long long)oldDrop);
}

// ---------------------------------------------------------------- 4. loudness
static void testLoudness() {
  std::printf("\n4. Loudness (ITU-R BS.1770) and the finished take\n");
  const int fs = 48000;
  {  // EBU Tech 3341 case 1: stereo 1 kHz at -23 dBFS reads -23.0 LUFS
    std::vector<float> s(size_t(fs) * 20);
    const double a = std::pow(10, -23.0 / 20);
    for (size_t i = 0; i < s.size(); i++) s[i] = float(a * std::sin(2 * M_PI * 1000 * double(i) / fs));
    const double l = integratedLoudness({s.data(), s.data()}, int64_t(s.size()), fs);
    check(std::fabs(l + 23) < 0.1, "1 kHz stereo sine at -23 dBFS", "%.2f LUFS (tol ±%.1f)", l, 0.1);
  }
  // a quiet sung phrase: harmonic voice with vibrato, phrases and breaths, mic noise
  auto voiceLike = [&](double secs, double level, std::vector<float>* out) {
    out->assign(size_t(secs * fs), 0.f);
    std::mt19937 rng(5);
    std::normal_distribution<float> nz(0, 1);
    double ph = 0;
    for (size_t i = 0; i < out->size(); i++) {
      const double t = double(i) / fs;
      const double f0 = 220 * std::pow(2.0, std::floor(std::fmod(t, 8.0)) / 12.0) * (1 + 0.01 * std::sin(2 * M_PI * 5.5 * t));
      ph += 2 * M_PI * f0 / fs;
      double v = 0;
      for (int h = 1; h <= 12; h++) v += std::sin(h * ph) / h * (h == 3 || h == 4 ? 1.6 : 1.0);
      const double ph8 = std::fmod(t, 4.0);
      const double env = ph8 < 3.2 ? std::min(1.0, ph8 * 8) * std::min(1.0, (3.2 - ph8) * 8) * (0.6 + 0.4 * std::sin(2 * M_PI * 0.7 * t)) : 0;
      (*out)[i] = float(level * v * env + 0.0006 * nz(rng));
    }
  };
  std::vector<float> voice;
  voiceLike(30, 0.02, &voice);
  Wav vw;
  vw.ch = 1;
  vw.rate = fs;
  vw.data = voice;
  const std::string vp = tmp("lectern_v.wav"), mp = tmp("lectern_m.wav"), op = tmp("lectern_out.wav");
  {
    std::FILE* f = std::fopen(vp.c_str(), "wb");
    writeWavHeader(f, 1, fs, 0);
    std::fwrite(voice.data(), 4, voice.size(), f);
    finishWav(f, 1, fs);
  }
  const double vin = integratedLoudness({voice.data(), voice.data()}, int64_t(voice.size()), fs);
  std::printf("  [INFO] raw phone-mic singing level in this test: %.1f LUFS (what previous takes were published at)\n", vin);
  FinalizeOptions o;
  o.mode = 0;
  FinalizeResult r = finalizeTake(vp, "", op, o);
  check(r.ok, "finalize (mic-only take)", "%.0f %.0f", 0, 0);
  check(std::fabs(r.outLufs - (-14)) < 1.0, "mic-only take loudness", "%.2f LUFS (target -14 ±%.0f)", r.outLufs, 1.0);
  check(r.truePeakDb <= -1.0 + 0.05, "mic-only take true peak", "%.2f dBTP (max %.1f)", r.truePeakDb, -1.0);
  // independent verification of the written file
  Wav ow;
  readWav(op, &ow);
  std::vector<float> l(size_t(ow.frames())), rr(size_t(ow.frames()));
  float mx = 0;
  for (int64_t i = 0; i < ow.frames(); i++) { l[size_t(i)] = ow.data[size_t(i) * 2]; rr[size_t(i)] = ow.data[size_t(i) * 2 + 1]; mx = std::max(mx, std::fabs(l[size_t(i)])); }
  const double ol = integratedLoudness({l.data(), rr.data()}, ow.frames(), fs);
  check(std::fabs(ol - r.outLufs) < 0.2, "re-measured from the written 16-bit file", "%.2f LUFS (tol ±%.1f vs reported)", ol, 0.2);
  check(mx < 0.95, "no clipped samples in the file", "peak %.3f (max %.2f)", mx, 0.95);
  // clean mix: quiet voice with loud music
  std::vector<float> music(size_t(30 * fs) * 2);
  for (size_t i = 0; i < music.size() / 2; i++) {
    const double t = double(i) / fs;
    const double v = 0.25 * (std::sin(2 * M_PI * 110 * t) + 0.5 * std::sin(2 * M_PI * 165 * t) + 0.3 * std::sin(2 * M_PI * 330 * t)) *
                     (0.7 + 0.3 * std::sin(2 * M_PI * 2 * t));
    music[i * 2] = float(v);
    music[i * 2 + 1] = float(v * 0.9);
  }
  {
    std::FILE* f = std::fopen(mp.c_str(), "wb");
    writeWavHeader(f, 2, fs, 0);
    std::fwrite(music.data(), 4, music.size(), f);
    finishWav(f, 2, fs);
  }
  o.mode = 2;
  r = finalizeTake(vp, mp, op, o);
  check(std::fabs(r.outLufs - (-14)) < 1.0, "clean-mix take loudness", "%.2f LUFS (target -14 ±%.0f)", r.outLufs, 1.0);
  check(r.truePeakDb <= -1.0 + 0.05, "clean-mix take true peak", "%.2f dBTP (max %.1f)", r.truePeakDb, -1.0);
  std::printf("  [INFO] voice in %.1f LUFS, music in %.1f LUFS -> mix %.1f LUFS (voice raised, music set 4 LU under it)\n", r.voiceLufs, r.musicLufs, r.outLufs);
  {  // previous engine: voice at unity + music x0.75
    std::vector<float> a(voice.size()), b(voice.size());
    for (size_t i = 0; i < voice.size(); i++) { a[i] = voice[i] + 0.75f * music[i * 2]; b[i] = voice[i] + 0.75f * music[i * 2 + 1]; }
    const double old = integratedLoudness({a.data(), b.data()}, int64_t(a.size()), fs);
    const double oldVoice = integratedLoudness({voice.data(), voice.data()}, int64_t(voice.size()), fs);
    std::printf("  [INFO] previous engine: mic-only takes at %.1f LUFS; clean mix at %.1f LUFS with the voice %.1f LU under the music\n", vin, old,
                integratedLoudness({music.data(), music.data()}, int64_t(music.size() / 2), fs) - oldVoice);
  }
}

// ---------------------------------------------------------------- 5. noise cancellation
static void testNoiseCancel() {
  std::printf("\n5. Noise cancellation\n");
  const int fs = 48000;
  NoiseCancel nc(fs);
  nc.setAmount(1);
  std::mt19937 rng(9);
  std::normal_distribution<float> nz(0, 1);
  const int n = fs * 16;
  std::vector<float> x(n), y(n);
  for (int i = 0; i < n; i++) {
    const double t = double(i) / fs;
    const bool tone = std::fmod(t, 2.0) > 1.0;  // 1 s of tone, 1 s of noise only
    x[i] = float(0.003 * nz(rng) + (tone ? 0.1 * std::sin(2 * M_PI * 330 * t) : 0));
  }
  for (int i = 0; i < n; i++) y[i] = nc.process(x[i]);
  const int lat = NoiseCancel::latency();
  auto rms = [&](const std::vector<float>& v, double a, double b, int shift) {
    double s = 0;
    int c = 0;
    for (int i = int(a * fs); i < int(b * fs); i++) { s += double(v[i + shift]) * v[i + shift]; c++; }
    return 10 * std::log10(s / c + 1e-20);
  };
  const double noiseIn = rms(x, 12.2, 12.9, 0), noiseOut = rms(y, 12.2, 12.9, lat);
  const double toneIn = rms(x, 13.2, 13.9, 0), toneOut = rms(y, 13.2, 13.9, lat);
  check(noiseIn - noiseOut > 8, "steady noise reduced (after it is learned)", "%.1f dB (need > %.0f)", noiseIn - noiseOut, 8);
  check(std::fabs(toneIn - toneOut) < 1.5, "voice-like tone level kept", "%.2f dB change (tol %.1f)", toneOut - toneIn, 1.5);
  bool finite = true;
  for (float v : y) finite = finite && std::isfinite(v);
  check(finite, "output finite", "%.0f %.0f", 0, 0);
}

// ---------------------------------------------------------------- 6. vocal analysis
static void testVocals() {
  std::printf("\n6. Finding where a voice is (Clip to lines drops words imagined over music)\n");
  const int fs = 44100;
  const double secs = 40;
  const int64_t n = int64_t(secs * fs);
  std::vector<int16_t> s(size_t(n) * 2);
  const std::vector<std::pair<double, double>> sung = {{12.0, 15.5}, {16.2, 19.8}, {26.0, 30.0}, {30.6, 36.0}};
  std::mt19937 rng(11);
  std::normal_distribution<float> nz(0, 1);
  double ph = 0;
  for (int64_t i = 0; i < n; i++) {
    const double t = double(i) / fs;
    // band: wide stereo pads (different notes left and right), centred kick, a little hi-hat noise
    double L = 0.08 * std::sin(2 * M_PI * 261.6 * t) + 0.06 * std::sin(2 * M_PI * 392 * t) + 0.04 * std::sin(2 * M_PI * 659 * t);
    double R = 0.08 * std::sin(2 * M_PI * 293.7 * t) + 0.06 * std::sin(2 * M_PI * 440 * t) + 0.04 * std::sin(2 * M_PI * 587 * t);
    const double kp = std::fmod(t, 0.5);
    const double kick = 0.5 * std::sin(2 * M_PI * 55 * kp) * std::exp(-kp * 18);
    const double hat = std::fmod(t + 0.25, 0.5) < 0.03 ? 0.02 * nz(rng) : 0;
    L += kick + hat;
    R += kick - hat;
    // voice: centred harmonic tone with vibrato inside the sung spans
    double v = 0;
    for (const auto& q : sung) {
      if (t >= q.first && t < q.second) {
        const double f0 = 246.9 * (1 + 0.012 * std::sin(2 * M_PI * 5.5 * t));
        ph += 2 * M_PI * f0 / fs;
        for (int h = 1; h <= 10; h++) v += std::sin(h * ph) / h * (h >= 3 && h <= 5 ? 2.0 : 1.0);
        v *= 0.06 * std::min(1.0, (t - q.first) * 30) * std::min(1.0, (q.second - t) * 30);
      }
    }
    s[size_t(i) * 2] = int16_t(std::lrint(std::max(-1.0, std::min(1.0, L + v)) * 32767));
    s[size_t(i) * 2 + 1] = int16_t(std::lrint(std::max(-1.0, std::min(1.0, R + v)) * 32767));
  }
  auto tr = makeTrack(s.data(), n, 2, fs);
  VocalMap vm = analyzeVocals(*tr);
  std::printf("  [INFO] regions found:");
  for (const auto& r : vm.regions) std::printf(" [%.2f-%.2f]", r.first, r.second);
  std::printf("\n");
  double worst = 0;
  for (const auto& q : sung) {
    double best = 99;
    for (const auto& r : vm.regions) best = std::min(best, std::fabs(r.first - q.first));
    worst = std::max(worst, best);
  }
  check(worst < 0.12, "every voiced phrase start found", "worst %.3f s (tol %.2f)", worst, 0.12);
  check(!vm.vocalAt(5.0) && !vm.vocalAt(10.0) && !vm.vocalAt(22.0), "intro and instrumental break not marked as voice", "%.0f %.0f", 0, 0);
}


// ---------------------------------------------------------------- 7. background music: trim, loop, fades
static void testMusicRegion() {
  std::printf("\n7. Background music: trim, loop seam, fades, timeline across loops\n");
  const int rate = 48000;
  // a loud 220 Hz tone: a jump in the waveform at a seam would be a click
  auto t = sineTrack(44100, 20, 220, 0.6);
  Player p;
  p.prepare(rate);
  p.setTrack(t);
  p.setVolume(1);
  p.setRegion(4.0, 9.0);  // 5 s of the track
  p.setLoop(true);
  p.setFades(1.0, 0);
  p.play();
  std::vector<float> out, block(2 * 1024);
  StreamClock clk;
  clk.reset(rate);
  int64_t f = 0;
  double maxStep = 0, maxPosErr = 0;
  float prev = 0;
  // 32 s of output: 6 loops
  while (f < int64_t(32.0 * rate)) {
    p.render(block.data(), 1024, f);
    for (int i = 0; i < 1024; i++) {
      const float x = block[size_t(i) * 2];
      if (f + i > rate * 2) maxStep = std::max(maxStep, double(std::fabs(x - prev)));
      prev = x;
      out.push_back(x);
    }
    // timeline: heard position must follow the loop (track time = 4 + (t mod 5))
    for (int k = 0; k < 1024; k += 256) {
      const double fr = double(f + k);
      const double want = 4.0 + std::fmod(fr / rate, 5.0);
      const double got = p.posAtOutFrame(fr);
      double e = std::fabs(got - want);
      e = std::min(e, std::fabs(e - 5.0));  // exactly at a seam either side is right
      maxPosErr = std::max(maxPosErr, e);
    }
    f += 1024;
  }
  // a 220 Hz sine at 0.6 changes by at most 2*pi*220/48000*0.6 = 0.0173 per sample
  check(maxStep < 0.02, "no click at loop seams (largest sample step)", "%.4f (max %.3f)", maxStep, 0.02);
  check(maxPosErr < 0.001, "playback clock follows the loop", "%.5f s (tol %.3f)", maxPosErr, 0.001);
  check(p.loops() == 6, "loops in 32 s of a 5 s region", "%.0f (want %.0f)", p.loops(), 6);
  // fade-in: level at 0.25 s is well under the level at 2 s, and smooth
  auto rmsAt = [&](double a, double b) {
    double s2 = 0;
    for (int64_t i = int64_t(a * rate); i < int64_t(b * rate); i++) s2 += double(out[size_t(i)]) * out[size_t(i)];
    return std::sqrt(s2 / ((b - a) * rate));
  };
  const double early = rmsAt(0.20, 0.30), full = rmsAt(2.0, 2.5);
  check(early < full * 0.3, "fade-in at the start of the region", "%.2f of full level (max %.1f)", early / full, 0.3);
  check(std::fabs(rmsAt(5.5, 6.0) / full - 1) < 0.02, "no fade-in again on later loops", "%.3f of full (tol %.2f)", rmsAt(5.5, 6.0) / full, 0.02);
  // no loop: fade out and stop at the region end
  Player q;
  q.prepare(rate);
  q.setTrack(t);
  q.setVolume(1);
  q.setRegion(2.0, 6.0);
  q.setLoop(false);
  q.setFades(0, 1.0);
  q.play();
  std::vector<float> o2;
  int64_t g = 0;
  while (q.playing() && g < rate * 10) {
    q.render(block.data(), 512, g);
    for (int i = 0; i < 512; i++) o2.push_back(block[size_t(i) * 2]);
    g += 512;
  }
  const double secs = double(g) / rate;
  check(std::fabs(secs - 4.0) < 0.02, "trimmed region plays for its length", "%.3f s (want 4.0 ±%.2f)", secs, 0.02);
  double tail = 0;
  for (size_t i = o2.size() - 480; i < o2.size(); i++) tail = std::max(tail, double(std::fabs(o2[i])));
  check(tail < 0.01, "faded out at the end (last 10 ms)", "peak %.4f (max %.2f)", tail, 0.01);
}

// ---------------------------------------------------------------- 8. ducking under the voice
static void testDucking() {
  std::printf("\n8. Music ducking under the voice (offline mix)\n");
  const int fs = 48000;
  const double secs = 30;
  const int64_t n = int64_t(secs * fs);
  // voice: speech-like bursts 4-9 s, 12-12.6 s (a short phrase), 16-24 s with small pauses
  std::vector<float> voice(static_cast<size_t>(n), 0.f);
  std::mt19937 rng(2);
  std::normal_distribution<float> nz(0, 1);
  auto speaking = [](double t) {
    if (t >= 4 && t < 9) return std::fmod(t, 0.5) < 0.42;    // words with 80 ms gaps
    if (t >= 12 && t < 12.6) return true;
    if (t >= 16 && t < 24) return std::fmod(t, 1.0) < 0.85;  // 150 ms breaths
    return false;
  };
  for (int64_t i = 0; i < n; i++) {
    const double t = double(i) / fs;
    voice[size_t(i)] = 0.0005f * nz(rng) + (speaking(t) ? float(0.15 * std::sin(2 * M_PI * 180 * t) + 0.05 * std::sin(2 * M_PI * 540 * t)) : 0.f);
  }
  FinalizeOptions o;
  o.mode = 2;
  o.duckDb = 9;
  o.musicFadeIn = 2;
  o.musicFadeOut = 3;
  const std::vector<float> env = musicEnvelope(voice.data(), n, fs, o);
  auto db = [&](double t) { return 20 * std::log10(std::max(1e-6f, env[size_t(t * fs)])); };
  check(std::fabs(db(7.0) + 9) < 1.0, "music lowered while speaking", "%.2f dB (want -9 ±%.0f)", db(7.0), 1.0);
  check(std::fabs(db(20.5) + 9) < 1.0, "stays down through short breaths (no pumping)", "%.2f dB (want -9 ±%.0f)", db(20.5), 1.0);
  check(db(11.5) > -1.0, "back up in a long pause", "%.2f dB (want > %.0f)", db(11.5), -1.0);
  check(db(3.97) < -0.5, "starts lowering just before the voice comes in", "%.2f dB at 3.97 s (want < %.1f)", db(3.97), -0.5);
  // smoothness: largest change in any 10 ms
  double worst = 0;
  for (int64_t i = fs; i + fs / 100 < n - int64_t(4 * fs); i += fs / 100) {
    const double a = 20 * std::log10(std::max(1e-6f, env[size_t(i)])), b = 20 * std::log10(std::max(1e-6f, env[size_t(i + fs / 100)]));
    worst = std::max(worst, std::fabs(a - b));
  }
  check(worst < 1.0, "smooth: largest gain change in 10 ms", "%.2f dB (max %.1f)", worst, 1.0);
  check(env[0] < 0.01 && db(2.5) > -0.5, "fades in over the first 2 s", "%.3f at 0 s (max %.2f)", env[0], 0.01);
  check(env[size_t(n - 1)] < 0.01, "fades out at the end", "%.3f (max %.2f)", env[size_t(n - 1)], 0.01);
  // full mix through the limiter: still -14 LUFS and no peak over -1 dBTP
  const std::string vp = tmp("lectern_dv.wav"), mp = tmp("lectern_dm.wav"), op = tmp("lectern_do.wav");
  {
    std::FILE* f = std::fopen(vp.c_str(), "wb");
    writeWavHeader(f, 1, fs, 0);
    std::fwrite(voice.data(), 4, voice.size(), f);
    finishWav(f, 1, fs);
    std::vector<int16_t> m(static_cast<size_t>(n) * 2);
    for (int64_t i = 0; i < n; i++) {
      const double t = double(i) / fs;
      m[size_t(i) * 2] = m[size_t(i) * 2 + 1] = int16_t(std::lrint(9000 * (std::sin(2 * M_PI * 110 * t) + 0.5 * std::sin(2 * M_PI * 330 * t))));
    }
    std::FILE* g = std::fopen(mp.c_str(), "wb");
    writeWavHeader(g, 2, fs, 0, false);
    std::fwrite(m.data(), 2, m.size(), g);
    finishWav(g, 2, fs, false);
  }
  const FinalizeResult r = finalizeTake(vp, mp, op, o);
  check(r.ok && std::fabs(r.outLufs + 14) < 1.0, "ducked mix loudness", "%.2f LUFS (target -14 ±%.0f)", r.outLufs, 1.0);
  check(r.truePeakDb <= -0.95, "ducked mix true peak", "%.2f dBTP (max %.1f)", r.truePeakDb, -1.0);
}

// ---------------------------------------------------------------- 9. recording over a looping music region
static void testLoopRecording() {
  std::printf("\n9. Recording over looped background music (clean mix stem)\n");
  const int rate = 48000;
  auto t = sineTrack(44100, 12, 220, 0.6);
  Player p;
  p.prepare(rate);
  p.setTrack(t);
  p.setVolume(1);
  p.setRegion(2.0, 5.0);
  p.setLoop(true);
  p.setFades(0.5, 0);
  StreamClock out;
  out.reset(rate);
  Recorder rec;
  RecConfig cfg;
  cfg.mode = 2;
  rec.configure(rate, cfg);
  const std::string vw = tmp("lectern_lv.wav"), mw = tmp("lectern_lm.wav");
  MusicRegion reg;
  reg.start = p.regionStart();
  reg.end = p.regionEnd();
  reg.loop = true;
  rec.start(vw, mw, t, reg);
  p.play();
  const int64_t t0 = 5000000000LL;
  const double lat = 0.02;
  std::vector<float> ob(2 * 192), ib(192, 0.f);
  int64_t of = 0, inf = 0;
  while (inf < int64_t(14.0 * rate)) {
    // output runs a block ahead of the input
    while (of <= inf + 192) {
      p.render(ob.data(), 192, of);
      of += 192;
      out.setFrames(of);
      out.setTimestamp(of - 192, t0 + int64_t((double(of - 192) / rate + lat) * 1e9));
    }
    const int64_t capNs = t0 + int64_t(double(inf) / rate * 1e9);
    bool mp = false;
    const double mpos = p.posAtOutFrame(out.frameAt(capNs, true), &mp);
    rec.onInput(ib.data(), 192, capNs, mp ? mpos : NAN, 1.0);
    inf += 192;
    while (rec.backlog() > (1 << 19)) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  const RecStats st = rec.stop();
  Wav mu;
  readWav(mw, &mu);
  double maxStep = 0, minRms = 1;
  for (int64_t i = rate; i + 1 < mu.frames(); i++) maxStep = std::max(maxStep, double(std::fabs(mu.data[size_t(i + 1) * 2] - mu.data[size_t(i) * 2])));
  for (double a = 1.0; a + 0.5 < double(mu.frames()) / rate; a += 0.5) {
    double s2 = 0;
    for (int64_t i = int64_t(a * rate); i < int64_t((a + 0.5) * rate); i++) s2 += double(mu.data[size_t(i) * 2]) * mu.data[size_t(i) * 2];
    minRms = std::min(minRms, std::sqrt(s2 / (0.5 * rate)));
  }
  check(maxStep < 0.02, "no click in the music stem at loop seams", "%.4f (max %.3f)", maxStep, 0.02);
  check(minRms > 0.3, "music keeps playing through every loop", "min RMS %.2f (want > %.1f)", minRms, 0.3);
  check(st.musicJumps == 0, "loops aren't counted as timeline glitches", "%.0f (want %.0f)", double(st.musicJumps), 0);
  check(p.loops() >= 3, "the region looped", "%.0f times (want >= %.0f)", double(p.loops()), 3);
}

int main() {
  testPlaybackRate();
  testClock();
  testRecording(5, 1024, 60e-6);
  testRecording(8, 960, -120e-6);
  testLoudness();
  testNoiseCancel();
  testVocals();
  testMusicRegion();
  testDucking();
  testLoopRecording();
  std::printf("\n%d passed, %d failed\n", passes, fails);
  return fails ? 1 : 0;
}
