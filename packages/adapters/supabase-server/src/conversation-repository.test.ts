import { describe, expect, it, vi } from "vitest";
import type { ConversationId, UserId } from "@mizyun/core";

import type {
  RepositoryListResult,
  RepositorySupabaseClient,
} from "./index.js";
import { SupabaseConversationRepository } from "./conversation-repository.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const conversationId = "00000000-0000-4000-8000-000000000002" as ConversationId;

const row = (id: string, createdAt: string, text: string) => ({
  id,
  user_id: userId,
  conversation_id: conversationId,
  role: "user" as const,
  content: { text },
  status: "complete" as const,
  idempotency_key: `key-${id}`,
  provider_metadata: {},
  created_at: createdAt,
});

describe("SupabaseConversationRepository.listMessages", () => {
  it("selects the newest bounded window and returns it chronologically", async () => {
    const order = vi.fn().mockReturnThis();
    const newestFirst = [
      row("message-new", "2026-07-23T10:02:00.000Z", "Newest"),
      row("message-old", "2026-07-23T10:01:00.000Z", "Older"),
    ];
    const client: RepositorySupabaseClient = {
      from: () => {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order,
          limit: vi.fn().mockReturnThis(),
          then: (resolve: (value: RepositoryListResult<unknown>) => void) =>
            resolve({ data: newestFirst, error: null }),
        };
        return builder as unknown as never;
      },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      auth: {
        setSession: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
    };
    const repository = new SupabaseConversationRepository({
      clientFor: () => client,
    });

    const messages = await repository.listMessages(userId, conversationId, {
      accessToken: "token",
      limit: 2,
    });

    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(messages.map((message) => message.text)).toEqual([
      "Older",
      "Newest",
    ]);
  });
});
