import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { format } from "prettier";

// In-app use only. Do not expose this adapted content as a standalone dataset/API.
export const REPDB_SNAPSHOT_SHA256 =
  "b651511287cd7e9261158598bf0263c56c19d2403ad8b57f68426c9c99d17421";
const VERSION = "2026-10-04-schema-3";
const LICENSE =
  "https://github.com/RepDB/exercise-dataset/blob/main/LICENSE-DATA.md";

// Deliberate identity decisions, checked against the previous English instructions.
// Missing matches remain archived. Name similarity never migrates an identity.
const SAME_VARIANT_IDS = {
  "ab-wheel-rollout": "ab-roller",
  "bodyweight-squat": "bodyweight-squat",
  squat: "barbell-squat",
  "glute-bridge": "glute-bridge",
  "dumbbell-romanian-deadlift": "dumbbell-rdl",
  "romanian-deadlift": "barbell-rdl",
  "push-up": "push-up",
  "db-bench-press": "dumbbell-bench-press",
  "bench-press": "barbell-bench-press",
  "seated-cable-row": "seated-cable-row",
  "pike-push-ups": "pike-push-up",
  "pull-up": "pull-up",
  "dead-bug": "dead-bug",
  plank: "front-plank",
  "stationary-bike": "stationary-bike",
  "band-pull-apart": "band-pull-apart",
  "barbell-curl": "barbell-curl",
  "barbell-glute-bridge": "barbell-glute-bridge",
  "barbell-lunge": "barbell-lunge",
  "barbell-row": "bent-over-barbell-row",
  "bench-dips": "bench-dips",
  "bicep-curl": "dumbbell-bicep-curl",
  "cable-chest-press": "cable-chest-press",
  "cable-crunch": "cable-crunch",
  "cable-wrist-curl": "cable-wrist-curl",
  "cat-stretch": "cat-stretch",
  "childs-pose": "childs-pose",
  "cross-body-crunch": "cross-body-crunch",
  "cross-body-hammer-curl": "cross-body-hammer-curl",
  crunches: "crunches",
  "db-shrug": "dumbbell-shrug",
  deadlift: "barbell-deadlift",
  "decline-bench-press-barbell": "decline-barbell-bench-press",
  "decline-crunch": "decline-crunch",
  "decline-push-up": "decline-push-up",
  "deficit-deadlift": "deficit-deadlift",
  "drag-curl": "drag-curl",
  "dumbbell-floor-press": "dumbbell-floor-press",
  "dumbbell-side-bend": "dumbbell-side-bend",
  "flutter-kicks": "flutter-kicks",
  "glute-kickback": "glute-kickback",
  "good-morning": "good-morning",
  "hanging-leg-raise": "hanging-leg-raise",
  "hanging-pike": "hanging-pike",
  "hip-thrust": "barbell-hip-thrust",
  "incline-db-curl": "incline-dumbbell-curl",
  "incline-db-press": "incline-dumbbell-press",
  "incline-push-ups": "incline-push-up",
  "jackknife-sit-up": "jackknife-sit-up",
  "leg-press": "leg-press",
  "mountain-climbers": "mountain-climbers",
  "one-arm-lat-pulldown": "one-arm-lat-pulldown",
  "plate-pinch": "plate-pinch",
  "russian-twist": "russian-twist",
  "seated-dumbbell-curl": "seated-dumbbell-curl",
  "seated-leg-curl": "seated-leg-curl",
  shrug: "barbell-shrug",
  "single-leg-glute-bridge": "single-leg-glute-bridge",
  "straight-arm-pulldown": "straight-arm-pulldown",
  "sumo-deadlift": "sumo-deadlift",
  superman: "superman",
  "zottman-curl": "zottman-curl",
};

export const LEGACY_EXERCISE_ALIASES = {
  "romanian-deadlift": "barbell-rdl",
  plank: "front-plank",
};

