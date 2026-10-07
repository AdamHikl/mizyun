package com.mizyun.healthsteps

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** The Health Connect permission sheet links here to explain optional health access. */
class HealthStepsPermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = "Mizyun health access"
    val padding = (24 * resources.displayMetrics.density).toInt()
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(padding, padding, padding, padding)
      addView(TextView(this@HealthStepsPermissionsRationaleActivity).apply {
        text = "If you enable Steps, Mizyun reads today's step total for your dashboard. If you choose a weight or completed-workout preview, Mizyun requests read access only to that category. Preview records stay in memory and are cleared when you leave the screen or background the app. Mizyun does not send these records to its server or Coach, change your targets, or use them for exports. In Mizyun Dev, separate nutrition and workout export controls request only the selected write permission. Eligible confirmed first-party nutrition values and actual completed workout times are sent to Health Connect. Export tracking stays encrypted on this device; copied platform records remain if you turn exports off or delete your Mizyun account. Manage those copies in Health Connect. Stop reading in Mizyun Settings, or revoke access in Health Connect."
        textSize = 18f
      })
      addView(Button(this@HealthStepsPermissionsRationaleActivity).apply {
        text = "Read privacy policy"
        setOnClickListener {
          startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.phiskel.com/mizyun/privacy")))
        }
      })
    }
    val scroll = ScrollView(this).apply {
      isFillViewport = true
      addView(layout, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
    setContentView(scroll, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }
}
