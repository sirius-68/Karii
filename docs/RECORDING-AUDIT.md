# Recording, video and sound: audit of November 2026

Reports this audit answers:

1. The take preview ("edit mode") is dark.
2. The first takes after installing work; a later take has no picture. Only uninstalling and
   reinstalling helps, and then it fails again after a take.
3. Takes are very quiet (−30 and −25 LUFS shown on "Microphone only" takes; the target is −14).

How it was investigated: the whole take pipeline was re-read (recording screen, camera plugin
source, Kotlin media code, C++ engine), and a test was added that runs the real app on an
Android emulator in CI and records takes back to back (`app/integration_test/takes_test.dart`,
result on the `device-test` branch). The emulator's system log is part of that result.

What is proven and what is inferred is marked for each finding.

## Findings

### A. The camera opened the microphone during every take (proven)

Lectern asks the camera plugin for video only (`enableAudio: false`) because it records the
voice itself. The plugin (camera_android_camerax, every version since 0.6.18) nevertheless
enables CameraX audio "muted" whenever the app holds the microphone permission, which Lectern
always does. A muted CameraX track is still captured from the microphone. The emulator's
system log of a take showed it: CameraX caching audio data, adding an audio track to its file,
"First audio time", and releasing an audio source at the end. The camera's file was also larger
than the finished take, because it carried that extra track.

So every video take ran two microphone captures at once: CameraX's and Lectern's low-latency
voice recorder. What a phone does with two captures depends on its audio hardware (inferred,
not observed on the reporter's phone): it can move both to the camcorder microphone, lower or
silence one, or interrupt one. CameraX also holds its video back until its audio arrives, so a
capture that gets no data means a recording with no frames, which CameraX deletes. That matches
reports 2 and 3: a take whose camera file did not exist, and voice levels near silence.

Fix: `app/tool/patch_plugins.py` removes the camera's audio unless it is asked for. The plugin
versions are pinned and the build stops if the plugin's code changes. The device test fails if
the camera's file contains an audio track.

### B. A second tap on Record started a second take (proven by reading; covered by the test)

Record did nothing visible for a few hundred milliseconds (permission check, storage check,
opening the microphone). A second tap in that time started a second countdown and a second
start. The second start restarted the sound recorder under a new take id and marked the take as
having no video, while the camera kept recording a file that nothing stopped. The take was saved
without picture, and the camera plugin was left "recording" for the next screen.

Fix: Record reacts at once ("Starting…") and can start only one take; record, pause, resume and
stop run strictly one after another.

### C. Camera steps could overtake each other (proven by reading the plugin)

The plugin keeps one camera for the whole app. Closing any controller unbinds every camera use,
and a start that follows an unfinished stop returns without doing anything. Lectern closed
cameras without waiting (when leaving the app, when the screen closed) and could open the next
one while the old close was still on its way, which leaves a camera that shows nothing and
records nothing. A camera still opening when its screen closed was never closed.

Fix: every camera step in the app goes through one ordered queue with time limits
(`app/lib/core/cam.dart`). A screen that closes mid-take ends the camera's recording first.

### D. Player and codec leaks (proven by reading)

A video player that was still opening when its screen closed was never released, each one
holding a hardware video decoder. The sound encoder and the muxer were not released when an
error occurred. Phones have few hardware codecs; once they are used up, the camera's encoder or
the player's decoder fails until the app process ends. This is the likeliest reason a reinstall
"fixed" it (it ends the process), and a plausible cause of the dark preview in report 1
(inferred).

Fix: players are released whatever the timing; playback errors are shown, retried and logged;
all encoders, extractors and muxers are released in every path.

### E. Storage (proven by reading; likely on a nearly full phone)

Each draft kept the camera's file and the finished take, which hold the same video. The camera's
own files and the files of abandoned takes were never deleted. Copies saved to the gallery
survive an uninstall, so each round left less room, which fits "two takes, then one".

Fix: the camera's copy is deleted once the finished take holds the picture; leftovers are
cleaned at start and after each take; a warning before recording when little space is left.

### F. A silent take was amplified by 30 dB (proven, engine test 10)

A take with no voice in it (a silent room) was raised by the maximum gain, which turns hiss up
and shows a low loudness figure. A recording quieter than about −52 LUFS is now left quiet
(at most +6 dB) and the take says that hardly any voice was recorded. Soft voices (−40 LUFS)
still reach −14 LUFS.

### G. Smaller defects fixed along the way

- Video and sound were written one after the other in the finished file; they are interleaved
  now, which players and messaging apps handle better.
- A take whose picture could not be used was still labelled a video; it is kept as sound with
  the reason, and the picture can be recovered while the camera's file exists.
- Sound-only takes were saved to the gallery as videos; failed gallery copies left a
  half-written entry.
- Two state saves at the same moment could damage the state file (projects, drafts and the
  list of recordings); saves are serialized, a backup is kept, a damaged file is preserved.
- Loading music (which may download) could hold up stopping a recording.
- The audio output stayed open and running while the app was idle in the background.
- A system bubble on top of the app is not treated as leaving the app.
- Release builds failed in a lint check of the camera plugin's own code (a tool crash).

## Tests

| Suite | Where it runs | What it checks |
|---|---|---|
| Audio engine (C++) | CI and any desktop | 54 checks, now including quiet takes |
| Scripts, projects, camera queue (Dart) | CI | ordering, time limits, failures of camera steps |
| Background jobs (JVM) | CI | job queue |
| Takes on a device | Android emulator in CI | 13 takes back to back through the real screen: picture, brightness, poster, sound track, playback, no camera audio; double tap on Record, pause/resume, leaving the app mid-take, a take stopped at once, switching cameras, saving, the gallery copy, the problem report |

The emulator has a virtual camera and a silent microphone and uses software codecs. It proves
the app's logic and the plugin behaviour; it cannot show how a particular phone's audio and
video hardware behave. For that the app now has **Profile → Send a problem report**: a text
file with what the app did during the last takes, the phone model, storage, and the app's own
system log (no scripts, audio or video).