const NAMES = {
  "bodyweight-overhead-press": "Pike shoulder press",
  "pike-push-ups": "Pike push-up",
  "box-squat": "Bodyweight box squat",
  "goblet-squat": "Kettlebell goblet squat",
  "db-kickstand-deadlift": "Single-dumbbell kickstand deadlift",
  "double-db-kickstand-deadlift": "Two-dumbbell kickstand deadlift",
  "db-overhead-carry": "Single-dumbbell overhead carry",
  "double-db-overhead-carry": "Two-dumbbell overhead carry",
  "decline-bench-press": "Decline dumbbell bench press",
  "bulgarian-split-squat": "Dumbbell Bulgarian split squat",
  "dumbbell-shoulder-press": "Dumbbell shoulder press",
  "leg-press": "Machine leg press",
  "stability-ball-push-up": "Stability-ball push-up (feet on ball)",
  plank: "Forearm plank",
  "single-arm-db-row": "Bench-supported single-arm dumbbell row",
  "romanian-deadlift": "Barbell Romanian deadlift",
  "front-squat": "Barbell front squat",
  "pause-squat": "Paused barbell back squat",
  "overhead-squat": "Barbell overhead squat",
  "sumo-squat": "Barbell sumo squat",
  "rear-delt-fly": "Bent-over dumbbell rear-delt fly",
  "lying-tricep-extension": "Lying dumbbell triceps extension",
  "overhead-tricep-extension": "Dumbbell overhead triceps extension",
  "skull-crusher": "Barbell skull crusher",
  "preacher-curl": "EZ-bar preacher curl",
  cocoons: "Knee-tuck crunch (cocoon)",
};

