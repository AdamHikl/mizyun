import type { UserId } from "./index";

export type FeedbackCategory =
  "like" | "dislike" | "change" | "bug" | "general";

export interface UserFeedback {
  readonly id: string;
  readonly userId: UserId;
  readonly category: FeedbackCategory;
  readonly rating: number | null;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly mediaAssetIds: ReadonlyArray<string>;
  readonly createdAt: Date;
}

export interface NewFeedback {
  readonly category: FeedbackCategory;
  readonly rating?: number | null;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly mediaAssetIds?: ReadonlyArray<string>;
}

export type FeedbackValidationError =
  | { readonly kind: "invalid_category"; readonly received: string }
  | { readonly kind: "rating_out_of_range"; readonly received: number }
  | { readonly kind: "empty_message" }
  | { readonly kind: "message_too_long"; readonly length: number }
  | { readonly kind: "too_many_attachments"; readonly count: number };

export const validateFeedback = (
  input: NewFeedback,
): FeedbackValidationError | null => {
  const allowedCategories: readonly FeedbackCategory[] = [
    "like",
    "dislike",
    "change",
    "bug",
    "general",
  ];
  if (!allowedCategories.includes(input.category)) {
    return { kind: "invalid_category", received: input.category };
  }
  if (input.rating !== undefined && input.rating !== null) {
    if (
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      return { kind: "rating_out_of_range", received: input.rating };
    }
  }
  const trimmed = input.message.trim();
  if (trimmed.length === 0) {
    return { kind: "empty_message" };
  }
  if (input.message.length > 4000) {
    return { kind: "message_too_long", length: input.message.length };
  }
  if (input.mediaAssetIds && input.mediaAssetIds.length > 3) {
    return { kind: "too_many_attachments", count: input.mediaAssetIds.length };
  }
  return null;
};

export interface FeedbackRepository {
  create(
    userId: UserId,
    feedback: UserFeedback,
    options: { readonly accessToken: string },
  ): Promise<UserFeedback>;

  listForUser(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit?: number },
  ): Promise<ReadonlyArray<UserFeedback>>;

  deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<number>;
}
