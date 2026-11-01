package com.gymlogger.watch

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.gymlogger.watch.data.Api
import com.gymlogger.watch.data.PairResult
import com.gymlogger.watch.data.RoutineItem
import com.gymlogger.watch.data.routines
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.IOException

/** What the screens show. The data lives in [Api] and the database; this only holds what is on screen. */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val api = Api(app)

    var signedIn by mutableStateOf(api.signedIn)
        private set

    var pairBusy by mutableStateOf(false)
        private set
    var pairError by mutableStateOf<String?>(null)
        private set

    var routines by mutableStateOf<List<RoutineItem>?>(null)
        private set
    var routinesError by mutableStateOf<String?>(null)
        private set

    fun pair(code: String) {
        pairBusy = true
        pairError = null
        viewModelScope.launch(Dispatchers.IO) {
            val result = api.pair(code)
            pairBusy = false
            when (result) {
                PairResult.Ok -> signedIn = true
                PairResult.WrongCode -> pairError = "Wrong or expired code"
                is PairResult.Failed -> pairError = result.message
            }
        }
    }

    fun loadRoutines() {
        routinesError = null
        viewModelScope.launch(Dispatchers.IO) {
            try {
                routines = api.routines()
            } catch (e: Api.SignedOut) {
                signedIn = false // the login was revoked: pair again
            } catch (e: IOException) {
                routinesError = "No connection"
            } catch (e: Exception) {
                routinesError = "Could not load"
            }
        }
    }

    fun signOut() {
        api.signOut()
        routines = null
        signedIn = false
    }
}
