import type { ConfigIssue, MobileConfigResult } from "@mizyun/config";
import { err } from "@mizyun/core";

interface RuntimeIdentity {
  readonly extra?: {
    readonly mizyunVariant?: unknown;
    readonly mizyunRuntimeEndpoints?: unknown;
  };
  readonly ios?: { readonly bundleIdentifier?: string };
  readonly android?: { readonly package?: string };
}

type Variant = "dev" | "production";

interface NativeRuntime {
  readonly platform: string;
  readonly applicationId: string | null;
  readonly executionEnvironment?: string;
}

const identities: Record<string, Variant> = {
  "com.mizyun.development": "dev",
  "com.mizyun.dev": "dev",
  "com.mizyun.app": "production",
};

const sameUrl = (left: unknown, right: unknown): boolean => {
  if (left == null && right == null) return true;
  if (typeof left !== "string" || typeof right !== "string") return false;
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
};

/**
 * Validate the effective SDK 57 virtual environment, not just app.config's
 * shell environment. Bind manifest routing to the installed native application
 * ID, never to the public env being checked. Failure disables both clients before
 * the Supabase adapter can restore a session or start refreshing tokens.
 */
export function guardMobileEnvironment(
  result: MobileConfigResult,
  identity: RuntimeIdentity | null | undefined,
  runtime: NativeRuntime,
): MobileConfigResult {
  if (!result.ok) return result;
  // Missing setup stays disabled without needing a native identity.
  if (!result.value.supabase.configured && !result.value.apiUrl) return result;

  const identityFailure = (): MobileConfigResult =>
    err([
      {
        kind: "malformed",
        key: "MIZYUN_APP_VARIANT",
        reason: "Installed app identity and declared environment do not match.",
      },
    ]);
  if (!identity) return identityFailure();

  const issues: ConfigIssue[] = [];
  const declared = identity.extra?.mizyunVariant;
  const variants = [
    declared === "dev" || declared === "production" ? declared : undefined,
    identities[identity.ios?.bundleIdentifier ?? ""],
    identities[identity.android?.package ?? ""],
  ].filter((variant): variant is Variant => variant !== undefined);
  const variant = variants[0];
  if (
    !variant ||
    (declared !== undefined &&
      declared !== "dev" &&
      declared !== "production") ||
    variants.some((candidate) => candidate !== variant)
  )
    return identityFailure();

  if (runtime.platform !== "web") {
    const isIos = runtime.platform === "ios";
    if (!isIos && runtime.platform !== "android") return identityFailure();
    const manifestId = isIos
      ? identity.ios?.bundleIdentifier
      : identity.android?.package;
    const expectedId =
      variant === "production"
        ? "com.mizyun.app"
        : isIos
          ? "com.mizyun.development"
          : "com.mizyun.dev";
    if (manifestId !== expectedId) return identityFailure();

    // Expo Go hosts Dev manifests without Mizyun's application ID. Both native
    // host ID and Expo's native execution environment must establish that case.
    const expoGoId = isIos ? "host.exp.Exponent" : "host.exp.exponent";
    const isExpoGo =
      runtime.applicationId === expoGoId &&
      runtime.executionEnvironment === "storeClient";
    if (isExpoGo ? variant !== "dev" : runtime.applicationId !== expectedId) {
      return identityFailure();
    }
  }

  const endpoints = [
    ["apiUrl", "EXPO_PUBLIC_API_URL", result.value.apiUrl],
    [
      "supabaseUrl",
      "EXPO_PUBLIC_SUPABASE_URL",
      result.value.supabaseConfig?.url ?? null,
    ],
    [
      "authRedirectUri",
      "EXPO_PUBLIC_AUTH_REDIRECT_URI",
      result.value.authRedirectUri,
    ],
  ] as const;
  const expected = identity.extra?.mizyunRuntimeEndpoints;
  if (expected && typeof expected === "object") {
    for (const [field, key, actual] of endpoints) {
      if (!sameUrl(actual, (expected as Record<string, unknown>)[field])) {
        issues.push({
          kind: "malformed",
          key,
          reason: "Effective environment differs from the app configuration.",
        });
      }
    }
  }

  // Also protect older manifests without the routing snapshot. Local Dev
  // endpoints remain supported; current manifests additionally bind the exact
  // selected origin/path/port through the comparison above.
  if (variant) {
    for (const [field, key, actual] of endpoints) {
      if (actual === null) continue;
      let allowed = false;
      try {
        const url = new URL(actual);
        if (field === "authRedirectUri") {
          allowed =
            url.protocol === (variant === "dev" ? "mizyun-dev:" : "mizyun:");
        } else {
          const service = field === "apiUrl" ? "api" : "supabase";
          const host = `mizyun-${service}${variant === "dev" ? "-dev" : ""}.phiskel.com`;
          allowed =
            (url.protocol === "https:" && url.hostname === host) ||
            (variant === "dev" &&
              ["http:", "https:"].includes(url.protocol) &&
              ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname));
          allowed = allowed && !url.username && !url.password;
        }
      } catch {
        allowed = false;
      }
      if (!allowed) {
        issues.push({
          kind: "malformed",
          key,
          reason:
            "Effective environment is incompatible with the app identity.",
        });
      }
    }
  }
  return issues.length ? err(issues) : result;
}
