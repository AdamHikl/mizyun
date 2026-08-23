import type { FeedbackRepository, UserFeedback, UserId } from "@mizyun/core";

export class InMemoryFeedbackRepository implements FeedbackRepository {
  readonly #byUser = new Map<UserId, UserFeedback[]>();
  readonly #byId = new Map<string, UserFeedback>();

  async create(
    userId: UserId,
    feedback: UserFeedback,
    options: { readonly accessToken: string },
  ): Promise<UserFeedback> {
    void options.accessToken;
    if (feedback.userId !== userId) {
      throw new Error("feedback create userId mismatch");
    }
    if (this.#byId.has(feedback.id)) {
      throw new Error(`feedback id collision ${feedback.id}`);
    }
    const list = this.#byUser.get(userId) ?? [];
    this.#byUser.set(userId, [...list, feedback]);
    this.#byId.set(feedback.id, feedback);
    return feedback;
  }

  async listForUser(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit?: number },
  ): Promise<ReadonlyArray<UserFeedback>> {
    void options.accessToken;
    const limit = options.limit ?? 50;
    const list = this.#byUser.get(userId) ?? [];
    return [...list]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(0, limit));
  }

  async deleteAllForUser(
    userId: UserId,
    options: { readonly accessToken: string },
  ): Promise<number> {
    void options.accessToken;
    const list = this.#byUser.get(userId) ?? [];
    for (const item of list) {
      this.#byId.delete(item.id);
    }
    this.#byUser.delete(userId);
    return list.length;
  }

  __seedForTest(feedback: UserFeedback): void {
    const list = this.#byUser.get(feedback.userId) ?? [];
    this.#byUser.set(feedback.userId, [...list, feedback]);
    this.#byId.set(feedback.id, feedback);
  }
}
