# Lectern for iOS and Android

This project is the Lectern web app inside a native shell made with [Capacitor 8](https://capacitorjs.com).
The app runs from files stored on the phone, so karaoke, poems, movie lines, recording,
the take editor and the creator tools all work offline. Streamed instrumentals, the
Whisper speech model and rhyme lookups still need a connection the first time they're used.

```
lectern-native/
├─ web/          Lectern source (src/, media/, build.py, icons)
├─ www/          bundled app the phone loads (www/index.html), made from web/
├─ ios/          Xcode project (Swift Package Manager)
├─ android/      Android Studio project
├─ resources/    1024 px app icon
└─ capacitor.config.json
```

## Get an APK without installing anything

GitHub can build the Android app for you, and this works from a phone browser:

1. Create a new repository on github.com (it can be private) and upload the contents
   of this folder, including the hidden `.github` folder.
2. Open the repository's **Actions** tab. "Build Android APK" starts by itself after
   the upload; if it doesn't, select it and press **Run workflow**.
3. When the run turns green (about 5–8 minutes), open it and download **lectern-apk**
   under *Artifacts*. Unzip it to get `Lectern.apk`.
4. Open `Lectern.apk` on your Android phone and allow "Install unknown apps" when asked.

This is a debug build: fine for installing and testing, but the Play Store needs a
signed release build (Android Studio → *Build → Generate Signed App Bundle / APK*).

## What you need

| | iOS | Android |
|---|---|---|
| Computer | A Mac | Mac, Windows or Linux |
| Tools | Xcode 26 or later | Android Studio (latest), Android SDK 36 |
| Both | Node.js 22 or later, Python 3 | Node.js 22 or later, Python 3 |
| Runs on | iOS 15 or later | Android 7 (API 24) or later |

## First run

```bash
cd lectern-native
npm install          # Capacitor and the plugins
npx cap sync         # wires the plugins into ios/ and android/
```

Then open a platform:

```bash
npm run ios          # rebuilds www/, syncs, opens Xcode
npm run android      # rebuilds www/, syncs, opens Android Studio
```

**In Xcode:** select the **App** target → *Signing & Capabilities* → choose your Team.
Pick your iPhone (or a simulator) and press Run. The simulator has no camera, so test
recording on a real device.

**In Android Studio:** wait for Gradle sync to finish, choose a device and press Run.

Or run directly from the command line on a connected device:

```bash
npm run run:ios
npm run run:android
```

## Changing the app

Edit the files in `web/src/` and run `npm run sync`. That bundles the web app into
`www/index.html` and copies it into both native projects. The same `web/` folder still
builds the browser version: `python3 web/build.py` writes `web/dist/lectern.html`.

## What the native shell adds

All of this lives in `web/src/native.js` and only runs inside the app. In a browser
nothing changes.

| Feature | How |
|---|---|
| Camera and microphone for takes | Permission prompts in `Info.plist` and `AndroidManifest.xml`. The WebView asks the first time you record. |
| Sound with the iPhone's silent switch on | `AppDelegate.swift` sets the audio session to *playback* (Web Audio is muted by the switch otherwise). |
| Saving and sharing takes, beats and `.lrc` files | "Download" and "Share" open the system share sheet (Save Video, Save to Files, Drive, WhatsApp…). Large videos are written in 3 MB chunks so memory stays low. |
| Screen stays on while you perform | `@capacitor-community/keep-awake` replaces the browser Wake Lock, which app WebViews don't support. |
| Android back button and gesture | Closes the top layer in order: sheet → take editor → tap-sync → stage → page → back to Explore → leaves the app. It never closes a take that's still recording. |
| Leaving the app | Playback, previews and the beat loop pause, and a take in progress is paused, not lost. |
| Whisper model downloads once | On iOS app WebViews the browser Cache API may be missing, so the model is kept in IndexedDB instead (about 80 MB, once). |
| Notch, Dynamic Island, gesture bar | `viewport-fit=cover` plus Capacitor 8 *SystemBars* safe-area handling. Light status bar icons on the dark UI. |
| Icon and launch screen | Brand-gradient icon (adaptive and themed on Android), dark launch screen with no white flash. |

Plugins used: `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share`,
`@capacitor/splash-screen`, `@capacitor-community/keep-awake`.

## Before publishing

- **App ID.** The project uses `com.lectern.app`. Change it to one you own (for example
  `com.yourname.lectern`) in `capacitor.config.json`, the `PRODUCT_BUNDLE_IDENTIFIER` in
  Xcode, and `applicationId` / `namespace` in `android/app/build.gradle`. Also move
  `MainActivity.java` to the matching folder and update its `package` line.
- **Version.** Set it in Xcode (*General → Identity*) and in `android/app/build.gradle`
  (`versionCode`, `versionName`).
- **Licences.** The bundled instrumentals are by Tanner Helland (CC BY). The in-app
  Credits page already credits him. Keep that page in the store build.
- **Privacy labels.** The App Store and Play Store will ask about data. Lectern keeps
  recordings, songs and settings on the device. The only network requests are streamed
  instrumentals, the speech model (Hugging Face, jsDelivr), PoetryDB and Datamuse rhymes.
- **New icon.** Replace `resources/icon.png` (1024×1024) and run
  `npx @capacitor/assets generate` to rebuild every size.

## Device checklist

These depend on real hardware, so test them on a phone:

1. Record a take with the camera on, using the front camera on both platforms.
2. On iPhone, flip the silent switch on and play karaoke. You should still hear it.
3. Share a take and choose **Save Video** (iOS) or Photos/Files (Android).
4. Run AI auto-sync once online. Then turn on airplane mode, reopen the app and run
   it again. The model should load from storage. (The speech engine's runtime is
   cached by the WebView too, but that cache can be cleared, so the very first sync after
   a clean install needs a connection.)
5. On Android, press back from every screen.
