/**
 * The AI second opinion and the better Cue (migration 027) in the review
 * tool's pure model: the better-Cue rules, the blind-first reveal, the
 * agreement report against the hand-over bar, and the migration at the source.
 *
 * The server round trip (that an unrevealed opinion never reaches the page)
 * is driven for real in adminServer.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BETTER_CUE_MAX_LENGTH,
  CUE_WORD_CAP,
  HAND_OVER_BAR,
  instrumentOf,
  parseVerdictRequest,
  revealOpinions,
  secondOpinionReport,
  toSummary,
  type AiCall,
  type AiOpinionRow,
  type CueVerdict,
  type HandOverBar,
  type SessionRow,
  type SessionSummary,
  type VerdictRow,
} from '../../scripts/admin/review';

const SQL = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '027_ai_second_opinion.sql',
  ),
  'utf8',
);

const SID = '11111111-1111-4111-8111-111111111111';
const CUE = 'Get on your side and frame on the hip.';
const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');

const opinion = (o: Partial<AiOpinionRow> = {}): AiOpinionRow => ({
  session_id: SID,
  cue: CUE,
  defective: true,
  mode: 'ungrounded',
  records_available: 0,
  claims: [],
  rationale: 'no checkable claim in the cue',
  judge_model: 'judge-model',
  judge_version: '1',
  created_at: '2026-10-02T09:00:00Z',
  ...o,
});

// ── The better Cue ──────────────────────────────────────────────────────────

describe('a better Cue on a verdict', () => {
  const body = (o: Record<string, unknown> = {}) => ({
    sessionId: SID,
    cue: CUE,
    verdict: 'shallow',
    reason: null,
    note: null,
    ...o,
  });
  const better = (o: Record<string, unknown>) => {
    const out = parseVerdictRequest(body(o));
    return out.ok && out.value.verdict !== null ? out.value.betterCue : out;
  };

  it('is kept, trimmed, on a shallow or a wrong verdict', () => {
    expect(better({ betterCue: '  Frame first, then hip escape. ' })).toBe(
      'Frame first, then hip escape.',
    );
    expect(
      better({
        verdict: 'wrong',
        reason: 'off_target',
        betterCue: 'Frame first.',
      }),
    ).toBe('Frame first.');
  });

  it('is optional: absent, null or blank all mean none', () => {
    expect(better({})).toBeNull();
    expect(better({ betterCue: null })).toBeNull();
    expect(better({ betterCue: '   ' })).toBeNull();
  });

  it('is refused on a sound verdict: a sound Cue needs no replacement', () => {
    expect(
      parseVerdictRequest(body({ verdict: 'sound', betterCue: 'x' })).ok,
    ).toBe(false);
    // Blank is no better Cue at all, so it's fine there.
    expect(
      parseVerdictRequest(body({ verdict: 'sound', betterCue: ' ' })).ok,
    ).toBe(true);
  });

  it(`is a Cue, so it is capped at ${CUE_WORD_CAP} words`, () => {
    expect(better({ betterCue: words(CUE_WORD_CAP) })).toBe(
      words(CUE_WORD_CAP),
    );
    expect(
      parseVerdictRequest(body({ betterCue: words(CUE_WORD_CAP + 1) })).ok,
    ).toBe(false);
  });

  it('is bounded in characters too, and must be text', () => {
    const long = 'x'.repeat(BETTER_CUE_MAX_LENGTH + 1);
    expect(parseVerdictRequest(body({ betterCue: long })).ok).toBe(false);
    expect(parseVerdictRequest(body({ betterCue: 7 })).ok).toBe(false);
  });

  it('cannot ride along on clearing a verdict', () => {
    expect(
      parseVerdictRequest({
        sessionId: SID,
        cue: CUE,
        verdict: null,
        betterCue: 'x',
      }).ok,
    ).toBe(false);
  });
});

// ── Blind first ─────────────────────────────────────────────────────────────

describe('revealOpinions: blind first', () => {
  it('holds back every opinion on the current Cue until it is judged', () => {
    const opinions = [opinion(), opinion({ judge_model: 'other' })];
    expect(revealOpinions(CUE, false, opinions)).toEqual({
      shown: [],
      hidden: 2,
    });
  });

  it('shows them once judged, newest first', () => {
    const old = opinion({ created_at: '2026-10-01T00:00:00Z' });
    const recent = opinion({
      judge_model: 'other',
      created_at: '2026-10-03T00:00:00Z',
    });
    expect(revealOpinions(CUE, true, [old, recent])).toEqual({
      shown: [recent, old],
      hidden: 0,
    });
  });

  it('never shows, or counts, an opinion about an earlier Cue', () => {
    const earlier = opinion({ cue: 'The Cue before a Re-analyze.' });
    expect(revealOpinions(CUE, true, [earlier])).toEqual({
      shown: [],
      hidden: 0,
    });
    expect(revealOpinions(CUE, false, [earlier])).toEqual({
      shown: [],
      hidden: 0,
    });
    expect(revealOpinions(null, true, [opinion()])).toEqual({
      shown: [],
      hidden: 0,
    });
  });

  it('carries into the list summary the same way', () => {
    const row = {
      id: SID,
      user_id: 'u1',
      session_date: '2026-10-01T18:00:00Z',
      coaching_cue: CUE,
      reanalyzed_at: null,
      pipeline_version: '1.3.0',
      grounding_record_ids: [],
    } as unknown as SessionRow;
    const ctx = {
      athlete: 'Ana',
      positionLabel: null,
      facts: { reachedModel: true, candidatesExact: true },
      opinions: [opinion()],
    };
    const unjudged = toSummary(row, { ...ctx, verdicts: [] });
    expect(unjudged).toMatchObject({ ai: [], aiHidden: 1 });

    const verdict = {
      id: 'v1',
      session_id: SID,
      cue: CUE,
      verdict: 'sound',
      reason: null,
    } as unknown as VerdictRow;
    const judged = toSummary(row, { ...ctx, verdicts: [verdict] });
    expect(judged).toMatchObject({
      aiHidden: 0,
      ai: [
        {
          instrument: 'judge-model (judge v1)',
          defective: true,
          mode: 'ungrounded',
        },
      ],
    });
  });
});

// ── Agreement against the hand-over bar ─────────────────────────────────────

let day = 0;
function judged(
  verdict: CueVerdict | null,
  ai: Partial<AiCall> | null,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  day += 1;
  return {
    id: `s${String(day).padStart(3, '0')}`,
    userId: 'u1',
    athlete: 'Ana',
    sessionDate: new Date(Date.UTC(2026, 0, 1) + day * 864e5).toISOString(),
    cue: CUE,
    keyMistake: null,
    transcript: null,
    targetPositionId: null,
    targetPositionLabel: null,
    grounding: 'grounded',
    gatePassed: true,
    thumbsUp: null,
    feedbackReason: null,
    trail: 'trusted',
    reanalyzed: false,
    verdict,
    verdictReason: verdict === 'wrong' ? 'model_wrong' : null,
    earlierVerdicts: 0,
    cueWriter: 'pro-model',
    ai: ai
      ? [
          {
            instrument: 'judge-model (judge v1)',
            defective: false,
            mode: 'grounded',
            ...ai,
          },
        ]
      : [],
    aiHidden: 0,
    ...extra,
  };
}

const many = (n: number, f: () => SessionSummary) =>
  Array.from({ length: n }, f);

describe('secondOpinionReport', () => {
  beforeEach(() => {
    day = 0;
  });

  it('scores flags against your wrong and your sound Cues, shallow apart', () => {
    const r = secondOpinionReport([
      judged('wrong', { defective: true }),
      judged('wrong', { defective: false }),
      judged('sound', { defective: false, mode: 'grounded' }),
      judged('sound', { defective: true, mode: 'ungrounded' }),
      judged('shallow', { defective: true }),
    ]);
    const [x] = r.instruments;
    expect(x).toMatchObject({
      instrument: 'judge-model (judge v1)',
      status: 'not_enough',
      paired: 5,
      caught: { n: 1, of: 2 },
      caughtByMode: {
        grounded: { n: 1, of: 2 },
        ungrounded: { n: 0, of: 0 },
      },
      falseAlarms: { n: 1, of: 2 },
      falseAlarmsByMode: {
        grounded: { n: 0, of: 1 },
        ungrounded: { n: 1, of: 1 },
      },
      shallowFlagged: { n: 1, of: 1 },
      missed: ['s002'],
      falselyFlagged: ['s004'],
    });
  });

  it('lists disagreements newest first, so the latest are read first', () => {
    const r = secondOpinionReport([
      judged('wrong', { defective: false }),
      judged('wrong', { defective: false }),
    ]);
    expect(r.instruments[0]?.missed).toEqual(['s002', 's001']);
  });

  const bar: HandOverBar = {
    minPaired: 20,
    minEach: 10,
    minCatch: 0.7,
    maxFalseAlarm: 0.2,
  };
  /** `wrong` wrong Cues with `caught` flagged, `sound` sound with `alarms`. */
  const run = (caught: number, wrong: number, alarms: number, sound: number) =>
    secondOpinionReport(
      [
        ...many(caught, () => judged('wrong', { defective: true })),
        ...many(wrong - caught, () => judged('wrong', { defective: false })),
        ...many(alarms, () => judged('sound', { defective: true })),
        ...many(sound - alarms, () => judged('sound', { defective: false })),
      ],
      bar,
    ).instruments[0]?.status;

  it('clears the bar at its edges and not just past them', () => {
    expect(run(7, 10, 2, 10)).toBe('cleared');
    expect(run(6, 10, 2, 10)).toBe('not_cleared'); // misses too many
    expect(run(7, 10, 3, 10)).toBe('not_cleared'); // too many false alarms
  });

  it('says nothing until there are enough pairs of each kind', () => {
    expect(run(9, 9, 0, 11)).toBe('not_enough'); // 20 paired, 9 wrong
    expect(run(7, 10, 0, 9)).toBe('not_enough'); // 19 paired
  });

  it('keeps each judge apart: a changed judge is a new instrument', () => {
    const r = secondOpinionReport([
      judged('wrong', { defective: true }),
      judged('wrong', {
        defective: true,
        instrument: 'judge-model (judge v2)',
      }),
      judged('sound', {
        defective: false,
        instrument: 'judge-model (judge v2)',
      }),
    ]);
    expect(r.instruments.map((x) => [x.instrument, x.paired])).toEqual([
      ['judge-model (judge v2)', 2],
      ['judge-model (judge v1)', 1],
    ]);
  });

  it('counts what waits behind your verdict, and judged Cues with no opinion', () => {
    const r = secondOpinionReport([
      judged(null, null, { aiHidden: 1 }),
      judged(null, null, { aiHidden: 2 }),
      judged(null, null),
      judged('sound', null),
      judged('wrong', null, { cue: null, verdict: null }),
      judged('sound', { defective: false }),
    ]);
    expect(r.waiting).toBe(2);
    expect(r.unopined).toBe(1);
    expect(r.instruments[0]?.paired).toBe(1);
  });

  it('defaults to the August bar the judge failed, over many more Cues', () => {
    expect(HAND_OVER_BAR).toEqual({
      minPaired: 50,
      minEach: 10,
      minCatch: 12 / 17,
      maxFalseAlarm: 2 / 11,
    });
  });

  it('names an instrument by model and version', () => {
    expect(instrumentOf({ judge_model: 'm', judge_version: '3' })).toBe(
      'm (judge v3)',
    );
  });
});