// Corrections are editorial preparation, not professional acceptance evidence.
const OVERRIDES = {
  "bodyweight-overhead-press": {
    description:
      "A pike push-up with hips raised, pressing through the hands to train the shoulders and upper arms.",
    instructions: [
      "Place your hands shoulder-width apart on the floor and raise your hips into an upside-down V, with enough space to move.",
      "Keep your feet on the floor and bend your knees slightly if needed to hold the raised-hip position.",
      "Bend your elbows and lower your head toward a point slightly in front of your hands, only as far as you can control.",
      "Press through your hands to straighten your arms, keeping your hips raised.",
      "After the last repetition, lower your knees to the floor before standing up.",
    ],
  },
  "banded-kneeling-hip-thrust": {
    description: "A kneeling hip extension with a band around the thighs.",
    instructions: [
      "Kneel on a padded surface with a loop band above your knees and your torso upright.",
      "Keep gentle outward pressure on the band and sit your hips back toward your heels.",
      "Squeeze your buttocks to bring your hips forward until your torso is upright, without arching your back.",
      "Return your hips backward with control, keeping your knees comfortably apart.",
      "After the set, release the band tension before removing it.",
    ],
  },
  "banded-fire-hydrant": {
    instructions: [
      "Place a loop band above your knees and start on hands and knees, with hands below shoulders and knees below hips.",
      "Tighten your abdomen and keep your back and pelvis steady.",
      "Keeping one knee bent, lift that leg out to the side only as far as you can without rotating your hips or leaning your trunk.",
      "Lower the knee with control and complete the other side.",
      "After the set, sit back and remove the band after releasing its tension.",
    ],
  },
  "hip-thrust": {
    instructions: [
      "Secure a stable bench against movement and sit with your upper back against its edge; position a padded barbell across the crease of your hips.",
      "Plant your feet flat and tighten your abdomen, holding the bar steady with both hands.",
      "Lift your hips until your trunk and thighs form a straight line, keeping your ribs down instead of arching your lower back.",
      "Lower your hips with control, keeping the bench and your feet steady.",
      "After the set, lower the weight fully and move out from under it with control.",
    ],
  },
  "goblet-squat": {
    instructions: [
      "Stand with your feet about shoulder-width apart, holding a kettlebell by its handles close to your chest.",
      "Tighten your abdomen and bend your hips and knees, keeping your knees moving in the same direction as your toes.",
      "Lower only as far as you can keep your feet planted and control your back position.",
      "Press through your whole feet to stand, keeping the weight close to your chest.",
      "After the last repetition, lower the kettlebell to the floor with control.",
    ],
    tips: [
      "Keep the kettlebell close instead of reaching it forward.",
      "Use a comfortable stance and depth; do not force your knees apart.",
    ],
  },
  "bench-press": {
    instructions: [
      "Set the rack height and safety supports before lifting; use a spotter when needed. Lie on the bench with your eyes under the bar and feet supported.",
      "Grip the bar slightly wider than shoulder-width with thumbs around it and wrists over your forearms.",
      "Lift the bar out of the rack and steady it above your chest, keeping your shoulder blades against the bench.",
      "Lower the bar toward the middle of your chest with control, using a range your shoulders can tolerate without bouncing.",
      "Press the bar upward to straight arms without forcing your elbows backward.",
      "After the final repetition, guide the bar back into both rack hooks and confirm it is secure before releasing your grip.",
    ],
  },
  squat: {
    instructions: [
      "Set the rack hooks below shoulder height and safety bars just below your controlled squat depth. Position the bar across your upper back, not your neck.",
      "Grip the bar firmly, tighten your abdomen, stand to unrack and take a few short steps back.",
      "With feet in a comfortable stance, bend your hips and knees while keeping your whole feet planted.",
      "Lower only as far as you can keep your trunk controlled and knees following the direction of your toes.",
      "Press through your whole feet to stand tall, without leaning backward at the top.",
      "Walk forward with control and settle the bar into both rack hooks before releasing it.",
    ],
  },
  "leg-press": {
    instructions: [
      "Adjust the leg-press seat and safety stops. Sit with your back and hips supported and both feet fully on the platform.",
      "Steady the platform before releasing the safety catches according to the machine instructions.",
      "Bend your hips and knees to lower the platform, stopping before your hips lift or your lower back rounds away from the seat.",
      "Press evenly through your whole feet to extend your legs without forcing your knees backward.",
      "After the last repetition, re-engage the catches and confirm the platform is secure before leaving the machine.",
    ],
  },
  "banded-good-morning": {
    instructions: [
      "Stand on a loop band with both feet and place its upper loop across your upper back, below your neck. Check that the band is intact and secure.",
      "Set your feet hip-width apart with a small bend in your knees and tighten your abdomen.",
      "Push your hips backward, keeping your back position controlled as your chest moves forward.",
      "Stop when you feel tension in the backs of your thighs, before your back starts to round.",
      "Press through your whole feet and bring your hips forward to stand; release the band tension before taking it off.",
    ],
  },
  running: {
    description: "Running on level ground to train aerobic endurance.",
    tips: [
      "Increase time or distance gradually and allow recovery between harder sessions.",
      "For an easy run, use a pace that lets you speak in short sentences.",
      "Keep your stride comfortable rather than reaching far ahead with each step.",
    ],
  },
  walking: {
    description: "Walking on level ground at a comfortable, steady pace.",
    tips: [
      "Choose a pace and distance that suit your current ability.",
      "Take comfortable steps without reaching far ahead of your body.",
      "Adjust the duration or take a break when you feel tired.",
    ],
  },
  "behind-the-neck-pull-ups": {
    tips: [
      "This advanced variant needs a separate technique review before publication.",
      "Do not make contact between the bar and your neck.",
    ],
  },
  "db-overhead-carry": {
    tips: [
      "Keep the weight steady over your shoulder without forcing the elbow backward.",
      "Use a clear walking area and a load you can lower with control.",
      "Keep your trunk upright instead of leaning sideways.",
    ],
  },
  "elliptical-trainer": {
    tips: [
      "Keep your feet supported on the pedals and use a comfortable stride.",
      "Stand upright without hanging your bodyweight from the handles.",
      "Begin at a manageable resistance and slow down before stepping off.",
    ],
  },
  "ez-bar-overhead-extension": {
    tips: [
      "Keep your upper arms steady while your elbows bend and straighten.",
      "Lower only through a range you can control without shoulder discomfort.",
      "Keep your abdomen tightened instead of arching your lower back.",
    ],
  },
  "plate-loaded-donkey-calf-raise": {
    tips: [
      "Use a controlled ankle range instead of forcing your heels as low as possible.",
      "Keep the balls of your feet securely supported on the platform.",
      "Do not bounce at the bottom of the movement.",
    ],
  },
  "stability-ball-wall-squat": {
    tips: [
      "Keep your whole feet planted and your knees following your toes.",
      "Use a depth that lets you keep the ball and your body controlled.",
      "Your knees can move forward over your toes; do not force a fixed shin angle.",
    ],
  },
  "banded-clamshell": {
    tips: [
      "Keep your hips stacked instead of rolling backward as the knee opens.",
      "Choose a band that permits slow, controlled movement.",
      "Stop and relax if you develop cramping or discomfort.",
    ],
  },
  "rack-pull": {
    description:
      "A partial-range barbell deadlift starting from supports in a rack.",
    tips: [
      "Set both supports at the same height and keep the bar close to your legs.",
      "Choose a load that lets you control your trunk throughout the lift.",
      "Stand tall without leaning back at the top.",
    ],
  },
  "rope-climb": {
    tips: [
      "Use an appropriate climbing rope, a clear landing area and qualified instruction before attempting this advanced exercise.",
      "Practise a secure foot hold close to the floor before climbing higher.",
      "Descend with control; do not slide down or drop from the rope.",
    ],
  },
  "dumbbell-pistol-squat": {
    instructions: [
      "Stand on one leg and hold a light dumbbell close to your chest; keep the other foot off the floor.",
      "Bend your standing knee and hip, lowering only as far as you can maintain balance and control.",
      "Keep the raised leg clear of the floor and the standing foot planted.",
      "Press through the whole standing foot to return upright, then complete the other side.",
      "After the set, place both feet down and lower the dumbbell with control.",
    ],
  },
  "smith-machine-reverse-lunge": {
    instructions: [
      "Set the Smith machine safety stops and position the bar across your upper back, below your neck.",
      "Unrack the bar with feet in a comfortable stance, then step one foot backward.",
      "Bend both knees to lower through a comfortable range, keeping the front foot planted and your trunk controlled.",
      "Press through the whole front foot to stand and bring the rear foot forward.",
      "Complete the other side; re-engage the hooks and confirm the bar is secure before leaving.",
    ],
  },
  "smith-machine-split-squat": {
    instructions: [
      "Set the Smith machine safety stops and position the bar across your upper back, below your neck.",
      "Unrack the bar and take a split stance with both feet in a stable position.",
      "Bend both knees to lower through a range you can control, keeping the front foot planted.",
      "Press through your whole front foot to return upright without stepping between repetitions.",
      "Complete the other side; re-engage the hooks and confirm the bar is secure before leaving.",
    ],
  },
};

