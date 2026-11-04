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
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
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
    @Volatile private var loadSeq = 0
    private var jobsSink: EventChannel.EventSink? = null
    private var pendingOpen: String? = null
    private var focusReq: AudioFocusRequest? = null

    private fun assetKey(asset: String) = FlutterInjector.instance().flutterLoader().getLookupKeyForAsset(asset)

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
                    "load" -> {
                        // only the newest load wins (a slow decode must not replace a newer song)
                        val seq = ++loadSeq
                        async {
                            val asset = call.argument<String>("asset")
                            val path = call.argument<String>("path")
                            val url = call.argument<String>("url")
                            val pcm = when {
                                asset != null -> Media.decodeAsset(this, assetKey(asset))
                                path != null -> Media.decodeFile(path)
                                url != null -> Media.decodeFile(Media.fetch(this, url).path)
                                else -> throw IllegalArgumentException("nothing to load")
                            }
                            if (seq != loadSeq) {
                                mapOf("stale" to true)
                            } else {
                                NativeEngine.nativeStart()
                                NativeEngine.nativeLoad(pcm.buf, pcm.frames, pcm.channels, pcm.rate)
                                mapOf("duration" to pcm.frames.toDouble() / pcm.rate, "rate" to pcm.rate)
                            }
                        }
                    }
                    "unload" -> { loadSeq++; NativeEngine.nativeUnload(); result.success(null) }
                    "play" -> { requestFocus(); NativeEngine.nativePlay(); result.success(null) }
                    "pause" -> { NativeEngine.nativePause(); result.success(null) }
                    "seek" -> { NativeEngine.nativeSeek(call.argument<Double>("sec") ?: 0.0); result.success(null) }
                    "rate" -> { NativeEngine.nativeSetRate(call.argument<Double>("rate") ?: 1.0); result.success(null) }
                    "volume" -> { NativeEngine.nativeSetVolume((call.argument<Double>("v") ?: 1.0).toFloat()); result.success(null) }
                    "music" -> {
                        NativeEngine.nativeSetMusic(
                            call.argument<Double>("start") ?: 0.0, call.argument<Double>("end") ?: 0.0, call.argument<Boolean>("loop") ?: false,
                            call.argument<Double>("fadeIn") ?: 0.0, call.argument<Double>("fadeOut") ?: 0.0
                        )
                        result.success(null)
                    }
                    "state" -> result.success(NativeEngine.nativeState().toList())
                    "openMic" -> async {
                        // music stays on the media path (never the call/SCO path: that is narrowband, "radio" sound)
                        am.mode = AudioManager.MODE_NORMAL
                        NativeEngine.nativeOpenMic(
                            call.argument<Int>("mode") ?: 0,
                            call.argument<Boolean>("nc") ?: false,
                            (call.argument<Double>("gainDb") ?: 0.0).toFloat(),
                            call.argument<Int>("preset") ?: 0,
                            call.argument<Int>("deviceId") ?: 0
                        )
                    }
                    "closeMic" -> async { NativeEngine.nativeCloseMic(); null }
                    "startRecord" -> { requestFocus(); result.success(NativeEngine.nativeStartRecord(call.argument<String>("voice")!!, call.argument<String>("music") ?: "")) }
                    "pauseRecord" -> { NativeEngine.nativePauseRecord(call.argument<Boolean>("paused") ?: false); result.success(null) }
                    "stopRecord" -> async { NativeEngine.nativeStopRecord().toList() }
                    "videoInfo" -> async { Media.videoInfo(call.argument<String>("path")!!, call.argument<String>("thumb")) }
                    "nc" -> { NativeEngine.nativeSetNC(call.argument<Boolean>("on") ?: false); result.success(null) }
                    "micGain" -> { NativeEngine.nativeSetMicGain((call.argument<Double>("db") ?: 0.0).toFloat()); result.success(null) }
                    "outputLatency" -> result.success(NativeEngine.nativeOutputLatency())
                    "monoNs" -> result.success(NativeEngine.nativeMonoNs())
                    "finishTake" -> async {
                        // loudness-normalised mix, then into the video (or an .m4a)
                        val wav = call.argument<String>("wav")!!
                        val fin = org.json.JSONObject(
                            NativeEngine.nativeFinalize(
                                call.argument<String>("voice")!!, call.argument<String>("music") ?: "", wav,
                                call.argument<Int>("mode") ?: 0, call.argument<Double>("balance") ?: 0.0,
                                call.argument<Double>("fadeIn") ?: 0.0, call.argument<Double>("fadeOut") ?: 0.0, call.argument<Double>("duckDb") ?: 0.0
                            )
                        )
                        if (!fin.optBoolean("ok")) throw IllegalStateException(fin.optString("error", "mix failed"))
                        val out = call.argument<String>("out")!!
                        val video = call.argument<String>("video")
                        var off = call.argument<Double>("offset")
                        // the camera finishes its file in the background after it stops: wait for it,
                        // and never pass a take off as video when its picture couldn't be used
                        var videoProblem: String? = if (video != null) Media.waitForVideo(video, 8000) else null
                        if (video != null && videoProblem == null) {
                            if (off == null) {
                                // the camera and the mic stopped at measured moments: line up the ends
                                val vd = Media.videoDuration(video)
                                val ad = fin.optDouble("seconds")
                                val gap = ((call.argument<Number>("videoStopNs")?.toDouble() ?: 0.0) - (call.argument<Number>("audioEndNs")?.toDouble() ?: 0.0)) / 1e9
                                off = ((vd - ad) - (if (gap.isFinite() && kotlin.math.abs(gap) < 3) gap else 0.0)).coerceIn(-1.0, 2.0)
                            }
                            val tmp = "$out.tmp.mp4"
                            try {
                                Media.mux(video, wav, tmp, off)
                                File(tmp).renameTo(File(out))
                            } catch (e: Exception) {
                                videoProblem = e.message ?: "the video couldn't be combined with the sound"
                                File(tmp).delete()
                                Media.wavToM4a(wav, out)
                            }
                        } else {
                            Media.wavToM4a(wav, out)
                        }
                        File(wav).delete()
                        mapOf(
                            "offset" to (off ?: 0.0), "lufs" to fin.optDouble("outLufs"), "truePeak" to fin.optDouble("truePeak"),
                            "voiceLufs" to fin.optDouble("voiceLufs"), "musicLufs" to fin.optDouble("musicLufs"), "gain" to fin.optDouble("gain"), "duckMin" to fin.optDouble("duckMin"),
                            "seconds" to fin.optDouble("seconds"),
                            "hasVideo" to (video != null && videoProblem == null), "videoProblem" to videoProblem
                        )
                    }
                    "jobs.enqueue" -> async {
                        JobStore.init(this)
                        val j = org.json.JSONObject(call.argument<Map<String, Any?>>("job")!!)
                        if (j.optString("asset").isNotEmpty()) j.put("assetKey", assetKey(j.getString("asset")))
                        val id = JobStore.enqueue(j)
                        JobService.start(this)
                        id
                    }
                    "jobs.list" -> async {
                        JobStore.init(this)
                        if (JobStore.recover()) JobService.start(this)
                        JobStore.list()
                    }
                    "jobs.result" -> async {
                        val f = JobStore.resultFile(this, call.argument<String>("id")!!)
                        if (f.exists()) f.readText() else null
                    }
                    "jobs.cancel" -> { JobService.cancel(call.argument<String>("id")!!); result.success(null) }
                    "jobs.retry" -> {
                        val id = call.argument<String>("id")!!
                        JobStore.update(id) { it.put("state", "queued").put("progress", 0).put("error", "").put("phase", "Waiting") }
                        JobService.start(this)
                        result.success(null)
                    }
                    "jobs.applied" -> { JobStore.update(call.argument<String>("id")!!) { it.put("applied", true) }; result.success(null) }
                    "jobs.remove" -> { JobStore.remove(this, call.argument<String>("id")!!); result.success(null) }
                    "jobs.takeOpen" -> { result.success(pendingOpen); pendingOpen = null }
                    "transcribeProgress" -> result.success(NativeEngine.nativeTranscribeProgress())
                    "transcribeCancel" -> { NativeEngine.nativeTranscribeCancel(); result.success(null) }
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

        EventChannel(messenger, "lectern/jobs").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) { jobsSink = events }
            override fun onCancel(arguments: Any?) { jobsSink = null }
        })
        JobStore.init(this)
        var pushPending = false
        JobStore.onChange = {
            // throttle: at most a few updates a second reach Dart
            if (!pushPending) {
                pushPending = true
                main.postDelayed({
                    pushPending = false
                    jobsSink?.success(mapOf("jobs" to JobStore.list()))
                }, 250)
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        takeJobIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeJobIntent(intent)
    }

    /** A tap on a "transcription ready" notification: tell Dart which job to open. */
    private fun takeJobIntent(i: Intent?) {
        val id = i?.getStringExtra("lecternJob") ?: return
        i.removeExtra("lecternJob")
        pendingOpen = id
        main.post { jobsSink?.success(mapOf("open" to id)) }
    }

    // ------------------------------------------------------------------ audio focus
    // Another app or a phone call takes the audio: tell Dart so it pauses cleanly (a take is
    // paused, not left recording silence).
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                focusReq?.let { am.abandonAudioFocusRequest(it) }
                focusReq = null
                routeSink?.success(mapOf("event" to "interrupted"))
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> routeSink?.success(mapOf("event" to "interrupted"))
            AudioManager.AUDIOFOCUS_GAIN -> routeSink?.success(mapOf("event" to "resumed"))
        }
    }

    private fun requestFocus() {
        if (focusReq != null) return
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
        val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attrs).setOnAudioFocusChangeListener(focusListener, main).build()
        if (am.requestAudioFocus(r) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) focusReq = r
    }

    override fun onDestroy() {
        focusReq?.let { am.abandonAudioFocusRequest(it) }
        focusReq = null
        JobStore.onChange = null
        super.onDestroy()
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
