package com.lectern.lectern

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** The background job queue: duplicates, persistence across restarts, recovery, retry. */
class JobStoreTest {
    private fun job(item: String, purpose: String = "clip") =
        JSONObject().put("id", "$item-${System.nanoTime()}").put("itemId", item).put("purpose", purpose).put("title", "Sync: $item")

    private fun fresh(): File = File(Files.createTempDirectory("jobs").toFile(), "jobs.json").also { JobStore.load(it) }

    @Test
    fun duplicateTapsDoNotStartASecondJob() {
        fresh()
        val a = JobStore.enqueue(job("song1"))
        val b = JobStore.enqueue(job("song1"))
        val c = JobStore.enqueue(job("song1", "clip2"))
        assertEquals(a, b)
        assertNotEquals(a, c)
        assertEquals(2, JobStore.list().size)
        // a job of another purpose (like the removed karaoke sync) is never picked up
        assertEquals(a, JobStore.nextQueued()!!.getString("id"))
        println("duplicate enqueue: 3 taps -> ${JobStore.list().size} jobs")
    }

    @Test
    fun queueSurvivesARestartAndInterruptedJobsResume() {
        val f = fresh()
        val a = JobStore.enqueue(job("song1"))
        val b = JobStore.enqueue(job("song2"))
        JobStore.update(a) { it.put("state", "running").put("progress", 40) }
        JobStore.update(b) { it.put("state", "done").put("progress", 100) }
        // the app process dies; next launch reads the file again
        JobStore.load(f)
        assertEquals("running", JobStore.get(a)!!.getString("state"))
        val resume = JobStore.recover()
        assertTrue(resume)
        assertEquals("queued", JobStore.get(a)!!.getString("state"))
        assertEquals("done", JobStore.get(b)!!.getString("state"))
        assertEquals(a, JobStore.nextQueued()!!.getString("id"))
        println("restart: running job re-queued, finished job kept")
    }

    @Test
    fun failedJobCanBeRetriedAndANewRequestReplacesIt() {
        fresh()
        val a = JobStore.enqueue(job("song3"))
        JobStore.update(a) { it.put("state", "error").put("error", "network") }
        val again = JobStore.enqueue(job("song3"))
        assertNotEquals(a, again)
        assertEquals(1, JobStore.list().count { it["itemId"] == "song3" })
        JobStore.update(again) { it.put("state", "queued") }
        assertEquals(again, JobStore.nextQueued()!!.getString("id"))
    }
}

class RemovedKaraokeJobsTest {
    @Test
    fun leftoverKaraokeJobsAreCancelledNotRun() {
        val f = File(Files.createTempDirectory("jobs").toFile(), "jobs.json")
        JobStore.load(f)
        val k = JobStore.enqueue(JSONObject().put("id", "k1").put("itemId", "s").put("purpose", "sync"))
        JobStore.update(k) { it.put("state", "running") }
        JobStore.load(f)
        JobStore.recover()
        assertEquals("cancelled", JobStore.get(k)!!.getString("state"))
        assertEquals(null, JobStore.nextQueued())
        println("leftover karaoke job: cancelled, not run")
    }
}
