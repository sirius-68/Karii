# Recording audio: architecture, diagnosis and test plan

## The doubled-audio bug (fixed in build 5)

**Symptom.** Takes recorded with music on the phone speaker sounded doubled, echoey or
phasey, most noticeably when the take was played back in the editor.

**Root cause, confirmed by the diagnostic test below.** In-app music was always mixed into
the recording digitally, delayed by an *estimate* of the speaker latency. On the speaker,
the microphone also heard the same music through the air. Echo cancellation was switched
on to remove it, but on many Android phones it doesn't remove music reliably. So:

1. **The video file contained the music twice.** One copy came from the digital mix and the
   other leaked through the mic, about 85 ms apart in the simulation. That is an echo or
   comb filter, which is the "doubled" sound.
2. **The editor made it worse.** It played the voice stem, which still contained the leaked
   music, plus the clean music at the estimated offset. That is two misaligned copies again.
3. **Music from other apps was suppressed.** Echo cancellation on the speaker switches
   Android into voice-call processing, which treats sustained music as noise.

The editor never played the video's own sound together with the stem: the video element
stays muted in buffer mode. So the duplication came entirely from the capture design.

## The new architecture

Every take now uses **one capture strategy**, chosen from the output route and the music
source, so the same sound can never be recorded twice:

| Mode | When | Music reaches the take by | Echo cancellation |
|---|---|---|---|
| **Natural mic** (`mic`) | No in-app music: voice only, or music from another app | The mic, if any music is playing | Off |
| **Music through the mic** (`acoustic`) | In-app music on the speaker (default) | The mic, as heard in the room. No digital copy. | Off |
| **Clean mix** (`mix`) | In-app music with Bluetooth, wired or USB headphones | A digital mix, delayed to match what the singer heard. The mic hears only the voice. | Off |
| **Clean mix + echo cancellation** (`mixaec`) | Optional for in-app music on the speaker | A digital mix | On |

These settings apply in every mode:

- **No call-style processing.** The browser's noise suppression and auto-gain are always
  requested off, and the request is repeated with `applyConstraints` if the device ignores
  it. What the device actually applied (`track.getSettings()`) is stored with the take and
  shown to the user.
- **Separate controls for echo and noise.**
  - Echo cancellation (Auto / On / Off) can only be set before recording.
  - Noise cancellation is Lectern's own music-safe AudioWorklet, which can be toggled live,
    including during a take.
    - **How it works:** spectral gating with a noise floor learned by minimum statistics
      over about 8 s.
    - **How much it reduces:** at most 12 dB.
    - **Latency:** a constant 21 ms whether it is on or off. In the digital modes this is
      compensated in the music delay.
- **Mic level and music level** are independent and adjustable live.
- **The editor plays one mix.** That mix is the voice track, plus the clean music only in
  the digital modes or when "Add the original track on top" is switched on. The video's own
  sound stays muted.
  - If the voice track contains music (detected by cross-correlation), the clean music is
    placed exactly on top of it rather than at the estimated offset.
  - A mixed take whose voice track contains leaked music is re-rendered on save, so the
    exported file has a single copy.
  - The export uses the same Web Audio graph as playback, so it can't differ.

## Diagnostic test (`diag.mjs`, simulated devices)

How the test works:

- **Recording:** headless Chromium with a simulated microphone. Everything the app sends to
  the speakers also reaches the simulated mic, 110 ms later at −6 dB. That models a phone
  speaker leaking into the mic.
- **Inspection:** each take's video file is saved and its streams listed with `ffprobe`. The
  music is located with GCC-PHAT cross-correlation in:
  - the video file's audio,
  - the voice stem,
  - a capture of what the editor plays.
- **Counting copies:** a "copy" is a correlation peak at least 30% as strong as the main one,
  and at least 15 ms away from it.

