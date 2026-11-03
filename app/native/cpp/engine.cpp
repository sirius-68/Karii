#include "engine.h"

#include <android/log.h>

#include <chrono>
#include <cmath>
#include <thread>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "lectern", __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, "lectern", __VA_ARGS__)

namespace lectern {

Engine& Engine::get() {
  static Engine e;
  return e;
}

// ---------------------------------------------------------------- output
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
  if (r != oboe::Result::OK) { LOGW("output open failed: %s", oboe::convertToText(r)); out_.reset(); return false; }
  const int rate = out_->getSampleRate();
  // The player renders the track at its own rate into whatever rate this stream has, and the
  // frame counter of a new stream starts at 0: reset both before the first callback.
  outFrames_ = 0;
  outCalls_ = 0;
  outClk_.reset(rate);
  player_.prepare(rate);
  tuner_.reset(new oboe::LatencyTuner(*out_));
  auto l = out_->calculateLatencyMillis();
  outClk_.setLatencyFrames(int64_t((l ? l.value() : 40.0) * rate / 1000.0));
  out_->requestStart();
  LOGI("output open: %d Hz, burst %d, %s", rate, out_->getFramesPerBurst(), out_->getSharingMode() == oboe::SharingMode::Exclusive ? "exclusive" : "shared");
  return true;
}

bool Engine::start() {
  std::lock_guard<std::mutex> g(lock_);
  if (out_) return true;
  return openOutput();
}

oboe::DataCallbackResult Engine::OutCb::onAudioReady(oboe::AudioStream* s, void* data, int32_t n) {
  Engine& e = Engine::get();
  e.player_.render(static_cast<float*>(data), n, e.outFrames_);
  e.outFrames_ += n;
  e.outClk_.setFrames(e.outFrames_);
  // hardware presentation timestamp (cheap with AAudio; unsupported on OpenSL ES)
  if ((e.outCalls_++ & 3) == 0) {
    auto ts = s->getTimestamp(CLOCK_MONOTONIC);
    if (ts && ts.value().position > 0) e.outClk_.setTimestamp(ts.value().position, ts.value().timestamp);
  }
  // grow the buffer if the phone is too busy to keep it filled (camera + encoder)
  if (e.tuner_) e.tuner_->tune();
  return oboe::DataCallbackResult::Continue;
}

void Engine::OutCb::onErrorAfterClose(oboe::AudioStream*, oboe::Result err) {
  // device change (headphones in/out, Bluetooth): reopen; the track position is kept
  LOGW("output closed: %s, reopening", oboe::convertToText(err));
  Engine& e = Engine::get();
  std::lock_guard<std::mutex> g(e.lock_);
  e.out_.reset();
  e.tuner_.reset();
  e.openOutput();
}

bool Engine::loadPcm(const int16_t* pcm, int64_t frames, int channels, int rate) {
  start();
  // the track is kept at its own sample rate; the player converts while rendering
  player_.setTrack(makeTrack(pcm, frames, channels, rate));
  return true;
}

void Engine::unload() { player_.clearTrack(); }

double Engine::position() { return player_.posAtOutFrame(outClk_.frameAt(monoNs(), true)); }

void Engine::state(double* o) {
  o[0] = position();
  o[1] = player_.playing() ? 1 : 0;
  o[2] = player_.duration();
  o[3] = rec_.levelDb();
  o[4] = rec_.recording() ? 1 : 0;
  o[5] = outClk_.rate();
  o[6] = outClk_.hasTimestamp() ? 1 : 0;
  o[7] = player_.speed();
}

double Engine::outputLatencySec() {
  std::lock_guard<std::mutex> g(lock_);
  if (!out_) return 0;
  auto l = out_->calculateLatencyMillis();
  return l ? l.value() / 1000.0 : 0.04;
}

