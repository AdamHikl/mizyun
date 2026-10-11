package com.mizyun.companion

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.AtomicFile
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.io.File
import java.util.Locale

class WorkoutActivity : Activity(), MessageClient.OnMessageReceivedListener {
  private val main = Handler(Looper.getMainLooper())
  private lateinit var state: CompanionState
  private lateinit var queue: AtomicFile
  private lateinit var heading: TextView
  private lateinit var sets: TextView
  private lateinit var repsLabel: TextView
  private lateinit var loadLabel: TextView
  private lateinit var restLabel: TextView
  private lateinit var statusLabel: TextView
  private lateinit var logButton: Button
  private lateinit var skipButton: Button
  private lateinit var finishButton: Button
  private val editButtons = mutableListOf<Button>()
  private var reps = 8
  private var load = 0.0
  private var phoneNode: String? = null
  private var active = false
  private var restAlerted: Long? = null
  private var lastHelloAt = 0L
  private val path = "/mizyun/workout/message"
  private val tick = object : Runnable {
    override fun run() {
      if (!active) return
      val now = System.currentTimeMillis()
      val end = state.snapshot?.optLong("restEndsAtMs") ?: 0
      state.tick(now)
      if (state.snapshot != null && end > 0 && end <= now && restAlerted != end) {
        restAlerted = end
        (getSystemService(VIBRATOR_SERVICE) as? Vibrator)?.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
      }
      render()
      if (state.snapshot == null && now - lastHelloAt >= 5000) hello()
      flush()
      main.postDelayed(this, 1000)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    queue = AtomicFile(File(noBackupFilesDir, "workout-companion-pending.json"))
    state = CompanionState { item ->
      if (item == null) queue.delete()
      else {
        val bytes = item.toString().toByteArray()
        require(bytes.size <= 16384)
        val stream = queue.startWrite()
        try { stream.write(bytes); queue.finishWrite(stream) }
        catch (failure: Exception) { queue.failWrite(stream); throw failure }
      }
    }
    buildView()
  }
  private fun available() = packageName == "com.mizyun.dev" && GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS
  override fun onResume() {
    super.onResume()
    active = true; phoneNode = null
    state.activate(hadOutbox = queue.baseFile.exists())
    if (available()) Wearable.getMessageClient(this).addListener(this)
    main.post(tick); hello()
  }
  override fun onPause() {
    active = false
    main.removeCallbacks(tick)
    if (available()) Wearable.getMessageClient(this).removeListener(this)
    state.suspend(); phoneNode = null
    super.onPause()
  }
  private fun hello() {
    if (!active || !available()) return
    lastHelloAt = System.currentTimeMillis()
    val activationNonce = state.nonce
    Wearable.getNodeClient(this).connectedNodes.addOnSuccessListener { nodes ->
      if (!active || state.nonce != activationNonce) return@addOnSuccessListener
      // Ambiguous multi-node routes require opening the phone rather than choosing another authority.
      if (nodes.size != 1) { phoneNode = null; return@addOnSuccessListener }
      val target = nodes.single().id
      if (phoneNode != null && phoneNode != target) return@addOnSuccessListener
      phoneNode = target
      Wearable.getMessageClient(this).sendMessage(target, path, state.hello().toByteArray())
      flush()
    }
  }
  private fun flush() {
    if (!active || !available()) return
    val target = phoneNode ?: return
    val json = state.nextDelivery(System.currentTimeMillis()) ?: return
    val operation = JSONObject(json).getString("operationId")
    Wearable.getMessageClient(this).sendMessage(target, path, json.toByteArray()).addOnFailureListener {
      if (state.pending?.getString("json")?.let { JSONObject(it).optString("operationId") } == operation) {
        state.uncertain(); render()
      }
    }
    render()
  }
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path != path || event.data.size > 16384) return
    main.post {
      if (!active || event.sourceNodeId != phoneNode) return@post
      val previous = state.snapshot
      state.receive(event.data.toString(Charsets.UTF_8), System.currentTimeMillis())
      val next = state.snapshot
      val exercise = next?.optJSONObject("exercise")
      if (exercise != null && (previous?.optLong("revision") != next.optLong("revision") || previous?.optJSONObject("exercise")?.optString("exerciseId") != exercise.optString("exerciseId"))) {
        reps = exercise.optInt("repetitions", 8).coerceIn(1, 1000)
        load = exercise.optDouble("loadKg", 0.0) / if (exercise.optString("loadUnit") == "lb") 0.45359237 else 1.0
      }
      render(); flush()
    }
  }
  private fun label(parent: LinearLayout, size: Float = 14f): TextView = TextView(this).also {
    it.textSize = size; it.gravity = Gravity.CENTER; parent.addView(it)
  }
  private fun button(parent: LinearLayout, title: String, onClick: () -> Unit): Button = Button(this).also {
    it.text = title; it.isAllCaps = false; it.setOnClickListener { onClick() }; parent.addView(it)
  }
  private fun buildView() {
    val scroll = ScrollView(this)
    val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(24, 24, 24, 32) }
    scroll.addView(column); setContentView(scroll)
    label(column, 12f).text = "Mizyun Dev"
    heading = label(column, 18f); sets = label(column)
    repsLabel = label(column)
    val repsRow = LinearLayout(this).also { column.addView(it) }
    editButtons.add(button(repsRow, "− rep") { reps = (reps - 1).coerceAtLeast(1); render() })
    editButtons.add(button(repsRow, "+ rep") { reps = (reps + 1).coerceAtMost(1000); render() })
    loadLabel = label(column)
    val loadRow = LinearLayout(this).also { column.addView(it) }
    editButtons.add(button(loadRow, "− 0.5") { load = (load - 0.5).coerceAtLeast(0.0); render() })
    editButtons.add(button(loadRow, "+ 0.5") { load = (load + 0.5).coerceAtMost(2000.0); render() })
    logButton = button(column, "Log set") { submit("log-set") }
    restLabel = label(column, 18f)
    skipButton = button(column, "Skip rest") { submit("skip-rest") }
    finishButton = button(column, "Finish workout") {
      AlertDialog.Builder(this).setMessage("Finish this workout on your phone?")
        .setPositiveButton("Finish") { _, _ -> submit("finish") }.setNegativeButton("Keep working out", null).show()
    }
    statusLabel = label(column)
    button(column, "Connect to phone") { hello() }
    render()
  }
  private fun submit(kind: String) {
    val kg = load * if (state.snapshot?.optJSONObject("exercise")?.optString("loadUnit") == "lb") 0.45359237 else 1.0
    if (state.enqueue(kind, reps, kg, System.currentTimeMillis())) flush()
    render()
  }
  private fun render() {
    val snapshot = state.snapshot
    val exercise = snapshot?.optJSONObject("exercise")
    val valid = snapshot?.optString("status") == "active"
    val blocked = state.pending != null
    heading.text = if (valid) exercise?.optString("name") ?: "Workout" else "Connect to phone"
    sets.text = if (valid && exercise != null) "${exercise.optInt("completedSets")} of ${exercise.optInt("targetSets")} sets · ${exercise.optString("setType")}" else ""
    repsLabel.text = if (valid && exercise != null) "Reps: $reps" else ""
    loadLabel.text = if (valid && exercise != null) String.format(Locale.getDefault(), "%.1f %s", load, exercise.optString("loadUnit", "kg")) else ""
    editButtons.forEach { it.isEnabled = valid && exercise != null && !blocked }
    logButton.isEnabled = valid && !blocked && snapshot?.optBoolean("canLogSet") == true
    finishButton.isEnabled = valid && !blocked && snapshot?.optBoolean("canFinish") == true
    val seconds = ((snapshot?.optLong("restEndsAtMs") ?: 0) - System.currentTimeMillis() + 999) / 1000
    restLabel.text = if (valid && seconds > 0) "Rest ${seconds}s" else ""
    skipButton.isEnabled = valid && !blocked && seconds > 0
    statusLabel.text = state.message
  }
}
