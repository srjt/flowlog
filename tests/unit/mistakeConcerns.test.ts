/**
 * Grounding abstains when the key mistake is not about a position (#153,
 * migration 027).
 *
 * Seams, in the order the decision travels:
 *   1. Extraction says what the mistake concerns (the BJJ prompt), and both
 *      normalisers turn anything else into 'unknown'.
 *   2. The edge function decides with the shared `groundingScope` BEFORE any
 *      records fetch, and writes the field and the outcome on every Session
 *      write. Deno cannot load under Jest, so that half is a source scan, as in
 *      `sessionPerspective` and `reanalysisProvenance`.
 *   3. The client's Supabase mapping, against a captured client.
 *   4. Migration 027, and the review tool's outcome list kept equal to it.
 *
 * The client reference pipeline runs for real in
 * `tests/integration/FlowlogPipeline.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SupabaseStorageProvider } from '@/providers/storage/SupabaseStorageProvider';
import { ExtractionService } from '@/services/ExtractionService';
import { getSportContext } from '@/sports';
import { BJJ_EXTRACTION_PROMPT } from '@/sports/bjj/bjjPrompts';
import { MISTAKE_CONCERNS } from '@/sports/grounding';
import { GROUNDING_OUTCOMES } from '../../scripts/admin/review';
import { MockAIProvider } from '../mocks';

// Hoisted above the imports by Jest: captures what the provider sends.
const mockWrites: { op: string; payload: Record<string, unknown> }[] = [];
let mockRowFromDb: Record<string, unknown> | null = null;
jest.mock('@/lib/supabase', () => {
  const answer = (payload: Record<string, unknown>) => ({
    select: () => ({
      single: async () => ({
        data: mockRowFromDb ?? { id: 'row-1', ...payload },
        error: null,
      }),
    }),
  });
  return {
    supabase: {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          mockWrites.push({ op: 'insert', payload });
          return answer(payload);
        },
        update: (payload: Record<string, unknown>) => {
          mockWrites.push({ op: 'update', payload });
          return { eq: () => answer(payload) };
        },
      }),
    },
  };
});

const read = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', rel), 'utf8');

const EDGE = read('supabase/functions/process-session/index.ts');
const AI = read('supabase/functions/_shared/ai.ts');
const SQL = read('supabase/migrations/027_grounding_not_positional.sql');
const SQL_010 = read('supabase/migrations/010_grounding_experiment.sql');
const APP_JS = read('scripts/admin/app.js');

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** The object literal handed to the first `dbInsert`/`dbUpdate` in `source`. */
function writtenObject(source: string): string {
  const call = source.search(/db(Insert|Update)\(/);
  expect(call).toBeGreaterThan(-1);
  const open = source.slice(call).search(/\{\s*\n/) + call;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced object literal');
}

/** The values of a SQL `check (col in (...))` list. */
function checkValues(sql: string, column: string): string[] {
  const list = sql.match(
    new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`),
  )?.[1];
  expect(list).toBeTruthy();
  return list!.split(',').map((v) => v.trim().replace(/'/g, ''));
}

const WRITES_CONCERNS = /\bmistake_concerns:\s*extraction\.mistakeConcerns,/;

// ── 1. Extraction ───────────────────────────────────────────────────────────

describe('the extraction prompt asks what the mistake concerns', () => {
  it('declares the field with exactly the four values', () => {
    expect(BJJ_EXTRACTION_PROMPT).toMatch(
      /"mistakeConcerns": string, +\/\/ exactly one of: "position", "submission", "transition", "unknown"\./,
    );
  });

  it('is the prompt both sides use', () => {
    // `_shared/sports.ts` imports the same constant for the edge function.
    expect(getSportContext('bjj').extractionPrompt).toBe(BJJ_EXTRACTION_PROMPT);
    expect(read('supabase/functions/_shared/sports.ts')).toContain(
      'BJJ_EXTRACTION_PROMPT',
    );
  });

  const section = slice(
    BJJ_EXTRACTION_PROMPT,
    'MISTAKE CONCERNS —',
    'GI CONTEXT —',
  );

  // Defending a submission is still about the position it came from: the
  // mount-bottom records are exactly the ones that help.
  it('counts defending a submission from a position as position', () => {
    expect(section).toMatch(/INCLUDES defending a submission from a position/);
    expect(section).toContain('"got armbarred from');
    expect(section).toMatch(/mount" is "position"/);
  });

  it("reserves submission for the athlete's OWN attack", () => {
    expect(section).toMatch(/finish or secure THEIR OWN submission attack/);
    expect(section).toContain(
      "couldn't\n                 finish the reverse triangle",
    );
  });

  it('gives transition the berimbolo example', () => {
    expect(section).toContain('"lost my hips during the berimbolo"');
  });

  it('judges the mistake, not the positions that came up', () => {
    expect(section).toMatch(/Judge the keyMistake itself/);
  });

  it('prefers unknown over guessing', () => {
    expect(section).toContain('**Return "unknown" rather than guessing.**');
  });
});

describe('both normalisers map anything else to unknown', () => {
  const JUNK = [undefined, null, '', 'Position', 'technique', 'sweep', 7, {}];

  it.each(JUNK)('the client turns %p into unknown', (value) => {
    expect(ExtractionService.normaliseMistakeConcerns(value)).toBe('unknown');
  });

  it.each(MISTAKE_CONCERNS)('the client keeps %p', (value) => {
    expect(ExtractionService.normaliseMistakeConcerns(value)).toBe(value);
  });

  it('the client applies it to what the provider returned', async () => {
    const service = new ExtractionService(
      new MockAIProvider({
        mistakeConcerns: 'submissions' as unknown as 'submission',
      }),
    );
    const out = await service.extract(
      'He passed to side control and I could not frame before the crossface.',
      getSportContext('bjj'),
      'Blue Belt',
    );
    expect(out.mistakeConcerns).toBe('unknown');
  });

  // The server cannot be imported under Jest. It must call the SAME shared
  // function on the model's answer, never a local copy that could drift.
  it('the server calls the shared normaliser on the parsed answer', () => {
    expect(AI).toMatch(
      /import \{[^}]*\bnormaliseMistakeConcerns\b[^}]*\} from '\.\.\/\.\.\/\.\.\/src\/sports\/grounding\.ts'/,
    );
    expect(AI).toMatch(
      /mistakeConcerns:\s*normaliseMistakeConcerns\(parsed\.mistakeConcerns\),/,
    );
    expect(AI).not.toMatch(/function normaliseMistakeConcerns/);
  });
});

// ── 2. The edge function ────────────────────────────────────────────────────

const reanalysis = slice(EDGE, "stage = 'reanalyze'", 'One-shot record flow');
const oneShot = EDGE.slice(EDGE.indexOf('One-shot record flow'));

describe('process-session writes mistake_concerns on every Session write', () => {
  const insertHelper = slice(
    oneShot,
    'const insertSession = async',
    '// ── Decline path (issue #44)',
  );

  it('inserts Sessions only through the shared helper, which writes it', () => {
    expect(EDGE.match(/dbInsert\(\s*'sessions'/g)).toHaveLength(1);
    expect(writtenObject(insertHelper)).toMatch(WRITES_CONCERNS);
  });

  it.each([
    {
      path: 'the one-shot insert',
      body: () =>
        slice(
          oneShot,
          '// ── Stage 4: persistence',
          'return jsonResponse(output, 200);',
        ),
    },
    {
      path: 'the declined insert',
      body: () =>
        slice(
          oneShot,
          '// ── Decline path (issue #44)',
          '// History for coaching',
        ),
    },
  ])('$path goes through the helper', ({ body }) => {
    expect(body()).toMatch(/await insertSession\(\{/);
  });

  it.each([
    {
      path: 'the declined Re-analyze update',
      body: () =>
        slice(
          reanalysis,
          'if (!extraction.hasCoachableContent)',
          'const { recentMistakes',
        ),
    },
    {
      path: 'the Re-analyze update',
      body: () =>
        slice(
          reanalysis,
          'const updated = await dbUpdate(',
          'storeCoachingPrompts(',
        ),
    },
  ])('$path overwrites it', ({ body }) => {
    expect(writtenObject(body())).toMatch(WRITES_CONCERNS);
  });

  it('takes it from the edited transcript on re-analysis, never the old row', () => {
    expect(reanalysis).toMatch(
      /const extraction = await extract\(editedTranscript,/,
    );
    expect(reanalysis).not.toMatch(/existing\.mistake_concerns/);
  });

  it('leaves no write of an Extraction without it', () => {
    const writes = [...EDGE.matchAll(/db(Insert|Update)\(\s*[`']sessions\b/g)]
      .map((m) => writtenObject(EDGE.slice(m.index)))
      .filter((w) => w.includes('key_mistake:'));
    expect(writes).toHaveLength(3);
    for (const w of writes) expect(w).toMatch(WRITES_CONCERNS);
  });
});

