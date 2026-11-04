# Lectern test report

Commit 5231f6941871d6f1dc151c38d65af345b1f5809c, 2026-11-04 19:09 UTC

| Suite | Result |
|---|---|
| Audio engine | success |
| Scripts and projects (Dart) | success |
| Background jobs | success |

## t_engine

```
1. Playback speed and pitch across output rates (44.1 kHz song)
  [PASS] 1 kHz tone through a 48 kHz output                         1000.000 Hz (tol ±0.5)
  [PASS] interpolation noise/distortion                             SNR 86.6 dB (need > 80)
  [PASS] after the output switches to 44.1 kHz                      1000.000 Hz (tol ±0.5)
  [PASS] track time advanced over 4 s of output                     4.0171 s (tol ±0.03)
  [INFO] previous engine after the same route change: 918.75 Hz (8.1% slow, pitch down)
  [PASS] 10 s song plays for 10 s                                   10.0053 s (tol ±0.02)
2. Playback clock vs what is actually heard (180 ms Bluetooth latency, jittery timestamps)
  [PASS] clock vs heard audio, max error over 7 min                 0.0015 s (tol 0.003)
  [INFO] mean error 0.00031 s over 55407 queries (seeks, pause/resume, 0.75x speed included)
  [INFO] previous app polled the position over a platform channel each frame and glided toward it
3. Recording 5 min: Bluetooth-style 1024-frame output bursts, mic clock off by +60 ppm
  [PASS] voice length == mic samples captured (nothing inserted/dropped) 0 frames off (tol 1)
  [PASS] no samples lost in the recorder                            0 lost (tol 0)
  [PASS] music stem length == voice length                          0 frames off (tol 0)
  [PASS] clicks matched between voice and music                     603 (need > 500)
  [PASS] voice vs music alignment, worst click                      0.0004 s (tol 0.002)
  [INFO] mean offset 0.00007 s over 603 clicks; timeline corrections: 0
  [INFO] previous engine, same conditions: 0.04 s of silence inserted, 0.00 s of voice dropped (2048 + 0 frames)
3. Recording 8 min: Bluetooth-style 960-frame output bursts, mic clock off by -120 ppm
  [PASS] voice length == mic samples captured (nothing inserted/dropped) 0 frames off (tol 1)
  [PASS] no samples lost in the recorder                            0 lost (tol 0)
  [PASS] music stem length == voice length                          0 frames off (tol 0)
  [PASS] clicks matched between voice and music                     963 (need > 800)
  [PASS] voice vs music alignment, worst click                      0.0004 s (tol 0.002)
  [INFO] mean offset 0.00008 s over 963 clicks; timeline corrections: 0
  [INFO] previous engine, same conditions: 0.08 s of silence inserted, 0.00 s of voice dropped (4032 + 0 frames)
4. Loudness (ITU-R BS.1770) and the finished take
  [PASS] 1 kHz stereo sine at -23 dBFS                              -22.99 LUFS (tol ±0.1)
  [INFO] raw phone-mic singing level in this test: -35.6 LUFS (what previous takes were published at)
  [PASS] finalize (mic-only take)                                   0 0
  [PASS] mic-only take loudness                                     -14.00 LUFS (target -14 ±1)
  [PASS] mic-only take true peak                                    -5.86 dBTP (max -1.0)
  [PASS] re-measured from the written 16-bit file                   -14.00 LUFS (tol ±0.2 vs reported)
  [PASS] no clipped samples in the file                             peak 0.508 (max 0.95)
  [PASS] clean-mix take loudness                                    -14.00 LUFS (target -14 ±1)
  [PASS] clean-mix take true peak                                   -3.90 dBTP (max -1.0)
  [INFO] voice in -37.2 LUFS, music in -15.4 LUFS -> mix -14.0 LUFS (voice raised, music set 4 LU under it)
  [INFO] previous engine: mic-only takes at -35.6 LUFS; clean mix at -17.8 LUFS with the voice 18.3 LU under the music
5. Noise cancellation
  [PASS] steady noise reduced (after it is learned)                 9.5 dB (need > 8)
  [PASS] voice-like tone level kept                                 -0.01 dB change (tol 1.5)
  [PASS] output finite                                              0 0
6. Finding where a voice is (Clip to lines drops words imagined over music)
  [INFO] regions found: [12.02-15.49] [16.21-19.79] [26.01-29.99] [30.61-35.98]
  [PASS] every voiced phrase start found                            worst 0.020 s (tol 0.12)
  [PASS] intro and instrumental break not marked as voice           0 0
7. Background music: trim, loop seam, fades, timeline across loops
  [PASS] no click at loop seams (largest sample step)               0.0173 (max 0.020)
  [PASS] playback clock follows the loop                            0.00000 s (tol 0.001)
  [PASS] loops in 32 s of a 5 s region                              6 (want 6)
  [PASS] fade-in at the start of the region                         0.16 of full level (max 0.3)
  [PASS] no fade-in again on later loops                            1.000 of full (tol 0.02)
  [PASS] trimmed region plays for its length                        4.011 s (want 4.0 ±0.02)
  [PASS] faded out at the end (last 10 ms)                          peak 0.0000 (max 0.01)
8. Music ducking under the voice (offline mix)
  [PASS] music lowered while speaking                               -9.00 dB (want -9 ±1)
  [PASS] stays down through short breaths (no pumping)              -9.00 dB (want -9 ±1)
  [PASS] back up in a long pause                                    -0.35 dB (want > -1)
  [PASS] starts lowering just before the voice comes in             -3.07 dB at 3.97 s (want < -0.5)
  [PASS] smooth: largest gain change in 10 ms                       0.72 dB (max 1.0)
  [PASS] fades in over the first 2 s                                0.000 at 0 s (max 0.01)
  [PASS] fades out at the end                                       0.000 (max 0.01)
  [PASS] ducked mix loudness                                        -14.00 LUFS (target -14 ±1)
  [PASS] ducked mix true peak                                       -8.71 dBTP (max -1.0)
9. Recording over looped background music (clean mix stem)
  [PASS] no click in the music stem at loop seams                   0.0173 (max 0.020)
  [PASS] music keeps playing through every loop                     min RMS 0.42 (want > 0.3)
  [PASS] loops aren't counted as timeline glitches                  0 (want 0)
  [PASS] the region looped                                          4 times (want >= 3)
49 passed, 0 failed
```

