# Lyrics AI: models, evaluation and roadmap

Transcription (which words) and alignment (when each word is sung) are separate problems
and are evaluated separately.

## Current state

- On-device **Whisper Base** (ready), **Whisper Small** and **Whisper Large v3 Turbo**
  (in testing: integrated, not yet benchmarked; selectable via Settings → Models in testing).
- The song's **language** can be chosen (auto-detect is still available). Public lyrics
  benchmarks found mis-detected language to be a costly error; Russian songs default to
  Russian when the title or lyrics are in Cyrillic.
- Optional **vocal focus** pre-processing (centre-channel emphasis + voice band). Off by
  default: vocal separation helped in one public benchmark and hurt Whisper in another
  (Jam-ALT), so it must be measured per song set.
- **Review flags** mark lines that look unreliable (wrong alphabet for the chosen language,
  very long words, repetition loops, tiny fragments).
- **Check accuracy** in the song editor computes WER and CER against pasted correct lyrics
  and stores the result (Settings → Accuracy results).

## Listed for evaluation (not integrated)

| Model | Provider | Status | Notes |
|---|---|---|---|
| Scribe v2 | ElevenLabs | Needs server | 90+ languages incl. Russian; word timestamps |
| Nova-3 | Deepgram | Needs server | Russian model updated in 2026 |
| Chirp 3 | Google Cloud | Needs server | ru-RU GA; word timestamps in batch mode (≤20 min) |
| WhisperX | Open source | Planned | Alignment workflow for timing, not a singing model |
| Demucs | Meta (open source) | Planned | Vocal separation pre-processing |

Hosted models need a Lectern backend (API keys must not ship in the app).

## Benchmark protocol

1. Build a set of at least 30 songs with verified lyrics: 10 Russian, 10 English, 10 other
   (French, Spanish, etc.). Include rap, harmonies, long held notes, heavy mixes and accents.
2. For each pipeline (model × language hint × pre-processing), run every song and record:
   WER, CER, processing time ÷ song length, and cost.
3. Timing: for 10 songs, tap-sync reference line starts; measure mean absolute line-start
   error and the share of words highlighted within ±150 ms.
4. Report per language. Recommend a default per language; consider a language-specific or
   multi-stage pipeline if one model is weak on Russian.

The app's Accuracy results page is the on-device half of this: it records WER/CER and speed
per model and language from real songs.
