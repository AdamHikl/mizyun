import type {
  FeedbackCategory,
  FeedbackRepository,
  UserFeedback,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface FeedbackRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly category: string;
  readonly rating: number | null;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly media_asset_ids?: readonly string[];
  readonly created_at: string;
}

export const feedbackFromRow = (row: FeedbackRow): UserFeedback => ({
  id: row.id,
  userId: row.user_id as UserId,
  category: row.category as FeedbackCategory,
  rating: row.rating,
  message: row.message,
  context: { ...row.context },
  mediaAssetIds: Array.isArray(row.media_asset_ids)
    ? [...row.media_asset_ids]
    : [],
  createdAt: new Date(row.created_at),
});
const fromRow = feedbackFromRow;

const toInsertRow = (
  userId: UserId,
  feedback: UserFeedback,
): Partial<FeedbackRow> => ({
  id: feedback.id,
  user_id: userId,
  category: feedback.category,
  rating: feedback.rating,
  message: feedback.message,
  context: { ...feedback.context },
  media_asset_ids: [...feedback.mediaAssetIds],
});

export interface SupabaseFeedbackRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseFeedbackRepository implements FeedbackRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseFeedbackRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async create(
    userId: UserId,
    feedback: UserFeedback,
    options: { readonly accessToken: string },
  ): Promise<UserFeedback> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<FeedbackRow>("user_feedback")
      .insert(toInsertRow(userId, feedback))
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "feedback insert returned no row",
      );
    }
    return fromRow(data);
  }

  async listForUser(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit?: number },
  ): Promise<ReadonlyArray<UserFeedback>> {
    const client = this.#clientFor(options.accessToken);
    const limit = options.limit ?? 50;
    const { data, error } = await client
      .from<FeedbackRow>("user_feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<number> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<FeedbackRow>("user_feedback")
      .delete()
      .eq("user_id", userId)
      .select("id");
    if (error) {
      throw new RepositoryError(error.message);
    }
    return Array.isArray(data) ? data.length : 0;
  }
}
