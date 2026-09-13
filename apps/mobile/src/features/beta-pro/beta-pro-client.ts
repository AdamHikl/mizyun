import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  betaProRequestResponseSchema,
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