| Scenario | File tracks | Music copies in file | Music copies in editor playback |
|---|---|---|---|
| Speaker + in-app song, old design (`mixaec`; echo cancellation can't remove the music in this simulation) | 1 audio + 1 video | **2** (91 ms and 176 ms): the reported bug | 1. The editor aligns the clean track to the leak, and the export is re-rendered. |
| Speaker + in-app song, new default (`acoustic`) | 1 + 1 | **1** | 1 |
| Bluetooth + in-app song (`mix`) | 1 + 1 | 1 (none in the voice stem) | 1 |
| Wired + in-app song (`mix`) | 1 + 1 | 1 (none in the voice stem) | 1 |

### Results for all eight requested scenarios

All results are from the simulation described above.

| # | Scenario | Mode | Copies of the music (file / editor) | Peak | Clipped samples | Notes |
|---|---|---|---|---|---|---|
| 1 | Speaker music + mic | `acoustic` | 1 / 1 | 0.73 | 0 | The editor adds no second copy. |
| 2 | In-app music + mic, headphones | `mix` | 1 / 1 | 0.91 | 0 | No music in the voice stem. |
| 3 | Music from another app, NC off | `mic` | n/a | 0.41 | 0 | Noise-only passage: −36.7 dB. Music and voice: −19.6 dB. |
| 3 | Music from another app, NC on | `mic` | n/a | 0.41 | 0 | Noise-only passage: **−41.2 dB (4.5 dB less noise)**. Music and voice: **−19.6 dB (unchanged)**. |
| 4 | In-app music, speaker, NC on | `acoustic` | 1 / 1 | 0.69 | 0 | |
| 4 | In-app music, Bluetooth, NC on | `mix` | 1 / 1 | 0.90 | 0 | |
| 5 | Bluetooth, and wired | `mix` | 1 / 1 | 0.91 | 0 | The route was detected from the device names. |
| 6 | Voice only | `mic` | n/a | 0.55 | 0 | |
| 7 | Music only (silent mic) | `mix` | 1 / 1 | 0.32 | 0 | |
| 8 | Loud voice (+6 dB), music at 30% | `mix` | 1 / 1 | 0.91 | 0 | |
| 8 | Quiet voice (−6 dB), music at 100% | `mix` | 1 / 1 | 0.82 | 0 | |

Every take had exactly one audio track and one video track (checked with `ffprobe`). In
every mode, the mic was opened with noise suppression and auto-gain off. Echo cancellation
was on only in `mixaec`.

### Noise cancellation, offline measurements

The NC worklet was run offline on the embedded tracks plus white noise.

- **Steady noise:** reduced by 5–6 dB.
- **A tone over noise:** within 0.3 dB of its original level.
- **Music on its own:** 0.2–1.7 dB quieter. The largest loss was on the slow, sustained
  piano track.

Because sustained notes can lose a little level, NC is off by default.

## Still to test on real phones

The simulation can't model a real room, a real phone's echo canceller, Bluetooth codecs or
OS processing. Before claiming quality parity with Snapchat, run these on at least one
mid-range Android phone and one iPhone:

1. In-app music on the speaker, default mode: no echo or doubling, and check that the music
   level is acceptable.
2. The same in "Clean digital mix" mode: listen for doubling. The editor should report
   "Speaker music in the voice track" if echo cancellation missed it.
3. Bluetooth headphones and wired headphones with in-app music.
4. Spotify or YouTube playing on the speaker with noise cancellation off and then on. The
   music should be neither suppressed nor pumping.
5. A noisy room (fan or TV) with noise cancellation on and off.
6. Voice only; music only; loud voice with quiet music, and the reverse.
7. Pause and resume mid-take in every mode.

## Platform limits (can't be fixed from the app)

- **WebView audio sources.** In the Android WebView, `getUserMedia` can't choose the
  `CAMCORDER`, `VOICE_PERFORMANCE` or `UNPROCESSED` audio sources. Some phones apply light
  processing that the app can't turn off.
  - Lectern reports what the device kept on, and whether the phone offers an unprocessed
    input (`AudioRoute.getProcessing`).
  - Truly raw capture would need a native recorder plugin, which is a possible follow-up.
- **Music from other apps.** It can't be captured digitally without Android's playback
  capture: that needs Android 10+ and screen-capture consent, and apps can opt out. On iOS
  it isn't available to apps. Lectern records it through the mic, untouched.
- **Bluetooth headset microphones** switch the headset to call quality. The phone mic with
  Bluetooth playback is better.
