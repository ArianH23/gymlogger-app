package com.gymlogger.watch.data

import android.content.Context
import com.gymlogger.watch.BuildConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** What the screens get back from a pairing attempt. */
sealed interface PairResult {
    data object Ok : PairResult
    data object WrongCode : PairResult
    data class Failed(val message: String) : PairResult
}

@Serializable
private data class PairResponse(val access_token: String, val refresh_token: String, val expires_in: Long)

@Serializable
private data class RefreshResponse(val access_token: String, val refresh_token: String, val expires_in: Long)

/**
 * Talks to the same Supabase project as the phone: pairs with a code, keeps the login (and renews it), and reads
 * and writes with plain REST calls. Everything here blocks, so call it from a background thread.
 */
class Api(context: Context) {
    private val prefs = context.getSharedPreferences("login", Context.MODE_PRIVATE)
    private val http = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonType = "application/json".toMediaType()
    private val base = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val key = BuildConfig.SUPABASE_KEY

    val signedIn: Boolean get() = prefs.getString("refresh", null) != null

    fun signOut() = prefs.edit().clear().apply()

    private fun save(access: String, refresh: String, expiresInSeconds: Long) {
        prefs.edit()
            .putString("access", access)
            .putString("refresh", refresh)
            .putLong("expiresAt", System.currentTimeMillis() + expiresInSeconds * 1000)
            .apply()
    }

    /** Trades the 6-digit code made on the phone for a login, through the watch-pair Edge Function. */
    fun pair(code: String): PairResult {
        val request = Request.Builder()
            .url("$base/functions/v1/watch-pair")
            .header("apikey", key)
            .post("""{"code":"$code"}""".toRequestBody(jsonType))
            .build()
        return try {
            http.newCall(request).execute().use { r ->
                val body = r.body.string()
                when {
                    r.code == 200 -> {
                        val tokens = json.decodeFromString<PairResponse>(body)
                        save(tokens.access_token, tokens.refresh_token, tokens.expires_in)
                        PairResult.Ok
                    }
                    r.code == 401 -> PairResult.WrongCode
                    else -> PairResult.Failed("Error ${r.code}")
                }
            }
        } catch (e: IOException) {
            PairResult.Failed("No connection")
        }
    }

    /** A valid access token, renewed with the refresh token when it is about to expire. Null if signed out. */
    @Synchronized
    private fun token(): String? {
        val access = prefs.getString("access", null)
        val refresh = prefs.getString("refresh", null) ?: return null
        if (access != null && System.currentTimeMillis() < prefs.getLong("expiresAt", 0) - 60_000) return access

        val request = Request.Builder()
            .url("$base/auth/v1/token?grant_type=refresh_token")
            .header("apikey", key)
            .post("""{"refresh_token":"$refresh"}""".toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { r ->
            val body = r.body.string()
            if (r.code in 400..499) { // the login was revoked or is no longer valid: pair again
                signOut()
                return null
            }
            if (!r.isSuccessful) throw IOException("Error ${r.code}")
            val tokens = json.decodeFromString<RefreshResponse>(body)
            save(tokens.access_token, tokens.refresh_token, tokens.expires_in)
            return tokens.access_token
        }
    }

    /** GET a REST path (for example "routine_status?select=name") and return the JSON text. Throws IOException. */
    fun get(path: String): String {
        val access = token() ?: throw SignedOut()
        val request = Request.Builder()
            .url("$base/rest/v1/$path")
            .header("apikey", key)
            .header("Authorization", "Bearer $access")
            .build()
        http.newCall(request).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Error ${r.code}")
            return r.body.string()
        }
    }

    /** POST a JSON body to a REST path (for example "rpc/workout_start") and return the JSON text. Throws IOException. */
    fun post(path: String, jsonBody: String): String {
        val access = token() ?: throw SignedOut()
        val request = Request.Builder()
            .url("$base/rest/v1/$path")
            .header("apikey", key)
            .header("Authorization", "Bearer $access")
            .post(jsonBody.toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Error ${r.code}")
            return r.body.string()
        }
    }

    class SignedOut : IOException("Signed out")
}
