package com.gymlogger.watch.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The rules of the workout screens, checked without a watch. Run with: watch\build.ps1 testDebugUnitTest */
class WorkoutLogicTest {
    private fun exercise(id: String, loadType: String = "weighted", unilateral: Boolean = false, sets: Int = 3, min: Int? = 6, max: Int? = 10) =
        PlanExercise(
            exerciseId = id, name = id, loadType = loadType, unilateral = unilateral,
            sets = (1..sets).map { PlanSet(it, 40.0, min, max, null) },
        )

    private fun workout(vararg ex: PlanExercise, sets: List<LoggedSet> = emptyList()) =
        Workout(id = "w", routineId = null, title = "t", startedAt = "2026-01-01T10:00:00Z", plan = ex.toList(), sets = sets)

    private fun logged(ex: String, setNo: Int, reps: Int, side: String? = null) =
        LoggedSet("$ex-$setNo-$side", ex, setNo, side, 40.0, reps, "2026-01-01T10:0$setNo:00Z")

    // ---- the weight hint, by the reps against the range

    @Test fun aboveTheTopOfTheRangeMeansUp() = assertEquals(WeightHint.UP, hintFor("weighted", 11, 6, 10))

    @Test fun belowTheBottomOfTheRangeMeansDown() = assertEquals(WeightHint.DOWN, hintFor("weighted", 5, 6, 10))

    @Test fun theEdgesOfTheRangeAreFine() {
        assertNull(hintFor("weighted", 10, 6, 10))
        assertNull(hintFor("weighted", 6, 6, 10))
        assertNull(hintFor("weighted", 8, 6, 10))
    }

    @Test fun assistedIsReversed() {
        assertEquals(WeightHint.DOWN, hintFor("assisted", 11, 6, 10)) // more reps: less help
        assertEquals(WeightHint.UP, hintFor("assisted", 5, 6, 10)) // fewer reps: more help
    }

    @Test fun aSingleTargetNeedsTwoRepsOfMargin() {
        assertEquals(WeightHint.UP, hintFor("weighted", 14, 12, 12))
        assertNull(hintFor("weighted", 13, 12, 12))
        assertNull(hintFor("weighted", 11, 12, 12))
        assertEquals(WeightHint.DOWN, hintFor("weighted", 10, 12, 12))
        assertEquals(WeightHint.UP, hintFor("weighted", 14, 12, null)) // no top given: the same as a single target
    }

    @Test fun noTargetNoHint() = assertNull(hintFor("weighted", 30, null, null))

    // ---- which set it judges, and when

    @Test fun nextSetIsJudgedByTheSetBefore() {
        val ex = exercise("press")
        val w = workout(ex, sets = listOf(logged("press", 1, 12)))
        assertEquals(WeightHint.UP, w.weightHint(ex, Row(2, null)))
        assertNull(w.weightHint(ex, Row(1, null))) // already logged
        assertNull(workout(ex).weightHint(ex, Row(1, null))) // nothing before it
    }

    @Test fun aSkippedSetFallsBackToTheNearestLoggedOne() {
        val ex = exercise("press")
        val w = workout(ex, sets = listOf(logged("press", 1, 4)))
        assertEquals(WeightHint.DOWN, w.weightHint(ex, Row(3, null)))
    }

    @Test fun oneSidedUsesTheLowerSideOnceBothAreDone() {
        val ex = exercise("row", unilateral = true)
        val both = workout(ex, sets = listOf(logged("row", 1, 12, "L"), logged("row", 1, 4, "R")))
        assertEquals(WeightHint.DOWN, both.weightHint(ex, Row(2, "L")))
        assertEquals(WeightHint.DOWN, both.weightHint(ex, Row(2, "R"))) // both rows of the next set agree
        val oneSide = workout(ex, sets = listOf(logged("row", 1, 12, "L")))
        assertNull(oneSide.weightHint(ex, Row(2, "L"))) // the right side of set 1 is not done yet
    }

    @Test fun bodyweightGetsNoHint() {
        val ex = exercise("legraise", loadType = "bodyweight")
        assertNull(workout(ex, sets = listOf(logged("legraise", 1, 30))).weightHint(ex, Row(2, null)))
    }

    // ---- moving through the workout

    @Test fun loggingMovesOnToTheNextEmptySetEvenInTheNextExercise() {
        val a = exercise("a", sets = 1)
        val b = exercise("b", sets = 2)
        val w = workout(a, b, sets = listOf(logged("a", 1, 8)))
        assertEquals("b" to Row(1, null), w.nextOpenAfter("a", Row(1, null))?.let { it.first.exerciseId to it.second })
    }

    @Test fun nothingOpenMeansTheWorkoutIsDone() {
        val a = exercise("a", sets = 1)
        assertNull(workout(a, sets = listOf(logged("a", 1, 8))).nextOpenAfter("a", Row(1, null)))
    }

    @Test fun stepArrowsCrossIntoTheNextExercise() {
        val a = exercise("a", sets = 1)
        val b = exercise("b", sets = 1)
        val w = workout(a, b)
        assertEquals("b", w.step("a", Row(1, null), 1)?.first?.exerciseId)
        assertNull(w.step("a", Row(1, null), -1))
    }
}
