package com.lectern.lectern

import android.content.ContentValues
import android.content.Context
import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Decoded audio: interleaved 16-bit PCM in a direct buffer. */
class Pcm(val buf: ByteBuffer, val frames: Long, val channels: Int, val rate: Int)

object Media {
    // ------------------------------------------------------------------ decoding
    fun decodeAsset(ctx: Context, assetKey: String): Pcm {
        val afd: AssetFileDescriptor = ctx.assets.openFd(assetKey)
        val ex = MediaExtractor()
        ex.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        try {
            return decode(ex)
        } finally {
            ex.release()
            afd.close()
        }
    }

    fun decodeFile(path: String): Pcm {
        val ex = MediaExtractor()
        ex.setDataSource(path)
        try {
            return decode(ex)
        } finally {
            ex.release()
        }
    }

    /** Downloads a URL into the cache (once) and returns the file. */
    fun fetch(ctx: Context, url: String): File {
        val f = File(ctx.cacheDir, "dl-" + url.hashCode().toString(16) + "." + url.substringAfterLast('.', "bin").take(4))
        if (f.exists() && f.length() > 0) return f
        val tmp = File(f.path + ".part")
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 30000
        c.inputStream.use { inp -> tmp.outputStream().use { out -> inp.copyTo(out) } }
        tmp.renameTo(f)
        return f
    }