const COMMON_MISTAKES = {
  "bodyweight-squat": [
    "Letting the heels lift as you lower.",
    "Forcing a depth that makes your back position change.",
  ],
  squat: [
    "Letting your knees collapse inward.",
    "Leaning backward at the top.",
    "Releasing the bar before both rack hooks support it.",
  ],
  "goblet-squat": [
    "Holding the kettlebell far away from your chest.",
    "Forcing your knees apart instead of letting them follow your toes.",
  ],
  "bench-press": [
    "Bouncing the bar off your chest.",
    "Bending your wrists backward under the bar.",
    "Releasing the bar before checking both rack hooks.",
  ],
  "db-bench-press": [
    "Lowering the weights farther than you can control.",
    "Letting your wrists bend backward under the weights.",
  ],
  "romanian-deadlift": [
    "Bending from your lower back instead of moving your hips backward.",
    "Reaching lower after your back position starts to change.",
  ],
  "dumbbell-romanian-deadlift": [
    "Letting the dumbbells drift away from your legs.",
    "Reaching lower after your back position starts to change.",
  ],
  "pike-push-ups": [
    "Dropping your hips during the press.",
    "Resting your bodyweight on your head.",
  ],
  "bodyweight-overhead-press": [
    "Dropping your hips during the press.",
    "Resting your bodyweight on your head.",
  ],
  plank: [
    "Letting your hips sag toward the floor.",
    "Holding your breath throughout the hold.",
  ],
  "hip-thrust": [
    "Arching your lower back to lift the weight higher.",
    "Using a bench that can slide or tip.",
  ],
  "leg-press": [
    "Lowering until your hips lift from the seat.",
    "Forcing your knees backward at the top.",
  ],
};

const MUSCLES = {
  rectus_abdominis: "abdominals",
  transverse_abdominis: "abdominals",
  anterior_deltoid: "front shoulders",
  lateral_deltoid: "side shoulders",
  posterior_deltoid: "rear shoulders",
  latissimus_dorsi: "lats",
  gluteus_maximus: "glutes",
  gluteus_medius: "side glutes",
  pectoralis_major: "chest",
  biceps_brachii: "biceps",
  triceps_brachii: "triceps",
  erector_spinae: "lower back",
  gastrocnemius: "calves",
  soleus: "calves",
  trapezius: "traps",
  quadratus_lumborum: "lower back",
  forearm_flexors: "forearms",
  forearm_extensors: "forearms",
  brachioradialis: "forearms",
};

