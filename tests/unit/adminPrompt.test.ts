import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COACHING_CUE_MAX_WORDS,
  GROUNDING_COLUMNS,
  RECENT_MISTAKES_WINDOW,
  buildTodaysPrompt,
  compareWithStored,
  inferredPerspective,
  positionsToday,
  recordedPerspective,
  toPoolRecord,
  type PoolRecord,
  type PromptContext,
  type PromptSessionRow,
} from '../../scripts/admin/prompt';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const row = (o: Partial<PromptSessionRow> = {}): PromptSessionRow => ({
  id: 's1',
  user_id: 'u1',
  sport_key: 'bjj',
  session_date: '2026-09-10T18:00:00Z',
  audio_storage_path: null,
  raw_transcript: 'Stuck on bottom of half guard again',
  positions_visited: ['half guard'],
  key_mistake: 'Flat on my back in half guard, never framed',
  opponent_action: 'Crossface and underhook',
  sentiment: 'frustrated',
  coaching_cue: 'Frame on the hip.',
  target_position: null,
  target_position_id: 'half-guard-bottom',
  quality_gate_passed: true,
  thumbs_up: null,
  feedback_reason: null,
  feedback_note: null,
  pipeline_version: '1.3.0',
  gi: 'gi',
  // Not recorded, as on every Session from before migration 024. The
  // fallbacks below are only reached for rows like this.
  perspective: null,
  grounding: 'grounded',
  grounding_candidates: 3,
  grounding_available: 1,
  grounding_records: 1,
  grounding_record_ids: ['r1'],
  reanalyzed_at: null,
  ...o,
});

const record = (id: string, o: Partial<PoolRecord> = {}): PoolRecord => ({
  id,
  position: 'half-guard-bottom',
  prescription: 'Get on your side in half guard and frame before they settle',
  why: '',
  detail: '',
  counter: '',
  gi: 'either',
  level: 'any',
  opponent: '',
  certified: false,
  contested: false,
  rejected: false,
  ...o,
});

const ctx = (o: Partial<PromptContext> = {}): PromptContext => ({
  skillLevel: 'Blue Belt',
  recentMistakes: ['Late on the underhook', 'Gave up the back'],
  dominantWeakness: 'half guard bottom',
  pool: [],
  ...o,
});

