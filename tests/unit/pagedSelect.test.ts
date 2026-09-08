/**
 * The grounding candidate pool must be COMPLETE (#114).
 *
 * These test `selectAllPages`, which is the loop the edge function runs. It
 * lives in `src/` rather than beside the function precisely so it can be
 * exercised here: the edge function is Deno and cannot be loaded under Jest,
 * and #112 is the standing proof of what untested edge-function logic costs —
 * a stage doing less than it claims while every column reports success.
 *
 * The failure modes worth money are the quiet ones: a loop that never
 * terminates in a wall-clock-billed function, offset arithmetic that drops or
 * repeats a page, and a `content-range` parse that writes a wrong number into
 * `grounding_candidates`, where 0 means "corpus gap, go mine it" (#58).
 */
import {
  POSTGREST_MAX_ROWS,
  RECORD_POOL_CEILING,
  parseContentRangeTotal,
  selectAllPages,
} from '@/services/pagedSelect';

/** A fake table of `n` distinguishable rows, served the way PostgREST serves. */
function fakeTable(n: number, opts: { total?: number | null } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: { offset: number; limit: number }[] = [];
  const fetchPage = async (offset: number, limit: number) => {
    calls.push({ offset, limit });
    return {
      rows: rows.slice(offset, offset + limit),
      total: opts.total === undefined ? n : opts.total,
    };
  };
  return { rows, calls, fetchPage };
}

describe('parseContentRangeTotal', () => {
  it('reads the total off a PostgREST content-range', () => {
    expect(parseContentRangeTotal('0-999/2478')).toBe(2478);
  });

  it('handles an empty range', () => {
    expect(parseContentRangeTotal('*/0')).toBe(0);
  });

  // Null, not 0 or NaN. A bad parse lands in `grounding_candidates`, where 0
  // is read as an empty corpus and sends someone mining a position that has
  // 1,114 records.
  it.each([
    ['a missing header', null],
    ['an uncounted response', '0-9/*'],
    ['a malformed header', 'garbage'],
    ['a negative total', '0-9/-3'],
    ['a fractional total', '0-9/1.5'],
  ])('returns null for %s', (_label, header) => {
    expect(parseContentRangeTotal(header)).toBeNull();
  });
});

describe('selectAllPages', () => {
  it('returns every row when the pool spans several pages', async () => {
    const t = fakeTable(2478);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toHaveLength(2478);
    expect(out.rows).toEqual(t.rows);
    expect(out.total).toBe(2478);
    expect(out.truncated).toBe(false);
  });

  // The measured production case: `standing` is 1,114 rows behind a server
  // that will never return more than 1,000 in one response.
  it('reaches past the PostgREST 1000-row cap', async () => {
    const t = fakeTable(1114);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toHaveLength(1114);
    expect(t.calls).toEqual([
      { offset: 0, limit: 1000 },
      { offset: 1000, limit: 1000 },
    ]);
  });

  it('pages by rows already held, so nothing is skipped or repeated', async () => {
    const t = fakeTable(2100);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(new Set(out.rows.map((r) => r.id)).size).toBe(2100);
    expect(t.calls.map((c) => c.offset)).toEqual([0, 1000, 2000]);
  });

  it('stops at the ceiling and reports the pool as truncated', async () => {
    const t = fakeTable(5000);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toHaveLength(3000);
    // The whole point: the count is the pool's size, NOT the fetch's. A caller
    // storing `rows.length` here would write 3000 and recreate #114 with a
    // bigger number.
    expect(out.total).toBe(5000);
    expect(out.truncated).toBe(true);
  });

  it('never asks for more rows than the ceiling allows', async () => {
    const t = fakeTable(5000);
    await selectAllPages(t.fetchPage, 2500, 1000);

    expect(t.calls).toEqual([
      { offset: 0, limit: 1000 },
      { offset: 1000, limit: 1000 },
      { offset: 2000, limit: 500 },
    ]);
  });

  it('makes one request when the pool fits in a page', async () => {
    const t = fakeTable(46);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toHaveLength(46);
    expect(t.calls).toHaveLength(1);
    expect(out.truncated).toBe(false);
  });

  it('makes one request for an empty pool', async () => {
    const t = fakeTable(0);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toEqual([]);
    expect(out.total).toBe(0);
    expect(t.calls).toHaveLength(1);
  });

  it('stops on a full final page rather than fetching an empty one', async () => {
    const t = fakeTable(2000);
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toHaveLength(2000);
    // Two pages, not three: the count says the pool is exhausted, so the
    // third request is not made.
    expect(t.calls).toHaveLength(2);
  });

  // This runs in a function billed by wall-clock time. A server that keeps
  // answering must not keep us looping.
  it('terminates when a server returns empty pages forever', async () => {
    let calls = 0;
    const out = await selectAllPages(
      async () => {
        calls++;
        return { rows: [], total: 999999 };
      },
      3000,
      1000,
    );

    expect(calls).toBe(1);
    expect(out.rows).toEqual([]);
  });

  it('still pages by short pages when the count is unavailable', async () => {
    const t = fakeTable(1500, { total: null });
    const out = await selectAllPages(t.fetchPage, 3000, 1000);

    expect(out.rows).toHaveLength(1500);
    // Unknown, never coerced to `rows.length` — a caller writing that into
    // `grounding_candidates` would state a fetched count as a found count.
    expect(out.total).toBeNull();
    // And with no count we cannot claim truncation either way. Claiming it
    // falsely is the same category of error as hiding it.
    expect(out.truncated).toBe(false);
  });

  it('keeps the first page count, not a later one', async () => {
    let call = 0;
    const out = await selectAllPages(
      async (offset, limit) => {
        call++;
        return {
          rows: Array.from(
            { length: Math.min(limit, 1500 - offset) },
            (_, i) => ({
              id: offset + i,
            }),
          ),
          // A concurrent publish between pages must not change the number we
          // report; the first is the one taken before our own paging began.
          total: call === 1 ? 1500 : 1600,
        };
      },
      3000,
      1000,
    );

    expect(out.total).toBe(1500);
  });

  it('defaults to the measured production constants', async () => {
    const t = fakeTable(1114);
    const out = await selectAllPages(t.fetchPage);

    expect(out.rows).toHaveLength(1114);
    expect(t.calls.map((c) => c.limit)).toEqual([
      POSTGREST_MAX_ROWS,
      POSTGREST_MAX_ROWS,
    ]);
  });

  // Sized from measurement: the largest single position is `standing` at 1,114
  // and the largest realistic multi-position session is 2,478. Below the full
  // 5,574-record corpus on purpose — a ceiling that can never fire is
  // decoration.
  it('has a ceiling above the worst measured session and below the corpus', () => {
    expect(RECORD_POOL_CEILING).toBeGreaterThan(2478);
    expect(RECORD_POOL_CEILING).toBeLessThan(5574);
  });
});