function distinct(items) {
  return [...new Set(items)];
}

function editorialText(text, id, role) {
  let value = text.trim().replace(/\s+/g, " ");
  // Correct recurring absolute-depth and heel-only cues; calf raises legitimately
  // move on the balls of the feet, so their ankle instructions are left intact.
  if (!/calf|ball-leg-curl/.test(id)) {
    value = value.replace(
      /through (your |the |the front |your front )?heels?/gi,
      "through your whole foot",
    );
  }
  if (/squat|lunge|leg-press|wall-sit/.test(id)) {
    value = value.replace(
      /until (your |the |both )?(front )?thighs? (are|is) (at least )?parallel( to (the )?(floor|platform))?( or (below|lower))?/gi,
      "through a depth you can control with your feet planted and trunk steady",
    );
    value = value.replace(
      /until (both )?knees (form|reach)( about| around)? 90-degree angles/gi,
      "through a comfortable, controlled range",
    );
    value = value.replace(
      /until (both )?knees (reach|are)( about| around)? 90 degrees/gi,
      "through a comfortable, controlled range",
    );
    value = value.replace(
      /until both knees are bent at approximately 90 degrees/gi,
      "through a comfortable, controlled range",
    );
    value = value.replace(
      /Stop when (your |the )?(front )?thighs? (are|is) parallel to the floor\./gi,
      "Stop at a depth you can control without losing your foot or trunk position.",
    );
  }
  value = value.replace(
    /lowering (the dumbbell|both dumbbells|the kettlebell) toward mid-shin/gi,
    "lowering $1 only as far as you can keep your back position controlled",
  );
  value = value.replace(
    /Lower your heels as far as possible\./gi,
    "Lower your heels through a comfortable ankle range without bouncing.",
  );
  value = value.replace(
    /a deep (hamstring|calf|triceps?|lat and pec|lat|pec) stretch/gi,
    "a comfortable $1 stretch",
  );
  value = value.replace(
    /as deep as possible/gi,
    "through a range you can control",
  );
  value = value
    .replace(/eccentric \(lowering\) phase/gi, "lowering movement")
    .replace(/the eccentric/gi, "the lowering movement");
  value = value
    .replace(/quadruped position/gi, "position on hands and knees")
    .replace(/supine /gi, "lying face-up ");
  if (role === "description") {
    value = value.replace(
      /,? (for better knee stability( than a forward lunge)?|reducing shoulder impingement risk while building pressing strength)/gi,
      "",
    );
    value = value.replace(
      /wrist-friendlier than the straight barbell version while keeping the deep lat and pec stretch/gi,
      "using an angled grip",
    );
    value = value
      .replace(/wrist-friendly/gi, "angled")
      .replace(
        /shoulder-friendly and a great home option/gi,
        "an option with a shorter lowering range",
      );
    value = value.replace(
      /,? improving shoulder health and posture by strengthening the upper back/gi,
      "",
    );
    value = value.replace(/ and improved shoulder health/gi, "");
    value = value.replace(
      / — a staple warm-up and rehab drill for hip stability/gi,
      "",
    );
    value = value.replace(/, often used for VMO and knee rehab/gi, "");
    value = value.replace(
      /, which reduces shoulder strain and makes it a good home-gym or prehab option/gi,
      "",
    );
    value = value.replace(/ to maximize chest activation/gi, "");
  }
  if (role === "tips") {
    if (
      /muscle damage|not optional|Almost every running injury|without needing to recover|disengages|cramp.*exactly|deeper.*better|cuts the glutes out|wastes the setup|allow loads well above|makes it more shoulder-friendly|thumbless|doubles your work capacity|only thing that stops|widely discouraged|no benefit here/.test(
        value,
      )
    )
      return null;
    value = value.replace(
      /to protect (your |the )?(shoulders|lower back|spine|elbows|elbow tendons|biceps tendon|lumbar spine)/gi,
      "to keep the movement controlled",
    );
    value = value.replace(
      /to prevent (wrist|lower back) strain/gi,
      "while keeping the movement controlled",
    );
    value = value.replace(
      /to reduce shoulder impingement risk/gi,
      "and use a range you can control",
    );
    value = value.replace(
      /to maximi[sz]e (muscle engagement|glute activation|the contraction|contraction|time under tension|triceps activation|triceps engagement|lat tension throughout the range)/gi,
      "with control",
    );
    value = value.replace(/; this is a high-rep prehab exercise/gi, "");
  }
  return value;
}