describe("cue review: today's prompt", () => {
  it('fills every input, leaving no placeholder behind', () => {
    const { prompt } = buildTodaysPrompt(row(), ctx(), []);
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(prompt).toContain('Skill level: Blue Belt');
    expect(prompt).toContain(
      'key mistake: Flat on my back in half guard, never framed',
    );
    expect(prompt).toContain('Opponent action: Crossface and underhook');
    expect(prompt).toContain('Positions visited: half guard');
    expect(prompt).toContain('Late on the underhook; Gave up the back');
    expect(prompt).toContain('Dominant weakness so far: half guard bottom');
  });

  it('uses the same fallbacks as the edge function when inputs are empty', () => {
    const { prompt, caveats } = buildTodaysPrompt(
      row({ positions_visited: [] }),
      ctx({ skillLevel: null, recentMistakes: [], dominantWeakness: null }),
      [],
    );
    expect(prompt).toContain('Positions visited: none');
    expect(prompt).toContain('last sessions): none recorded');
    expect(prompt).toContain('Dominant weakness so far: not yet established');
    expect(prompt).toContain('Skill level: not set');
    expect(caveats).toContain(
      'The athlete has no skill level on their profile.',
    );
  });

  it('re-selects records: gi filter, then the relevance gate, then the cap', () => {
    const pool = [
      record('r1'),
      // Matches, but for the wrong attire: removed before ranking.
      record('r2', { gi: 'no-gi' }),
      // Right attire, nothing to do with the mistake: fails the gate.
      record('r3', { prescription: 'Control the wrist before the kimura' }),
      // Matches, but reviewers rejected it: never grounds.
      record('r4', { rejected: true }),
    ];
    const { prompt, selection } = buildTodaysPrompt(row(), ctx({ pool }), [
      'half-guard-bottom',
    ]);
    expect(selection).toEqual({
      pool: 4,
      afterGi: 3,
      gatePassed: 1,
      injected: 1,
      recordIds: ['r1'],
    });
    expect(prompt).toContain('Get on your side in half guard');
    expect(prompt).not.toContain('kimura');
  });

  it('leads with the declined caveat on a declined take', () => {
    const { caveats } = buildTodaysPrompt(
      row({ grounding: 'declined' }),
      ctx(),
      [],
    );
    expect(caveats[0]).toMatch(/declined/);
    expect(caveats[1]).toMatch(/not the prompt this Cue came from/);
  });

  it('shapes records the way loadGroundingRecords does', () => {
    expect(
      toPoolRecord({ id: 'x', prescription: 'p', why: null, gi: null }),
    ).toEqual({
      ...record('x', { prescription: 'p', position: '' }),
    });
  });

  const UNKNOWN = { side: 'unknown', source: null };

  it('without a recorded side, takes it from the records the session was grounded in first', () => {
    // The live case that broke the rebuild: the Cue targeted "Berimbolo",
    // which never resolves, so the target position carried no side and "De La
    // Riva Guard" resolved to nothing — 18 grounded records rebuilt as zero.
    // The records the pipeline selected carry the side it actually used.
    const berimbolo = row({
      // No side phrase anywhere, as in the live session.
      raw_transcript: 'Went for the berimbolo and lost the hips again',
      key_mistake: 'Losing control of the hips during the berimbolo',
      opponent_action: null,
      target_position_id: null,
      positions_visited: ['De La Riva Guard', 'Berimbolo', 'Leg Drag'],
    });
    const side = inferredPerspective(berimbolo, [
      'de-la-riva-bottom',
      'de-la-riva-bottom',
    ]);
    expect(side).toEqual({ side: 'bottom', source: 'stored records' });
    expect(positionsToday(berimbolo, side.side)).toEqual(['de-la-riva-bottom']);
    expect(positionsToday(berimbolo, 'unknown')).toEqual([]);
  });

  it('prefers stored records over the target position', () => {
    expect(
      inferredPerspective(row({ target_position_id: 'mount-top' }), [
        'half-guard-bottom',
      ]),
    ).toEqual({ side: 'bottom', source: 'stored records' });
  });

  it('falls back to the stored target position', () => {
    expect(inferredPerspective(row())).toEqual({
      side: 'bottom',
      source: 'target position',
    });
    // Records that disagree about the side are no evidence either way.
    expect(
      inferredPerspective(row({ target_position_id: 'mount-top' }), [
        'mount-top',
        'mount-bottom',
      ]),
    ).toEqual({ side: 'top', source: 'target position' });
    expect(positionsToday(row(), 'bottom')).toContain('half-guard-bottom');
  });

  it('leaves the side unknown rather than guessing', () => {
    expect(inferredPerspective(row({ target_position_id: null }))).toEqual(
      UNKNOWN,
    );
    expect(
      inferredPerspective(row({ target_position_id: 'standing' }), [
        'standing',
      ]),
    ).toEqual(UNKNOWN);
    expect(
      positionsToday(
        row({ target_position_id: null, positions_visited: ['standing'] }),
        'unknown',
      ),
    ).toEqual(['standing']);
  });

  // ── The recorded side (#130, migration 024) ──────────────────────────────

  it('takes the recorded side over both fallbacks', () => {
    // Records and target both say bottom; the Session recorded top. What
    // Extraction actually reported wins over anything inferred from its output.
    expect(
      inferredPerspective(row({ perspective: 'top' }), ['half-guard-bottom']),
    ).toEqual({ side: 'top', source: 'recorded' });
  });

  it('carries the side of a Berimbolo Session with no records to infer from', () => {
    // The one case that defeats every inference: the Cue targeted something
    // non-canonical, so the target position carries no side, and here no
    // records were stored either.
    const berimbolo = row({
      perspective: 'bottom',
      raw_transcript: 'Went for the berimbolo and lost the hips again',
      key_mistake: 'Losing control of the hips during the berimbolo',
      opponent_action: null,
      target_position_id: null,
      grounding_record_ids: null,
      positions_visited: ['De La Riva Guard', 'Berimbolo', 'Leg Drag'],
    });
    const side = inferredPerspective(berimbolo);
    expect(side).toEqual({ side: 'bottom', source: 'recorded' });
    expect(positionsToday(berimbolo, side.side)).toEqual(['de-la-riva-bottom']);
  });

  it("uses a recorded 'unknown' as is instead of inferring a side", () => {
    // Extraction abstained, and the pipeline grounded with that abstention.
    // Guessing a side here would rebuild a prompt the pipeline never built.
    const abstained = row({ perspective: 'unknown' });
    const side = inferredPerspective(abstained, ['half-guard-bottom']);
    expect(side).toEqual({ side: 'unknown', source: 'recorded' });
    const { caveats } = buildTodaysPrompt(abstained, ctx(), [], side);
    expect(caveats[1]).toMatch(/Extraction recorded that it could not tell/);
    expect(caveats[1]).not.toMatch(/not recorded/);
  });

  it('still resolves a Session with no recorded side from its records', () => {
    expect(
      inferredPerspective(row({ perspective: null }), ['half-guard-bottom']),
    ).toEqual({ side: 'bottom', source: 'stored records' });
    // Before 024 is applied the column is absent altogether; same answer.
    const { perspective: _absent, ...pre024 } = row();
    expect(inferredPerspective(pre024, ['half-guard-bottom'])).toEqual({
      side: 'bottom',
      source: 'stored records',
    });
  });

  it('never reads NULL as "Extraction could not tell"', () => {
    expect(recordedPerspective(row({ perspective: null }))).toBeNull();
    // Only the three recorded values count; anything else is not a record.
    expect(
      recordedPerspective(
        row({ perspective: 'neutral' as unknown as 'unknown' }),
      ),
    ).toBeNull();

    // Nothing recorded and nothing to infer from: unknown, but from no
    // source, which is not the recorded abstention above.
    const nothing = row({ perspective: null, target_position_id: null });
    const side = inferredPerspective(nothing);
    expect(side).toEqual(UNKNOWN);
    expect(side.source).not.toBe('recorded');
    const { caveats } = buildTodaysPrompt(nothing, ctx(), [], side);
    expect(caveats[1]).toMatch(/Perspective was not recorded for this session/);
    expect(caveats[1]).not.toMatch(/Extraction recorded/);
  });

  it('says when the side is the one Extraction recorded', () => {
    const { caveats } = buildTodaysPrompt(
      row({ perspective: 'top' }),
      ctx(),
      [],
    );
    expect(caveats[1]).toMatch(/"top" is the side Extraction recorded/);
  });

  it('names where the side came from in the caveats', () => {
    const fromRecords = buildTodaysPrompt(row(), ctx(), [], {
      side: 'bottom',
      source: 'stored records',
    });
    expect(fromRecords.caveats[1]).toMatch(
      /"bottom" from the records this session was grounded in/,
    );
    const unknown = buildTodaysPrompt(
      row({ target_position_id: null }),
      ctx(),
      [],
    );
    expect(unknown.caveats[1]).toMatch(/may not resolve/);
  });

  it('compares today’s records with the ids the stored prompt carried', () => {
    const stored = row({ grounding_record_ids: ['a', 'b', 'c'] });
    expect(compareWithStored(stored, ['a', 'b', 'c'])).toEqual({
      stored: 3,
      today: 3,
      shared: 3,
      sameOrder: true,
    });
    expect(compareWithStored(stored, ['b', 'a', 'c'])?.sameOrder).toBe(false);
    expect(compareWithStored(stored, ['a', 'x'])).toEqual({
      stored: 3,
      today: 2,
      shared: 1,
      sameOrder: false,
    });
    // Nothing to compare against: unknown, or known-empty.
    expect(compareWithStored(row({ grounding_record_ids: null }), ['a'])).toBe(
      null,
    );
    expect(compareWithStored(row({ grounding_record_ids: [] }), ['a'])).toBe(
      null,
    );
  });

  it('keeps its mirrored constants in step with process-session', () => {
    const source = read('supabase/functions/process-session/index.ts');
    const value = (name: string) =>
      source.match(new RegExp(`const ${name} = (\\d+);`))?.[1];
    expect(Number(value('COACHING_CUE_MAX_WORDS'))).toBe(
      COACHING_CUE_MAX_WORDS,
    );
    expect(Number(value('RECENT_MISTAKES_WINDOW'))).toBe(
      RECENT_MISTAKES_WINDOW,
    );
    const columns = source.match(
      /const GROUNDING_COLUMNS =\s*'([^']+)' \+\s*'([^']+)';/,
    );
    expect(columns ? `${columns[1]}${columns[2]}` : null).toBe(
      GROUNDING_COLUMNS,
    );
  });
});

