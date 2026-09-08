import type {
  BodyMeasurementRepository,
  StoredBodyMeasurement,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface BodyMeasurementRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly measured_at: string;
  readonly weight_kg: number | null;
  readonly measurements: Record<string, unknown>;
  readonly source: string;
  readonly created_at: string;
}

export const bodyMeasurementFromRow = (
  row: BodyMeasurementRow,
): StoredBodyMeasurement => ({
  id: row.id,
  userId: row.user_id as UserId,
  measuredAt: new Date(row.measured_at),
  weightKg: row.weight_kg,
  measurements: { ...row.measurements },
  source: "manual",
  createdAt: new Date(row.created_at),
});
const fromRow = bodyMeasurementFromRow;

const toInsertRow = (
  userId: UserId,
  measurement: StoredBodyMeasurement,
): Partial<BodyMeasurementRow> => ({
  id: measurement.id,
  user_id: userId,
  measured_at: measurement.measuredAt.toISOString(),
  weight_kg: measurement.weightKg,
  measurements: { ...measurement.measurements },
  source: "manual",
});

export interface SupabaseBodyMeasurementRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseBodyMeasurementRepository implements BodyMeasurementRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseBodyMeasurementRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async create(
    userId: UserId,
    measurement: StoredBodyMeasurement,
    options: { readonly accessToken: string },
  ): Promise<StoredBodyMeasurement> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<BodyMeasurementRow>("body_measurements")
      .insert(toInsertRow(userId, measurement))
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "body measurement insert returned no row",
      );
    }
    return fromRow(data);
  }

  async list(
    userId: UserId,
    options: {
      readonly from: Date | null;
      readonly to: Date | null;
      readonly limit: number;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredBodyMeasurement>> {
    const client = this.#clientFor(options.accessToken);
    let builder = client
      .from<BodyMeasurementRow>("body_measurements")
      .select("*")
      .eq("user_id", userId)
      .order("measured_at", { ascending: false })
      .limit(options.limit);
    if (options.from !== null) {
      builder = builder.gte("measured_at", options.from.toISOString());
    }
    if (options.to !== null) {
      builder = builder.lte("measured_at", options.to.toISOString());
    }
    const { data, error } = await builder;
    if (error) {
      throw new RepositoryError(error.message);
    }
    return (data ?? []).map(fromRow);
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredBodyMeasurement | null> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<BodyMeasurementRow>("body_measurements")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(error.message);
    }
    return data === null ? null : fromRow(data);
  }

  async delete(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<boolean> {
    const client = this.#clientFor(options.accessToken);
    const { data, error } = await client
      .from<BodyMeasurementRow>("body_measurements")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      throw new RepositoryError(error.message);
    }
    return Array.isArray(data) && data.length > 0;
  }
}
