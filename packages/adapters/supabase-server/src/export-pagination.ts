import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_PAGES = 1000;

/** Owner-scoped, bounded reads. Only an empty page establishes exhaustion. */
export async function fetchAllExportPages<T extends Record<string, unknown>>(
  client: RepositorySupabaseClient,
  table: string,
  filterCol: string,
  filterVal: string,
  orderCol: string,
  ascending = true,
  tieBreaker = "id",
  /** Read only these columns (default `*`). */
  columns = "*",
): Promise<ReadonlyArray<T>> {
  const all: T[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_EXPORT_PAGES; page++) {
    let query = client.from<T>(table).select(columns).eq(filterCol, filterVal);
    query = query.order(orderCol, { ascending });
    if (orderCol !== tieBreaker) {
      query = query.order(tieBreaker, { ascending: true });
    }
    const { data, error } = await query.range(
      offset,
      offset + EXPORT_PAGE_SIZE - 1,
    );
    if (error || !Array.isArray(data)) {
      throw new RepositoryError(
        `Unable to read account export category: ${table}`,
      );
    }
    if (data.length === 0) return all;
    all.push(...data);
    // A configured PostgREST cap may be smaller than our requested range.
    offset += data.length;
  }
  throw new RepositoryError(`Account export page limit exceeded: ${table}`);
}
