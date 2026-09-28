package com.mizyun.healthsteps

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** The Health Connect permission sheet links here to explain Mizyun's step access. */
class HealthStepsPermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = "Mizyun step access"
    val padding = (24 * resources.displayMetrics.density).toInt()
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(padding, padding, padding, padding)
      addView(TextView(this@HealthStepsPermissionsRationaleActivity).apply {
        text = "If you choose to connect Health Connect, Mizyun reads only today's step total to show it on your dashboard. Steps stay on this device and do not change your calorie target. You can stop reading steps in Mizyun Settings or revoke access in Health Connect."
        textSize = 18f
      })
      addView(Button(this@HealthStepsPermissionsRationaleActivity).apply {
        text = "Read privacy policy"
        setOnClickListener {
          startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.phiskel.com/mizyun/privacy")))
        }
      })
    }
    setContentView(layout, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }
}
