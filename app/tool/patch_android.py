#!/usr/bin/env python3
"""After `flutter create` generates the Android project, add Lectern's native parts:
the C++ audio engine (CMake + Oboe), Kotlin code, permissions, app id and icons.
Runs on the build machine; idempotent."""
import os, re, shutil, sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AND = os.path.join(APP, 'android')
MOD = os.path.join(AND, 'app')


def patch_gradle():
    kts = os.path.join(MOD, 'build.gradle.kts')
    groovy = os.path.join(MOD, 'build.gradle')
    if os.path.exists(kts):
        p, s, k = kts, open(kts).read(), True
    elif os.path.exists(groovy):
        p, s, k = groovy, open(groovy).read(), False
    else:
        sys.exit('app build file not found')
    if 'lectern-native' in s:
        print('gradle already patched')
        return
    q = (lambda x: '"%s"' % x) if k else (lambda x: "'%s'" % x)
    s = re.sub(r'applicationId\s*=?\s*["\'][^"\']+["\']', 'applicationId = %s' % q('com.lectern.app') if k else "applicationId 'com.lectern.app'", s)
    s = re.sub(r'minSdk(Version)?\s*=?\s*[^\n]+', 'minSdk = 26' if k else 'minSdkVersion 26', s, count=1)
    if k:
        android_add = '''
    // lectern-native: C++ audio engine
    externalNativeBuild {
        cmake {
            path = file("../../native/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    buildFeatures {
        prefab = true
    }
'''
        default_add = '''
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
'''
        deps = '\ndependencies {\n    implementation("com.google.oboe:oboe:1.9.3")\n    testImplementation("junit:junit:4.13.2")\n    testImplementation("org.json:json:20240303")\n}\n'
    else:
        android_add = '''
    // lectern-native: C++ audio engine
    externalNativeBuild { cmake { path file('../../native/cpp/CMakeLists.txt'); version '3.22.1' } }
    buildFeatures { prefab true }
'''
        default_add = '''
        externalNativeBuild { cmake { arguments '-DANDROID_STL=c++_shared' } }
        ndk { abiFilters 'arm64-v8a' }
'''
        deps = "\ndependencies {\n    implementation 'com.google.oboe:oboe:1.9.3'\n    testImplementation 'junit:junit:4.13.2'\n    testImplementation 'org.json:json:20240303'\n}\n"
    s = re.sub(r'(\nandroid\s*\{)', r'\1' + android_add.replace('\\', '\\\\'), s, count=1)
    s = re.sub(r'(defaultConfig\s*\{)', r'\1' + default_add.replace('\\', '\\\\'), s, count=1)
    s += deps
    open(p, 'w').write(s)
    print('patched', p)


def patch_manifest():
    p = os.path.join(MOD, 'src', 'main', 'AndroidManifest.xml')
    s = open(p).read()
    perms = [
        'android.permission.INTERNET',
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.WAKE_LOCK',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PROCESSING',
        'android.permission.POST_NOTIFICATIONS',
    ]
    add = ''
    for perm in perms:
        if perm not in s:
            add += '    <uses-permission android:name="%s"/>\n' % perm
    if 'android.permission.BLUETOOTH"' not in s:
        add += '    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30"/>\n'
    if 'WRITE_EXTERNAL_STORAGE' not in s:
        add += '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/>\n'
    if 'READ_EXTERNAL_STORAGE' not in s:
        add += '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/>\n'
    s = s.replace('<application', add + '    <application', 1)
    s = re.sub(r'android:label="[^"]*"', 'android:label="Lectern"', s, count=1)
    # background job runner (transcription keeps going when the app is left)
    if 'JobService' not in s:
        s = s.replace('</application>', '        <service android:name="com.lectern.lectern.JobService" android:exported="false"\n'
                      '            android:foregroundServiceType="dataSync|mediaProcessing" />\n    </application>', 1)
    open(p, 'w').write(s)
    print('patched manifest')


def copy_native():
    src = os.path.join(APP, 'native', 'android', 'kotlin')
    dst = os.path.join(MOD, 'src', 'main', 'kotlin', 'com', 'lectern', 'lectern')
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(src):
        shutil.copy(os.path.join(src, f), os.path.join(dst, f))
    # remove a Java MainActivity if the template made one
    jdir = os.path.join(MOD, 'src', 'main', 'java', 'com', 'lectern', 'lectern')
    if os.path.exists(os.path.join(jdir, 'MainActivity.java')):
        os.remove(os.path.join(jdir, 'MainActivity.java'))
    # JVM unit tests for the job queue
    tsrc = os.path.join(APP, 'native', 'android', 'test')
    tdst = os.path.join(MOD, 'src', 'test', 'kotlin', 'com', 'lectern', 'lectern')
    if os.path.isdir(tsrc):
        os.makedirs(tdst, exist_ok=True)
        for f in os.listdir(tsrc):
            shutil.copy(os.path.join(tsrc, f), os.path.join(tdst, f))
    res = os.path.join(APP, 'native', 'android', 'res')
    for d in os.listdir(res):
        out = os.path.join(MOD, 'src', 'main', 'res', d)
        os.makedirs(out, exist_ok=True)
        for f in os.listdir(os.path.join(res, d)):
            shutil.copy(os.path.join(res, d, f), os.path.join(out, f))
    with open(os.path.join(MOD, 'proguard-rules.pro'), 'w') as f:
        f.write('-keep class com.lectern.lectern.NativeEngine { *; }\n-keepclasseswithmembernames class * { native <methods>; }\n')
    print('copied native sources')


def drop_template_test():
    # the template's widget test refers to the counter app, which this project replaces
    t = os.path.join(APP, 'test', 'widget_test.dart')
    if os.path.exists(t):
        os.remove(t)
        print('removed template test')


if __name__ == '__main__':
    drop_template_test()
    patch_gradle()
    patch_manifest()
    copy_native()
