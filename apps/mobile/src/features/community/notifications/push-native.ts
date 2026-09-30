import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiConfiguration } from "@/composition/api-client";
import {
  CommunityPushLifecycle,
  type PushBinding,
  type PushPrincipal,
} from "./push-lifecycle";

const installationKey = "community.push.installation.v1";
const bindingKey = "community.push.binding.v1";
const storageOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let installationPromise: Promise<string> | null = null;
async function installationId() {
  if (!installationPromise)
    installationPromise = (async () => {
      const existing = await SecureStore.getItemAsync(installationKey);
      if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
      const id = Crypto.randomUUID();
      await SecureStore.setItemAsync(installationKey, id, storageOptions);
      return id;
    })().catch((error) => {
      installationPromise = null;
      throw error;
    });
  return installationPromise;
}
async function readBinding(): Promise<PushBinding | null> {
  const raw = await SecureStore.getItemAsync(bindingKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PushBinding;
    return typeof value.userId === "string" &&
      typeof value.installationId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
async function tokenRequest(
  principal: PushPrincipal,
  method: "PUT" | "DELETE",
  installation: string,
  token?: string,
) {
  if (!apiConfiguration.configured) return false;
  try {
    const response = await fetch(
      `${apiConfiguration.baseUrl.replace(/\/$/, "")}/v1/community/notifications/token${method === "DELETE" ? `/${encodeURIComponent(installation)}` : ""}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${principal.accessToken}`,
          "Content-Type": "application/json",
        },
        ...(method === "PUT"
          ? { body: JSON.stringify({ installationId: installation, token }) }
          : {}),
        signal: AbortSignal.timeout(10000),
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}
export const communityPushLifecycle = new CommunityPushLifecycle({
  installationId,
  readBinding,
  writeBinding: async (binding) => {
    if (binding)
      await SecureStore.setItemAsync(
        bindingKey,
        JSON.stringify(binding),
        storageOptions,
      );
    else await SecureStore.deleteItemAsync(bindingKey);
  },
  permission: async (prompt) => {
    if (Platform.OS === "web") return false;
    const Notifications = await import("expo-notifications");
    // Channel creation occurs only in the explicit optional permission context.
    if (prompt && Platform.OS === "android")
      await Notifications.setNotificationChannelAsync("community", {
        name: "Community updates",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && prompt && permission.canAskAgain)
      permission = await Notifications.requestPermissionsAsync();
    return (
      permission.granted ||
      permission.ios?.status ===
        Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  },
  expoToken: async () => {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (typeof projectId !== "string" || !projectId)
      throw new Error("Community push configuration unavailable");
    const Notifications = await import("expo-notifications");
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  },
  register: (principal, installation, token) =>
    tokenRequest(principal, "PUT", installation, token),
  remove: (principal, installation) =>
    tokenRequest(principal, "DELETE", installation),
});
/** Await before auth logout; a failed removal still loses server send authority on session revocation. */
export const deregisterCommunityPush = (captured?: PushPrincipal | null) =>
  communityPushLifecycle.deregister(captured);
