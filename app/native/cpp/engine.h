// Lectern audio engine: low-latency music playback with a sample-accurate clock, music-mode
// microphone capture, live mixing with noise cancellation, and WAV writing for takes.
#pragma once
#include <oboe/Oboe.h>

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "dsp.h"

namespace lectern {

struct RecordConfig {
  int mode = 0;          // 0 natural mic, 1 music through the mic (speaker), 2 clean mix, 3 clean mix + echo cancellation
  bool nc = false;       // noise cancellation
  float micGainDb = 0;   // mic level
  int inputPreset = 0;   // 0 auto (performance), 1 unprocessed, 2 camcorder, 3 voice communication
  int deviceId = 0;      // preferred input device (0 = system default)
};

struct Health {
  int64_t micUnderrunFrames = 0, micDropFrames = 0;
  int32_t outXruns = 0, inXruns = 0;
  double seconds = 0;
};

class WavWriter;

class Engine {
 public:
  static Engine& get();

  bool start();                 // opens the output stream
  void stop();
  int sampleRate() const { return rate_; }

  // ---- playback ----
  bool loadPcm(const int16_t* pcm, int64_t frames, int channels, int rate);
  void unload();
  void play();
  void pause();
  void seek(double sec);
  void setRate(double r);
  void setVolume(float v);
  double position();            // what the listener hears now, seconds into the track
  double duration() const;
  bool playing() const { return playing_.load(); }

  // ---- recording ----
  std::string openMic(const RecordConfig& c);   // returns a JSON-ish description
  void closeMic();
  bool startRecord(const std::string& mixPath, const std::string& stemPath);
  void pauseRecord(bool p);
  Health stopRecord(double* mixSeconds, double* musicOffset);
  void setNC(bool on);
  void setMicGain(float db);
  float micLevelDb();
  bool recording() const { return recording_.load(); }
  double outputLatencySec();
  double inputLatencySec();

 private:
  Engine() = default;
  class OutCb : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
   public:
    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* s, void* data, int32_t n) override;
    void onErrorAfterClose(oboe::AudioStream* s, oboe::Result e) override;
  } outCb_;
  class InCb : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
   public:
    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* s, void* data, int32_t n) override;
    void onErrorAfterClose(oboe::AudioStream* s, oboe::Result e) override;
  } inCb_;

  void render(float* out, int32_t n);
  bool openOutput();
  bool openInput();
  void writerLoop();

  std::mutex lock_;
  std::shared_ptr<oboe::AudioStream> out_, in_;
  int rate_ = 48000;

  // track (interleaved stereo int16 at rate_)
  std::shared_ptr<std::vector<int16_t>> track_;
  std::atomic<int64_t> trackFrames_{0};
  double readPos_ = 0;                        // audio thread only
  std::atomic<double> seekTo_{-1};
  std::atomic<bool> playing_{false};
  std::atomic<double> rateVal_{1.0};
  std::atomic<float> volTarget_{0.8f};
  float volCur_ = 0.8f;
  // clock: at rendered frame anchorFrame_ the track was at anchorPos_ seconds
  std::atomic<int64_t> rendered_{0};
  std::atomic<int64_t> anchorFrame_{0};
  std::atomic<double> anchorPos_{0};
  std::atomic<double> anchorRate_{1.0};
  std::atomic<bool> anchorPlaying_{false};

  // mic
  RecordConfig cfg_;
  Ring micRing_{1 << 16};
  std::atomic<bool> micOpen_{false};
  std::atomic<float> micPeak_{0};
  std::atomic<float> micGain_{1};
  std::unique_ptr<NoiseCancel> nc_;
  Biquad hpf_, ess_, pres_;
  Compressor comp_;
  Limiter vlim_, mlim_;
  std::vector<float> musicDelay_;             // stereo delay line for the digital mix
  int delayLen_ = 0, delayW_ = 0;
  float duck_ = 1.f, voiceEnv_ = 0;
  std::vector<float> micBuf_, recMix_, recStem_;

  // recording
  std::atomic<bool> recording_{false}, recPaused_{false};
  Ring mixRing_{1 << 18}, stemRing_{1 << 17};
  std::unique_ptr<WavWriter> mixW_, stemW_;
  std::thread writer_;
  std::atomic<bool> writerRun_{false};
  std::atomic<int64_t> recFrames_{0};
  Health health_;
  int32_t outXr0_ = 0, inXr0_ = 0;
  double musicOffset_ = 0;
};

}  // namespace lectern
