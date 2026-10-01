/** Provider-neutral boundary. Authorization, generations and atomic retry live in the repository. */
export interface CommunityCommentsRepository {
  execute(
    operation:
      | "list"
      | "upsert"
      | "delete"
      | "settings"
      | "preferences"
      | "candidates"
      | "mentionsInbox"
      | "report",
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown>;
}
export const COMMUNITY_COMMENT_LIMITS = {
  text: 500,
  page: 20,
  mentions: 3,
  dailyMutations: 100,
  thread: 500,
} as const;
/** Typed @names cannot imply recipient consent. Mentions use explicit authorized IDs. */
export const isPlainCommunityComment = (text: string): boolean => {
  const value = text.trim();
  return (
    value.length > 0 &&
    Array.from(value).length <= COMMUNITY_COMMENT_LIMITS.text &&
    !/[\u0000-\u001f\u007f@]|https?:\/\/|www\./i.test(value)
  );
};
