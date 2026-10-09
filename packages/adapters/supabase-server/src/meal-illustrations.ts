import sharp from "sharp";
import {
  MEAL_ILLUSTRATION_MAX_BYTES,
  type MealIllustrationClaim,
  type MealIllustrationImage,
  type MealIllustrationRepository,
  type MealIllustrationUsage,
  type StoredMealIllustration,
  type UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export async function processMealIllustration(
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024)
    throw new Error("Invalid illustration");
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 4_194_304,
    animated: false,
  });
  const meta = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
    (meta.pages ?? 1) !== 1
  )
    throw new Error("Invalid illustration");
  const output = await image
    .timeout({ seconds: 10 })
    .rotate()
    .resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#f7f5ef" })
    .jpeg({ quality: 75 })
    .toBuffer();
  if (!output.length || output.length > MEAL_ILLUSTRATION_MAX_BYTES)
    throw new Error("Invalid illustration");
  return output.toString("base64");
}
interface IllustrationRow extends Record<string, unknown> {
  id: string;
  source_entry_id: string;
  user_id: string;
  dish_key: string;
  state: StoredMealIllustration["state"];
  created_at: string;
  lease_until: string;
  image_base64: string | null;
}
function missingRelation(
  error: { code?: string; message: string } | null,
  table: "meal_illustrations" | "meal_illustration_user_usage",
): boolean {
  return (
    error?.code === "42P01" &&
    (error.message === `relation "public.${table}" does not exist` ||
      error.message === `relation "${table}" does not exist`)
  );
}
function fromRow(row: IllustrationRow): StoredMealIllustration {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    sourceEntryId: row.source_entry_id,
    key: row.dish_key,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    leaseUntil: new Date(row.lease_until).toISOString(),
    image: row.image_base64
      ? { key: row.dish_key, base64: row.image_base64, mimeType: "image/jpeg" }
      : null,
  };
}
export class SupabaseMealIllustrationRepository implements MealIllustrationRepository {
  constructor(
    private readonly options: {
      serviceClient: RepositorySupabaseClient;
      clientFor: (token: string) => RepositorySupabaseClient;
    },
  ) {}
  async claim(
    userId: UserId,
    key: string,
    consentVersion: string,
    sourceEntryId: string,
  ): Promise<MealIllustrationClaim> {
    const res = await this.options.serviceClient.rpc<
      IllustrationRow & { claimed: boolean }
    >("meal_illustration_claim", {
      p_user_id: userId,
      p_key: key,
      p_consent_version: consentVersion,
      p_source_entry_id: sourceEntryId,
    });
    if (res.error) throw new RepositoryError("Illustration admission failed");
    const row = res.data?.[0];
    return row
      ? { kind: row.claimed ? "claimed" : "existing", record: fromRow(row) }
      : { kind: "limited" };
  }
  async complete(
    userId: UserId,
    id: string,
    image: MealIllustrationImage,
    consentVersion: string,
  ): Promise<void> {
    const res = await this.options.serviceClient.rpc(
      "meal_illustration_complete",
      {
        p_user_id: userId,
        p_id: id,
        p_base64: image.base64,
        p_consent_version: consentVersion,
      },
    );
    if (res.error) throw new RepositoryError("Illustration persistence failed");
  }
  async fail(userId: UserId, id: string): Promise<void> {
    const res = await this.options.serviceClient.rpc("meal_illustration_fail", {
      p_user_id: userId,
      p_id: id,
    });
    if (res.error)
      throw new RepositoryError("Illustration failure persistence failed");
  }
  async exportForUser(
    userId: UserId,
    accessToken: string,
  ): Promise<readonly StoredMealIllustration[]> {
    const result: StoredMealIllustration[] = [];
    // Only the authenticated account-export flow invokes this ownership-scoped port.
    // Feature reads use admission RPC; downgrade RLS must not omit retained export bytes.
    void accessToken;
    const client = this.options.serviceClient;
    for (let start = 0; ; start += 100) {
      const page = await client
        .from<IllustrationRow>("meal_illustrations")
        .select("*")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(start, start + 99);
      if (page.error) {
        if (start === 0 && missingRelation(page.error, "meal_illustrations"))
          return [];
        throw new RepositoryError("Illustration export failed");
      }
      result.push(...(page.data ?? []).map(fromRow));
      if ((page.data?.length ?? 0) < 100) return result;
    }
  }
  async exportUsageForUser(
    userId: UserId,
    accessToken: string,
  ): Promise<readonly MealIllustrationUsage[]> {
    const result: MealIllustrationUsage[] = [];
    const client = this.options.clientFor(accessToken);
    for (let start = 0; ; start += 100) {
      const page = await client
        .from<
          Record<string, unknown> & {
            user_id: string;
            day: string;
            attempts: number;
          }
        >("meal_illustration_user_usage")
        .select("*")
        .eq("user_id", userId)
        .order("day", { ascending: true })
        .range(start, start + 99);
      if (page.error) {
        if (
          start === 0 &&
          missingRelation(page.error, "meal_illustration_user_usage")
        )
          return [];
        throw new RepositoryError("Illustration usage export failed");
      }
      result.push(
        ...page.data.map((row) => ({
          userId: row.user_id as UserId,
          day: row.day,
          attempts: row.attempts,
        })),
      );
      if (page.data.length < 100) return result;
    }
  }
  async deleteForUser(userId: UserId): Promise<void> {
    const res = await this.options.serviceClient
      .from<IllustrationRow>("meal_illustrations")
      .delete()
      .eq("user_id", userId);
    if (res.error && !missingRelation(res.error, "meal_illustrations"))
      throw new RepositoryError("Illustration deletion failed");
    const usage = await this.options.serviceClient
      .from<Record<string, unknown>>("meal_illustration_user_usage")
      .delete()
      .eq("user_id", userId);
    if (
      usage.error &&
      !missingRelation(usage.error, "meal_illustration_user_usage")
    )
      throw new RepositoryError("Illustration deletion failed");
  }
  async invalidateForEntry(
    userId: UserId,
    sourceEntryId: string,
  ): Promise<void> {
    const res = await this.options.serviceClient
      .from<IllustrationRow>("meal_illustrations")
      .delete()
      .eq("user_id", userId)
      .eq("source_entry_id", sourceEntryId);
    if (res.error && !missingRelation(res.error, "meal_illustrations"))
      throw new RepositoryError("Illustration cleanup failed");
  }
}