function equipmentFor(x, instructions) {
  // Editorial corrections can remove an erroneous support requirement. Use the
  // displayed steps for support detection while retaining the source's explicit
  // equipment key and requirements tags.
  const text = instructions.join(" ").toLowerCase();
  const exact = x.equipment ? [x.equipment.replaceAll("_", " ")] : [];
  const coarse = [];
  const simple = {
    dumbbell: "dumbbells",
    barbell: "barbell",
    flat_bench: "bench",
    resistance_band: "resistance_bands",
    loop_band: "resistance_bands",
    pull_up_bar: "pullup_bar",
    cable: "cable_machine",
  };
  if (x.equipment)
    coarse.push(
      simple[x.equipment] ??
        (/bike|elliptical|treadmill|rower|ski_erg|stair_climber/.test(
          x.equipment,
        )
          ? "cardio_machine"
          : "full_gym"),
    );
  if (
    /bench|requires_bench/.test(text) ||
    (x.tags ?? []).includes("requires_bench")
  ) {
    exact.push(
      /preacher/.test(text)
        ? "preacher bench"
        : /incline/.test(text)
          ? "incline bench"
          : /decline/.test(text)
            ? "decline bench"
            : "stable bench or specified support",
    );
    coarse.push("bench");
  }
  if (
    /power rack|safety pins|barbell (across|on|resting on) (your |the )?upper back/.test(
      text,
    ) ||
    (x.equipment === "barbell" &&
      /squat|bench-press|ohp|overhead-press/.test(x.id))
  ) {
    exact.push("rack with appropriate safety supports");
    coarse.push("rack");
  }
  if (
    /anchor|fixed point|secure.*band/.test(text) &&
    /band|rope|suspension/.test(x.equipment ?? "")
  ) {
    exact.push("secure anchor suitable for the equipment");
  }
  if (!x.equipment) {
    if (/captains-chair/.test(x.id)) {
      exact.push("captain's chair station");
      coarse.push("full_gym");
    } else if (/hyperextension bench/.test(text)) {
      exact.push("hyperextension bench");
      coarse.push("full_gym");
    } else if (/box|platform|elevated surface|parallettes/.test(text)) {
      exact.push("stable raised platform or specified support");
      coarse.push("full_gym");
    } else if (/wall|doorway/.test(text))
      exact.push(/doorway/.test(text) ? "stable doorway" : "clear wall space");
  }
  if (/^band-assisted-pull-ups$/.test(x.id)) {
    exact.push("secure pull-up bar");
    coarse.push("pullup_bar");
  }
  if (/landmine/.test(x.id)) {
    exact.push("secured landmine attachment");
    coarse.push("full_gym");
  }
  if (/weighted-(dips|pull-up)/.test(x.id)) {
    exact.push("dip belt and weight plates");
    coarse.push("full_gym");
  }
  if (!coarse.length) coarse.push("bodyweight");
  if (!exact.length) exact.push("no equipment");
  return { equipment: distinct(coarse), requiredEquipment: distinct(exact) };
}

function movementFor(x) {
  if (x.category === "stretching") return "mobility";
  if (x.category === "cardio") return "aerobic";
  if (x.body_part === "core") return "core";
  if (
    /deadlift|good-morning|hip-thrust|glute-bridge|clean|snatch|swing|leg-curl|kickback|back-extension/.test(
      x.id,
    )
  )
    return "hip_hinge";
  if (/squat|lunge|leg-press|leg-extension|step-up|jump/.test(x.id))
    return "knee_dominant";
  if (/pull-up|pull-ups|chin-up|pulldown|muscle-up|rope-climb/.test(x.id))
    return "vertical_pull";
  if (
    /overhead|shoulder-press|ohp|arnold|handstand|pike-push|push-press|jerk|landmine|thruster/.test(
      x.id,
    )
  )
    return "vertical_push";
  if (/row|face-pull|reverse-fly|rear-delt|pull-apart/.test(x.id))
    return "horizontal_pull";
  if (x.force_type === "pull") return "horizontal_pull";
  if (x.force_type === "push") return "horizontal_push";
  return "core";
}

