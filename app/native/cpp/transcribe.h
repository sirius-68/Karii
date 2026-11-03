// Speech recognition with word timing (whisper.cpp + vocal map) for Clip to lines. Platform independent.
#pragma once
#include <atomic>
#include <memory>
#include <string>

#include "core.h"

namespace lectern {

extern std::atomic<int> g_sttProgress;   // 0..100 while transcribing
extern std::atomic<bool> g_sttAbort;     // set to cancel

struct TranscribeOptions {
  bool dtw = true;      // DTW token timestamps
  bool refine = true;   // drop words the model imagined where no voice is
  int threads = 0;      // 0 = pick from the CPU count
};

// {"words":[{text,start,end}],"vad":[[s,e]],"lang":"xx","dropped":n} or {"error":...}
std::string transcribeJson(std::shared_ptr<Track> track, const std::string& model, std::string lang, const TranscribeOptions& opt);

}  // namespace lectern
