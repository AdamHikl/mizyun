import type { CatalogExercise } from "./exercise-catalog";

/**
 * Mizyun-authored entries for activities the RepDB import lacks (#278).
 * They carry no RepDB `source`; content review is pending like the import.
 */
export const SUPPLEMENTAL_EXERCISE_CATALOG: readonly CatalogExercise[] = [
  {
    id: "exercise-swimming",
    name: "Swimming",
    movementPattern: "aerobic",
    equipment: ["bodyweight"],
    requiredEquipment: ["swimming pool or open water"],
    blockedBy: [],
    focusFit: ["balanced", "endurance"],
    primaryMuscles: ["lats", "front shoulders", "side shoulders"],
    secondaryMuscles: [
      "chest",
      "triceps",
      "glutes",
      "quadriceps",
      "abdominals",
    ],
    instructions: [
      "Choose a stroke you can swim comfortably, such as front crawl or breaststroke.",
      "Start with a few easy lengths to warm up before settling into your working pace.",
      "Keep your body long and close to the surface, and breathe out steadily while your face is in the water.",
      "Rest at the wall whenever you need to, and continue for the desired time or distance.",
      "Finish with an easy length or two before getting out.",
    ],
    category: "cardio",
    level: "beginner",
    mechanic: "compound",
    description:
      "Continuous or interval swimming in a pool or open water, working the whole body with low impact on the joints.",
    aliases: ["swim", "lap swimming", "pool swim"],
    tips: [
      "Swim where a lifeguard is present, or with a partner in open water.",
      "Count lengths or use the pool clock to track distance and time.",
    ],
    commonMistakes: [],
    contentReview: { status: "pending_professional", reviewedAt: null },
    demonstration: null,
  },
  {
    id: "exercise-outdoor-cycling",
    name: "Outdoor Cycling",
    movementPattern: "aerobic",
    equipment: ["bodyweight"],
    requiredEquipment: ["bicycle"],
    blockedBy: [],
    focusFit: ["balanced", "endurance"],
    primaryMuscles: ["quadriceps", "glutes"],
    secondaryMuscles: ["hamstrings", "calves"],
    instructions: [
      "Check your brakes and tyres, and wear a helmet.",
      "Set the saddle so your knee is only slightly bent at the bottom of each pedal stroke.",
      "Start in an easy gear for the first few minutes to warm up.",
      "Keep a steady cadence and shift gears to hold an effort you can sustain.",
      "Ride for the desired time or distance, then ease off for the last few minutes.",
    ],
    category: "cardio",
    level: "beginner",
    mechanic: "compound",
    description:
      "Riding a bicycle outdoors on roads or trails, a low-impact way to build leg endurance.",
    aliases: ["cycling", "road cycling", "biking"],
    tips: [
      "Follow local traffic rules and use lights in low light.",
      "Carry water on longer rides.",
    ],
    commonMistakes: [],
    contentReview: { status: "pending_professional", reviewedAt: null },
    demonstration: null,
  },
  {
    id: "exercise-hiking",
    name: "Hiking",
    movementPattern: "aerobic",
    equipment: ["bodyweight"],
    requiredEquipment: ["no equipment"],
    blockedBy: [],
    focusFit: ["balanced", "endurance"],
    primaryMuscles: ["quadriceps", "glutes"],
    secondaryMuscles: ["hamstrings", "calves", "abdominals"],
    instructions: [
      "Choose a route that suits your fitness and check the weather before you set out.",
      "Wear supportive footwear and carry water.",
      "Start at an easy pace and take shorter steps on steep sections.",
      "Keep a pace at which you can still hold a conversation, resting when needed.",
      "Continue for the desired time or distance.",
    ],
    category: "cardio",
    level: "beginner",
    mechanic: "compound",
    description:
      "Walking on trails or hilly terrain, building leg endurance with varied gradients.",
    aliases: ["hike", "trail walk"],
    tips: [
      "Tell someone your route on remote trails.",
      "Allow extra time for descents.",
    ],
    commonMistakes: [],
    contentReview: { status: "pending_professional", reviewedAt: null },
    demonstration: null,
  },
];