function limitationsFor(x, movement) {
  const blocked = [];
  const text = `${x.id} ${x.instructions_en.join(" ")}`.toLowerCase();
  if (/running|high-knees|heel-flicks/.test(x.id))
    blocked.push("no_running", "low_impact_only");
  if (/jump|plyo|burpee|clap-push/.test(x.id))
    blocked.push("no_jumping", "low_impact_only");
  if (
    ["vertical_push", "vertical_pull"].includes(movement) ||
    /overhead|above (your |the )?head/.test(text)
  )
    blocked.push("no_overhead_work");
  if (
    /squat|lunge|leg-press|leg-extension|step-up|leg-curl|mountain-climber/.test(
      x.id,
    )
  )
    blocked.push("limited_knee_flexion");
  if (
    /barbell|dumbbell|kettlebell|ez_bar|trap_bar/.test(x.equipment ?? "") &&
    ["hip_hinge", "knee_dominant", "vertical_push"].includes(movement)
  )
    blocked.push("limited_spinal_loading");
  return distinct(blocked);
}

export function adaptExerciseSnapshot(snapshot) {
  if (
    snapshot.schema_version !== 3 ||
    snapshot.count !== 609 ||
    snapshot.exercises?.length !== 609
  )
    throw new Error(
      "Expected the pinned RepDB free schema-3 snapshot with 609 entries.",
    );
  const sourceIds = new Set();
  const records = snapshot.exercises.map((x) => {
    if (
      typeof x.id !== "string" ||
      !/^[a-z0-9-]+$/.test(x.id) ||
      sourceIds.has(x.id)
    )
      throw new Error("Invalid or duplicate source exercise ID.");
    sourceIds.add(x.id);
    for (const field of ["instructions_en", "tips_en"])
      if (
        !Array.isArray(x[field]) ||
        !x[field].length ||
        x[field].some((s) => typeof s !== "string" || !s.trim())
      )
        throw new Error(`Missing English content for ${x.id}.`);
    if (
      typeof x.name_en !== "string" ||
      !x.name_en.trim() ||
      typeof x.description_en !== "string" ||
      !x.description_en.trim()
    )
      throw new Error(`Missing English name/description for ${x.id}.`);
    const patch = OVERRIDES[x.id] ?? {};
    const id = SAME_VARIANT_IDS[x.id] ?? `exercise-${x.id}`;
    const name =
      NAMES[x.id] ??
      x.name_en
        .replace(/\bTricep\b/g, "Triceps")
        .replace(/\bBicep\b/g, "Biceps")
        .replace(/Push Ups/g, "Push-Ups")
        .replace(/Pull Ups/g, "Pull-Ups");
    const movementPattern = movementFor(x);
    let instructions = (patch.instructions ?? x.instructions_en)
      .map((s) => editorialText(s, x.id, "instructions"))
      .filter(Boolean);
    const tips = (patch.tips ?? x.tips_en)
      .map((s) => editorialText(s, x.id, "tips"))
      .filter(Boolean)
      .slice(0, 3);
    // Remove an unhelpful repeat-only final instruction, leaving actual return
    // instructions intact; add a finish cue suitable for the movement family.
    if (/^repeat\b/i.test(instructions.at(-1) ?? "")) instructions.pop();
    // Longer source setup sequences become one numbered setup step, retaining
    // every cue rather than dropping the final return or change-of-side step.
    while (instructions.length > 6)
      instructions.splice(0, 2, `${instructions[0]} ${instructions[1]}`);
    if (
      instructions.length < 6 &&
      !/after (the |your )?(last|final)|exit|come out|finish|step off|lower your knees|release.*tension|secure|rack hooks/i.test(
        instructions.at(-1) ?? "",
      )
    ) {
      instructions.push(
        x.category === "stretching"
          ? "Release the stretch slowly and return to a comfortable resting position."
          : x.category === "cardio"
            ? "Slow down gradually before ending the session or stepping off the equipment."
            : !x.equipment
              ? "After the set, return to a stable resting position with control."
              : "Finish the set with control and secure or set down the equipment before changing position.",
      );
    }
    return {
      id,
      name,
      movementPattern,
      ...equipmentFor(x, instructions),
      blockedBy: limitationsFor(x, movementPattern),
      focusFit:
        x.category === "stretching"
          ? ["balanced"]
          : x.category === "cardio"
            ? ["balanced", "endurance"]
            : [
                "balanced",
                ...distinct(
                  (x.goals ?? []).filter((g) =>
                    ["strength", "hypertrophy", "endurance"].includes(g),
                  ),
                ),
              ],
      primaryMuscles: distinct(
        (x.primary_muscles ?? []).map(
          (m) => MUSCLES[m] ?? m.replaceAll("_", " "),
        ),
      ),
      secondaryMuscles: distinct(
        (x.secondary_muscles ?? []).map(
          (m) => MUSCLES[m] ?? m.replaceAll("_", " "),
        ),
      ),
      instructions,
      category: x.category === "olympic" ? "olympic weightlifting" : x.category,
      level: x.difficulty === "advanced" ? "expert" : x.difficulty,
      mechanic: x.mechanic ?? null,
      description: editorialText(
        patch.description ?? x.description_en,
        x.id,
        "description",
      ),
      aliases: distinct(
        [
          x.name_en,
          ...(/romanian-deadlift|rdl/.test(x.id)
            ? [
                x.equipment === "dumbbell"
                  ? "DB RDL"
                  : x.equipment === "barbell"
                    ? "Barbell RDL"
                    : `${name} RDL`,
              ]
            : []),
          ...(x.id === "db-bench-press"
            ? ["DB bench", "Dumbbell chest press"]
            : []),
          ...(x.id === "pec-deck" ? ["Pec deck fly"] : []),
          ...(x.id === "bodyweight-overhead-press"
            ? ["Bodyweight overhead press", "Pike push-up"]
            : []),
        ].filter((a) => a !== name),
      ),
      tips,
      commonMistakes: COMMON_MISTAKES[x.id] ?? [],
      source: {
        provider: "repdb",
        exerciseId: x.id,
        version: VERSION,
        licenseUrl: LICENSE,
      },
      contentReview: { status: "pending_professional", reviewedAt: null },
      demonstration: null,
    };
  });
  if (new Set(records.map((x) => x.id)).size !== records.length)
    throw new Error(
      "Stable IDs collided; explicit variant review is required.",
    );
  return records;
}

