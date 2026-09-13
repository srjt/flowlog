/**
 * The grounding candidate fetch, guarded at the source (#114).
 *
 * A SOURCE SCAN rather than an import, for the reason `promptPlaceholders`
 * gives: the edge function is Deno (`Deno.env`, `.ts` import specifiers) and
 * cannot be loaded under Jest — which is the same gap that let #112 live. So
 * the test reads the file instead of skipping the file.
 *
 * `pagedSelect.test.ts` proves the paging LOOP is correct. Nothing there
 * proves the edge function still uses it: someone could reintroduce a bare
 * `&limit=` on this query and every other test would pass, which is exactly
 * how the 200 got in. This file covers that half.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(
  __dirname,
  '../../supabase/functions/process-session/index.ts',
);
const source = readFileSync(SOURCE, 'utf8');

/** The `loadGroundingRecords` body, so assertions cannot match other queries. */
function groundingFetch(): string {
  const start = source.indexOf('async function loadGroundingRecords');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\nfunction outputFromRow', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the coaching_records candidate fetch', () => {
  const fetchBody = groundingFetch();

  // The bug itself. 200 was the one constant in this path with no measurement
  // behind it, and it made 58% of the records across the nine largest
  // positions unreachable.
  it('does not cap the query with a hardcoded row limit', () => {
    expect(fetchBody).not.toMatch(/limit=\d/);
  });

  // Not optional. Offset paging over an unordered query may repeat rows on one
  // page and drop them from another, so ordering is what makes the paging
  // correct — before it is anything to do with ADR 0011's determinism.
  it('orders the query totally and stably', () => {
    expect(fetchBody).toContain('order=id.asc');
  });

  it('pages through the pool instead of issuing one capped request', () => {
    expect(fetchBody).toContain('selectAllPages');
    expect(fetchBody).toContain('RECORD_POOL_CEILING');
  });

  // `Prefer: count=exact` lives in `dbSelectCounted`. Using plain `dbSelect`
  // here would silently return to storing the fetched length.
  it('reads the row count from the database, not from the array', () => {
    expect(fetchBody).toContain('dbSelectCounted');
    expect(fetchBody).not.toMatch(/\bawait dbSelect\(/);
  });

  // `*` at 3,000 rows drags every future column into this hot path — an
  // embedding vector would be ~6 KB a row, arriving with no code change.
  it('names the columns it needs rather than selecting everything', () => {
    expect(fetchBody).not.toContain('select=*');
    expect(fetchBody).toContain('select=${GROUNDING_COLUMNS}');
  });

  it('selects exactly the columns the record mapper reads', () => {
    const declared = source.match(
      /const GROUNDING_COLUMNS =\s*([\s\S]*?);\n/,
    )?.[1];
    expect(declared).toBeTruthy();
    const columns = declared!
      .replace(/['+\s]/g, '')
      .split(',')
      .filter(Boolean);
    expect(columns.sort()).toEqual(
      [
        'certified',
        'contested',
        'counter',
        'detail',
        'gi',
        'id',
        'level',
        'opponent',
        'position',
        'prescription',
        'rejected',
        'why',
      ].sort(),
    );
  });
});

describe('what the session row records about the pool', () => {
  // The difference between the count and the fetched length is the only thing
  // standing between this fix and the bug it replaces. `.length` here would
  // make a capped pool read as a healthy one again, just at a bigger number.
  it('stores the database count, never the fetched length', () => {
    expect(source).toContain('groundingCandidates: candidatePool.total');
    expect(source).not.toMatch(/groundingCandidates:\s*\w+\.records\.length/);
  });

  // Migration 020's `grounding_candidates_is_exact()` reads the version stamp
  // to decide whether the column is a count or a lower bound. Re-analysis
  // rewrites the stamp, so it must rewrite the value too or the predicate lies.
  it('rewrites the candidate count wherever it rewrites the version', () => {
    const reanalysis = source.slice(
      source.indexOf("stage = 'reanalyze_persist'"),
      source.indexOf('One-shot record flow'),
    );
    expect(reanalysis).toContain('pipeline_version: PIPELINE_VERSION');
    expect(reanalysis).toContain('grounding_candidates: rePool.total');
  });
});

describe('the pipeline version boundary', () => {
  const version = source.match(/const PIPELINE_VERSION = '([^']+)'/)?.[1];
  const migration020 = readFileSync(
    join(
      __dirname,
      '../../supabase/migrations/020_grounding_candidates_exact.sql',
    ),
    'utf8',
  );

  // Asserted as an INVARIANT rather than a literal. The version moves whenever
  // a grounding fix lands (1.3.0 for #117), and a test pinning the number would
  // fail for the right change while missing the wrong one: shipping a version
  // that migration 020 still classifies as a lower bound.
  it('ships a version whose candidate count migration 020 calls exact', () => {
    expect(version).toBeTruthy();
    const clause = migration020.match(/not in \(([^)]*)\)/)?.[1];
    expect(clause).toBeTruthy();
    const excluded = clause!.split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(excluded).toEqual(['1.0.0', '1.1.0']);
    expect(excluded).not.toContain(version);
  });

  // Migration 021 documents the 1.3.0 boundary in prose; it must name the
  // version the code actually ships or the caveat points at nothing.
  it('is the version migration 021 names as the re-analysis boundary', () => {
    const migration021 = readFileSync(
      join(
        __dirname,
        '../../supabase/migrations/021_reanalysis_provenance.sql',
      ),
      'utf8',
    );
    expect(migration021).toContain(`before ${version}`);
  });
});

// ── The funnel has to be readable from a session row (#119) ──────────────────
//
// `grounding_available` is the length of the ALREADY-SLICED rank result, so it
// is min(gate-passers, GROUNDING_RECORD_LIMIT). It saturates at 20 and cannot
// answer how selective the relevance gate is — the number #116 must calibrate
// a cosine threshold against.
describe('what the session row records about the funnel', () => {
  it('stores the pre-cap gate count, not the capped one', () => {
    expect(source).toContain('groundingGatePassed: ranked.gatePassed');
    // `.records.length` here would re-create the bug: capped by construction.
    expect(source).not.toMatch(/groundingGatePassed:\s*\w+\.records\.length/);
  });

  it('ranks once and reads both numbers off it', () => {
    // A second uncapped rank purely to count would re-run a quadratic
    // computation — ~300ms on a 2,386-record pool — for a value the first call
    // already had and discarded.
    expect(source).toContain('rankRecordsWithStats');
    expect(source.match(/rankRecordsWithStats\(/g)).toHaveLength(2);
    expect(source).not.toMatch(/MAX_SAFE_INTEGER/);
  });

  it('records unknown rather than zero where nothing was ranked', () => {
    // 0 means the gate rejected everything, which is a finding about the
    // corpus. Conflating it with "not measured" is the #58 error one layer down.
    expect(source).toContain('groundingGatePassed: null');
  });
});
