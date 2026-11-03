// Lectern audio engine on Android: Oboe streams around the platform-independent core (core.h).
//  - One output stream renders the Player; its hardware timestamps drive the clock that lyrics
//    and recording follow ("what the listener hears now").
//  - One input stream feeds the Recorder; the recording is driven by the mic's own clock, so
//    nothing is inserted or dropped when the two streams drift, burst (Bluetooth) or stall.
//  - All processing (noise cancellation, EQ, file writing) runs on a worker thread, never in
//    the audio callbacks.
#pragma once
#include <oboe/Oboe.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>

#include "core.h"

namespace lectern {

class Engine {
 public:
  static Engine& get();

  bool start();
  int outputRate() const { return outClk_.rate(); }

  // ---- playback ----
  bool loadPcm(const int16_t* pcm, int64_t frames, int channels, int rate);
  void unload();
  void play() { start(); player_.play(); }
  void pause() { player_.pause(); }
  void seek(double sec) { player_.seek(sec); }
  void setSpeed(double s) { player_.setSpeed(s); }
  void setVolume(float v) { player_.setVolume(v); }
  void setMusic(double start, double end, bool loop, double fadeIn, double fadeOut) {
    player_.setRegion(start, end);
    player_.setLoop(loop);
    player_.setFades(fadeIn, fadeOut);
  }
  double position();  // seconds into the track that the listener hears now
  double duration() const { return player_.duration(); }
  bool playing() const { return player_.playing(); }
  // [position, playing, duration, micDb, recording, outputRate, hasHardwareClock, speed]
  void state(double* out);

  // ---- recording ----
  std::string openMic(const RecConfig& c);
  void closeMic();
  bool startRecord(const std::string& voicePath, const std::string& musicPath);
  void pauseRecord(bool p) { rec_.setPaused(p); }
  RecStats stopRecord(int32_t* outXruns, int32_t* inXruns);
  void setNC(bool on) { rec_.setNC(on); }
  void setMicGain(float db) { rec_.setGain(db); }
  float micLevelDb() const { return rec_.levelDb(); }
  bool recording() const { return rec_.recording(); }
  double outputLatencySec();

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

  bool openOutput();  // with lock_ held
  bool openInput();   // with lock_ held

  std::mutex lock_;
  std::shared_ptr<oboe::AudioStream> out_, in_;
  std::unique_ptr<oboe::LatencyTuner> tuner_;
  Player player_;
  StreamClock outClk_, inClk_;
  Recorder rec_;
  RecConfig cfg_;
  std::atomic<bool> micWanted_{false};
  int64_t outFrames_ = 0, inFrames_ = 0;  // audio threads
  uint32_t outCalls_ = 0, inCalls_ = 0;
  std::atomic<int64_t> inLatencyNs_{20000000};
  int32_t outXr0_ = 0, inXr0_ = 0;
};

}  // namespace lectern
