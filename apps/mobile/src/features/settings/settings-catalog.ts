/**
 * Settings catalog definitions and static metadata.
 *
 * Defines all available Account settings destinations, metadata, aliases,
 * intent phrases, and availability rules for navigation and local search.
 * Search must inspect metadata only; it never renders hidden cards or executes mutations.
 */

export type SettingsCategoryId =
  | "profile-goals"
  | "workouts-reminders"
  | "appearance"
  | "health-connections"
  | "ai-coach"
  | "privacy-data"
  | "account-help";

export interface SettingsCategoryDefinition {
  readonly id: SettingsCategoryId;
  readonly title: string;
  readonly shortDescription: string;
  readonly icon: string;
  readonly exampleItems: readonly string[];
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryDefinition[] = [
  {
    id: "profile-goals",
    title: "Profile & goals",
    shortDescription: "Personal details, targets, food standards & progress",
    icon: "👤",
    exampleItems: [
      "Personal details",
      "Units",
      "Goal & target pace",
      "Energy targets",
      "Regional food standards",
      "Body progress",
      "Progress photos",
    ],
  },
  {
    id: "workouts-reminders",
    title: "Workouts & reminders",
    shortDescription:
      "Rest timer, progression, coach check-ins & notifications",
    icon: "⏱️",
    exampleItems: [
      "Rest timer & alerts",
      "Auto-advance target weights",
      "Coach reminders",
      "First-meal reminder",
      "Evening catch-up reminder",
      "Evening stretch reminder",
      "Weekly calorie check-in",
      "Weigh-in reminder",
    ],
  },
  {
    id: "appearance",
    title: "Appearance",
    shortDescription: "Theme display: System, Light, or Dark",
    icon: "🎨",
    exampleItems: ["Theme (System, Light, Dark)"],
  },
  {
    id: "health-connections",
    title: "Health connections",
    shortDescription: "Steps sync from Apple Health or Health Connect",
    icon: "👟",
    exampleItems: ["Steps from Apple Health / Health Connect"],
  },
  {
    id: "ai-coach",
    title: "AI coach",
    shortDescription: "Coaching style, AI model usage, and shared coach memory",
    icon: "💬",
    exampleItems: [
      "Coaching preferences",
      "AI usage & Launch Pro Pass",
      "Coach memory",
      "AI data consent",
    ],
  },
  {
    id: "privacy-data",
    title: "Privacy & data",
    shortDescription:
      "Memory, analytics, data export, account deletion & privacy policy",
    icon: "🛡️",
    exampleItems: [
      "Coach memory",
      "AI data consent",
      "Product analytics",
      "Export account data",
      "Delete account",
      "Privacy policy",
    ],
  },
  {
    id: "account-help",
    title: "Account & help",
    shortDescription: "Sign-in, identity details, support, terms & sign out",
    icon: "🔑",
    exampleItems: [
      "Sign-in & security",
      "Account information",
      "Feedback & support",
      "Terms & medical advisory",
      "Sign out",
    ],
  },
] as const;

export type SettingsAvailabilityRule =
  | "always"
  | "progress-photos"
  | "signed-in"
  | "health-exports"
  | "health-preview"
  | "has-profile"
  | "incomplete-setup";

export interface SettingsAvailabilityContext {
  readonly isSignedIn: boolean;
  readonly hasProfile: boolean;
  readonly isProgressPhotosEnabled: boolean;
  readonly isSetupComplete: boolean;
  readonly isHealthPreviewEnabled?: boolean;
}

export type SettingsTargetType = "setting-detail" | "external-route" | "action";

export interface SettingsCatalogItem {
  /** Unique identifier for the catalog item */
  readonly id: string;
  /**
   * Canonical destination key for deduplication and detail routing.
   * Multiple entries (e.g. coach-memory under AI Coach and Privacy) share the same destinationId.
   */
  readonly destinationId: string;
  /** Primary user-facing label */
  readonly label: string;
  /** Short descriptive summary */
  readonly description: string;
  /** Category */
  readonly categoryId: SettingsCategoryId;
  /** User-friendly category title */
  readonly categoryLabel: string;
  /** User-facing breadcrumb path, e.g. "Account → Appearance" */
  readonly breadcrumb: string;
  /** Alternative names and synonyms */
  readonly aliases: readonly string[];
  /** Common natural language intent phrases people describe */
  readonly intentPhrases: readonly string[];
  /** How the target is reached */
  readonly targetType: SettingsTargetType;
  /** Key for settings-detail screen when targetType is "setting-detail" */
  readonly settingDetailKey?: string;
  /** Anchor inside the editor for scrolling/focusing */
  readonly anchorId?: string;
  /** Route path when targetType is "external-route" */
  readonly targetRoute?: string;
  /** Action identifier when targetType is "action" */
  readonly actionId?: "sign-out" | "open-onboarding";
  /** Rule governing visibility */
  readonly availabilityRule: SettingsAvailabilityRule;
  /** Additional search keywords */
  readonly keywords?: readonly string[];
}

export const SETTINGS_CATALOG: readonly SettingsCatalogItem[] = [
  // ── Profile & goals ──
  {
    id: "profile-personal-details",
    destinationId: "profile",
    label: "Personal & physical details",
    description: "Name, birth date, biological sex, and height",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "personal details",
      "profile details",
      "my profile",
      "edit profile",
      "height",
      "birthday",
      "sex",
      "gender",
      "age",
    ],
    intentPhrases: [
      "change my name",
      "update my height",
      "change my birthday",
      "edit my physical details",
      "how tall am i",
    ],
    targetType: "setting-detail",
    settingDetailKey: "profile",
    availabilityRule: "has-profile",
  },
  {
    id: "profile-units",
    destinationId: "profile",
    label: "Units of measurement",
    description: "Metric (kg, cm) or Imperial (lb, in)",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "units",
      "unit system",
      "metric",
      "imperial",
      "kilograms",
      "pounds",
      "centimeters",
      "inches",
      "kg",
      "lb",
    ],
    intentPhrases: [
      "pounds instead of kilos",
      "change kg to lb",
      "switch to pounds",
      "switch to kilograms",
      "change to imperial",
      "change to metric",
      "change measurement units",
      "weight in pounds",
      "weight in kg",
      "height in feet",
    ],
    targetType: "setting-detail",
    settingDetailKey: "profile",
    anchorId: "units",
    availabilityRule: "has-profile",
    keywords: ["measurement", "lbs", "kilos", "feet", "inches", "cm", "scale"],
  },
  {
    id: "goal-pace",
    destinationId: "goal",
    label: "Goal & target pace",
    description:
      "Calorie deficit or surplus, target weight, and weekly rate of change",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "goal",
      "target weight",
      "weekly pace",
      "deficit",
      "surplus",
      "maintenance",
      "weight loss speed",
      "bulk",
      "cut",
    ],
    intentPhrases: [
      "lose weight more slowly",
      "lose weight faster",
      "change my target weight",
      "change weekly goal",
      "adjust calorie deficit",
      "gain muscle pace",
      "switch to maintenance",
      "update weight goal",
    ],
    targetType: "setting-detail",
    settingDetailKey: "goal",
    availabilityRule: "has-profile",
    keywords: [
      "diet goal",
      "rate of loss",
      "weekly pace",
      "target kilograms",
      "target pounds",
    ],
  },
  {
    id: "logging-goal",
    destinationId: "goal",
    label: "Weekly logging goal",
    description:
      "Choose how many days a week you aim to log meals, or hide the dashboard card",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "weekly logging goal",
      "days logged this week",
      "logging goal",
      "logging card",
    ],
    intentPhrases: [
      "change how many days I log",
      "hide the weekly logging card",
      "stop showing days logged",
      "log fewer days a week",
    ],
    targetType: "setting-detail",
    settingDetailKey: "goal",
    anchorId: "logging-goal",
    availabilityRule: "has-profile",
    keywords: ["habit", "consistency", "weekly", "dashboard card", "hide"],
  },
  {
    id: "energy-targets",
    destinationId: "energy-setup",
    label: "Energy targets",
    description:
      "Daily calorie target, macro split (protein, carbs, fats), and BMR calculations",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "calories",
      "energy",
      "macros",
      "macronutrients",
      "protein target",
      "calorie budget",
      "bmr",
      "tdee",
    ],
    intentPhrases: [
      "change calorie target",
      "adjust my macros",
      "set protein goal",
      "recalculate calories",
      "change daily calorie budget",
      "how many calories per day",
    ],
    targetType: "external-route",
    targetRoute: "/energy-setup",
    availabilityRule: "has-profile",
    keywords: ["carbohydrates", "fats", "nutrition targets", "calorie limit"],
  },
  {
    id: "regional-food-standards",
    destinationId: "food-standards",
    label: "Regional food standards",
    description:
      "Country food database conventions and energy labeling standards",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "food standards",
      "country standards",
      "regional standards",
      "food database region",
      "nutrition facts region",
      "slovakia",
      "eu",
      "usa",
    ],
    intentPhrases: [
      "change country for food",
      "change food database region",
      "regional nutrition standards",
      "slovak food standards",
    ],
    targetType: "setting-detail",
    settingDetailKey: "food-standards",
    availabilityRule: "has-profile",
  },
  {
    id: "body-progress",
    destinationId: "body",
    label: "Body progress trends",
    description:
      "Weight history, trend lines, body measurements, and rate of change",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "body history",
      "weight trends",
      "measurements",
      "progress chart",
      "weight graph",
    ],
    intentPhrases: [
      "see weight history",
      "body progress chart",
      "view weight graph",
      "check body trends",
    ],
    targetType: "external-route",
    targetRoute: "/body",
    availabilityRule: "always",
  },
  {
    id: "progress-photos",
    destinationId: "progress-photos",
    label: "Progress photos",
    description: "Visual transformation timeline and comparison photos",
    categoryId: "profile-goals",
    categoryLabel: "Profile & goals",
    breadcrumb: "Account → Profile & goals",
    aliases: [
      "photos",
      "progress pictures",
      "body photos",
      "physique photos",
      "transformation photos",
    ],
    intentPhrases: [
      "look at progress photos",
      "take progress photo",
      "view my photos",
      "physique timeline",
    ],
    targetType: "external-route",
    targetRoute: "/progress-photos",
    availabilityRule: "progress-photos",
  },

  // ── Workouts & reminders ──
  {
    id: "rest-timer",
    destinationId: "workout",
    label: "Rest timer & workout alerts",
    description:
      "Default rest duration, sound, vibration, and auto-start preferences",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "rest timer",
      "workout timer",
      "rest duration",
      "timer sound",
      "timer vibration",
      "rest alert",
      "auto start timer",
    ],
    intentPhrases: [
      "timer takes too long",
      "stop rest timer sound",
      "change rest time",
      "longer rest between sets",
      "shorter rest between sets",
      "turn off rest timer beep",
      "mute rest timer",
      "vibrate when rest ends",
      "stop notifications",
    ],
    targetType: "setting-detail",
    settingDetailKey: "workout",
    anchorId: "rest-timer",
    availabilityRule: "signed-in",
    keywords: [
      "countdown",
      "inter-set rest",
      "audio alert",
      "haptics",
      "workout chime",
    ],
  },
  {
    id: "weight-progression",
    destinationId: "workout",
    label: "Auto-advance target weights",
    description:
      "Automatically increase planned workout weights when target reps are completed",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "weight progression",
      "progressive overload",
      "auto advance",
      "increase weight",
      "lift heavier",
      "auto target weight",
    ],
    intentPhrases: [
      "auto advance weight",
      "automatically increase weights",
      "progressive overload setting",
      "stop increasing workout weights",
      "turn off auto advance",
    ],
    targetType: "setting-detail",
    settingDetailKey: "workout",
    anchorId: "weight-progression",
    availabilityRule: "signed-in",
    keywords: [
      "overload",
      "rep completion",
      "planned weight",
      "exercise progression",
    ],
  },
  {
    id: "coach-reminders",
    destinationId: "reminders",
    label: "Coach push reminders",
    description:
      "Daily coaching check-ins and weekly progress review notifications",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "coach reminders",
      "daily check-in reminder",
      "weekly reminder",
      "push reminders",
      "coach notifications",
    ],
    intentPhrases: [
      "stop daily reminder",
      "change reminder time",
      "turn off coach notifications",
      "stop notifications",
      "remind me to check in",
      "weekly summary notification",
    ],
    targetType: "setting-detail",
    settingDetailKey: "reminders",
    anchorId: "coach-reminders",
    availabilityRule: "signed-in",
  },
  {
    id: "first-meal-reminder",
    destinationId: "reminders",
    label: "First-meal reminder",
    description:
      "Morning prompt to log breakfast or your first meal of the day",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "first meal reminder",
      "breakfast reminder",
      "morning meal notification",
      "morning reminder",
    ],
    intentPhrases: [
      "remind me to eat breakfast",
      "breakfast reminder",
      "first meal alert",
      "morning food reminder",
      "stop breakfast notification",
      "stop notifications",
    ],
    targetType: "setting-detail",
    settingDetailKey: "reminders",
    anchorId: "first-meal",
    availabilityRule: "signed-in",
  },
  {
    id: "evening-catch-up-reminder",
    destinationId: "reminders",
    label: "Evening catch-up reminder",
    description:
      "Evening prompt to finish logging meals or review remaining calorie targets",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "evening reminder",
      "catch up reminder",
      "dinner reminder",
      "night reminder",
      "end of day reminder",
    ],
    intentPhrases: [
      "stop evening reminders",
      "turn off dinner reminder",
      "remind me to finish logging",
      "evening check in notification",
      "stop notifications",
    ],
    targetType: "setting-detail",
    settingDetailKey: "reminders",
    anchorId: "evening-catch-up",
    availabilityRule: "signed-in",
  },
  {
    id: "evening-stretch-reminder",
    destinationId: "reminders",
    label: "Evening stretch reminder",
    description:
      "Evening reminder on training days that opens a short stretch built from today's workouts",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "stretch reminder",
      "stretching",
      "cool down",
      "mobility reminder",
      "flexibility",
    ],
    intentPhrases: [
      "remind me to stretch",
      "stop stretch reminders",
      "change stretch reminder time",
      "turn off stretching notification",
    ],
    targetType: "setting-detail",
    settingDetailKey: "reminders",
    anchorId: "evening-stretch",
    availabilityRule: "signed-in",
  },

  {
    id: "weekly-review-reminder",
    destinationId: "reminders",
    label: "Weekly calorie check-in",
    description:
      "Monday reminder to review and accept or decline a calorie target adjustment",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "weekly check in",
      "weekly review",
      "calorie review",
      "calorie adjustment reminder",
    ],
    intentPhrases: [
      "remind me to review my calories",
      "stop weekly calorie reminder",
      "weekly calorie check in notification",
      "adjust my calorie target",
      "stop notifications",
    ],
    targetType: "setting-detail",
    settingDetailKey: "reminders",
    anchorId: "weekly-review",
    availabilityRule: "signed-in",
  },

  {
    id: "weigh-in-reminder",
    destinationId: "reminders",
    label: "Weigh-in reminder",
    description:
      "Optional reminder to weigh in on the days and time you choose",
    categoryId: "workouts-reminders",
    categoryLabel: "Workouts & reminders",
    breadcrumb: "Account → Workouts & reminders",
    aliases: [
      "weigh in reminder",
      "weight reminder",
      "scale reminder",
      "body weight reminder",
    ],
    intentPhrases: [
      "remind me to weigh myself",
      "weigh in notification",
      "stop weigh in reminders",
      "stop notifications",
    ],
    targetType: "setting-detail",
    settingDetailKey: "reminders",
    anchorId: "weigh-in",
    availabilityRule: "signed-in",
  },

  // ── Appearance ──
  {
    id: "theme",
    destinationId: "appearance",
    label: "Appearance & theme",
    description: "Switch between Auto (System), Light, or Dark display mode",
    categoryId: "appearance",
    categoryLabel: "Appearance",
    breadcrumb: "Account → Appearance",
    aliases: [
      "theme",
      "dark mode",
      "light mode",
      "system theme",
      "color scheme",
      "appearance",
      "dark theme",
      "light theme",
      "display mode",
    ],
    intentPhrases: [
      "dark mode",
      "make the app darker",
      "too bright",
      "turn on dark mode",
      "switch to light mode",
      "make the app lighter",
      "follow system theme",
      "drak mode",
      "black screen",
    ],
    targetType: "setting-detail",
    settingDetailKey: "appearance",
    availabilityRule: "always",
    keywords: ["contrast", "night mode", "bright", "colors"],
  },

  // ── Health connections ──
  {
    id: "health-steps",
    destinationId: "health-steps",
    label: "Steps from Health",
    description:
      "Optional, read-only daily step count from Apple Health or Health Connect",
    categoryId: "health-connections",
    categoryLabel: "Health connections",
    breadcrumb: "Account → Health connections",
    aliases: [
      "steps",
      "apple health",
      "health connect",
      "step count",
      "pedometer",
      "daily steps",
      "healthkit",
      "walking steps",
    ],
    intentPhrases: [
      "connect Apple Health",
      "connect Health Connect",
      "show my steps",
      "track my walking",
      "import steps from phone",
      "disconnect apple health",
      "stop reading steps",
      "sync steps",
    ],
    targetType: "setting-detail",
    settingDetailKey: "health-steps",
    availabilityRule: "signed-in",
    keywords: ["fitness sync", "google fit", "health app", "step tracking"],
  },

  {
    id: "health-preview",
    destinationId: "health-preview",
    label: "Weight & workout Health preview",
    description:
      "Read selected weight or completed workout summaries on this screen",
    categoryId: "health-connections",
    categoryLabel: "Health connections",
    breadcrumb: "Account → Health connections",
    aliases: [
      "weight from health",
      "health workout preview",
      "smart scale",
      "import weight",
    ],
    intentPhrases: [
      "preview my health weight",
      "preview workouts from health",
      "read scale measurements",
    ],
    targetType: "setting-detail",
    settingDetailKey: "health-preview",
    availabilityRule: "health-preview",
    keywords: ["body mass", "completed exercise", "local preview"],
  },

  {
    id: "health-exports",
    destinationId: "health-exports",
    label: "Nutrition & workout Health exports",
    description: "Send selected confirmed nutrition and completed workouts",
    categoryId: "health-connections",
    categoryLabel: "Health connections",
    breadcrumb: "Account → Health connections",
    aliases: [
      "export nutrition",
      "export workouts",
      "write Apple Health",
      "write Health Connect",
    ],
    intentPhrases: [
      "send my meals to health",
      "send completed workouts to health",
    ],
    targetType: "setting-detail",
    settingDetailKey: "health-exports",
    availabilityRule: "health-exports",
    keywords: ["write permission", "health exports"],
  },

  // ── AI coach ──
  {
    id: "coach-preferences",
    destinationId: "coach-preferences",
    label: "Coaching style & preferences",
    description:
      "Experience level, workout equipment, dietary focus, and communication style",
    categoryId: "ai-coach",
    categoryLabel: "AI coach",
    breadcrumb: "Account → AI coach",
    aliases: [
      "coaching style",
      "coach personality",
      "dietary focus",
      "equipment available",
      "experience level",
      "coach tone",
    ],
    intentPhrases: [
      "change coaching style",
      "adjust coach personality",
      "change available equipment",
      "vegetarian coach advice",
      "beginner coach guidance",
      "more direct coach",
    ],
    targetType: "setting-detail",
    settingDetailKey: "coach-preferences",
    availabilityRule: "has-profile",
  },
  {
    id: "ai-usage",
    destinationId: "ai-usage",
    label: "AI usage & Launch Pro Pass",
    description: "Daily AI usage limits, token allowances, and Launch Pro Pass",
    categoryId: "ai-coach",
    categoryLabel: "AI coach",
    breadcrumb: "Account → AI coach",
    aliases: [
      "ai usage",
      "pro pass",
      "launch pro pass",
      "complimentary pro",
      "beta pro",
      "beta pro pass",
      "message limits",
      "token allowance",
      "ai quota",
      "ai tier",
    ],
    intentPhrases: [
      "more AI messages",
      "pro pass",
      "request pro pass",
      "request launch pro pass",
      "request free pro access",
      "how many messages do i have left",
      "ai limit reached",
      "check token usage",
    ],
    targetType: "setting-detail",
    settingDetailKey: "ai-usage",
    availabilityRule: "always",
    keywords: ["credits", "subscription", "upgrade", "quota"],
  },
  {
    id: "coach-memory",
    destinationId: "memory",
    label: "Coach memory",
    description:
      "Inspect, edit, or wipe learned personal context and dietary facts",
    categoryId: "ai-coach",
    categoryLabel: "AI coach",
    breadcrumb: "Account → AI coach",
    aliases: [
      "coach memory",
      "ai memory",
      "what ai knows",
      "durable memories",
      "remembered facts",
      "forget me",
    ],
    intentPhrases: [
      "what does the coach remember",
      "forget what AI knows about me",
      "delete coach memories",
      "clear remembered facts",
      "view ai memory",
    ],
    targetType: "setting-detail",
    settingDetailKey: "memory",
    availabilityRule: "signed-in",
    keywords: [
      "facts",
      "allergies remembered",
      "learned preferences",
      "reset coach",
    ],
  },
  {
    id: "ai-data-consent",
    destinationId: "account-data",
    label: "AI data consent",
    description:
      "Manage or revoke third-party AI processing consent for Coach, meals, recipes and Log activity",
    categoryId: "ai-coach",
    categoryLabel: "AI coach",
    breadcrumb: "Account → AI coach",
    aliases: [
      "ai consent",
      "ai data consent",
      "third party ai",
      "revoke ai consent",
      "stop ai processing",
      "gemini consent",
    ],
    intentPhrases: [
      "stop sharing with AI",
      "revoke AI consent",
      "withdraw consent for ai",
      "do not send photos to ai",
      "disable ai coaching features",
    ],
    targetType: "setting-detail",
    settingDetailKey: "account-data",
    anchorId: "ai-consent",
    availabilityRule: "always",
    keywords: ["data sharing", "privacy permission", "opt out of ai"],
  },

  {
    id: "community-settings",
    destinationId: "community-settings",
    label: "Community",
    description:
      "Optional social profile, exact-handle discovery and withdrawal",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: [
      "friends",
      "community",
      "social profile",
      "discovery",
      "leave community",
    ],
    intentPhrases: [
      "join community",
      "stop sharing with friends",
      "hide my handle",
      "leave community",
      "edit my social name",
    ],
    targetType: "external-route",
    targetRoute: "/community/settings",
    availabilityRule: "signed-in",
  },
  // ── Privacy & data ──
  {
    id: "coach-memory-privacy",
    destinationId: "memory",
    label: "Coach memory & facts",
    description: "Inspect, edit, or erase learned preferences and facts",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: [
      "coach memory",
      "ai memories",
      "durable memories",
      "learned facts",
    ],
    intentPhrases: [
      "what does the coach remember",
      "forget what AI knows about me",
      "erase coach memory",
    ],
    targetType: "setting-detail",
    settingDetailKey: "memory",
    availabilityRule: "signed-in",
  },
  {
    id: "ai-data-consent-privacy",
    destinationId: "account-data",
    label: "AI data consent & revocation",
    description: "Review or withdraw consent for third-party model processing",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: ["ai consent", "revoke ai consent", "ai privacy"],
    intentPhrases: ["stop sharing with AI", "revoke AI consent"],
    targetType: "setting-detail",
    settingDetailKey: "account-data",
    anchorId: "ai-consent",
    availabilityRule: "always",
  },
  {
    id: "product-analytics",
    destinationId: "analytics",
    label: "Help improve Mizyun · Usage analytics",
    description:
      "Allow optional usage data, separately from AI consent; export or clear analytics",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: [
      "analytics",
      "product analytics",
      "Product Analytics & Export",
      "help improve Mizyun",
      "usage analytics",
      "analytics consent",
      "data collection",
      "usage data",
      "usage telemetry",
      "tracking",
      "telemetry",
      "export analytics",
      "clear analytics",
    ],
    intentPhrases: [
      "stop usage tracking",
      "don't collect analytics",
      "turn off tracking",
      "disable analytics",
      "export telemetry",
      "clear analytics events",
      "allow data collection",
      "share usage data",
    ],
    targetType: "setting-detail",
    settingDetailKey: "analytics",
    availabilityRule: "always",
    keywords: ["metrics", "event queue", "telemetry opt out"],
  },
  {
    id: "export-account-data",
    destinationId: "account-data",
    label: "Export account data",
    description:
      "Download a complete copy of your personal data, meals, workouts, and weights",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: [
      "export data",
      "download data",
      "data export",
      "takeout",
      "backup data",
      "export my records",
    ],
    intentPhrases: [
      "download my data",
      "export all my data",
      "get a copy of my records",
      "download workout history",
      "download meal history",
    ],
    targetType: "setting-detail",
    settingDetailKey: "account-data",
    anchorId: "export",
    availabilityRule: "always",
    keywords: ["gdpr takeout", "portable data", "json export"],
  },
  {
    id: "delete-account",
    destinationId: "account-data",
    label: "Delete account",
    description:
      "Permanently erase your account, identity, photos, workout logs, and nutrition records",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: [
      "delete account",
      "erase account",
      "close account",
      "remove account",
      "delete my profile",
    ],
    intentPhrases: [
      "delete my account",
      "erase my profile",
      "permanently remove my account",
      "close my account",
      "wipe everything",
    ],
    targetType: "setting-detail",
    settingDetailKey: "account-data",
    anchorId: "delete",
    availabilityRule: "always",
    keywords: ["erasure", "gdpr right to be forgotten", "account removal"],
  },
  {
    id: "privacy-policy",
    destinationId: "legal",
    label: "Privacy policy",
    description:
      "Review how your health, nutrition, and photo data is stored and protected",
    categoryId: "privacy-data",
    categoryLabel: "Privacy & data",
    breadcrumb: "Account → Privacy & data",
    aliases: ["privacy policy", "data protection policy", "privacy rules"],
    intentPhrases: [
      "read privacy policy",
      "how is my data protected",
      "what do you do with my health data",
      "privacy agreement",
    ],
    targetType: "setting-detail",
    settingDetailKey: "legal",
    anchorId: "privacy-policy",
    availabilityRule: "always",
  },

  // ── Account & help ──
  {
    id: "password-security",
    destinationId: "security",
    label: "Sign-in & security",
    description:
      "Password reset, change password, or provider-managed sign-in details",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "password",
      "change password",
      "reset password",
      "security",
      "google sign in",
      "apple sign in",
      "login details",
    ],
    intentPhrases: [
      "change my password",
      "reset password",
      "update login password",
      "security settings",
    ],
    targetType: "setting-detail",
    settingDetailKey: "security",
    availabilityRule: "signed-in",
    keywords: ["credentials", "authentication provider"],
  },
  {
    id: "account-information",
    destinationId: "identity",
    label: "Account information",
    description:
      "Signed-in email address, internal user ID, session status, and connection diagnostics",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "account info",
      "user id",
      "signed in email",
      "auth status",
      "principal state",
      "session info",
      "account identity",
    ],
    intentPhrases: [
      "what is my user id",
      "which email am i using",
      "check connection status",
      "my account details",
    ],
    targetType: "setting-detail",
    settingDetailKey: "identity",
    availabilityRule: "always",
  },
  {
    id: "setup-wizard",
    destinationId: "setup-wizard",
    label: "Complete setup",
    description:
      "Finish setting up profile details, units, starting weight, and primary goal",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "onboarding",
      "setup wizard",
      "finish setup",
      "initial setup",
      "get started",
    ],
    intentPhrases: [
      "finish onboarding",
      "run setup again",
      "complete profile setup",
    ],
    targetType: "action",
    actionId: "open-onboarding",
    availabilityRule: "incomplete-setup",
  },
  {
    id: "feedback-support",
    destinationId: "feedback",
    label: "Feedback & support",
    description:
      "Send bug reports, suggest features, or submit feedback to the team",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "feedback",
      "support",
      "contact support",
      "report bug",
      "feature request",
      "help",
      "contact us",
    ],
    intentPhrases: [
      "send feedback",
      "report a problem",
      "suggest a feature",
      "contact support",
      "ask for help",
    ],
    targetType: "external-route",
    targetRoute: "/feedback",
    availabilityRule: "always",
    keywords: ["issue", "customer service", "inquiry"],
  },
  {
    id: "terms-of-service",
    destinationId: "legal",
    label: "Terms of service",
    description: "Service conditions and membership terms",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "terms",
      "terms of service",
      "user agreement",
      "terms and conditions",
    ],
    intentPhrases: [
      "read terms of service",
      "view user agreement",
      "service terms",
    ],
    targetType: "setting-detail",
    settingDetailKey: "legal",
    anchorId: "terms",
    availabilityRule: "always",
  },
  {
    id: "health-advisory",
    destinationId: "legal",
    label: "Health & medical advisory",
    description: "Informational fitness disclaimer and medical advice guidance",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "medical advisory",
      "health disclaimer",
      "not a doctor",
      "medical warning",
    ],
    intentPhrases: ["medical disclaimer", "health advisory information"],
    targetType: "setting-detail",
    settingDetailKey: "legal",
    anchorId: "medical-advisory",
    availabilityRule: "always",
  },
  {
    id: "external-account-deletion",
    destinationId: "legal",
    label: "External account deletion info",
    description:
      "Information on requesting data erasure outside the mobile app",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "web deletion instructions",
      "external deletion",
      "delete account via web",
    ],
    intentPhrases: [
      "how to delete account outside app",
      "web account deletion",
    ],
    targetType: "setting-detail",
    settingDetailKey: "legal",
    anchorId: "external-deletion",
    availabilityRule: "always",
  },
  {
    id: "sign-out",
    destinationId: "sign-out",
    label: "Sign out",
    description: "Sign out of your Mizyun account on this device",
    categoryId: "account-help",
    categoryLabel: "Account & help",
    breadcrumb: "Account → Account & help",
    aliases: [
      "sign out",
      "log out",
      "logout",
      "switch account",
      "exit account",
    ],
    intentPhrases: [
      "sign out",
      "log me out",
      "sign out of my account",
      "exit the app",
    ],
    targetType: "action",
    actionId: "sign-out",
    availabilityRule: "signed-in",
    keywords: ["disconnect session", "leave account"],
  },
] as const;

