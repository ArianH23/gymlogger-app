package com.gymlogger.watch.data

import org.junit.Assert.assertEquals
import org.junit.Test

class HeartRateLogicTest {
    private fun s(atSeconds: Int, bpm: Int) = HrSample(atSeconds * 1000L, bpm)

    @Test
    fun `one reading every five seconds is kept`() {
        val everySecond = (1..12).map { s(it, 100 + it) }
        assertEquals(listOf(s(5, 105), s(10, 110)), thinHr(everySecond, lastKeptMs = 0))
    }

    @Test
    fun `thinning carries on from the last reading kept before`() {
        // the last one kept was at 8 s, so the next can be at 13 s at the earliest
        assertEquals(listOf(s(13, 120)), thinHr(listOf(s(9, 118), s(12, 119), s(13, 120), s(14, 121)), lastKeptMs = 8000))
    }

    @Test
    fun `readings that are not a heart rate are dropped`() {
        // 0 while the sensor is still searching, and an impossible value
        assertEquals(listOf(s(20, 95)), thinHr(listOf(s(10, 0), s(15, 300), s(20, 95)), lastKeptMs = 0))
    }

    @Test
    fun `a batch that arrives out of order is put in time order`() {
        assertEquals(listOf(s(10, 100), s(20, 110)), thinHr(listOf(s(20, 110), s(10, 100)), lastKeptMs = 0))
    }

    @Test
    fun `nothing new gives nothing`() {
        assertEquals(emptyList<HrSample>(), thinHr(emptyList(), lastKeptMs = 0))
    }

    @Test
    fun `samples are sent as seconds from the start of the session`() {
        val start = 1_000_000L
        val samples = listOf(HrSample(start + 5_000, 101), HrSample(start + 10_400, 120))
        assertEquals("[[5,101],[10,120]]", hrSamplesJson(samples, start))
    }

    @Test
    fun `readings from before the session started are left out`() {
        val start = 1_000_000L
        assertEquals("[[0,90]]", hrSamplesJson(listOf(HrSample(start - 3_000, 80), HrSample(start, 90)), start))
        assertEquals("[]", hrSamplesJson(emptyList(), start))
    }
}