## t_dart

```
00:00 +0: loading /home/runner/work/Karii/Karii/app/test/studio_test.dart
00:00 +0: sections and directions capitalised bracket lines are sections, lower-case ones are directions
00:00 +1: sections and directions parse and join keep every line and the order
00:00 +2: sections and directions reorder and duplicate sections
00:00 +3: sections and directions text before the first header is its own untitled section
00:00 +4: sections and directions section names are cleaned and capitalised
00:00 +5: teleprompter rows keep headers, paragraph breaks and line indexes
00:00 +6: reading time and word count
00:00 +7: undo history tool actions undo and redo one step at a time
00:00 +8: undo history quick typing is one step; a new change clears redo
00:00 +9: projects from older versions karaoke songs become spoken-word lyrics, keeping text and music
00:00 +10: projects from older versions poems and scripts are untouched
00:00 +11: projects from older versions defaults for projects without settings
00:00 +12: projects from older versions music removed from a project stays removed
00:00 +13: All tests passed!
```

## t_jobs

```
The client will now receive all logging from the daemon (pid: 3156). The daemon log file: /home/runner/.gradle/daemon/9.3.1/daemon-3156.out.log
Starting 2nd build in daemon [uptime: 7 mins 19.087 secs, performance: 99%, GC rate: 0.00/s, heap usage: 0% of 8 GiB, non-heap usage: 10% of 4 GiB]
Compilation mode: in-process compilation
Compilation mode: in-process compilation
Compilation mode: in-process compilation
Adopted [uses-feature: null]
Adopted [service: null]
Compilation mode: in-process compilation
Compilation mode: in-process compilation
Compilation mode: in-process compilation
Kotlin source files: /home/runner/work/Karii/Karii/app/android/app/src/test/kotlin/com/lectern/lectern/JobStoreTest.kt
Calling mockable JAR artifact transform to create file: /home/runner/.gradle/caches/9.3.1/transforms/bb5d33143549d2bfc6303913afd1573b-78bd5224-2ba1-4547-8230-6f2ce1ac02fe/transformed/android.jar with input /usr/local/lib/android/sdk/platforms/android-36/android.jar
JobStoreTest > duplicateTapsDoNotStartASecondJob STANDARD_OUT
    duplicate enqueue: 3 taps -> 2 jobs
JobStoreTest > queueSurvivesARestartAndInterruptedJobsResume STANDARD_OUT
    restart: running job re-queued, finished job kept
BUILD SUCCESSFUL in 52s
```
