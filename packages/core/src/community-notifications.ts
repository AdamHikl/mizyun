/** Provider-neutral notification boundary. Tokens never enter core logging or export. */
export interface CommunityNotificationRepository {
  execute(
    operation:
      | "inbox"
      | "read"
      | "resolve"
      | "preferences"
      | "savePreferences"
      | "registerToken"
      | "removeToken",
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown>;
}
export interface CommunityPushDeliveryPort {
  send(input: { readonly token: string; readonly eventId: string }): Promise<{
    readonly status: "accepted" | "retry" | "invalid";
    readonly receiptId?: string;
  }>;
}
export const isCommunityQuietTime = (
  date: Date,
  timezone: string,
  quiet: { readonly startMinutes: number; readonly endMinutes: number } | null,
): boolean => {
  if (!quiet) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const minute =
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value);
  return quiet.startMinutes < quiet.endMinutes
    ? minute >= quiet.startMinutes && minute < quiet.endMinutes
    : minute >= quiet.startMinutes || minute < quiet.endMinutes;
};
