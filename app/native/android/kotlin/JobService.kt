package com.lectern.lectern

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Persistent queue of long audio jobs (speech recognition for lyric sync, lyrics from audio,
 * clip to lines). Jobs live in a JSON file so they survive the app being closed; results are
 * written to files and picked up by the app when it next runs.
 */
object JobStore {
    private var file: File? = null
    private val jobs = ArrayList<JSONObject>()
    @Volatile var onChange: (() -> Unit)? = null

    @Synchronized
    fun init(ctx: Context) {
        if (file != null) return
        load(File(ctx.filesDir, "lectern/jobs.json"))
    }

    /** Loads the queue from [f] (also used by the unit tests to simulate an app restart). */
    @Synchronized
    fun load(f: File) {
        f.parentFile?.mkdirs()
        file = f
        jobs.clear()
        if (f.exists()) {
            try {
                val a = JSONArray(f.readText())
                for (i in 0 until a.length()) jobs.add(a.getJSONObject(i))
            } catch (_: Throwable) {}
        }
    }

    fun resultFile(ctx: Context, id: String) = File(ctx.filesDir, "lectern/jobs/$id.json").apply { parentFile?.mkdirs() }

    @Synchronized
    private fun save() {
        val f = file ?: return
        val tmp = File(f.path + ".tmp")
        tmp.writeText(JSONArray(jobs).toString())
        tmp.renameTo(f)
    }

    private fun changed() { onChange?.invoke() }

    @Synchronized
    fun list(): List<Map<String, Any?>> = jobs.map { j -> j.keys().asSequence().associateWith { k -> j.opt(k).let { if (it == JSONObject.NULL) null else it } } }

    @Synchronized
    fun get(id: String): JSONObject? = jobs.firstOrNull { it.optString("id") == id }

    /** Adds a job, or returns the one already queued/running for the same item and purpose. */
    @Synchronized
    fun enqueue(j: JSONObject): String {
        val dup = jobs.firstOrNull {
            it.optString("itemId") == j.optString("itemId") && it.optString("purpose") == j.optString("purpose") &&
                it.optString("state") in listOf("queued", "downloading", "running")
        }
        if (dup != null) return dup.getString("id")
        jobs.removeAll { it.optString("itemId") == j.optString("itemId") && it.optString("purpose") == j.optString("purpose") && it.optString("state") in listOf("error", "cancelled") }
        j.put("state", "queued").put("progress", 0).put("created", System.currentTimeMillis()).put("updated", System.currentTimeMillis())
        jobs.add(j)
        save()
        changed()
        return j.getString("id")
    }

    @Synchronized
    fun update(id: String, notify: Boolean = true, fn: (JSONObject) -> Unit) {
        val j = get(id) ?: return
        fn(j)
        j.put("updated", System.currentTimeMillis())
        save()
        if (notify) changed()
    }

    @Synchronized
    fun nextQueued(): JSONObject? = jobs.firstOrNull { it.optString("state") == "queued" }

    @Synchronized
    fun remove(ctx: Context, id: String) {
        jobs.removeAll { it.optString("id") == id }
        resultFile(ctx, id).delete()
        save()
        changed()
    }

    /** After the app process was killed mid-job: put interrupted jobs back in the queue. */
    @Synchronized
    fun recover(): Boolean {
        var any = false
        if (!JobService.running) {
            for (j in jobs) {
                if (j.optString("state") in listOf("running", "downloading")) {
                    j.put("state", "queued").put("progress", 0).put("phase", "Restarting after the app was closed")
                    any = true
                }
            }
            if (any) save()
        }
        return any || jobs.any { it.optString("state") == "queued" }
    }
}

class JobService : Service() {
    companion object {
        const val CHANNEL = "lectern_jobs"
        const val CHANNEL_DONE = "lectern_jobs_done"
        const val ONGOING_ID = 7001
        @Volatile var running = false
        @Volatile private var cancelId: String? = null
        @Volatile private var currentId: String? = null

        fun start(ctx: Context) {
            val i = Intent(ctx, JobService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun cancel(id: String) {
            cancelId = id
            if (currentId == id) NativeEngine.nativeTranscribeCancel()
            JobStore.update(id) { if (it.optString("state") == "queued") it.put("state", "cancelled") }
        }
    }

    private lateinit var nm: NotificationManager
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        JobStore.init(this)
        nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Processing", NotificationManager.IMPORTANCE_LOW).apply { description = "Transcription and other long jobs" })
            nm.createNotificationChannel(NotificationChannel(CHANNEL_DONE, "Finished jobs", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "When a transcription is ready" })
        }
    }

    private fun openIntent(jobId: String?): PendingIntent {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (jobId != null) i.putExtra("lecternJob", jobId)
        return PendingIntent.getActivity(this, jobId?.hashCode() ?: 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun builder(channel: String): Notification.Builder =
        if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else @Suppress("DEPRECATION") Notification.Builder(this)

    private fun ongoing(title: String, text: String, progress: Int): Notification =
        builder(CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, progress.coerceIn(0, 100), progress <= 0)
            .setContentIntent(openIntent(null))
            .build()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = ongoing("Lectern", "Preparing…", 0)
        if (Build.VERSION.SDK_INT >= 35) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING)
        else if (Build.VERSION.SDK_INT >= 29) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(ONGOING_ID, n)
        if (!running) {
            running = true
            Thread({ loop() }, "lectern-jobs").start()
        }
        return START_NOT_STICKY
    }

