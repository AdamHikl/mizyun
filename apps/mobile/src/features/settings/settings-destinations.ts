/**
 * Settings destinations and navigation registry.
 *
 * Provides allowlisted mapping from setting keys to routes, valid anchors,
 * and navigation targets. Strictly guards against arbitrary href execution.
 */

import { router, type Href } from "expo-router";
import type { SettingsCatalogItem } from "./settings-catalog";

export type SettingsDetailKey =
  | "profile"
  | "goal"
  | "food-standards"
  | "workout"
  | "reminders"
  | "appearance"
  | "health-steps"
  | "health-exports"
  | "health-preview"
  | "coach-preferences"
  | "ai-usage"
  | "memory"
  | "analytics"
  | "account-data"
  | "security"
  | "identity"
  | "legal";

export interface SettingsDetailRouteConfig {
  readonly title: string;
  readonly categoryId: string;
  readonly validAnchors: readonly string[];
}

export const SETTINGS_DETAIL_CONFIGS: Record<
  SettingsDetailKey,
  SettingsDetailRouteConfig
> = {
  profile: {
    title: "Personal & physical details",
    categoryId: "profile-goals",
    validAnchors: ["personal-details", "units"],
  },
  goal: {
    title: "Goal & target pace",
    categoryId: "profile-goals",
    validAnchors: ["target-weight", "weekly-pace", "logging-goal"],
  },
  "food-standards": {
    title: "Regional food standards",
    categoryId: "profile-goals",
    validAnchors: [],
  },
  workout: {
    title: "Rest timer & workout preferences",
    categoryId: "workouts-reminders",
    validAnchors: ["rest-timer", "weight-progression"],
  },
  reminders: {
    title: "Push notification reminders",
    categoryId: "workouts-reminders",
    validAnchors: [
      "coach-reminders",
      "first-meal",
      "evening-catch-up",
      "weekly-review",
      "weigh-in",
    ],
  },
  appearance: {
    title: "Appearance & theme",
    categoryId: "appearance",
    validAnchors: [],
  },
  "health-steps": {
    title: "Steps from Health",
    categoryId: "health-connections",
    validAnchors: [],
  },
  "health-exports": {
    title: "Nutrition & workout Health exports",
    categoryId: "health-connections",
    validAnchors: [],
  },
  "health-preview": {
    title: "Weight & workout Health preview",
    categoryId: "health-connections",
    validAnchors: [],
  },
  "coach-preferences": {
    title: "Coaching style & preferences",
    categoryId: "ai-coach",
    validAnchors: [],
  },
  "ai-usage": {
    title: "AI usage & Launch Pro Pass",
    categoryId: "ai-coach",
    validAnchors: [],
  },
  memory: {
    title: "Coach memory",
    categoryId: "ai-coach",
    validAnchors: [],
  },
  analytics: {
    title: "Help improve Mizyun",
    categoryId: "privacy-data",
    validAnchors: [],
  },
  "account-data": {
    title: "Account data & erasure",
    categoryId: "privacy-data",
    validAnchors: ["ai-consent", "export", "delete"],
  },
  security: {
    title: "Password & security",
    categoryId: "account-help",
    validAnchors: [],
  },
  identity: {
    title: "Account information",
    categoryId: "account-help",
    validAnchors: [],
  },
  legal: {
    title: "Legal, terms & health advisory",
    categoryId: "account-help",
    validAnchors: [
      "privacy-policy",
      "terms",
      "medical-advisory",
      "external-deletion",
    ],
  },
};

export const ALLOWED_EXTERNAL_ROUTES = [
  "/energy-setup",
  "/body",
  "/progress-photos",
  "/feedback",
  "/community/settings",
] as const;

export type AllowedExternalRoute = (typeof ALLOWED_EXTERNAL_ROUTES)[number];

export function isAllowedExternalRoute(
  path: string,
): path is AllowedExternalRoute {
  return (ALLOWED_EXTERNAL_ROUTES as readonly string[]).includes(path);
}

export function isSettingsDetailKey(key: string): key is SettingsDetailKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_DETAIL_CONFIGS, key);
}

export interface NavigationCallbacks {
  readonly onSignOutRequest?: () => void;
  readonly onOpenOnboarding?: () => void;
}

/**
 * Safely navigates to a catalog item destination.
 */
export function navigateToSetting(
  item: SettingsCatalogItem,
  callbacks?: NavigationCallbacks,
): void {
  if (item.targetType === "setting-detail" && item.settingDetailKey) {
    if (isSettingsDetailKey(item.settingDetailKey)) {
      const pathname = `/account-settings/${item.settingDetailKey}` as const;
      const params = item.anchorId ? { anchor: item.anchorId } : undefined;
      router.push({
        pathname,
        params,
      } as unknown as Href);
      return;
    }
  }

  if (item.targetType === "external-route" && item.targetRoute) {
    if (isAllowedExternalRoute(item.targetRoute)) {
      router.push(item.targetRoute as Href);
      return;
    }
  }

  if (item.targetType === "action") {
    if (item.actionId === "sign-out") {
      if (callbacks?.onSignOutRequest) {
        callbacks.onSignOutRequest();
      } else {
        // Fall back to Account & help detail screen to reveal the Sign Out control
        router.push("/account-settings/identity" as Href);
      }
      return;
    }
    if (item.actionId === "open-onboarding") {
      if (callbacks?.onOpenOnboarding) {
        callbacks.onOpenOnboarding();
      } else {
        router.push("/onboarding" as Href);
      }
      return;
    }
  }

  // Safe fallback if target cannot be resolved
  console.warn(`[Settings] Unrecognized destination for item: ${item.id}`);
}
