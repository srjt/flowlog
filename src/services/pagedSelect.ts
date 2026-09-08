/**
 * Paging for PostgREST reads that must see a WHOLE table slice (#114).
 *
 * Dependency-free with no imports at all, on purpose: this file is imported by
 * the Supabase edge function via a relative `.ts` specifier, exactly like
 * `src/sports/grounding.ts`. Keep it free of any `@/`, node, or React Native
 * import or the Deno bundle breaks.
 *
 * It lives under `src/` rather than beside the edge function for ONE reason:
 * the edge function cannot be loaded under Jest (Deno globals, `.ts` import
 * specifiers), and #112 is the standing proof of what untested edge-function
 * logic costs. A paging loop that silently drops a page fails exactly like the
 * bug this fixes — everything around it succeeds — so it is tested where tests
 * can reach it. The app itself never calls this; nothing in the client bundle
 * imports it.
 *
 * ── Why paging is needed at all ──────────────────────────────────────────────
 *
 * PostgREST on this project enforces `db-max-rows = 1000`. Measured, not
 * assumed: `coaching_records?position=eq.standing` has 1,114 rows, and both an
 * unbounded request AND `limit=2000` return exactly 1,000. So "remove the
 * limit" does not fetch the table — it swaps a 200-row truncation for a
 * 1,000-row one, silently, on the largest position in the corpus.
 */

/**
 * The server's own ceiling. Asking for more in one request does not get more,
 * so this is the page size rather than a preference.
 */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Hard stop on how many rows one pool fetch will accumulate.
 *
 * Sized from measurement, not taste. The largest single position is `standing`
 * at 1,114 records, and the largest realistic multi-position session
 * (`standing` + `closed-guard-bottom` + `half-guard-bottom`) is 2,478 — so
 * 3,000 clears today's worst case with headroom while capping one fetch at
 * ~2.2 MB and three round-trips.
 *
 * It is deliberately BELOW the full 5,574-record corpus. A ceiling that can
 * never fire is decoration; this one fires when the corpus outgrows the design,
 * which is the signal we actually want. When it fires nothing is silent:
 * `grounding_candidates` carries the true count from the database (see
 * `selectAllPages`), so a truncated pool is visible as
 * `grounding_candidates > records fetched` rather than as a healthy-looking
 * number equal to the cap. That distinction is the whole point of #114.
 */
export const RECORD_POOL_CEILING = 3000;

/** One page of a PostgREST read, plus the exact total when it was requested. */
export interface FetchedPage<T> {
  rows: T[];
  /** From `content-range` when `Prefer: count=exact` was sent; else null. */
  total: number | null;
}

export interface PagedResult<T> {
  rows: T[];
  /**
   * How many rows MATCH the query, which is not how many were fetched. Null
   * when the count was unavailable — unknown, never silently coerced to
   * `rows.length`, or the caller re-learns the bug this module exists to fix.
   */
  total: number | null;
  /** True when the ceiling stopped us before the pool was exhausted. */
  truncated: boolean;
}

/**
 * Parse the row total out of a PostgREST `content-range` header.
 *
 * The header is `<first>-<last>/<total>`, e.g. `0-999/2478`, and the total is
 * `*` when it was not requested. Returns null for anything unparseable rather
 * than a number: a bad parse that yields 0 or NaN would be written straight
 * into `grounding_candidates`, where 0 means "corpus gap, go mine it" (#58).
 * Getting that wrong sends someone mining a position that has 1,114 records.
 */
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const slash = header.lastIndexOf('/');
  if (slash < 0) return null;
  const total = Number(header.slice(slash + 1).trim());
  return Number.isInteger(total) && total >= 0 ? total : null;
}

/**
 * Read every row matching a query, up to `ceiling`.
 *
 * The page fetcher is injected so the loop is testable without a server, and
 * so this module needs no knowledge of auth, headers, or the REST helper.
 *
 * The caller MUST supply a total ordering (this is `order=id.asc` for the
 * grounding pool). Offset paging over an unordered query is unsound by
 * construction: Postgres may return a different row order per request, so
 * page 2 can repeat rows from page 1 and omit others. Ordering is what makes
 * paging correct, and it is a separate matter from ordering being MEANINGFUL —
 * see the ranking comments in `src/sports/grounding.ts`.
 */
export async function selectAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<FetchedPage<T>>,
  ceiling: number = RECORD_POOL_CEILING,
  pageSize: number = POSTGREST_MAX_ROWS,
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  let total: number | null = null;

  while (rows.length < ceiling) {
    const limit = Math.min(pageSize, ceiling - rows.length);
    const page = await fetchPage(rows.length, limit);
    // The count comes back on every page; keep the first, which is the one
    // taken before any of our own paging could influence it.
    if (total === null) total = page.total;
    // A page with nothing in it is the end of the table. Checked before the
    // short-page test below so a server that returns [] forever terminates
    // instead of looping: this runs in a function billed by wall-clock time.
    if (page.rows.length === 0) break;
    rows.push(...page.rows);
    // A short page means the rows ran out — the only end condition that does
    // not depend on the count being available.
    if (page.rows.length < limit) break;
    if (total !== null && rows.length >= total) break;
  }

  return {
    rows,
    total,
    // Unknown total means we cannot claim truncation either way, and claiming
    // it falsely is the same category of error as hiding it.
    truncated: total !== null && rows.length < total,
  };
}
