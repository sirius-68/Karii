# Lectern bug log

Status key: **Fixed (simulated)** means fixed and verified with automated tests in a browser
with simulated devices. It has not been confirmed on a real phone yet.

| # | Issue | Status |
|---|---|---|
| 16 | Double or layered audio, external music suppressed, noise cancellation, music bed | Fixed (simulated), build 5 |
| 17 | Recording screen freezes after returning from the editor | Fixed (simulated), build 6 |
| 18 | Recording freezes after replacing generated lyrics | Fixed (simulated), build 6 |
| 19 | Distorted, accelerated audio in Retap | Fixed (simulated), build 6 |
| 20 | Retap progress bar stays at 0:00 | Fixed (simulated), build 6 |
| 21 | Lyrics freeze after saving Retap adjustments | Fixed (simulated), build 6 |
| 22 | Oversized lyrics in the editor; lyric visibility controls | Fixed (simulated), build 6 |
| 23 | Background music volume control on the karaoke recording screen | Fixed (simulated), build 7 |
| 24 | Incorrect word highlighting during intros and vocal pauses | Fixed (simulated), build 7 |
| 25 | Audio distortion, stuttering and lyric skipping during recording | Fixed (simulated), build 7. Needs real-device confirmation |
| 24b | AI sync still lit the first word in the intro and jumped to a later "ooh" | Fixed (simulated), build 8: lyric matching keeps only matches that form a singable timeline; missed lines placed on detected singing |

---

## 23. Background music volume control in karaoke recording

**Issue.** When recording in Karaoke mode, the user needs to adjust the background song's
volume directly from the recording screen.

**Required:**
- A clearly visible volume slider for the background song on the karaoke recording screen.
- The backing track volume can be adjusted before and during recording.
- Changes apply in real time, without interrupting recording, restarting playback or
  resetting lyric sync.
- The music volume is independent of mic volume and voice effects.
- The setting is kept when pausing, resuming or restarting a session.
- The volume is reflected consistently in the preview, the recorded video and the exported
  mix.

**Resolution (build 7):**
- **The slider.** A "Music" slider sits above the stage controls whenever a song or music
  bed is playing, and stays available during recording.
- **One volume for listening and recording.** It sets the playback volume, and the recording
  taps the music after that volume, so the take follows the slider live.
- **Changes during a take.** They are stored as a volume envelope. The editor and the export
  replay the envelope, so they match the recorded video.
- **What it doesn't touch.** Mic level and voice effects are separate.
- **Persistence.** The value is saved and restored when the stage reopens.

## 24. Incorrect word highlighting during intros and vocal pauses

**Issue.** After AI auto-sync, the first word is sometimes highlighted as soon as Sing is
pressed, during the instrumental intro. Between lines, the next line or word can light up
before the singer reaches it.

**Required:**
- Accurate word timestamps.
- No highlighting during intros.
- Correct handling of intros, vocal sections and pauses.
- The highlight follows the real playback position.
- Users can correct word timing manually.

**Resolution (build 7):**
- **Cause.** Speech recognition (and onset-based sync) folds the silence before a word into
  that word, so the word "starts" during the intro or the pause.
- **Refinement pass.** A new pass runs on a vocal-focused version of the song and moves any
  word or line start that falls on silence to where the voice actually begins. It only moves
  starts later and never past the next word.
  - It runs automatically after AI or quick sync.
  - It runs once in the background for songs synced before this build.
  - Manual timing (Re-tap, fine-tune, LRC import) is never changed.
- **Upcoming line.** It is now shown as "next" so it can be read ahead. It isn't highlighted
  until its first word is sung.
- **Manual word timing.** In Fine-tune timing you can pick any word in a line, nudge its
  start, snap it to an onset and listen from it.

## 25. Critical audio distortion, playback stuttering and lyric skipping during recording

**Issue.** During karaoke video recording, the audio may initially play normally but later
develop distortion, stuttering, crackling or freezing sounds. At the same time, the lyrics
may skip words or jump forward, losing sync with the music.

This was first noticed after about 50 seconds in one recording. That is only an observation,
not a confirmed failure threshold. The problem may occur at different times, including in
recordings of one minute or longer, and it persists after exiting the recording screen and
recording again.

**Required fix.** Investigate the audio pipeline, buffer management, playback clock,
resource use and recording-session lifecycle. Reproduce the issue across recordings of
different lengths rather than assuming a fixed failure time.

**Testing requirement.** Repeated recordings of varying length, including sessions under one
minute and sessions of several minutes, monitoring audio quality and lyric sync throughout.

**Expected result.** Audio and lyrics stay stable and in sync for the whole recording,
whatever its length, with no distortion, stutter or lyric skipping as it goes on.

**Findings (build 7):**
1. **Noise-cancellation processors were never released.** The noise-cancellation stage runs
   on the audio thread. After every take, its processor kept running even though it was
   disconnected.
   - Each new take added one more, so the audio thread got busier with every take. This
     explains why exiting and recording again didn't help.
   - Measured offline, the leftover processors from 20 takes cost 17.7 s of processing for
     every 30 s of audio.
   - Fixed: processors now stop after a take.
2. **The noise-cancellation stage itself was expensive** and created garbage on the audio
   thread. Garbage collection on that thread is heard as clicks and stutter.
   - Fixed: it was rewritten to allocate nothing while running, with precomputed tables.
   - Result: about 9 times cheaper (one processor for 30 s: 873 ms before, 96 ms after).
3. **Small audio buffers on phones.** The audio engine on phones now uses larger buffers
   ("playback" latency). The extra delay is measured and compensated.
4. **Video encoding on the CPU.** On phones the camera is now recorded as H.264, which uses
   the hardware encoder; VP8 is encoded on the CPU. The video bitrate on phones is also
   slightly lower.
5. **Lyric display.** The highlight now follows a smoothed version of the audio clock, so a
   late frame or a small timing jump can't make it skip words.
6. **Health monitor during recording.** If the audio falls behind:
   - The stage drops its costly visual effects and shows a warning once.
   - If it keeps failing, the take is stopped and saved, with a clear message, instead of
     recording broken sound.
   - The next take starts on a fresh audio engine.
   - The editor's Audio sources card reports takes where the audio struggled.

**Stress test.** A simulated karaoke session on desktop Chromium at 4× CPU slowdown, with
mic, noise cancellation and the music mixed in:
- one 150 s take, then four 60 s takes back to back;
- no audio underruns (the audio clock stayed within 1–2% of real time);
- music in the recorded file continuous, with 0 ms drift;
- no lyric skips or backward steps;
- memory flat at about 20 MB.

Real phones (thermal throttling, vendor audio stacks) still need to be tested.