export function renderCatalogModule(records) {
  return `// Adapted RepDB Free content for use inside Mizyun only.\n// Credit: Exercise data by RepDB (https://repdb.co).\n// License: ${LICENSE}\n// Snapshot SHA256: ${REPDB_SNAPSHOT_SHA256}; editorial preparation, professional review pending.\n// Generated with scripts/import-exercise-catalog.mjs. Do not manually edit.\nimport type { CatalogExercise } from "./exercise-catalog";\n\nexport const REPDB_EXERCISE_CATALOG: readonly CatalogExercise[] = ${JSON.stringify(records, null, 2)};\n\n// Lookup aliases only: persisted workout/history IDs must never be rewritten.\nexport const LEGACY_EXERCISE_ALIASES: Readonly<Record<string, string>> = ${JSON.stringify(LEGACY_EXERCISE_ALIASES, null, 2)};\n`;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      "Usage: node scripts/import-exercise-catalog.mjs <local-source.json> <output.ts>",
    );
  const bytes = await readFile(input);
  if (
    createHash("sha256").update(bytes).digest("hex") !== REPDB_SNAPSHOT_SHA256
  )
    throw new Error(
      "Source checksum differs from the reviewed snapshot. Review and pin a new version before importing.",
    );
  const records = adaptExerciseSnapshot(JSON.parse(bytes.toString("utf8")));
  await writeFile(
    output,
    await format(renderCatalogModule(records), { parser: "typescript" }),
  );
  console.log(
    JSON.stringify({
      source: records.length,
      unique: new Set(records.map((x) => x.id)).size,
      professionalAccepted: 0,
      stableIdsReused: records.filter((x) => !x.id.startsWith("exercise-"))
        .length,
      explicitLookupAliases: Object.keys(LEGACY_EXERCISE_ALIASES).length,
      noMediaImported: true,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
