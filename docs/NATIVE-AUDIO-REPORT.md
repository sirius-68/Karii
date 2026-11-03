# Audio, karaoke sync and background processing: investigation and rebuild

## 1. Root causes found

### Recording speed (slow / fast audio, pitch shift)
- **The track was resampled once, to the output rate at load time.** When the output stream
  was reopened at another rate (Bluetooth A2DP at 44.1 kHz after the phone speaker at 48 kHz,
  or the reverse), the same samples were played at the new rate: 8.1 % slow and a semitone and
  a half flat (or fast and sharp). Positions and durations were computed with the new rate, so
  the lyrics clock was wrong as well.
- **Takes were written with the output's rate**, from samples clocked by the output callback.
  After a route change mid-session the WAV header and the data disagreed, so the take played back
  at the wrong speed.
- The app's track cache kept the stale (wrong-rate) track when the user came back to the page:
  the "excessively fast after revisiting" report.

### Jitter, crackle, "radio" sound
- **Recording was driven by the output callback**, which pulled the microphone out of a ring
  buffer. The mic and the output run on different clocks and, with Bluetooth, the output asks
  for audio in large bursts. When the ring ran short, silence was inserted; when it grew, audio
  was thrown away. Both are audible clicks.
- **All voice processing (noise-cancellation FFTs, EQ, compressor, limiter) ran inside the
  output callback**, the most timing-critical thread in the app, while the camera encoder was
  competing for the CPU. Late callbacks are underruns: crackle in what you hear and in the take.
- **The noise canceller used plain spectral gating**, which produces "musical noise", the
  warbling, radio-like artefact, on steady background noise.
- The noise canceller's delay was compensated as 1,024 samples, but it is 1,792. In clean mixes
  the voice sat 16 ms late against the music.
- The web build's "headset mic" option routed through Bluetooth SCO, the 8 to 16 kHz phone-call
  path. That is literally telephone-quality, radio-like sound. The native app now forces the
  media path when the mic opens.

### Low video volume
- Phone mics in music mode deliver about -35 LUFS for normal singing at arm's length. Nothing
  raised it: the take was published at the raw level.
- In clean mixes the music was added at 75 % of full scale under a voice at unity. In the test
  material the voice ended up 18 LU *under* the music.

### Karaoke sync
- **The first word lit during the intro** (reproduced): the speech recogniser's decoder timestamps
  put a phrase's first word at the start of its 30-second window. In the test song the first word
  was stamped at 0.00 s although it is sung at 14.00 s, and 4 words landed in the intro.
- After that was replaced with DTW timestamps, every word was **0.4 s late**: whisper.cpp stamps
  a token's DTW time when the alignment leaves the token, i.e. its *end*, not its start.
- The highlighting followed a smoothed position polled over a platform channel once per frame,
  then glided towards it using wall-clock time. That is an independent timer in between the
  audio and the lyrics.
- Each frame rebuilt the whole stage, camera preview included, and made a platform-channel call
  on the main thread. This is the source of video freezes while audio continued.
- Timing data from different sources (catalogue, tap, AI, generated, edited) went straight to
  the renderer. Missing, stale or invalid entries (NaN, out of order, word counts that no longer
  match the line) could throw while drawing, which shows up as a frozen stage.
- Two song loads in flight could finish in the wrong order: the older song replaced the newer one.

### Background processing
- Transcription ran behind a modal dialog on a thread that lived with the screen. Leaving the
  screen or the app stopped or orphaned it.

## 2. Research: how established karaoke systems time lyrics

