#!/usr/bin/env bash
# Runs the on-device take test on the emulator that the workflow started.
# The app asks for the camera and the microphone; a test can't tap the system's permission
# dialog, so the permissions are granted from outside as soon as the app is installed.
set -uo pipefail
cd "$(dirname "$0")/.."
adb logcat -c || true
( while true; do
    for p in CAMERA RECORD_AUDIO POST_NOTIFICATIONS; do adb shell pm grant com.lectern.app android.permission.$p >/dev/null 2>&1; done
    sleep 1
  done ) &
GRANT=$!
flutter test integration_test/takes_test.dart -d emulator-5554 --reporter expanded 2>&1 | tee ../t_device_full.log
rc=${PIPESTATUS[0]}
kill $GRANT 2>/dev/null || true
adb logcat -d -v time 2>/dev/null | grep -E "CameraX|Recorder|VideoCapture|MediaCodec|ExoPlayer|lectern|AndroidRuntime|FATAL|E/flutter" | tail -n 300 > ../device_logcat.log || true
exit $rc
