import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  betaProRequestResponseSchema,
  betaProPushTokenResponseSchema,
  type BetaProPushTokenResponse,
  betaProStatusResponseSchema,
  type BetaProRequestResponse,
  type BetaProStatusResponse,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";

export async function fetchBetaProStatus(
  client: ApiClient,
): Promise<Result<BetaProStatusResponse, ApiError>> {
  return client.request<BetaProStatusResponse>({
    method: "GET",
    path: "/v1/beta-pro/status",
    schema: betaProStatusResponseSchema,
  });
}

export async function requestBetaProPass(
  client: ApiClient,
  options?: {
    getPushToken?: () => Promise<string | undefined>;
  },
): Promise<Result<BetaProRequestResponse, ApiError>> {
  let pushToken: string | undefined;
  if (options?.getPushToken) {
    try {
      pushToken = await options.getPushToken();
    } catch {
      // Push token not available — proceed without it
    }
  } else {
    try {
      const Notifications = await import("expo-notifications");
      let perm = await Notifications.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await Notifications.requestPermissionsAsync();
      }
      if (perm.granted) {
        try {
          const tokenResult = await Notifications.getExpoPushTokenAsync();
          pushToken = tokenResult.data;
        } catch {
          try {
            const deviceToken = await Notifications.getDevicePushTokenAsync();
            pushToken = deviceToken.data;
          } catch {
            // Push token not available — proceed without it
          }
        }
      }
    } catch {
      // Push token not available — proceed without it
    }
  }

  return client.request<BetaProRequestResponse>({
    method: "POST",
    path: "/v1/beta-pro/request",
    body: {
      ...(pushToken !== undefined ? { pushToken } : {}),
    },
    schema: betaProRequestResponseSchema,
  });
}

/**
 * Whether the OS notification prompt may show. An anchor with a first record
 * allows it and an anchor without one defers. With no anchor (the first-run
 * card was skipped, or this is a reinstall) a set-up profile stands in, so a
 * brand-new account is never asked before value.
 */
export const pushPromptAllowed = (input: {
  readonly anchor: { readonly firstRecordOn: string | null } | null;
  readonly profileSetUp: boolean;
  readonly preview: boolean;
}): boolean => {
  if (input.preview) return false;
  if (input.anchor !== null) return input.anchor.firstRecordOn !== null;
  return input.profileSetUp;
};

export interface PushRegistrationAttempt {
  /** True when the OS prompt is still pending and no record exists yet. */
  readonly deferred: boolean;
  readonly token: string | null;
}

/**
 * Registers the device token, but holds back the OS notification prompt until
 * the account's first confirmed record. A device that already decided (granted
 * or denied) registers at once; nothing is asked of a new user before value.
 */
export async function registerDevicePushTokenAfterFirstRecord(
  client: ApiClient,
  firstRecordConfirmed: () => Promise<boolean>,
): Promise<PushRegistrationAttempt> {
  try {
    const Notifications = await import("expo-notifications");
    const perm = await Notifications.getPermissionsAsync();
    const wouldPrompt = !perm.granted && perm.canAskAgain;
    if (wouldPrompt && !(await firstRecordConfirmed().catch(() => false))) {
      return { deferred: true, token: null };
    }
  } catch {
    return { deferred: false, token: null };
  }
  return { deferred: false, token: await registerDevicePushToken(client) };
}

export async function registerDevicePushToken(
  client: ApiClient,
): Promise<string | null> {
  try {
    const Notifications = await import("expo-notifications");
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync();
    }
    if (!perm.granted) {
      return null;
    }

    let pushToken: string | undefined;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      pushToken = deviceToken.data;
    } catch {
      try {
        const tokenResult = await Notifications.getExpoPushTokenAsync();
        pushToken = tokenResult.data;
      } catch {
        return null;
      }
    }

    if (!pushToken) {
      return null;
    }

    const result = await client.request<BetaProPushTokenResponse>({
      method: "PUT",
      path: "/v1/beta-pro/push-token",
      body: { pushToken },
      schema: betaProPushTokenResponseSchema,
    });

    if (result.ok && result.value.updated) {
      return pushToken;
    }
    return null;
  } catch {
    return null;
  }
}
