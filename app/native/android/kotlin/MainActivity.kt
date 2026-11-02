package com.lectern.lectern

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import android.view.WindowManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.FlutterInjector
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val bg = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var routeSink: EventChannel.EventSink? = null
    private lateinit var am: AudioManager
    private var permResult: MethodChannel.Result? = null
    private var pickResult: MethodChannel.Result? = null
    private val sttExec = java.util.concurrent.Executors.newSingleThreadExecutor()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        MethodChannel(messenger, "lectern/engine").setMethodCallHandler { call, result ->
            fun <T> asyncOn(ex: java.util.concurrent.Executor, work: () -> T) {
                ex.execute {
                    try {
                        val v = work()
                        main.post { result.success(v) }
                    } catch (e: Throwable) {
                        main.post { result.error("engine", e.message ?: e.toString(), null) }
                    }
                }
            }
            fun <T> async(work: () -> T) = asyncOn(bg, work)
            try {
                when (call.method) {
                    "start" -> result.success(NativeEngine.nativeStart())
                    "load" -> async {
                        val asset = call.argument<String>("asset")
                        val path = call.argument<String>("path")
                        val url = call.argument<String>("url")
                        val pcm = when {
                            asset != null -> Media.decodeAsset(this, FlutterInjector.instance().flutterLoader().getLookupKeyForAsset(asset))
                            path != null -> Media.decodeFile(path)
                            url != null -> Media.decodeFile(Media.fetch(this, url).path)
                            else -> throw IllegalArgumentException("nothing to load")
                        }
                        NativeEngine.nativeStart()
                        NativeEngine.nativeLoad(pcm.buf, pcm.frames, pcm.channels, pcm.rate)
                        mapOf("duration" to pcm.frames.toDouble() / pcm.rate, "rate" to pcm.rate)
                    }
                    "unload" -> { NativeEngine.nativeUnload(); result.success(null) }
                    "play" -> { NativeEngine.nativePlay(); result.success(null) }
                    "pause" -> { NativeEngine.nativePause(); result.success(null) }
                    "seek" -> { NativeEngine.nativeSeek(call.argument<Double>("sec") ?: 0.0); result.success(null) }
                    "rate" -> { NativeEngine.nativeSetRate(call.argument<Double>("rate") ?: 1.0); result.success(null) }
                    "volume" -> { NativeEngine.nativeSetVolume((call.argument<Double>("v") ?: 1.0).toFloat()); result.success(null) }
                    "state" -> result.success(NativeEngine.nativeState().toList())
                    "openMic" -> async {
                        val mode = call.argument<Int>("mode") ?: 0
                        val aec = mode == 3
                        if (!aec) am.mode = AudioManager.MODE_NORMAL
                        NativeEngine.nativeOpenMic(
                            mode,
                            call.argument<Boolean>("nc") ?: false,
                            (call.argument<Double>("gainDb") ?: 0.0).toFloat(),
                            call.argument<Int>("preset") ?: 0,
                            call.argument<Int>("deviceId") ?: 0
                        )
                    }
                    "closeMic" -> async { NativeEngine.nativeCloseMic(); null }
                    "startRecord" -> result.success(NativeEngine.nativeStartRecord(call.argument<String>("mix")!!, call.argument<String>("stem")!!))
                    "pauseRecord" -> { NativeEngine.nativePauseRecord(call.argument<Boolean>("paused") ?: false); result.success(null) }
                    "stopRecord" -> async { NativeEngine.nativeStopRecord().toList() }
                    "nc" -> { NativeEngine.nativeSetNC(call.argument<Boolean>("on") ?: false); result.success(null) }
                    "micGain" -> { NativeEngine.nativeSetMicGain((call.argument<Double>("db") ?: 0.0).toFloat()); result.success(null) }
                    "outputLatency" -> result.success(NativeEngine.nativeOutputLatency())
                    "transcribe" -> asyncOn(sttExec) {
                        val asset = call.argument<String>("asset")
                        val path = call.argument<String>("path")
                        val url = call.argument<String>("url")
                        val pcm = when {
                            asset != null -> Media.decodeAsset(this, FlutterInjector.instance().flutterLoader().getLookupKeyForAsset(asset))
                            path != null -> Media.decodeFile(path)
                            url != null -> Media.decodeFile(Media.fetch(this, url).path)
                            else -> throw IllegalArgumentException("no audio")
                        }
                        val json = NativeEngine.nativeTranscribe(call.argument<String>("model")!!, pcm.buf, pcm.frames, pcm.channels, pcm.rate, call.argument<String>("language") ?: "auto")
                        if (json.startsWith("{")) throw IllegalStateException(org.json.JSONObject(json).optString("error", "failed"))
                        val arr = org.json.JSONArray(json)
                        List(arr.length()) { i ->
                            val o = arr.getJSONObject(i)
                            mapOf("text" to o.getString("text"), "start" to o.getDouble("start"), "end" to o.getDouble("end"))
                        }
                    }
                    "transcribeProgress" -> result.success(NativeEngine.nativeTranscribeProgress())
                    "transcribeCancel" -> { NativeEngine.nativeTranscribeCancel(); result.success(null) }
                    "mux" -> async {
                        val video = call.argument<String>("video")!!
                        val audio = call.argument<String>("audio")!!
                        val out = call.argument<String>("out")!!
                        var off = call.argument<Double>("offset")
                        if (off == null) {
                            // align the ends: both stopped together, so any extra video is at its start
                            val vd = Media.videoDuration(video)
                            val ad = (File(audio).length() - 44) / (4.0 * (call.argument<Int>("rate") ?: 48000))
                            off = (vd - ad).coerceIn(-1.0, 1.5)
                        }
                        Media.mux(video, audio, out, off)
                        mapOf("offset" to off)
                    }
                    "wavToM4a" -> async { Media.wavToM4a(call.argument<String>("wav")!!, call.argument<String>("out")!!); true }
                    "videoDuration" -> async { Media.videoDuration(call.argument<String>("path")!!) }
                    "saveToGallery" -> async { Media.saveVideoToGallery(this, call.argument<String>("path")!!, call.argument<String>("name")!!) }
                    "permissions" -> {
                        val perms = (call.argument<List<String>>("perms") ?: emptyList()).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                        if (perms.isEmpty()) result.success(true) else {
                            permResult = result
                            requestPermissions(perms.toTypedArray(), 4711)
                        }
                    }
                    "keepAwake" -> {
                        if (call.argument<Boolean>("on") == true) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        result.success(null)
                    }
                    "pickFile" -> {
                        pickResult = result
                        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(call.argument<String>("mime") ?: "*/*")
                        startActivityForResult(i, 4712)
                    }
                    "route" -> result.success(route())
                    "preferMic" -> { preferMic(call.argument<String>("mic") ?: "phone"); result.success(route()) }
                    else -> result.notImplemented()
                }
            } catch (e: Throwable) {
                result.error("engine", e.message ?: e.toString(), null)
            }
        }

        EventChannel(messenger, "lectern/route").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) { routeSink = events }
            override fun onCancel(arguments: Any?) { routeSink = null }
        })
        am.registerAudioDeviceCallback(object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) { routeSink?.success(route()) }
            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) { routeSink?.success(route()) }
        }, main)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 4711) {
            permResult?.success(grantResults.all { it == PackageManager.PERMISSION_GRANTED })
            permResult = null
        }
    }

    @Deprecated("Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 4712) return
        val r = pickResult ?: return
        pickResult = null
        val uri: Uri? = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) { r.success(null); return }
        bg.execute {
            try {
                var name = "import"
                contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) name = c.getString(0) ?: name
                }
                val dir = File(filesDir, "lectern/imports").apply { mkdirs() }
                val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_")
                val out = File(dir, System.currentTimeMillis().toString(36) + "-" + safe)
                contentResolver.openInputStream(uri)!!.use { inp -> out.outputStream().use { inp.copyTo(it) } }
                main.post { r.success(mapOf("path" to out.path, "name" to name)) }
            } catch (e: Throwable) {
                main.post { r.error("pick", e.message, null) }
            }
        }
    }

    // ------------------------------------------------------------------ audio route
    private fun typeName(t: Int): String = when (t) {
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "usb"
        AudioDeviceInfo.TYPE_HDMI -> "hdmi"
        else -> if (Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER)) "bluetooth" else "speaker"
    }

    private fun route(): Map<String, Any> {
        val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val order = listOf("bluetooth", "usb", "wired", "hdmi")
        var output = "speaker"
        var name = ""
        for (kind in order) {
            val d = outs.firstOrNull { typeName(it.type) == kind }
            if (d != null) { output = kind; name = d.productName?.toString() ?: ""; break }
        }
        val ins = am.getDevices(AudioManager.GET_DEVICES_INPUTS).map {
            mapOf(
                "id" to it.id,
                "name" to (it.productName?.toString() ?: "Microphone"),
                "type" to when (it.type) {
                    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin"
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
                    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "headset"
                    else -> "other"
                }
            )
        }
        return mapOf("output" to output, "name" to name, "inputs" to ins, "musicActive" to am.isMusicActive)
    }

    /** "phone": phone mic, headphones stay on high-quality playback. "headset": headset mic. "release": back to normal. */
    private fun preferMic(mic: String) {
        if (mic == "headset") {
            if (Build.VERSION.SDK_INT >= 31) {
                val d = am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_HEADSET }
                if (d != null) {
                    am.mode = AudioManager.MODE_IN_COMMUNICATION
                    am.setCommunicationDevice(d)
                }
            } else {
                am.mode = AudioManager.MODE_IN_COMMUNICATION
                @Suppress("DEPRECATION")
                am.startBluetoothSco()
                @Suppress("DEPRECATION")
                am.isBluetoothScoOn = true
            }
        } else {
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice() else {
                @Suppress("DEPRECATION")
                am.stopBluetoothSco()
                @Suppress("DEPRECATION")
                am.isBluetoothScoOn = false
            }
            am.mode = AudioManager.MODE_NORMAL
        }
    }
}