    private fun decode(ex: MediaExtractor): Pcm {
        var track = -1
        for (i in 0 until ex.trackCount) {
            if (ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) { track = i; break }
        }
        require(track >= 0) { "No audio track" }
        ex.selectTrack(track)
        val fmt = ex.getTrackFormat(track)
        var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val durUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 600_000_000L
        val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(fmt, null, null, 0)
        codec.start()
        var out = ByteBuffer.allocateDirect(((durUs / 1e6 + 2) * rate * channels * 2).toInt().coerceAtLeast(1 shl 16)).order(ByteOrder.nativeOrder())
        val info = MediaCodec.BufferInfo()
        var inDone = false
        var outDone = false
        while (!outDone) {
            if (!inDone) {
                val ii = codec.dequeueInputBuffer(10_000)
                if (ii >= 0) {
                    val ib = codec.getInputBuffer(ii)!!
                    val n = ex.readSampleData(ib, 0)
                    if (n < 0) {
                        codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inDone = true
                    } else {
                        codec.queueInputBuffer(ii, 0, n, ex.sampleTime, 0)
                        ex.advance()
                    }
                }
            }
            val oi = codec.dequeueOutputBuffer(info, 10_000)
            if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                val f = codec.outputFormat
                channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            } else if (oi >= 0) {
                val ob = codec.getOutputBuffer(oi)!!
                if (info.size > 0) {
                    if (out.remaining() < info.size) {
                        val bigger = ByteBuffer.allocateDirect((out.capacity() * 3 / 2).coerceAtLeast(out.position() + info.size + 65536)).order(ByteOrder.nativeOrder())
                        out.flip()
                        bigger.put(out)
                        out = bigger
                    }
                    ob.position(info.offset)
                    ob.limit(info.offset + info.size)
                    out.put(ob)
                }
                codec.releaseOutputBuffer(oi, false)
                if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true
            }
        }
        codec.stop()
        codec.release()
        val bytes = out.position()
        out.flip()
        return Pcm(out, (bytes / (2 * channels)).toLong(), channels, rate)
    }

    // ------------------------------------------------------------------ muxing
    /**
     * Combines the camera's video (no audio) with a 16-bit WAV mix into one MP4.
     * audioOffsetSec > 0 delays the audio, < 0 trims its start.
     */
    /**
     * Waits until the camera has finished writing [path]: the file exists, stops growing, opens,
     * and its video track has a first frame. Returns null when it's ready, or what's wrong.
     */
    fun waitForVideo(path: String, timeoutMs: Long): String? {
        val t0 = System.currentTimeMillis()
        var last = -1L
        var problem = "the camera didn't write a video file"
        while (System.currentTimeMillis() - t0 < timeoutMs) {
            val f = File(path)
            val len = if (f.exists()) f.length() else 0L
            if (len > 0 && len == last) {
                val ex = MediaExtractor()
                try {
                    ex.setDataSource(path)
                    var vt = -1
                    for (i in 0 until ex.trackCount) {
                        if (ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) { vt = i; break }
                    }
                    if (vt < 0) {
                        problem = "the camera's file has no video track"
                    } else {
                        ex.selectTrack(vt)
                        val buf = ByteBuffer.allocateDirect(4 shl 20)
                        if (ex.readSampleData(buf, 0) >= 0) return null
                        problem = "the camera's video has no frames"
                    }
                } catch (e: Exception) {
                    problem = "the camera's video file isn't finished (${e.message})"
                } finally {
                    ex.release()
                }
            } else if (len > 0) {
                problem = "the camera was still writing the video"
            }
            last = len
            Thread.sleep(150)
        }
        return problem
    }

    fun mux(videoPath: String, wavPath: String, outPath: String, audioOffsetSec: Double) {
        val audio = encodeAac(wavPath)
        val vex = MediaExtractor()
        vex.setDataSource(videoPath)
        var vTrack = -1
        for (i in 0 until vex.trackCount) {
            if (vex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) { vTrack = i; break }
        }
        require(vTrack >= 0) { "No video track" }
        vex.selectTrack(vTrack)
        val vfmt = vex.getTrackFormat(vTrack)
        val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        if (vfmt.containsKey("rotation-degrees")) muxer.setOrientationHint(vfmt.getInteger("rotation-degrees"))
        val mv = muxer.addTrack(vfmt)
        val ma = if (audio.format != null) muxer.addTrack(audio.format!!) else -1
        muxer.start()
        val maxIn = if (vfmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) vfmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 4 shl 20
        val buf = ByteBuffer.allocateDirect(maxIn.coerceAtLeast(1 shl 20))
        val info = MediaCodec.BufferInfo()
        var v0 = -1L
        var frames = 0
        while (true) {
            buf.clear()
            val n = vex.readSampleData(buf, 0)
            if (n < 0) break
            if (v0 < 0) v0 = vex.sampleTime
            info.set(0, n, vex.sampleTime - v0, if ((vex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            muxer.writeSampleData(mv, buf, info)
            frames++
            vex.advance()
        }
        vex.release()
        if (frames == 0) {
            try { muxer.release() } catch (_: Exception) {}
            File(outPath).delete()
            throw IllegalStateException("the camera's video has no frames")
        }
        if (ma >= 0) {
            val off = (audioOffsetSec * 1e6).toLong()
            for (s in audio.samples) {
                val pts = s.pts + off
                if (pts < 0) continue
                val bb = ByteBuffer.wrap(s.data)
                info.set(0, s.data.size, pts, s.flags)
                muxer.writeSampleData(ma, bb, info)
            }
        }
        muxer.stop()
        muxer.release()
    }

    /**
     * What a recorded video actually contains: size, rotation, duration, and how bright the
     * picture is at 10/50/90 % (mean luma 0..255), so a take whose camera delivered a black
     * picture can be told apart from a player that doesn't draw it. Writes a poster frame
     * (the brightest of those, upright) to [thumbPath] as a JPEG.
     */
    fun videoInfo(path: String, thumbPath: String?): Map<String, Any?> {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(path)
            val hasVideo = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes"
            val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val durMs = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val lumas = ArrayList<Double>()
            var best: Bitmap? = null
            var bestLuma = -1.0
            if (hasVideo && durMs > 0) {
                for (f in doubleArrayOf(0.1, 0.5, 0.9)) {
                    val us = (durMs * f * 1000).toLong()
                    val bm = (if (Build.VERSION.SDK_INT >= 27) r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 720, 720)
                              else r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)) ?: continue
                    val l = meanLuma(bm)
                    lumas.add(l)
                    if (l > bestLuma) { best?.recycle(); best = bm; bestLuma = l } else bm.recycle()
                }
            }
            var thumb: String? = null
            val b = best
            if (b != null && thumbPath != null) {
                // upright, whatever the retriever did with the rotation
                val portrait = if (rot == 90 || rot == 270) w > h else h > w
                val up = if ((b.height > b.width) != portrait && (rot == 90 || rot == 270)) {
                    Bitmap.createBitmap(b, 0, 0, b.width, b.height, Matrix().apply { postRotate(rot.toFloat()) }, true)
                } else b
                FileOutputStream(thumbPath).use { up.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                if (up !== b) up.recycle()
                thumb = thumbPath
            }
            b?.recycle()
            return mapOf(
                "hasVideo" to hasVideo, "width" to w, "height" to h, "rotation" to rot, "duration" to durMs / 1000.0,
                "lumas" to lumas, "luma" to (if (lumas.isEmpty()) -1.0 else lumas.max()), "thumb" to thumb
            )
        } finally {
            r.release()
        }
    }

    private fun meanLuma(bm: Bitmap): Double {
        val s = Bitmap.createScaledBitmap(bm, 32, 32, true)
        val px = IntArray(32 * 32)
        s.getPixels(px, 0, 32, 0, 0, 32, 32)
        if (s !== bm) s.recycle()
        var sum = 0.0
        for (c in px) sum += 0.299 * ((c shr 16) and 255) + 0.587 * ((c shr 8) and 255) + 0.114 * (c and 255)
        return sum / px.size
    }

    /** Duration of the first video track in seconds. */
    fun videoDuration(path: String): Double {
        val ex = MediaExtractor()
        ex.setDataSource(path)
        try {
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true && f.containsKey(MediaFormat.KEY_DURATION)) return f.getLong(MediaFormat.KEY_DURATION) / 1e6
            }
        } finally {
            ex.release()
        }
        return 0.0
    }

    class AacSample(val data: ByteArray, val pts: Long, val flags: Int)
    class Aac(val format: MediaFormat?, val samples: List<AacSample>)

    private fun encodeAac(wavPath: String): Aac {
        val raf = RandomAccessFile(wavPath, "r")
        val hdr = ByteArray(44)
        raf.readFully(hdr)
        val hb = ByteBuffer.wrap(hdr).order(ByteOrder.LITTLE_ENDIAN)
        val ch = hb.getShort(22).toInt()
        val rate = hb.getInt(24)
        raf.close()
        val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, ch)
        fmt.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        fmt.setInteger(MediaFormat.KEY_BIT_RATE, 192_000)
        fmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 1 shl 16)
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        val inp = FileInputStream(wavPath)
        inp.skip(44)
        val chunk = ByteArray(4096 * ch)
        val samples = ArrayList<AacSample>()
        var outFmt: MediaFormat? = null
        val info = MediaCodec.BufferInfo()
        var framesIn = 0L
        var inDone = false
        var outDone = false
        while (!outDone) {
            if (!inDone) {
                val ii = codec.dequeueInputBuffer(10_000)
                if (ii >= 0) {
                    val ib = codec.getInputBuffer(ii)!!
                    ib.clear()
                    val want = minOf(chunk.size, ib.capacity())
                    val n = inp.read(chunk, 0, want)
                    val pts = framesIn * 1_000_000L / rate
                    if (n <= 0) {
                        codec.queueInputBuffer(ii, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inDone = true
                    } else {
                        ib.put(chunk, 0, n)
                        codec.queueInputBuffer(ii, 0, n, pts, 0)
                        framesIn += n / (2 * ch)
                    }
                }
            }
            val oi = codec.dequeueOutputBuffer(info, 10_000)
            if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                outFmt = codec.outputFormat
            } else if (oi >= 0) {
                val ob = codec.getOutputBuffer(oi)!!
                if (info.size > 0 && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                    val data = ByteArray(info.size)
                    ob.position(info.offset)
                    ob.get(data, 0, info.size)
                    samples.add(AacSample(data, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM.inv()))
                }
                codec.releaseOutputBuffer(oi, false)
                if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true
            }
        }
        inp.close()
        codec.stop()
        codec.release()
        return Aac(outFmt, samples)
    }

    /** Encodes a WAV to an .m4a (AAC) audio file. */
    fun wavToM4a(wavPath: String, outPath: String) {
        val audio = encodeAac(wavPath)
        val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val ma = muxer.addTrack(audio.format!!)
        muxer.start()
        val info = MediaCodec.BufferInfo()
        for (s in audio.samples) {
            info.set(0, s.data.size, s.pts, s.flags)
            muxer.writeSampleData(ma, ByteBuffer.wrap(s.data), info)
        }
        muxer.stop()
        muxer.release()
    }

    // ------------------------------------------------------------------ gallery
    fun saveVideoToGallery(ctx: Context, path: String, name: String): String {
        val src = File(path)
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Lectern")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val r = ctx.contentResolver
            val uri = r.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("MediaStore insert failed")
            r.openOutputStream(uri)!!.use { o -> src.inputStream().use { it.copyTo(o) } }
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            r.update(uri, values, null, null)
            return uri.toString()
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "Lectern")
            dir.mkdirs()
            val dst = File(dir, name)
            src.copyTo(dst, overwrite = true)
            return dst.path
        }
    }
}
