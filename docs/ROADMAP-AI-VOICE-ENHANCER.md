# Roadmap: AI Voice Enhancer for singing

Status: **planned** (not implemented). Scheduled after the recording, multitrack editing
and lyrics-transcription work is stable on real devices.

## Goal

Help people who feel their singing sounds weak, rough or unstable get a more pleasant,
confident result **in their own voice**. The enhancer improves a performance; it never
replaces the singer with another voice and never clones anyone.

## What it does

| Capability | What the user gets | How (proposed) |
|---|---|---|
| Tone enhancement | Smoother, warmer, clearer voice | Adaptive EQ toward a target vocal balance (extends today's Enhance, which already measures tonal balance per take) |
| Pitch correction | Notes land closer to the intended pitch, expression kept | Pitch tracking (e.g. YIN/CREPE-style) → note targets from the song's key/melody (built-in songs know their melody) → gentle correction with adjustable retune speed and vibrato preservation |
| Vocal smoothing | Less harshness and unevenness | Multiband dynamic EQ on 2–6 kHz and sibilance (today's smoother, made frequency-adaptive) |
| Clarity | Voice sits in front of the music | Presence shaping + level riding against the backing track |
| Natural sound | No robotic or over-processed artefacts | Conservative defaults, formant-preserving pitch shifting, limits on correction depth |
| Intensity | Subtle → strong | One "Enhance" amount, plus Advanced: retune speed, smoothing, warmth |
| Before/after | Hear the difference instantly | A/B toggle that switches buffers in place without restarting playback |
| Identity | Still sounds like you | Never change timbre/formants beyond small corrections; no voice conversion models |

## User experience

1. After recording, the take editor's **Voice** tab shows **AI Voice Enhancer** with one
   slider (Off · Subtle · Natural · Strong) and an **A/B** button.
2. First use explains in one line what it changes and that the original is kept.
3. Pitch correction only appears when the song has a known key or melody (karaoke
   catalogue, beats with a key, or a key the user sets in Lyric pad).
4. Processing happens in the background with progress in the existing job pill; the
   editor stays usable.

## Proposed pipeline

```
voice stem (already recorded separately)
  → analysis: pitch track, voicing, loudness, tonal balance, sibilance
  → pitch correction (optional, needs key/melody) — formant-preserving
  → adaptive EQ + multiband smoothing
  → gentle compression / level riding against the music
  → A/B buffers kept side by side; non-destructive, saved as edit settings
```

Device vs server:

- **On device (first):** analysis, adaptive EQ, smoothing, compression (already partly built).
  Pitch correction is feasible in a worker for short takes; quality must be verified on
  mid-range Android phones.
- **Server (optional later):** neural enhancement or higher-quality pitch processing for
  long takes. Needs a privacy notice, opt-in, and cost controls.

## Feasibility and risks

- Pitch correction without a reference melody risks "correcting" intentional notes. Only
  enable it when the key/melody is known, and keep it subtle by default.
- Real-time preview of heavy processing on low-end phones: render offline in a worker,
  preview the rendered buffer.
- Measuring quality: blind A/B listening tests with real users on real phones; track how
  often people keep the enhancement on and at which strength.

## Out of scope

Voice cloning, singing in another person's voice, gender/age conversion presets.
