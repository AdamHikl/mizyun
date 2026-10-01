import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export const SOCIAL_EXPORT_CATEGORIES = [
  "identity",
  "relationships",
  "blocks",
  "mutes",
  "activities",
  "reactions",
  "invitations",
  "reports",
  "appeals",
  "notificationPreferences",
  "inbox",
  "pushRegistrations",
  "delivery",
  "comments",
  "commentPreferences",
  "commentMentions",
  "groupMemberships",
  "groupPosts",
  "groupAppeals",
  "groupEvents",
  "groupOperations",
  "routineShares",
  "routineImports",
  "messages",
  "messageOperations",
  "messagingPreferences",
  "broaderDiscoveryPreferences",
  "challenges",
  "challengeContributions",
  "media",
  "mediaReviews",
] as const;

interface ExportRow extends Record<string, unknown> {
  item_key: string;
  item: Record<string, unknown>;
}

/** Each category has live keyset consistency; this is not a cross-table snapshot. */
export async function exportCommunityAccount(client: RepositorySupabaseClient) {
  const categories: Record<string, readonly Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const category of SOCIAL_EXPORT_CATEGORIES) {
    const items: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    let complete = false;
    for (let page = 0; page < 1000; page++) {
      const { data, error } = await client.rpc<ExportRow>(
        "community_export_page",
        {
          p_category: category,
          p_after: cursor,
          p_limit: 500,
        },
      );
      if (error)
        throw new RepositoryError(`Community export failed for ${category}`);
      const rows: readonly ExportRow[] = data ?? [];
      for (const row of rows) {
        if (!row.item_key || (cursor !== null && row.item_key <= cursor)) {
          throw new RepositoryError("Community export cursor did not advance");
        }
        cursor = row.item_key;
        items.push(row.item);
      }
      if (rows.length < 500) {
        complete = true;
        break;
      }
    }
    if (!complete)
      throw new RepositoryError("Community export exceeded page budget");
    categories[category] = items;
    counts[category] = items.length;
  }
  return {
    schemaVersion: "2026-10-01" as const,
    consistency: "live_keyset" as const,
    completeness: "complete" as const,
    counts,
    categories,
  };
}