export function isSettingAvailable(
  item: SettingsCatalogItem,
  context: SettingsAvailabilityContext,
): boolean {
  switch (item.availabilityRule) {
    case "always":
      return true;
    case "signed-in":
      return context.isSignedIn;
    case "health-exports":
    case "health-preview":
      return context.isSignedIn && context.isHealthPreviewEnabled === true;
    case "has-profile":
      return context.hasProfile;
    case "progress-photos":
      return context.isProgressPhotosEnabled;
    case "incomplete-setup":
      return !context.isSetupComplete;
    default:
      return true;
  }
}

export function getAvailableSettings(
  context: SettingsAvailabilityContext,
): readonly SettingsCatalogItem[] {
  return SETTINGS_CATALOG.filter((item) => isSettingAvailable(item, context));
}

export function getSettingsForCategory(
  categoryId: SettingsCategoryId,
  context: SettingsAvailabilityContext,
): readonly SettingsCatalogItem[] {
  return getAvailableSettings(context).filter(
    (item) => item.categoryId === categoryId,
  );
}

export function getSettingById(id: string): SettingsCatalogItem | undefined {
  return SETTINGS_CATALOG.find((item) => item.id === id);
}

export function getSettingsByDestination(
  destinationId: string,
): readonly SettingsCatalogItem[] {
  return SETTINGS_CATALOG.filter(
    (item) => item.destinationId === destinationId,
  );
}