describe('process-session abstains BEFORE the records fetch', () => {
  // Every records fetch is reachable only through a positional scope: the
  // ids it is called with exist only on that variant of `GroundingScope`.
  it('fetches records only from a positional scope', () => {
    const calls = [...EDGE.matchAll(/loadGroundingRecords\(/g)];
    // The definition, plus one call on each path.
    expect(calls).toHaveLength(3);
    expect(oneShot).toMatch(
      /scope\.kind === 'positions'\s*\?\s*await loadGroundingRecords\(sportKey, scope\.positionIds\)\s*:\s*NOT_LOOKED_UP/,
    );
    expect(reanalysis).toMatch(
      /reScope\.kind === 'positions'\s*\?\s*await loadGroundingRecords\(existing\.sport_key, reScope\.positionIds\)\s*:\s*NOT_LOOKED_UP/,
    );
  });

  it.each([
    [
      'the insert path',
      () => oneShot,
      'const scope = groundingScope(extraction);',
    ],
    [
      're-analysis',
      () => reanalysis,
      'const reScope = groundingScope(extraction);',
    ],
  ])('decides the scope before fetching on %s', (_path, body, decide) => {
    const source = body();
    expect(source).toContain(decide);
    expect(source.indexOf(decide)).toBeLessThan(
      source.indexOf('await loadGroundingRecords('),
    );
  });

  // `candidatePositions` straight into a fetch is the bypass this replaced.
  it('never resolves positions around the scope', () => {
    expect(EDGE).not.toMatch(/candidatePositions\(/);
  });

  it('records the scope its own outcome instead of drawing an arm', () => {
    expect(oneShot).toMatch(/:\s*scope\.assignment;/);
    expect(reanalysis).toMatch(/:\s*reScope\.assignment;/);
  });

  it('writes the outcome to the row on both paths', () => {
    expect(oneShot).toMatch(/grounding:\s*groundingArm\.outcome,/);
    expect(reanalysis).toMatch(/grounding:\s*reArm\.outcome,/);
  });

  // Not measured, never 0 (#58, #119).
  it('stands in nulls for the funnel of an abstained session', () => {
    expect(EDGE).toMatch(
      /const NOT_LOOKED_UP: \{ records: CoachingRecord\[\]; total: null \} = \{\s*records: \[\],\s*total: null,\s*\};/,
    );
    expect(EDGE).toMatch(
      /const NOT_RANKED: \{ records: CoachingRecord\[\]; gatePassed: null \} = \{\s*records: \[\],\s*gatePassed: null,\s*\};/,
    );
    expect(oneShot).toMatch(/:\s*NOT_RANKED;/);
    expect(reanalysis).toMatch(/:\s*NOT_RANKED;/);
    expect(oneShot).toContain('groundingCandidates: candidatePool.total');
    expect(oneShot).toContain('groundingGatePassed: ranked.gatePassed');
  });
});

// ── 3. The client's Supabase mapping ────────────────────────────────────────

describe('SupabaseStorageProvider maps sessions.mistake_concerns', () => {
  const provider = new SupabaseStorageProvider();
  const analysis = {
    rawTranscript: 'Went for the reverse triangle and he stacked me.',
    positionsVisited: ['Side Control', 'Reverse Triangle'],
    keyMistake: 'Could not finish the reverse triangle',
    opponentAction: 'Stacked me',
    sentiment: 'frustrated',
    coachingCue: 'Underhook his near leg before he stacks.',
    targetPosition: null,
    targetPositionId: null,
    qualityGatePassed: true,
    pipelineVersion: '1.4.0',
  };
  const base = {
    ...analysis,
    userId: 'u1',
    sportKey: 'bjj' as const,
    sessionDate: '2026-11-06T10:00:00.000Z',
    audioStoragePath: null,
  };

  beforeEach(() => {
    mockWrites.length = 0;
    mockRowFromDb = null;
  });

  it('inserts it and reads it back', async () => {
    const saved = await provider.saveSession({
      ...base,
      mistakeConcerns: 'submission',
      grounding: 'not_positional',
    });
    expect(mockWrites[0]?.payload.mistake_concerns).toBe('submission');
    expect(mockWrites[0]?.payload.grounding).toBe('not_positional');
    expect(saved.mistakeConcerns).toBe('submission');
  });

  it('writes NULL, never "unknown", when the caller recorded nothing', async () => {
    await provider.saveSession(base);
    expect(mockWrites[0]?.payload.mistake_concerns).toBeNull();
  });

  it('overwrites it on re-analysis, and leaves it alone when omitted', async () => {
    await provider.updateSessionAnalysis('row-1', {
      ...analysis,
      mistakeConcerns: 'position',
    });
    await provider.updateSessionAnalysis('row-1', analysis);
    expect(mockWrites[0]?.payload.mistake_concerns).toBe('position');
    expect(mockWrites[1]?.payload).not.toHaveProperty('mistake_concerns');
  });

  it('reads a row from before migration 027 as not recorded', async () => {
    mockRowFromDb = { id: 'old', user_id: 'u1', sport_key: 'bjj' };
    const saved = await provider.saveSession(base);
    expect(saved.mistakeConcerns).toBeNull();
  });
});

// ── 4. Migration 027 ────────────────────────────────────────────────────────

describe('migration 027', () => {
  const constraint = slice(
    SQL,
    'alter table public.sessions\n  drop constraint',
    ';',
  );
  const addColumn = slice(
    SQL,
    'alter table public.sessions\n  add column',
    ';',
  );
  const columnComment = slice(
    SQL,
    'comment on column public.sessions.mistake_concerns is',
    '$$;',
  );
  const groundingComment = slice(
    SQL,
    'comment on column public.sessions.grounding is',
    '$$;',
  );

  it('keeps every outcome 010 allowed, and adds not_positional', () => {
    const before = checkValues(SQL_010, 'grounding');
    expect(before).toEqual([
      'grounded',
      'withheld',
      'no_position',
      'no_records',
      'declined',
    ]);
    expect(checkValues(constraint, 'grounding')).toEqual([
      ...before,
      'not_positional',
    ]);
  });

  // 010 declared the CHECK inline, so Postgres named it
  // `sessions_grounding_check`. Dropped and recreated by that name in ONE
  // statement, and without `if exists`: a wrong name must fail the migration,
  // not leave the old constraint rejecting every abstained Session.
  it('drops and recreates the constraint by name, in one statement', () => {
    expect(constraint).toMatch(
      /drop constraint sessions_grounding_check,\s*add constraint sessions_grounding_check\s*check \(/,
    );
    expect(constraint).not.toMatch(/if exists/i);
  });

  it('adds a nullable column idempotently, with no default', () => {
    expect(addColumn).toMatch(/add column if not exists mistake_concerns text/);
    expect(addColumn).not.toMatch(/not null/i);
    expect(addColumn).not.toMatch(/\bdefault\b/i);
  });

  it('constrains it to exactly the values Extraction emits', () => {
    expect(checkValues(addColumn, 'mistake_concerns')).toEqual([
      ...MISTAKE_CONCERNS,
    ]);
  });

  it('states up front that NULL is not recorded, never "unknown"', () => {
    expect(columnComment).toMatch(/NULL means NOT RECORDED/);
    expect(columnComment).toMatch(/never "Extraction could not tell"/);
    expect(columnComment.indexOf('NULL means')).toBeLessThan(
      columnComment.indexOf('unknown     recorded'),
    );
  });

  it('says which values abstain, and that re-analysis overwrites it', () => {
    expect(columnComment).toMatch(
      /grounding = 'not_positional', on 'submission' and\s+'transition' only/,
    );
    expect(columnComment).toMatch(/Re-analysis overwrites it/);
  });

  it('lists not_positional in the grounding comment, apart from no_position', () => {
    for (const outcome of GROUNDING_OUTCOMES) {
      expect(groundingComment).toMatch(new RegExp(`\\n\\s+${outcome}\\s+-`));
    }
    expect(groundingComment).toMatch(/neither\s+no_position nor no_records/);
  });

  // `comment on` REPLACES, so dropping 019's and 021's caveats would silently
  // un-document those boundaries.
  it('carries the earlier caveats forward', () => {
    expect(groundingComment).toContain('CAVEAT (migration 019)');
    expect(groundingComment).toContain('CAVEAT (migration 021)');
    expect(SQL).toContain('CAVEAT (migration 020)');
  });

  it('says the abstained funnel is null, not 0', () => {
    expect(
      slice(
        SQL,
        'comment on column public.sessions.grounding_candidates',
        '$$;',
      ),
    ).toMatch(/Null too when grounding =\s+'not_positional'/);
    expect(
      slice(
        SQL,
        'comment on column public.sessions.grounding_gate_passed',
        '$$;',
      ),
    ).toMatch(/grounding = 'not_positional', migration 027\)\. NULL is not 0/);
  });

  it('does not backfill', () => {
    expect(SQL).not.toMatch(/^\s*update\s/im);
  });

  it('reloads the API cache so the edge function can write at once', () => {
    expect(SQL.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

// ── The review tool reads every outcome the column can hold ─────────────────

describe('the cue review tool knows not_positional', () => {
  it('lists exactly the outcomes the CHECK allows', () => {
    const constraint = slice(SQL, 'drop constraint', ';');
    expect([...GROUNDING_OUTCOMES]).toEqual(
      checkValues(constraint, 'grounding'),
    );
  });

  // `GROUNDING[s.grounding][0]` throws on an outcome with no copy, which would
  // break the list for every Session on the page.
  it('has copy for every outcome', () => {
    const copy = slice(APP_JS, 'const GROUNDING = {', '\n};');
    for (const outcome of GROUNDING_OUTCOMES) {
      expect(copy).toMatch(new RegExp(`\\n  ${outcome}: \\[`));
    }
  });
});
