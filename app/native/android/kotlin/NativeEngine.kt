package com.lectern.lectern

import java.nio.ByteBuffer

/** JNI surface of the C++ engine (native/cpp). */
object NativeEngine {
    init {
        System.loadLibrary("lectern")
    }

    external fun nativeStart(): Boolean
    external fun nativeSampleRate(): Int
    external fun nativeLoad(buf: ByteBuffer, frames: Long, channels: Int, rate: Int): Boolean
    external fun nativeUnload()
    external fun nativePlay()
    external fun nativePause()
    external fun nativeSeek(sec: Double)
    external fun nativeSetRate(rate: Double)
    external fun nativeSetVolume(v: Float)
    /** [position, playing, duration, micDb, recording, outputRate, hasHardwareClock, speed] */
    external fun nativeState(): DoubleArray
    external fun nativeOpenMic(mode: Int, nc: Boolean, gainDb: Float, preset: Int, deviceId: Int): String
    external fun nativeCloseMic()
    external fun nativeStartRecord(voice: String, music: String): Boolean
    external fun nativePauseRecord(paused: Boolean)
    /** [seconds, rate, firstCaptureNs, lastCaptureNs, gapSeconds, lostSeconds, musicJumps, hasMusic, outXruns, inXruns] */
    external fun nativeStopRecord(): DoubleArray
    external fun nativeSetNC(on: Boolean)
    external fun nativeSetMicGain(db: Float)
    external fun nativeOutputLatency(): Double
    external fun nativeMonoNs(): Long
    external fun nativeFinalize(voice: String, music: String, out: String, mode: Int, balanceDb: Double): String
    external fun nativeTranscribe(model: String, buf: ByteBuffer, frames: Long, channels: Int, rate: Int, language: String): String
    external fun nativeTranscribeProgress(): Int
    external fun nativeTranscribeCancel()
    external fun nativeAnalyzeVocals(buf: ByteBuffer, frames: Long, channels: Int, rate: Int): String
}
