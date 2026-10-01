/** Text conversations are mutual opt-in; no device presence, read receipts or encryption claims. */
export interface CommunityMessagingRepository {
  execute(
    operation: string,
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<Record<string, unknown>>;
}
export function isPermittedMessageText(text: string): boolean {
  return (
    text.trim().length > 0 &&
    text.length <= 1000 &&
    !/(https?:\/\/|www\.|[\u0000-\u0008\u000B\u000C\u000E-\u001F])/i.test(text)
  );
}