// ---------------------------------------------------------------- input
bool Engine::openInput() {
  oboe::InputPreset preset = cfg_.mode == 3 ? oboe::InputPreset::VoiceCommunication : oboe::InputPreset::VoicePerformance;
  oboe::AudioStreamBuilder b;
  b.setDirection(oboe::Direction::Input)
      ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
      ->setSharingMode(oboe::SharingMode::Exclusive)
      ->setFormat(oboe::AudioFormat::Float)
      ->setChannelCount(oboe::ChannelCount::Mono)
      // a fixed rate for every take (the platform converts if the mic runs at another one)
      ->setSampleRate(rec_.recording() ? rec_.rate() : 48000)
      ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
      ->setInputPreset(preset)
      ->setDataCallback(&inCb_)
      ->setErrorCallback(&inCb_);
  oboe::Result r = b.openStream(in_);
  if (r != oboe::Result::OK) {
    b.setSharingMode(oboe::SharingMode::Shared);
    r = b.openStream(in_);
  }
  if (r != oboe::Result::OK && preset == oboe::InputPreset::VoicePerformance) {
    b.setInputPreset(oboe::InputPreset::Unprocessed);
    r = b.openStream(in_);
  }
  if (r != oboe::Result::OK) {
    b.setInputPreset(oboe::InputPreset::Generic);
    r = b.openStream(in_);
  }
  if (r != oboe::Result::OK) { LOGW("mic open failed: %s", oboe::convertToText(r)); in_.reset(); return false; }
  const int rate = in_->getSampleRate();
  inFrames_ = 0;
  inCalls_ = 0;
  inClk_.reset(rate);
  auto l = in_->calculateLatencyMillis();
  inLatencyNs_.store(int64_t((l ? l.value() : 20.0) * 1e6));
  rec_.configure(rate, cfg_);  // no-op while a take is running (keeps its processing)
  in_->requestStart();
  LOGI("mic open: %d Hz, preset %d, burst %d", rate, int(in_->getInputPreset()), in_->getFramesPerBurst());
  return true;
}

oboe::DataCallbackResult Engine::InCb::onAudioReady(oboe::AudioStream* s, void* data, int32_t n) {
  Engine& e = Engine::get();
  const int64_t f0 = e.inFrames_;
  e.inFrames_ += n;
  e.inClk_.setFrames(e.inFrames_);
  if ((e.inCalls_++ & 3) == 0) {
    auto ts = s->getTimestamp(CLOCK_MONOTONIC);
    if (ts && ts.value().position > 0) e.inClk_.setTimestamp(ts.value().position, ts.value().timestamp);
  }
  // when was the first sample of this block captured?
  int64_t cap = e.inClk_.nsAtFrame(double(f0));
  if (cap == 0) cap = monoNs() - e.inLatencyNs_.load(std::memory_order_relaxed) - int64_t(double(n) * 1e9 / e.inClk_.rate());
  // and what was the singer hearing at that moment?
  bool playing = false;
  const double pos = e.player_.posAtOutFrame(e.outClk_.frameAt(cap, true), &playing);
  e.rec_.onInput(static_cast<const float*>(data), n, cap, playing ? pos : NAN, e.player_.speed());
  return oboe::DataCallbackResult::Continue;
}

void Engine::InCb::onErrorAfterClose(oboe::AudioStream*, oboe::Result err) {
  LOGW("mic closed: %s, reopening", oboe::convertToText(err));
  Engine& e = Engine::get();
  std::lock_guard<std::mutex> g(e.lock_);
  e.in_.reset();
  if (e.micWanted_.load()) e.openInput();
}

std::string Engine::openMic(const RecConfig& c) {
  start();
  closeMic();
  std::lock_guard<std::mutex> g(lock_);
  cfg_ = c;
  micWanted_.store(true);
  if (!openInput()) {
    micWanted_.store(false);
    return "{\"ok\":false}";
  }
  rec_.setNC(c.nc);
  rec_.setGain(c.gainDb);
  auto lo = out_ ? out_->calculateLatencyMillis() : oboe::ResultWithValue<double>(oboe::Result::ErrorNull);
  char buf[256];
  std::snprintf(buf, sizeof(buf), "{\"ok\":true,\"rate\":%d,\"outLatency\":%.4f,\"inLatency\":%.4f,\"preset\":%d,\"outRate\":%d}", in_->getSampleRate(),
                lo ? lo.value() / 1000.0 : 0.0, inLatencyNs_.load() / 1e9, int(in_->getInputPreset()), outClk_.rate());
  return buf;
}

void Engine::closeMic() {
  if (rec_.recording()) {
    int32_t a, b;
    stopRecord(&a, &b);
  }
  std::lock_guard<std::mutex> g(lock_);
  micWanted_.store(false);
  if (in_) {
    in_->stop();
    in_->close();
    in_.reset();
  }
}

bool Engine::startRecord(const std::string& voicePath, const std::string& musicPath) {
  {
    std::lock_guard<std::mutex> g(lock_);
    if (!in_) return false;
    outXr0_ = out_ && out_->getXRunCount() ? out_->getXRunCount().value() : 0;
    inXr0_ = in_->getXRunCount() ? in_->getXRunCount().value() : 0;
  }
  return rec_.start(voicePath, musicPath, player_.track());
}

RecStats Engine::stopRecord(int32_t* outXruns, int32_t* inXruns) {
  RecStats s = rec_.stop();
  std::lock_guard<std::mutex> g(lock_);
  *outXruns = (out_ && out_->getXRunCount() ? out_->getXRunCount().value() : 0) - outXr0_;
  *inXruns = (in_ && in_->getXRunCount() ? in_->getXRunCount().value() : 0) - inXr0_;
  return s;
}

}  // namespace lectern