Public information only; proprietary internals are not documented.
- **Smule** user-made songbook arrangements are timed by hand, line by line (spacebar/click
  while the track plays); Smule's producers time each word or syllable and add pitch guides
  ([Smule help](https://smule.zendesk.com/hc/en-us/articles/360001425546-Adding-a-Song-to-the-Songbook)).
- **KaraFun** files store one timing mark per word in hundredths of a second, separately from the
  text (reverse-engineered: [ulduzsoft](https://www.ulduzsoft.com/?p=646)). **StarMaker** and
  **Yokee** don't document their approach.
- **Apple Music / TTML** lyrics give every word its own begin/end and the player lights a word
  when the playhead passes its begin
  ([BetterLyrics](https://composer.betterlyrics.org/guides/what-is-ttml)).
- **Audio clock**: Android guidance is to take the playback position from the audio output's
  presentation timestamps and trust them, without hard-coded offsets
  ([Amazon Fire TV A/V sync](https://developer.amazon.com/docs/fire-tv/audio-video-synchronization.html)).
- **Automatic alignment**: Whisper has no native word timestamps; DTW over cross-attention
  (WhisperT) and forced alignment with wav2vec2 (WhisperX) are the published approaches, with
  F1 around 75 at a 0.2 s collar on synthetic speech
  ([CrisperWhisper, arXiv 2408.16589](https://arxiv.org/html/2408.16589v1)).
  Lyrics-to-audio alignment of singing is an active research area (NUS, AIST).
- **Loudness**: EBU R128 / ITU-R BS.1770 (K-weighting, -70 LUFS absolute gate and -10 LU
  relative gate, true peak) ([EBU R 128](https://en.wikipedia.org/wiki/EBU_R_128)); streaming
  services normalise music to about -14 LUFS.

What was taken from this: one authoritative clock (the audio hardware's), word-level begin/end
times as the only thing the renderer needs, and automatic timing as speech recognition with
DTW, corrected with what the audio itself shows (vocal onsets, vocal activity). Tap sync stays
available as the manual method the big apps rely on.

## 3. What was rebuilt

**Audio core** (`native/cpp/core.*`, platform independent, unit-tested on Linux):
- `Player` keeps a song at its own sample rate and renders it through a 24-tap windowed-sinc
  interpolator into whatever rate the output has. A route change can't change speed or pitch.
- The clock is a history of anchors (output frame → song time) plus the output's hardware
  presentation timestamps. "What the listener hears now" is exact after seeks, pauses, speed
  changes and stream restarts, including Bluetooth latency.
- `Recorder` is driven by the mic. Its callback only copies samples and a timeline mark (the
  song time the singer was hearing when the sample was captured, from both hardware timestamps).
  A worker thread does noise cancellation and EQ and writes the voice (32-bit float) and the
  music the singer heard, read from the song by that timeline, so the two are sample-aligned.
- `finalizeTake`: an offline mix. The voice is evened out by a gentle compressor and set
  against the music (4 LU under the voice, adjustable). The mix is normalised to -14 LUFS
  (BS.1770) with a look-ahead true-peak limiter at -1 dBTP.
- The noise canceller is now a decision-directed Wiener filter (no musical noise), with its
  latency fixed.
- `analyzeVocals` finds where the voice is from centre-channel vocal-band energy, and vocal
  onsets for word starts.

**Android glue** (`engine.*`, `jni.cpp`): Oboe streams around the core, a latency tuner on the
output, audio focus handling (calls and other apps pause a take), and dart:ffi exports so Dart
reads the clock synchronously every frame.

**Karaoke engine** (`lib/lyrics/karaoke.dart`):
- Every source becomes one normalised `LyricTrack`: ordered words with start/end, all finite,
  never overlapping, stale timing re-aligned first.
- What is lit is a pure function of the audio clock: a binary search per frame, with no timers
  and no state.
- The stage rebuilds only the lyrics and the progress bar each frame, not the camera.

**AI sync** (`native/cpp/transcribe.*`): whisper.cpp DTW token times, read correctly as token
*ends*. A word starts where the previous one ended when sung back to back, or at the vocal onset
before its end after a pause, then snaps to the nearest onset. Words placed where nobody sings
move to the next vocal onset, and hallucinated phrases in intros and breaks are dropped.

**Background jobs** (`JobService.kt`, `lib/core/jobs.dart`, `lib/widgets/job_pill.dart`):
- An Android foreground service (media-processing / data-sync type) holds a wake lock and a
  queue persisted in `jobs.json`. Results are written to files.
- Progress shows in the notification and in a floating pill in the app; finishing posts a
  notification that opens the result.
- Duplicate taps return the running job. Retry and cancel are supported. After the app process
  is killed, interrupted jobs are re-queued on the next launch, and finished results are
  applied then.

**Take editor**: the take is re-mixed from its stems for sync fixes and a new music-level
slider. Loudness and true peak are shown.

## 4. Files changed

See the commit list on `main` from "Audio engine rebuild…" onwards:
- C++: `core.h/.cpp` (new), `dsp.h`, `engine.h/.cpp`, `jni.cpp`, `transcribe.h/.cpp` (new),
  `stt.cpp`, `CMakeLists.txt`
- Kotlin: `JobService.kt` (new), `MainActivity.kt`, `NativeEngine.kt`, `JobStoreTest.kt` (new)
- Dart: `engine/engine.dart`, `lyrics/karaoke.dart`, `core/jobs.dart` (new),
  `widgets/job_pill.dart` (new), `main.dart`, and the screens `stage`, `take_editor`,
  `sync_screen`, `editor`, `ai_sync`, `studio_tab` and `studio/recorder`
- Tests: `native/test/engine_test.cpp`, `native/test/asr_test.cpp`, `native/test/gen_song.py`,
  `test/lyric_sync_test.dart`
- CI: `.github/workflows/android-native.yml` runs every suite and publishes `TEST-REPORT.md`
  next to the APK.

## 5. Tests

Every push runs four suites; results are in `TEST-REPORT.md` on the `apk` branch.

## 6. Remaining limitations

- Nothing here has run on a phone yet. The suites simulate the audio hardware (bursts, drift,
  late callbacks, Bluetooth latency) and the speech test uses synthetic speech over a band.
  On-device behaviour, especially camera timing and the hardware timestamps of specific
  phones, still needs real use.
- Video/audio alignment uses the measured stop times of camera and mic. CameraX doesn't expose
  the first frame's capture time, so a residual offset of a few tens of milliseconds is possible;
  the take editor's sync slider corrects it.
- Automatic timing is only as good as the recognition: heavily processed or very fast singing
  is recognised less well than speech. Tap sync remains the exact fallback.
- The vocal map relies on vocals being centred; a centred lead instrument can be mistaken for
  a voice.
- Background jobs are tested at the queue level (JVM). The foreground service itself, its
  notification and Android's background limits were not exercised on a device.