// ── Migration 027 ───────────────────────────────────────────────────────────

describe('migration 027 keeps opinions server-side, separate and blind', () => {
  it('locks cue_ai_opinions down like 023 and 026: RLS, no grants, no policy', () => {
    expect(SQL).toMatch(
      /alter table public\.cue_ai_opinions enable row level security;/,
    );
    expect(SQL).toMatch(
      /revoke all on public\.cue_ai_opinions from anon, authenticated;/,
    );
    expect(SQL).not.toMatch(/create policy/i);
    expect(SQL).not.toMatch(/^\s*grant\s/im);
  });

  it('deletes opinions with their Session', () => {
    expect(SQL).toMatch(
      /session_id uuid not null\s+references public\.sessions\(id\) on delete cascade/,
    );
  });

  it('keys an opinion on the exact Cue text and the judge that read it', () => {
    expect(SQL).toMatch(
      /cue_md5 text generated always as \(md5\(cue\)\) stored/,
    );
    expect(SQL).toMatch(
      /constraint cue_ai_opinions_one_per_judge\s+unique \(session_id, cue_md5, judge_model, judge_version\)/,
    );
  });

  it('constrains the mode to the judge’s two', () => {
    const listed = SQL.match(/check \(mode in \(([^)]*)\)\)/)?.[1];
    expect(listed?.match(/'(\w+)'/g)?.map((s) => s.slice(1, -1))).toEqual([
      'grounded',
      'ungrounded',
    ]);
  });

  it('allows a better Cue on shallow or wrong only, and bounds it like the tool', () => {
    expect(SQL).toMatch(/add column if not exists better_cue text;/);
    expect(SQL).toMatch(
      /check \(better_cue is null or verdict in \('shallow', 'wrong'\)\)/,
    );
    expect(SQL).toMatch(
      new RegExp(
        `char_length\\(better_cue\\) between 1 and ${BETTER_CUE_MAX_LENGTH}`,
      ),
    );
  });

  it('says in the schema that an opinion is never a verdict', () => {
    expect(SQL).toMatch(/second opinion,\s+never a verdict/);
    expect(SQL).toMatch(/Blind first/);
    expect(SQL).toMatch(/notify pgrst, 'reload schema';/);
  });

  it('touches no other table', () => {
    expect(SQL).not.toMatch(
      /alter table public\.(?!cue_verdicts|cue_ai_opinions)/,
    );
    expect(SQL).not.toMatch(
      /create table if not exists public\.(?!cue_ai_opinions)/,
    );
    expect(SQL).not.toMatch(
      /\bdrop table\b|\bdelete from\b|\bupdate public\./i,
    );
  });
});
