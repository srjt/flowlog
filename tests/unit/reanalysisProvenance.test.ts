/**
 * Re-analysis must leave a row that tells the truth about itself (#117).
 *
 * Two halves, and they need two kinds of test.
 *
 * The CLIENT reference implementation is exercised for real: it used to skip
 * grounding on re-analysis entirely, so the edge function and the reference
 * built different prompts for the same session — the one thing
 * `src/sports/grounding.ts` opens by forbidding.
 *
 * The EDGE FUNCTION cannot be loaded under Jest (Deno globals, `.ts` import
 * specifiers), so its half is a source scan, the same compromise
 * `promptPlaceholders` and `groundingFetch` make.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = readFileSync(
  join(__dirname, '../../supabase/functions/process-session/index.ts'),
  'utf8',
);

/** The re-analysis branch alone, so assertions cannot match the insert path. */
function reanalysisBranch(): string {
  const start = EDGE.indexOf("stage = 'reanalyze'");
  const end = EDGE.indexOf('One-shot record flow');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return EDGE.slice(start, end);
}

describe('the edge function re-analysis path', () => {
  const branch = reanalysisBranch();

  // The bug. `assignGrounding` was called only on the insert path, so
  // re-analysis grounded unconditionally and never consulted the experiment.
  it('consults the experiment arm', () => {
    expect(branch).toContain('assignGrounding');
  });

  it('inherits the arm rather than re-drawing it', () => {
    // Re-deriving would need the original key, which cannot be rebuilt: the
    // insert keyed on the REQUEST's sessionDate while the row stores
    // `sessionDate ?? now()`.
    expect(branch).toMatch(/inheritedArm:\s*existing\.grounding/);
  });

  it('injects records only in the grounded arm', () => {
    expect(branch).toMatch(
      /reArm\.outcome === 'grounded' \? reRelevant : \[\]/,
    );
  });

  it.each([
    ['grounding', /grounding:\s*reArm\.outcome/],
    ['grounding_records', /grounding_records:\s*reArm\.inject/],
    ['grounding_available', /grounding_available:\s*reArm\.available/],
    ['grounding_record_ids', /grounding_record_ids:\s*reGrounding\.map/],
    ['grounding_candidates', /grounding_candidates:\s*rePool\.total/],
    ['grounding_gate_passed', /grounding_gate_passed:\s*reRanked\.gatePassed/],
  ])('writes %s on the success path', (_column, pattern) => {
    expect(branch).toMatch(pattern);
  });

  // The sharpest case: a declined re-analysis used to null the cue while
  // leaving `grounding = 'grounded'` and populated record ids behind it.
  it('leaves a declined re-analysis in the same state as a declined insert', () => {
    const declined = branch.slice(0, branch.indexOf('const { recentMistakes'));
    expect(declined).toContain("grounding: 'declined'");
    expect(declined).toContain('grounding_records: 0');
    expect(declined).toContain('grounding_available: 0');
    expect(declined).toContain('grounding_record_ids: []');
    expect(declined).toContain('grounding_candidates: null');
    // Unknown, not zero: nothing was ranked, so the gate never ran. 0 would
    // read as "the gate rejected everything" (#119).
    expect(declined).toContain('grounding_gate_passed: null');
  });

  // The only marker that reaches these rows: the version stamp cannot identify
  // a re-analysed row, because re-analysis writes whatever version is current.
  it('stamps reanalyzed_at on both the success and the declined path', () => {
    expect(
      branch.match(/reanalyzed_at: new Date\(\)\.toISOString\(\)/g),
    ).toHaveLength(2);
  });

  // Settled at capture time (#60): correcting a typo must not swap which
  // records can apply.
  it('does not re-decide the gi context', () => {
    expect(branch).not.toMatch(/gi:\s*giResolution/);
    expect(branch).toContain('existing.gi');
  });
});

describe('migration 021', () => {
  const sql = readFileSync(
    join(__dirname, '../../supabase/migrations/021_reanalysis_provenance.sql'),
    'utf8',
  );

  it('adds the marker column idempotently', () => {
    expect(sql).toMatch(/add column if not exists reanalyzed_at timestamptz/);
  });

  // `comment on` REPLACES. Restating 019's 1.0.0 caveats is not duplication —
  // dropping them would silently un-document that boundary.
  it('carries forward the 1.0.0 caveats it restates', () => {
    expect(sql).toContain('grounding_reached_model(pipeline_version)');
    expect(sql).toContain('CAVEAT (migration 019)');
    expect(sql).toContain('CAVEAT (migration 021)');
  });

  it('records that NULL means unknown, not never', () => {
    expect(sql).toMatch(/NOT that it never/);
  });
});
