# Recording audio: test plan (Lectern vs Snapchat)

The recording pipeline was rebuilt so that in-app music is **mixed digitally** into the
take instead of being re-recorded from the speaker. It has been tested in a browser with
simulated devices; it **has not yet been compared with Snapchat on a real phone**. Do not
claim parity until the comparison below has been run.

## What changed and why

| Problem found | Cause | Fix |
|---|---|---|
| Music sounded thin/warbly in saved videos | The take saved only camera + raw mic; music was re-captured through the air, then echo cancellation partly removed it | Music from the app is mixed digitally into the recording |
| "Bizarre", phasey sound in edited videos | The editor added clean music on top of a mic track that already contained speaker music | The mic is recorded as a separate voice stem; the editor mixes stem + clean music |
| Metallic artefacts | Noise reduction treated music in the mic as noise | Clean-up is off by default for mixed takes (the live chain already polished the voice) |
| Pumping levels | Loudness boost up to +18 dB and compression on music | Gentle live compression (2.5:1), ducking ≤3 dB, limiter + soft clipper, no browser AGC |
| Guide melody in takes | The player's guide track was recorded | The take gets the clean arrangement; the guide stays in the singer's ears |

## Configurations to test

For each: same phone, same song, same singer, same room, same distance (about 30 cm).

1. In-app music, **phone speaker**, phone mic.
2. In-app music, **Bluetooth headphones**, phone mic (recommended mode).
3. In-app music, Bluetooth headset **mic** (call-quality mode; expected lower quality).
4. In-app music, **wired headphones**, phone mic; and a wired headset mic.
5. External USB mic (Android).
6. Music volume in take at 30%, 60% (default), 90% (Tune → Music in take).
7. Quiet room and noisy room (TV or street noise).

Snapchat equivalent: record a video in Snapchat with a Sound added, same song section,
same configurations where Snapchat allows them.

## What to compare (score each 1–5 by two listeners, blind)

- Voice clarity and natural tone (no robotic/muffled/metallic sound)
- Music smoothness and steadiness (no pumping, no drop-outs)
- Balance between voice and music
- Distortion or clipping on loud passages
- Loudness consistency across the take
- Lip/voice sync with the video, and voice sync with the beat

Objective checks (optional): peak level (should stay below 0 dBFS), integrated loudness,
and voice-to-beat offset measured on a clap at the start.

## Known limits

- **Music from other apps** (Spotify etc.) can't be mixed digitally. Android's playback
  capture needs screen-capture consent and apps can opt out; on iOS it isn't available to
  apps. The mic will pick such music up acoustically. Recommend using in-app music.
- **Bluetooth headset microphones** switch the headset to call quality. The phone mic with
  Bluetooth playback gives better results.
- **Speaker playback** needs echo cancellation to keep the music out of the voice stem,
  which can slightly colour the voice. Headphones give the cleanest take.
