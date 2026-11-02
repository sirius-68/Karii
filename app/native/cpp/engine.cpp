#include "engine.h"

#include <android/log.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <ctime>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "lectern", __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, "lectern", __VA_ARGS__)

namespace lectern {

static constexpr float kHeadroom = 0.75f;  // music level under the voice in the digital mix

// ---------------------------------------------------------------- WAV writer (16-bit PCM)
class WavWriter {
 public:
  WavWriter(const std::string& path, int ch, int rate) : ch_(ch), rate_(rate) {
    f_ = std::fopen(path.c_str(), "wb");
    if (f_) writeHeader(0);
  }
  ~WavWriter() { close(); }
  bool ok() const { return f_ != nullptr; }
  void write(const float* s, size_t n) {
    if (!f_) return;
    buf_.resize(n);
    for (size_t i = 0; i < n; i++) {
      float v = std::max(-1.f, std::min(1.f, s[i]));
      buf_[i] = int16_t(std::lrint(v * 32767.f));
    }
    std::fwrite(buf_.data(), 2, n, f_);
    samples_ += n;
  }
  void close() {
    if (!f_) return;
    std::fflush(f_);
    std::fseek(f_, 0, SEEK_SET);
    writeHeader(uint32_t(samples_ * 2));
    std::fclose(f_);
    f_ = nullptr;
  }
  int64_t frames() const { return samples_ / ch_; }

