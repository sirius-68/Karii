#!/usr/bin/env python3
"""Fixes applied to third-party plugins after `flutter pub get` (the versions are pinned in
pubspec.yaml; the build stops if the code to change isn't found, so a plugin update can never
silently bring the problem back).

camera_android_camerax: with `enableAudio: false` the plugin still switches CameraX audio on,
"muted". A muted audio track is still recorded from the microphone: the camera opened the
microphone a second time during every take, next to Lectern's own voice recorder. Two captures
at once can make a phone lower, interrupt or silence one of them, and CameraX holds the video
back until its audio arrives. Lectern records the voice itself, so the camera gets no audio.
"""
import json, os, re, sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = '// lectern: no camera audio'


def package_root(name):
    cfg = json.load(open(os.path.join(APP, '.dart_tool', 'package_config.json')))
    for p in cfg['packages']:
        if p['name'] == name:
            uri = p['rootUri']
            if uri.startswith('file://'):
                return uri[len('file://'):]
            return os.path.normpath(os.path.join(APP, '.dart_tool', uri))
    sys.exit('package %s not found: run flutter pub get first' % name)


def patch_camerax():
    root = package_root('camera_android_camerax')
    p = os.path.join(root, 'lib', 'src', 'android_camera_camerax.dart')
    s = open(p).read()
    if MARK in s:
        print('camera_android_camerax already patched')
        return
    pat = re.compile(r'pendingRecording\s*=\s*await\s+pendingRecording!\s*\.withAudioEnabled\(\s*(?:/\*.*?\*/\s*)?!enableRecordingAudio\s*,?\s*\);', re.S)
    new = (MARK + ' unless it was asked for (a muted track still opens the microphone)\n'
           '    if (enableRecordingAudio) {\n'
           '      pendingRecording = await pendingRecording!.withAudioEnabled(false);\n'
           '    }')
    s2, n = pat.subn(lambda m: new, s)
    if n != 1:
        sys.exit('camera_android_camerax: the audio call was not found (%d matches) in %s.\n'
                 'The plugin changed: check how it enables audio and update tool/patch_plugins.py.' % (n, p))
    open(p, 'w').write(s2)
    print('patched camera_android_camerax: no audio capture when enableAudio is false')


if __name__ == '__main__':
    patch_camerax()
