import type { CommunityNotificationRepository } from "@mizyun/core";
/** Offline composition supports inbox/preferences without simulating push delivery. */
export class InMemoryCommunityNotificationRepository implements CommunityNotificationRepository {
  readonly #preferences = new Map<string, unknown>();
  async execute(
    operation: Parameters<CommunityNotificationRepository["execute"]>[0],
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown> {
    if (operation === "inbox") return { items: [], nextCursor: null };
    if (operation === "preferences")
      return (
        this.#preferences.get(accessToken) ?? {
          requests: true,
          reactions: true,
          moderation: true,
          muted: false,
          timezone: "UTC",
          quietHours: null,
        }
      );
    if (operation === "savePreferences") {
      this.#preferences.set(accessToken, args);
      return args;
    }
    if (operation === "resolve" || operation === "read") return null;
    if (operation === "removeToken") return {};
    throw new Error("Push registration requires durable storage");
  }
}