    private fun loop() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lectern:jobs").apply { acquire(60 * 60 * 1000L) }
        try {
            while (true) {
                val j = JobStore.nextQueued() ?: break
                process(j.getString("id"))
            }
        } finally {
            wake?.let { if (it.isHeld) it.release() }
            running = false
            currentId = null
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
            stopSelf()
            // a job queued while we were finishing
            if (JobStore.nextQueued() != null) start(this)
        }
    }

    private fun process(id: String) {
        val j = JobStore.get(id) ?: return
        val title = j.optString("title", "Transcription")
        currentId = id
        cancelId = null
        try {
            // 1. the speech model (downloaded once)
            val model = File(j.getString("model"))
            if (!model.exists()) {
                JobStore.update(id) { it.put("state", "downloading").put("phase", "Downloading the speech model").put("progress", 0) }
                download(id, j.getString("modelUrl"), model, title)
            }
            if (cancelId == id) throw CancelledException()
            // 2. decode the audio
            JobStore.update(id) { it.put("state", "running").put("phase", "Preparing the audio").put("progress", 0) }
            nm.notify(ONGOING_ID, ongoing(title, "Preparing the audio…", 0))
            val pcm = when {
                j.optString("assetKey").isNotEmpty() -> Media.decodeAsset(this, j.getString("assetKey"))
                j.optString("path").isNotEmpty() -> Media.decodeFile(j.getString("path"))
                j.optString("url").isNotEmpty() -> Media.decodeFile(Media.fetch(this, j.getString("url")).path)
                else -> throw IllegalStateException("no audio")
            }
            if (cancelId == id) throw CancelledException()
            // 3. recognise, reporting progress
            JobStore.update(id) { it.put("phase", "Listening").put("progress", 1) }
            val poll = Thread {
                var last = -1
                while (currentId == id && !Thread.currentThread().isInterrupted) {
                    val p = NativeEngine.nativeTranscribeProgress()
                    if (p != last) {
                        last = p
                        JobStore.update(id) { it.put("progress", p.coerceAtLeast(1)) }
                        nm.notify(ONGOING_ID, ongoing(title, "Listening… $p%", p))
                    }
                    try { Thread.sleep(700) } catch (_: InterruptedException) { break }
                }
            }
            poll.start()
            val json = try {
                NativeEngine.nativeTranscribe(model.path, pcm.buf, pcm.frames, pcm.channels, pcm.rate, j.optString("language", "auto"))
            } finally {
                poll.interrupt()
            }
            if (json.startsWith("{\"error\"")) {
                val err = JSONObject(json).optString("error")
                if (err == "cancelled") throw CancelledException()
                throw IllegalStateException(err)
            }
            JobStore.resultFile(this, id).writeText(json)
            val words = try { JSONObject(json).optJSONArray("words")?.length() ?: 0 } catch (_: Throwable) { 0 }
            JobStore.update(id) { it.put("state", "done").put("progress", 100).put("phase", "Ready").put("words", words).put("applied", false) }
            notifyDone(id, title, if (words > 0) "Ready: $words words timed. Tap to open." else "Finished, but no words were heard.")
        } catch (e: CancelledException) {
            JobStore.update(id) { it.put("state", "cancelled").put("phase", "Cancelled") }
        } catch (e: Throwable) {
            JobStore.update(id) { it.put("state", "error").put("error", e.message ?: e.toString()).put("phase", "Failed") }
            notifyDone(id, title, "Couldn’t finish: ${e.message ?: "unknown error"}. Tap to retry.")
        } finally {
            currentId = null
        }
    }

    private class CancelledException : Exception("cancelled")

    private fun download(id: String, url: String, dst: File, title: String) {
        dst.parentFile?.mkdirs()
        val tmp = File(dst.path + ".part")
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000
        c.readTimeout = 30000
        c.instanceFollowRedirects = true
        if (c.responseCode != 200) throw IllegalStateException("model download failed (HTTP ${c.responseCode})")
        val total = c.contentLengthLong
        var got = 0L
        var lastPct = -1
        c.inputStream.use { inp ->
            tmp.outputStream().use { out ->
                val buf = ByteArray(1 shl 16)
                while (true) {
                    if (cancelId == id) throw CancelledException()
                    val n = inp.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    got += n
                    val pct = if (total > 0) (got * 100 / total).toInt() else 0
                    if (pct != lastPct) {
                        lastPct = pct
                        JobStore.update(id, notify = pct % 5 == 0) { it.put("progress", pct) }
                        nm.notify(ONGOING_ID, ongoing(title, "Downloading the speech model… $pct%", pct))
                    }
                }
            }
        }
        if (total > 0 && got != total) throw IllegalStateException("model download incomplete")
        if (!tmp.renameTo(dst)) throw IllegalStateException("couldn't save the model")
    }

    private fun notifyDone(id: String, title: String, text: String) {
        val n = builder(CHANNEL_DONE)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openIntent(id))
            .build()
        try { nm.notify(7100 + (id.hashCode() and 0xffff), n) } catch (_: SecurityException) {}
    }
}
