/**
 * Single error class used by every per-feature Supabase adapter
 * (profile / goals / food-entries). Callers can distinguish a
 * Supabase adapter failure from a domain validation failure
 * without depending on Supabase's internal error type.
 */
export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}