// ── The abstention, mirrored (#153, migration 027) ──────────────────────────
// The rebuild is the prompt the pipeline WOULD send now, so it has to abstain
// where the pipeline does, and only there.
describe("cue review: today's prompt abstains like the pipeline", () => {
  const reverseTriangle = (o: Partial<PromptSessionRow> = {}) =>
    row({
      positions_visited: ['Side Control', 'Reverse Triangle'],
      key_mistake: 'Unable to finish the reverse triangle; he stacked me',
      raw_transcript:
        'Stuck under side control, then he stacked my reverse triangle',
      target_position_id: null,
      perspective: 'bottom',
      ...o,
    });

  it.each(['submission', 'transition'] as const)(
    'looks no records up when the Session recorded %s',
    (concerns) => {
      const r = reverseTriangle({ mistake_concerns: concerns });
      expect(positionsToday(r, 'bottom')).toEqual([]);
      const { caveats, selection } = buildTodaysPrompt(r, ctx(), []);
      expect(selection.injected).toBe(0);
      expect(caveats).toContain(
        `Extraction recorded that the key mistake is about a ${concerns}, not a position, so, as in the pipeline, grounding abstains and no records are looked up.`,
      );
    },
  );

  // NULL is a Session from before 027: not recorded, never an abstention.
  it.each([
    ['position', 'position'],
    ['unknown', 'unknown'],
    ['not recorded', null],
    ['absent before 027', undefined],
  ] as const)('grounds as before when it recorded %s', (_label, concerns) => {
    const r = reverseTriangle({ mistake_concerns: concerns });
    expect(positionsToday(r, 'bottom')).toEqual(['side-control-bottom']);
    const { caveats } = buildTodaysPrompt(r, ctx(), ['side-control-bottom']);
    expect(caveats.join('\n')).not.toMatch(/grounding abstains/);
  });
});