 private:
  void put32(uint32_t v) { std::fwrite(&v, 4, 1, f_); }
  void put16(uint16_t v) { std::fwrite(&v, 2, 1, f_); }
  void writeHeader(uint32_t dataBytes) {
    std::fwrite("RIFF", 1, 4, f_); put32(36 + dataBytes); std::fwrite("WAVE", 1, 4, f_);
    std::fwrite("fmt ", 1, 4, f_); put32(16); put16(1); put16(uint16_t(ch_)); put32(uint32_t(rate_));
    put32(uint32_t(rate_ * ch_ * 2)); put16(uint16_t(ch_ * 2)); put16(16);
    std::fwrite("data", 1, 4, f_); put32(dataBytes);
  }
  FILE* f_ = nullptr;
  int ch_, rate_;
  int64_t samples_ = 0;
  std::vector<int16_t> buf_;
};

// ---------------------------------------------------------------- resampler
std::vector<int16_t> resample(const int16_t* in, int64_t frames, int ch, int inRate, int outRate, int64_t* outFrames) {
  const double ratio = double(outRate) / inRate;
  const int64_t n = int64_t(std::floor(frames * ratio));
  std::vector<int16_t> out(size_t(n) * ch);
  const int taps = 16;
  const double cutoff = std::min(1.0, ratio) * 0.95;
  for (int64_t i = 0; i < n; i++) {
    const double x = i / ratio;
    const int64_t c = int64_t(std::floor(x));
    for (int k = 0; k < ch; k++) {
      double acc = 0, wsum = 0;
      for (int t = -taps + 1; t <= taps; t++) {
        const int64_t j = c + t;
        if (j < 0 || j >= frames) continue;
        const double d = x - double(j);
        const double sx = d * cutoff;
        const double sinc = std::fabs(sx) < 1e-9 ? 1.0 : std::sin(M_PI * sx) / (M_PI * sx);
        const double win = 0.5 + 0.5 * std::cos(M_PI * d / taps);  // Hann window
        const double w = sinc * win;
        acc += w * in[j * ch + k];
        wsum += w;
      }
      const double v = wsum > 1e-9 ? acc / wsum : 0;
      out[size_t(i) * ch + k] = int16_t(std::max(-32768.0, std::min(32767.0, v)));
    }
  }
  *outFrames = n;
  return out;
}

// ---------------------------------------------------------------- engine
Engine& Engine::get() {
  static Engine e;
  return e;
}

static int64_t nowNs() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return int64_t(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}

bool Engine::openOutput() {
  oboe::AudioStreamBuilder b;
  b.setDirection(oboe::Direction::Output)
      ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
      ->setSharingMode(oboe::SharingMode::Exclusive)
      ->setFormat(oboe::AudioFormat::Float)
      ->setChannelCount(oboe::ChannelCount::Stereo)
      ->setUsage(oboe::Usage::Media)
      ->setContentType(oboe::ContentType::Music)
      ->setDataCallback(&outCb_)
      ->setErrorCallback(&outCb_);
  oboe::Result r = b.openStream(out_);
  if (r != oboe::Result::OK) {
    b.setSharingMode(oboe::SharingMode::Shared);
    r = b.openStream(out_);
  }
  if (r != oboe::Result::OK) { LOGW("output open failed: %s", oboe::convertToText(r)); return false; }
  rate_ = out_->getSampleRate();
  // a couple of bursts of buffer: low latency, but room for a busy CPU (camera + encoder)
  out_->setBufferSizeInFrames(std::min(out_->getBufferCapacityInFrames(), out_->getFramesPerBurst() * 4));
  out_->requestStart();
  LOGI("output open: %d Hz, burst %d", rate_, out_->getFramesPerBurst());
  return true;
}

bool Engine::start() {
  std::lock_guard<std::mutex> g(lock_);
  if (out_) return true;
  return openOutput();
}

void Engine::stop() {
  std::lock_guard<std::mutex> g(lock_);
  if (out_) { out_->stop(); out_->close(); out_.reset(); }
}

bool Engine::loadPcm(const int16_t* pcm, int64_t frames, int channels, int rate) {
  start();
  std::vector<int16_t> st;
  int64_t fr = frames;
  if (channels == 1) {
    st.resize(size_t(frames) * 2);
    for (int64_t i = 0; i < frames; i++) st[i * 2] = st[i * 2 + 1] = pcm[i];
  } else {
    st.resize(size_t(frames) * 2);
    for (int64_t i = 0; i < frames; i++) { st[i * 2] = pcm[i * channels]; st[i * 2 + 1] = pcm[i * channels + 1]; }
  }
  auto t = std::make_shared<std::vector<int16_t>>();
  if (rate != rate_) *t = resample(st.data(), frames, 2, rate, rate_, &fr);
  else *t = std::move(st);
  playing_ = false;
  std::atomic_store(&track_, t);
  trackFrames_ = fr;
  seekTo_ = 0.0;
  anchorPos_ = 0;
  anchorPlaying_ = false;
  return true;
}

void Engine::unload() {
  playing_ = false;
  std::shared_ptr<std::vector<int16_t>> empty;
  std::atomic_store(&track_, empty);
  trackFrames_ = 0;
  anchorPos_ = 0;
  anchorPlaying_ = false;
}

double Engine::duration() const { return rate_ > 0 ? double(trackFrames_.load()) / rate_ : 0; }

void Engine::play() {
  start();
  if (trackFrames_.load() == 0) return;
  if (anchorPos_.load() >= duration() - 0.02) seekTo_ = 0.0;
  playing_ = true;
}

void Engine::pause() { playing_ = false; }

void Engine::seek(double sec) { seekTo_ = std::max(0.0, std::min(duration(), sec)); }

void Engine::setRate(double r) { rateVal_ = std::max(0.25, std::min(2.0, r)); }

void Engine::setVolume(float v) { volTarget_ = std::max(0.f, std::min(1.5f, v)); }

double Engine::outputLatencySec() {
  std::lock_guard<std::mutex> g(lock_);
  if (!out_) return 0;
  auto l = out_->calculateLatencyMillis();
  return l ? l.value() / 1000.0 : 0.02;
}

double Engine::inputLatencySec() {
  std::lock_guard<std::mutex> g(lock_);
  if (!in_) return 0;
  auto l = in_->calculateLatencyMillis();
  return l ? l.value() / 1000.0 : 0.02;
}

// What the listener hears right now: the frame being presented, mapped to track time.
double Engine::position() {
  const double pos = anchorPos_.load();
  if (!anchorPlaying_.load()) return pos;
  int64_t presented = -1;
  {
    std::lock_guard<std::mutex> g(lock_);
    if (out_) {
      auto ts = out_->getTimestamp(CLOCK_MONOTONIC);
      if (ts) {
        const auto v = ts.value();
        presented = v.position + int64_t(double(nowNs() - v.timestamp) * rate_ / 1e9);
      } else {
        auto l = out_->calculateLatencyMillis();
        presented = rendered_.load() - int64_t((l ? l.value() : 20.0) * rate_ / 1000.0);
      }
    }
  }
  if (presented < 0) return pos;
  double t = pos + double(presented - anchorFrame_.load()) * anchorRate_.load() / rate_;
  if (t < pos && t > pos - 1.0) t = pos;  // before the anchor reached the speaker
  return std::max(0.0, std::min(duration(), t));
}

// ---------------------------------------------------------------- output callback
oboe::DataCallbackResult Engine::OutCb::onAudioReady(oboe::AudioStream* s, void* data, int32_t n) {
  Engine::get().render(static_cast<float*>(data), n);
  return oboe::DataCallbackResult::Continue;
}

void Engine::OutCb::onErrorAfterClose(oboe::AudioStream*, oboe::Result e) {
  // device change (headphones in/out, Bluetooth): reopen and keep the position
  LOGW("output closed: %s, reopening", oboe::convertToText(e));
  Engine& en = Engine::get();
  std::lock_guard<std::mutex> g(en.lock_);
  en.out_.reset();
  en.rendered_ = 0;
  en.anchorFrame_ = 0;
  en.openOutput();
}

void Engine::render(float* out, int32_t n) {
  auto track = std::atomic_load(&track_);
  const int64_t tf = trackFrames_.load(std::memory_order_relaxed);
  const double rr = rateVal_.load(std::memory_order_relaxed);
  const bool play = playing_.load(std::memory_order_relaxed) && track && tf > 0;
  const double sk = seekTo_.exchange(-1.0);
  if (sk >= 0) readPos_ = sk * rate_;
  const int64_t frame0 = rendered_.load(std::memory_order_relaxed);
  // re-anchor the clock at the start of every block that changes state
  if (sk >= 0 || play != anchorPlaying_.load(std::memory_order_relaxed) || rr != anchorRate_.load(std::memory_order_relaxed)) {
    anchorFrame_.store(frame0);
    anchorPos_.store(readPos_ / rate_);
    anchorRate_.store(rr);
    anchorPlaying_.store(play);
  }
  const float volT = volTarget_.load(std::memory_order_relaxed);
  const bool rec = recording_.load(std::memory_order_relaxed) && !recPaused_.load(std::memory_order_relaxed);
  const bool mic = micOpen_.load(std::memory_order_relaxed);

  // pull the mic block that matches this output block
  if (mic) {
    if ((int)micBuf_.size() < n) micBuf_.resize(n);  // (sized in openMic; never grows in practice)
    const size_t avail = micRing_.available();
    // keep the mic buffer short: if it has grown (input faster than output), drop the excess
    if (avail > size_t(n) * 6) { micRing_.skip(avail - size_t(n) * 2); health_.micDropFrames += int64_t(avail - n * 2); }
    const size_t got = micRing_.read(micBuf_.data(), n);
    if (got < size_t(n)) {
      std::fill(micBuf_.begin() + got, micBuf_.begin() + n, 0.f);
      if (rec) health_.micUnderrunFrames += int64_t(n - got);
    }
  }

  float* mixBlock = recMix_.data();
  float* stemBlock = recStem_.data();
  const int cap = int(recStem_.size());
  int written = 0;
  const float gain = micGain_.load(std::memory_order_relaxed);
  const bool digital = cfg_.mode >= 2;
  float peak = 0;
  for (int i = 0; i < n; i++) {
    float l = 0, r = 0;
    if (play) {
      const int64_t i0 = int64_t(readPos_);
      if (i0 >= tf - 1) {
        playing_.store(false);
      } else {
        const float fr = float(readPos_ - double(i0));
        const int16_t* p = track->data() + i0 * 2;
        l = (p[0] + (p[2] - p[0]) * fr) / 32768.f;
        r = (p[1] + (p[3] - p[1]) * fr) / 32768.f;
        readPos_ += rr;
      }
    }
    volCur_ += (volT - volCur_) * 0.002f;
    l *= volCur_;
    r *= volCur_;
    out[i * 2] = l;
    out[i * 2 + 1] = r;

    if (mic) {
      float v = micBuf_[i];
      if (nc_) v = nc_->process(v);
      v = hpf_.process(v);
      if (digital) v = pres_.process(ess_.process(comp_.process(v)));
      v *= gain;
      const float a = std::fabs(v);
      if (a > peak) peak = a;
      v = Limiter::softclip(v * vlim_.gainFor(a));
      // music for the digital mix, delayed to line up with what the singer heard
      float ml = 0, mr = 0;
      if (digital && delayLen_ > 0) {
        const int rd = delayW_;
        ml = musicDelay_[rd * 2];
        mr = musicDelay_[rd * 2 + 1];
        musicDelay_[rd * 2] = l;
        musicDelay_[rd * 2 + 1] = r;
        delayW_ = (delayW_ + 1) % delayLen_;
        voiceEnv_ = std::max(a, voiceEnv_ * 0.9995f);
        const float duckT = voiceEnv_ > 0.01f ? 0.708f : 1.f;  // -3 dB under the voice
        duck_ += (duckT - duck_) * (duckT < duck_ ? 0.0006f : 0.00005f);
        ml *= kHeadroom * duck_;
        mr *= kHeadroom * duck_;
      }
      if (rec && written < cap) {
        float L = v + ml, R = v + mr;
        const float pk = std::max(std::fabs(L), std::fabs(R));
        const float g = mlim_.gainFor(pk);
        mixBlock[written * 2] = Limiter::softclip(L * g);
        mixBlock[written * 2 + 1] = Limiter::softclip(R * g);
        stemBlock[written] = v;
        written++;
      }
    }
  }
  if (mic) micPeak_.store(std::max(peak, micPeak_.load(std::memory_order_relaxed) * 0.9f));
  if (written > 0) {
    mixRing_.write(mixBlock, size_t(written) * 2);
    stemRing_.write(stemBlock, size_t(written));
    recFrames_.fetch_add(written);
  }
  rendered_.store(frame0 + n, std::memory_order_relaxed);
  if (play && !playing_.load(std::memory_order_relaxed)) {
    anchorFrame_.store(frame0 + n);
    anchorPos_.store(readPos_ / rate_);
    anchorPlaying_.store(false);
  }
}

// ---------------------------------------------------------------- input (mic)
oboe::DataCallbackResult Engine::InCb::onAudioReady(oboe::AudioStream*, void* data, int32_t n) {
  Engine& e = Engine::get();
  e.micRing_.write(static_cast<float*>(data), size_t(n));
  return oboe::DataCallbackResult::Continue;
}

void Engine::InCb::onErrorAfterClose(oboe::AudioStream*, oboe::Result e) {
  LOGW("mic closed: %s, reopening", oboe::convertToText(e));
  Engine& en = Engine::get();
  std::lock_guard<std::mutex> g(en.lock_);
  en.in_.reset();
  if (en.micOpen_.load()) en.openInput();
}

bool Engine::openInput() {
  oboe::AudioStreamBuilder b;
  oboe::InputPreset preset = oboe::InputPreset::VoicePerformance;
  if (cfg_.mode == 3 || cfg_.inputPreset == 3) preset = oboe::InputPreset::VoiceCommunication;
  else if (cfg_.inputPreset == 1) preset = oboe::InputPreset::Unprocessed;
  else if (cfg_.inputPreset == 2) preset = oboe::InputPreset::Camcorder;
  b.setDirection(oboe::Direction::Input)
      ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
      ->setSharingMode(oboe::SharingMode::Exclusive)
      ->setFormat(oboe::AudioFormat::Float)
      ->setChannelCount(oboe::ChannelCount::Mono)
      ->setSampleRate(rate_)
      ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
      ->setInputPreset(preset)
      ->setDataCallback(&inCb_)
      ->setErrorCallback(&inCb_);
  if (cfg_.deviceId > 0) b.setDeviceId(cfg_.deviceId);
  oboe::Result r = b.openStream(in_);
  if (r != oboe::Result::OK) {
    b.setSharingMode(oboe::SharingMode::Shared);
    r = b.openStream(in_);
  }
  if (r != oboe::Result::OK && preset == oboe::InputPreset::VoicePerformance) {
    b.setInputPreset(oboe::InputPreset::Unprocessed);
    r = b.openStream(in_);
  }
  if (r != oboe::Result::OK) { LOGW("mic open failed: %s", oboe::convertToText(r)); return false; }
  in_->requestStart();
  return true;
}

std::string Engine::openMic(const RecordConfig& c) {
  start();
  closeMic();
  {
    std::lock_guard<std::mutex> g(lock_);
    cfg_ = c;
    const float fs = float(rate_);
    nc_.reset(new NoiseCancel(fs));
    nc_->setAmount(c.nc ? 1.f : 0.f);
    hpf_.highpass(fs, c.mode >= 2 ? 90.f : 40.f);
    ess_.peaking(fs, 6800.f, 2.f, -2.f);
    pres_.peaking(fs, 3000.f, 0.9f, 1.5f);
    comp_.setup(fs, -26.f, 2.5f, 0.01f, 0.22f, 3.f);
    vlim_.setup(fs, -3.f);
    mlim_.setup(fs, -1.f);
    micGain_ = std::pow(10.f, c.micGainDb / 20.f);
    micBuf_.assign(8192, 0.f);
    recMix_.assign(16384, 0.f);
    recStem_.assign(8192, 0.f);
    micRing_.clear();
    if (!openInput()) return "{\"ok\":false}";
    micOpen_ = true;
    if (in_) inXr0_ = in_->getXRunCount() ? in_->getXRunCount().value() : 0;
  }
  // digital mix: delay the music by what the singer hears it late plus the mic's own delay
  const double outL = outputLatencySec(), inL = inputLatencySec();
  const double nl = float(NoiseCancel::latency()) / rate_;
  musicOffset_ = outL + inL + nl;
  delayLen_ = std::max(1, int(musicOffset_ * rate_));
  musicDelay_.assign(size_t(delayLen_) * 2, 0.f);
  delayW_ = 0;
  char buf[256];
  std::snprintf(buf, sizeof(buf), "{\"ok\":true,\"rate\":%d,\"outLatency\":%.4f,\"inLatency\":%.4f,\"preset\":%d}", rate_, outL, inL,
                in_ ? int(in_->getInputPreset()) : -1);
  return buf;
}

void Engine::closeMic() {
  micOpen_ = false;
  // let an audio block that already started with the mic finish before anything is replaced
  std::this_thread::sleep_for(std::chrono::milliseconds(40));
  std::lock_guard<std::mutex> g(lock_);
  if (in_) { in_->stop(); in_->close(); in_.reset(); }
}

void Engine::setNC(bool on) {
  if (nc_) nc_->setAmount(on ? 1.f : 0.f);
  cfg_.nc = on;
}

void Engine::setMicGain(float db) { micGain_ = std::pow(10.f, db / 20.f); }

float Engine::micLevelDb() {
  const float p = micPeak_.load();
  return p > 1e-6f ? 20.f * std::log10(p) : -90.f;
}

void Engine::writerLoop() {
  std::vector<float> a(8192), b(4096);
  while (writerRun_.load()) {
    size_t n;
    while ((n = mixRing_.read(a.data(), a.size())) > 0) mixW_->write(a.data(), n);
    while ((n = stemRing_.read(b.data(), b.size())) > 0) stemW_->write(b.data(), n);
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  size_t n;
  while ((n = mixRing_.read(a.data(), a.size())) > 0) mixW_->write(a.data(), n);
  while ((n = stemRing_.read(b.data(), b.size())) > 0) stemW_->write(b.data(), n);
}

bool Engine::startRecord(const std::string& mixPath, const std::string& stemPath) {
  if (!micOpen_.load()) return false;
  mixRing_.clear();
  stemRing_.clear();
  mixW_.reset(new WavWriter(mixPath, 2, rate_));
  stemW_.reset(new WavWriter(stemPath, 1, rate_));
  if (!mixW_->ok() || !stemW_->ok()) return false;
  health_ = Health();
  {
    std::lock_guard<std::mutex> g(lock_);
    outXr0_ = out_ && out_->getXRunCount() ? out_->getXRunCount().value() : 0;
    inXr0_ = in_ && in_->getXRunCount() ? in_->getXRunCount().value() : 0;
  }
  recFrames_ = 0;
  writerRun_ = true;
  writer_ = std::thread([this] { writerLoop(); });
  recPaused_ = false;
  recording_ = true;
  return true;
}

void Engine::pauseRecord(bool p) { recPaused_ = p; }

Health Engine::stopRecord(double* mixSeconds, double* musicOffset) {
  recording_ = false;
  writerRun_ = false;
  if (writer_.joinable()) writer_.join();
  if (mixW_) mixW_->close();
  if (stemW_) stemW_->close();
  {
    std::lock_guard<std::mutex> g(lock_);
    health_.outXruns = (out_ && out_->getXRunCount() ? out_->getXRunCount().value() : 0) - outXr0_;
    health_.inXruns = (in_ && in_->getXRunCount() ? in_->getXRunCount().value() : 0) - inXr0_;
  }
  *mixSeconds = double(recFrames_.load()) / rate_;
  *musicOffset = cfg_.mode >= 2 ? musicOffset_ : 0;
  health_.seconds = *mixSeconds;
  mixW_.reset();
  stemW_.reset();
  return health_;
}

}  // namespace lectern
