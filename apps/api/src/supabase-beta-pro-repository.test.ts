import { describe, expect, it, vi } from "vitest";
import type { RepositorySupabaseClient } from "@mizyun/adapter-supabase-server";
import type { UserId } from "@mizyun/core";
import { SupabaseBetaProRepository } from "./supabase-beta-pro-repository.js";

describe("SupabaseBetaProRepository.updatePushToken", () => {
  it.each([{ rows: [] }, { rows: [{ user_id: "user-a" }] }])(
    "uses an update only, including when the request was deleted (%j)",
    async ({ rows }) => {
      const select = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ select });
      const update = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ update });
      const repository = new SupabaseBetaProRepository({
        serviceClient: { from } as unknown as RepositorySupabaseClient,
      });
      expect(
        await repository.updatePushToken("user-a" as UserId, "new-token"),
      ).toBe(rows.length > 0);
      expect(from).toHaveBeenCalledWith("beta_pro_requests");
      expect(update).toHaveBeenCalledWith({ push_token: "new-token" });
      expect(eq).toHaveBeenCalledWith("user_id", "user-a");
      expect(select).toHaveBeenCalledWith("user_id");
    },
  );
});
