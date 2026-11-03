# Lectern — performance studio

Lectern is an Android app for performing and recording spoken word: poems, monologues,
movie lines and scenes, acting scripts, speeches, storytelling and original lyrics
performed as spoken word. Write or paste the text, read it from a teleprompter over the
camera, perform over background music, and get a finished, loudness-normalised video.

The app lives in [`app/`](app): a Flutter UI on top of a C++ audio engine (Oboe), with
on-device speech recognition (whisper.cpp) for *Clip to lines*.

## What it does

| Area | Features |
|---|---|
| Script editor | Write, paste or import a text file. Autosave, undo/redo, find and replace, line tools (move, duplicate, delete, blank line, stage direction), sections (`[Verse]`, `[Scene 2]` on their own line) that can be reordered, renamed, duplicated and deleted. Word count and performance time. Templates for speeches, monologues, scenes, stories, poems and spoken-word lyrics. |
| Teleprompter | Per project: font, size, weight, colour, alignment, line and paragraph spacing, background colour and opacity, highlight colour, shadow, outline. Auto-scroll with speed, pause/resume (tap the text), manual scrolling, jump to any line, reading line, position (top/middle/bottom), area height, transparency, mirror, hide while recording. Lower-case `[directions]` show smaller inside the text. The script is drawn over the camera preview only, so it never appears in the video. |
| Background music | Per project: your audio files or the built-in instrumentals and beats. Preview, seek, trim (drag or "start/end here"), loop with click-free seams, fade in/out, the volume you hear, voice-to-music balance in the video, and smooth ducking under the voice. |
| Recording | Live camera preview, front/back camera, portrait or landscape, countdown, rehearse without recording, pause/resume, focus mode, mic level and noise cancellation, interruption handling (calls pause the take). With headphones (or the clean-mix setting on the speaker) the voice is recorded on its own, sample-aligned with the music the performer heard, and mixed afterwards on that shared timeline: no echo or feedback, and the mix can be changed later. |
| After a take | Preview, fix audio/video sync, change music level, fades and ducking, save (and to the gallery), share, or keep as a draft. |
| Studio | Lyric pad (syllables, rhymes, metronome), beat maker, sound recorder, Clip to lines (turn the speech in a movie clip into text to perform). |

Projects and recordings stay on the phone. Network use: the speech model download (once,
for Clip to lines), streamed instrumentals and Datamuse rhyme suggestions.

## Build

Push to `main` and the **Build Android APK** workflow builds the app and runs the tests.
The APK and `TEST-REPORT.md` are published on the
[`apk` branch](https://github.com/sirius-68/Karii/tree/apk)
([direct download](https://github.com/sirius-68/Karii/raw/apk/Lectern.apk)).

Test suites:
- **Audio engine** (C++, runs on any desktop: `app/native/test/run_tests.sh`): playback speed
  and clock accuracy, mic-driven recording under Bluetooth bursts and clock drift, voice/music
  alignment, loudness (BS.1770) and true peak, noise cancellation, music trim/loop seams/fades,
  ducking smoothness, recording over a looping region.
- **Scripts and projects** (Dart, `flutter test`): sections, directions, teleprompter rows,
  undo history, migration of older projects.
- **Background jobs** (JVM): the persistent job queue, including that leftover jobs of
  removed features are cancelled rather than run.

## Upgrading from earlier versions

Karaoke has been removed. Karaoke songs saved by earlier versions open as *Lyrics*
projects with their text and music kept; their timing data is dropped. Text size, scroll
speed and music volume, which used to be global settings, are copied into each project.
Recordings and drafts are untouched.

## Repository layout

```
app/          the Android app (Flutter + C++); see app/native for the engine and its tests
docs/         engineering notes and measured results
web/, www/, android/, ios/   the earlier web (Capacitor) version, kept for reference only;
              it is not built automatically
```
