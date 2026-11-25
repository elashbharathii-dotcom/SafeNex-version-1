package com.safenex.app.data.ai

import android.util.Log
import com.safenex.app.data.location.SafenexLocation
import com.safenex.app.domain.model.EmergencyEvent
import com.safenex.app.domain.model.TriggerSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class AiThreatAssessment(
    val category: String,
    val summary: String,
    val confidence: Double,
    val uncertainty: String,
    val actions: List<String>
)

data class AiEmergencyMessage(
    val sms: String,
    val whatsApp: String,
    val voiceBroadcast: String
)

/**
 * SAFENEX AI CORE V1 - Android Native Client & Fallback Engine
 * 
 * Invariants:
 * - Operates asynchronously: NEVER blocks or delays EmergencyState transitions.
 * - Provides guaranteed local deterministic analysis when backend is unreachable.
 * - Adheres strictly to safety constraints: Never predicts crime, never criminalizes on appearance.
 */
class SafeNexAiCore(
    private val backendUrl: String = "http://10.0.2.2:5001",
    private val userTokenProvider: (() -> String?)? = null,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO)
) {
    companion object {
        private const val TAG = "SAFENEX_AiCore"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .build()

    /**
     * Non-blocking asynchronous threat evaluation.
     */
    fun evaluateThreatAsync(
        event: EmergencyEvent,
        location: SafenexLocation?,
        onResult: (AiThreatAssessment) -> Unit
    ) {
        scope.launch {
            try {
                val jsonPayload = JSONObject().apply {
                    put("triggerSource", event.source.name)
                    put("incidentDescription", "Android emergency triggered via ${event.source.name}")
                    if (location != null) {
                        put("telemetry", JSONObject().apply {
                            put("latitude", location.latitude)
                            put("longitude", location.longitude)
                            put("accuracy", location.accuracy)
                            put("address", location.address)
                        })
                    }
                }

                val requestBuilder = Request.Builder()
                    .url("$backendUrl/api/ai/threat-intelligence")
                    .addHeader("Content-Type", "application/json")
                    .post(jsonPayload.toString().toRequestBody(JSON_MEDIA_TYPE))

                val token = userTokenProvider?.invoke()
                if (!token.isNullOrBlank()) {
                    requestBuilder.addHeader("Authorization", "Bearer $token")
                }

                val request = requestBuilder.build()

                httpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string() ?: ""
                        val obj = JSONObject(body)
                        val actionsArray = obj.optJSONArray("recommendedActions")
                        val actionsList = mutableListOf<String>()
                        if (actionsArray != null) {
                            for (i in 0 until actionsArray.length()) {
                                actionsList.add(actionsArray.getString(i))
                            }
                        }

                        val result = AiThreatAssessment(
                            category = obj.optString("incidentCategory", "PHYSICAL_DURESS"),
                            summary = obj.optString("incidentSummary", "Active duress registered."),
                            confidence = obj.optDouble("confidenceLevel", 0.85),
                            uncertainty = obj.optString("uncertaintyExplanation", "Verified telemetry."),
                            actions = actionsList
                        )
                        Log.i(TAG, "Backend AI assessment received: ${result.category}")
                        onResult(result)
                        return@launch
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Backend AI call failed or timed out (${e.message}), engaging local deterministic fallback.")
            }

            // Local Deterministic Fallback (0ms latency, zero dependencies)
            onResult(localFallbackThreatAssessment(event, location))
        }
    }

    /**
     * Local deterministic rule-based threat evaluation.
     */
    fun localFallbackThreatAssessment(event: EmergencyEvent, location: SafenexLocation?): AiThreatAssessment {
        val category = when (event.source) {
            TriggerSource.BUTTON -> "PHYSICAL_DURESS"
            TriggerSource.SHAKE -> "PHYSICAL_DURESS"
            TriggerSource.SCHEDULE_OVERDUE -> "TRANSIT_ANOMALY"
            TriggerSource.VOICE -> "PHYSICAL_DURESS"
            TriggerSource.UNKNOWN -> "UNVERIFIED_DISTRESS"
        }

        val hasGps = location != null
        val confidence = if (hasGps) 0.85 else 0.70
        val uncertainty = if (hasGps) "Local heuristics with GPS fix." else "Local heuristics, GPS lock pending."

        return AiThreatAssessment(
            category = category,
            summary = "Emergency protocol active via ${event.source.name}. Alarms and blackbox evidence recording engaged.",
            confidence = confidence,
            uncertainty = uncertainty,
            actions = listOf(
                "Maintain connection to emergency guardians",
                "Keep phone powered and accessible",
                "Acoustic siren and strobe deterrents active"
            )
        )
    }

    /**
     * Formats emergency messages with strict <= 160 char SMS budget and WhatsApp rich markdown.
     */
    fun formatEmergencyMessages(
        userName: String,
        event: EmergencyEvent,
        location: SafenexLocation?,
        trackingUrl: String = "https://safenex.app/track"
    ): AiEmergencyMessage {
        val hasGps = location != null
        val locSnippet = if (hasGps) "Loc:${String.format("%.4f", location!!.latitude)},${String.format("%.4f", location.longitude)}" else "Loc:GPS acquiring"
        var sms = "EMERGENCY SOS: $userName alerted SafeNex (${event.source.name}). $locSnippet. Track: $trackingUrl"
        if (sms.length > 160) {
            sms = "SOS: $userName in distress (${event.source.name}). $locSnippet. Track: $trackingUrl"
        }
        if (sms.length > 160) {
            sms = sms.substring(0, 157) + "..."
        }

        val whatsApp = buildString {
            append("🚨 *SAFENEX CRITICAL EMERGENCY ALERT*\n\n")
            append("*User:* $userName\n")
            append("*Status:* 🚨 ACTIVE EMERGENCY\n")
            append("*Trigger:* ${event.source.name}\n")
            if (hasGps) {
                append("📍 *Coordinates:* ${location!!.latitude}, ${location.longitude}\n")
                if (!location.address.isNullOrBlank()) {
                    append("🏠 *Address:* ${location.address}\n")
                }
                append("🗺️ *Map:* ${location.mapsUrl}\n")
            } else {
                append("📍 *Location:* Acquiring GPS satellite fix...\n")
            }
            append("\n🛰️ *Live Tracking:* $trackingUrl\n\n_Please check on me immediately!_")
        }

        val voice = "Emergency mode active for $userName. Coordinates dispatched to guardians."

        return AiEmergencyMessage(sms, whatsApp, voice)
    }
}
