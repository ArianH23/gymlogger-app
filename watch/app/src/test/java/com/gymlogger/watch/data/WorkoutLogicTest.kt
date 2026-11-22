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

    // ---- "+ Set": a removed set comes back with its plan

    @Test fun plusSetAddsAnExtraSetWhenNothingWasRemoved() {
        val w = workout(exercise("press")).addSetRow("press")
        assertEquals(1, w.extraSets["press"])
        assertEquals(listOf(1, 2, 3, 4), w.rows(w.plan[0]).map { it.setNo })
    }

    @Test fun plusSetBringsARemovedPlannedSetBackWithItsPlan() {
        val gone = workout(exercise("press")).copy(removedSets = mapOf("press" to listOf(2)))
        assertEquals(listOf(1, 3), gone.rows(gone.plan[0]).map { it.setNo })
        val back = gone.addSetRow("press")
        assertEquals(listOf(1, 2, 3), back.rows(back.plan[0]).map { it.setNo })
        assertEquals(null, back.extraSets["press"]) // not a plain extra set
        assertEquals(null, back.removedSets["press"])
        assertEquals(40.0, back.plan[0].planSet(2)?.targetWeightKg) // set 2 still has its plan
        assertEquals(gone.liveRev + 1, back.liveRev) // so the phone gets the change
    }

    @Test fun plusSetBringsBackTheLowestRemovedNumberFirst() {
        val gone = workout(exercise("press")).copy(removedSets = mapOf("press" to listOf(3, 1)))
        val one = gone.addSetRow("press")
        assertEquals(listOf(1, 2), one.rows(one.plan[0]).map { it.setNo })
        val two = one.addSetRow("press")
        assertEquals(listOf(1, 2, 3), two.rows(two.plan[0]).map { it.setNo })
        assertEquals(listOf(1, 2, 3, 4), two.addSetRow("press").rows(two.plan[0]).map { it.setNo }) // then extra sets again
    }

    @Test fun plusSetLeavesAnotherExercisesRemovedSetsAlone() {
        val w = workout(exercise("press"), exercise("row")).copy(removedSets = mapOf("row" to listOf(1), "press" to listOf(2)))
        assertEquals(mapOf("row" to listOf(1)), w.addSetRow("press").removedSets)
    }

    // ---- machine taken: swapping an exercise for its backup

    @Test fun swappingPutsTheBackupInTheSamePlace() {
        val w = workout(exercise("row"), exercise("press").copy(backup = exercise("dumbbell")), exercise("curl"))
        val after = w.swapToBackup("press")!!
        assertEquals(listOf("row", "dumbbell", "curl"), after.plan.map { it.exerciseId })
        assertEquals(true, after.plan[1].swapped)
        assertEquals(w.liveRev + 1, after.liveRev) // so the phone gets the change
    }

    @Test fun theSameTapSwapsBack() {
        val w = workout(exercise("press").copy(backup = exercise("dumbbell")))
        val back = w.swapToBackup("press")!!.swapToBackup("dumbbell")!!
        assertEquals(listOf("press"), back.plan.map { it.exerciseId })
        assertEquals(false, back.plan[0].swapped)
        assertEquals("dumbbell", back.plan[0].backup?.exerciseId)
    }

    @Test fun noSwapOnceASetIsLogged() {
        val w = workout(exercise("press").copy(backup = exercise("dumbbell")), sets = listOf(logged("press", 1, 8)))
        assertEquals(false, w.canSwap(w.plan[0]))
        assertNull(w.swapToBackup("press"))
    }

    @Test fun noSwapWithoutABackupOrWhenItIsAlreadyInTheWorkout() {
        assertNull(workout(exercise("press")).swapToBackup("press"))
        val w = workout(exercise("press").copy(backup = exercise("dumbbell")), exercise("dumbbell"))
        assertEquals(false, w.canSwap(w.plan[0]))
    }

    @Test fun addedAndRemovedSetsOfTheOldExerciseDoNotCarryOver() {
        val w = workout(exercise("press").copy(backup = exercise("dumbbell"))).copy(extraSets = mapOf("press" to 1), removedSets = mapOf("press" to listOf(2)))
        val after = w.swapToBackup("press")!!
        assertEquals(emptyMap<String, Int>(), after.extraSets)
        assertEquals(emptyMap<String, List<Int>>(), after.removedSets)
    }

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
