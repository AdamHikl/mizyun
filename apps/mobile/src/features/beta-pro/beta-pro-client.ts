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
import { Platform } from "react-native";

async function ensurePushChannel(
  Notifications: typeof import("expo-notifications"),
): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("general-updates", {
      name: "Mizyun updates",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function requestSetupNotificationPermission(): Promise<
  "granted" | "denied"
> {
  const Notifications = await import("expo-notifications");
  await ensurePushChannel(Notifications);
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  return permission.granted ? "granted" : "denied";
}

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
      await ensurePushChannel(Notifications);
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

export async function registerDevicePushToken(
  client: ApiClient,
): Promise<string | null> {
  try {
    const Notifications = await import("expo-notifications");
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      return null;
    }
    await ensurePushChannel(Notifications);

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
