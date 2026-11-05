/**
 * The Session keeps the side Extraction reported (#130, migration 024).
 *
 * One seam: the persisted Session row. The EDGE FUNCTION half is a source scan,
 * for the reason `reanalysisProvenance` and `sessionPromptsLogging` give: it is
 * Deno and cannot load under Jest. Each path that writes an Extraction is
 * sliced on its own, because the declined paths are the ones historically
 * forgotten (#117 repaired exactly that for the grounding columns).
 *
 * The client reference pipeline runs for real in
 * `tests/integration/FlowlogPipeline.test.ts`; the Supabase row mapping it
 * writes through is exercised below against a captured client.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SupabaseStorageProvider } from '@/providers/storage/SupabaseStorageProvider';
import { ExtractionService } from '@/services/ExtractionService';

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
const SQL = read('supabase/migrations/024_session_perspective.sql');

const ALLOWED = ['top', 'bottom', 'unknown'];

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
  // The literal opens with `{` and a newline; a template literal's `${` does not.
  const open = source.slice(call).search(/\{\s*\n/) + call;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced object literal');
}

const WRITES_SIDE = /\bperspective:\s*extraction\.perspective,/;

// ── The edge function ───────────────────────────────────────────────────────

describe('process-session writes the perspective on every path that writes an Extraction', () => {
  const reanalysis = slice(EDGE, "stage = 'reanalyze'", 'One-shot record flow');
  const oneShot = EDGE.slice(EDGE.indexOf('One-shot record flow'));
  const insertHelper = slice(
    oneShot,
    'const insertSession = async',
    '// ── Decline path (issue #44)',
  );

  // Both insert paths go through one helper, so the declined insert cannot
  // drop a column the normal insert writes. That only holds while nothing
  // inserts a Session any other way.
  it('inserts Sessions only through the shared helper', () => {
    expect(EDGE.match(/dbInsert\(\s*'sessions'/g)).toHaveLength(1);
    expect(insertHelper).toMatch(/dbInsert\(\s*'sessions'/);
    expect(writtenObject(insertHelper)).toMatch(WRITES_SIDE);
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
  ])('$path writes it through the helper', ({ body }) => {
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
    expect(writtenObject(body())).toMatch(WRITES_SIDE);
  });

  // Overwritten, not preserved: the side is the EDITED transcript's. A stale
  // side under a fresh Extraction is the 021 failure on a new column.
  it('takes the side from the edited transcript on re-analysis, never the old row', () => {
    expect(reanalysis).toMatch(
      /const extraction = await extract\(editedTranscript,/,
    );
    expect(reanalysis).not.toMatch(/existing\.perspective/);
  });

  // The structural guarantee behind the four cases above: any Session write
  // that carries an Extraction carries its side.
  it('leaves no write of an Extraction without its side', () => {
    const writes = [...EDGE.matchAll(/db(Insert|Update)\(\s*[`']sessions\b/g)]
      .map((m) => writtenObject(EDGE.slice(m.index)))
      .filter((w) => w.includes('key_mistake:'));
    expect(writes).toHaveLength(3);
    for (const w of writes) expect(w).toMatch(WRITES_SIDE);
  });

  // The column rejects anything else, and a rejected value fails the WHOLE
  // insert — the athlete would lose the Session, not just the side.
  it('only ever hands the column a value its constraint accepts', () => {
    expect(AI).toMatch(
      /perspective:\s*parsed\.perspective === 'top' \|\| parsed\.perspective === 'bottom'\s*\?\s*parsed\.perspective\s*:\s*'unknown'/,
    );
  });
});

// ── The client half shares the same three values ────────────────────────────

describe('the client reference writes the same values', () => {
  it.each(['top', 'bottom', 'unknown', 'neutral', 'TOP', '', undefined, 42])(
    'normalises %p onto a value the column accepts',
    (raw) => {
      expect(ALLOWED).toContain(ExtractionService.normalisePerspective(raw));
    },
  );
});

describe('SupabaseStorageProvider maps sessions.perspective', () => {
  const provider = new SupabaseStorageProvider();
  const analysis = {
    rawTranscript: 'On bottom of half guard the whole round.',
    positionsVisited: ['half guard'],
    keyMistake: 'Flat on my back',
    opponentAction: 'Crossface',
    sentiment: 'frustrated',
    coachingCue: 'Frame on the hip.',
    targetPosition: null,
    targetPositionId: null,
    qualityGatePassed: true,
    pipelineVersion: '1.3.0',
  };
  const base = {
    ...analysis,
    userId: 'u1',
    sportKey: 'bjj' as const,
    sessionDate: '2026-11-01T10:00:00.000Z',
    audioStoragePath: null,
  };

  beforeEach(() => {
    mockWrites.length = 0;
    mockRowFromDb = null;
  });

  it('inserts the side and reads it back', async () => {
    const saved = await provider.saveSession({
      ...base,
      perspective: 'unknown',
    });
    expect(mockWrites[0]?.payload.perspective).toBe('unknown');
    expect(saved.perspective).toBe('unknown');
  });

  it('writes NULL, never "unknown", when the caller recorded nothing', async () => {
    await provider.saveSession(base);
    expect(mockWrites[0]?.payload.perspective).toBeNull();
  });

  it('overwrites it on re-analysis, and leaves it alone when omitted', async () => {
    await provider.updateSessionAnalysis('row-1', {
      ...analysis,
      perspective: 'top',
    });
    await provider.updateSessionAnalysis('row-1', analysis);
    expect(mockWrites[0]?.payload.perspective).toBe('top');
    expect(mockWrites[1]?.payload).not.toHaveProperty('perspective');
  });

  it('reads a row from before migration 024 as not recorded', async () => {
    mockRowFromDb = { id: 'old', user_id: 'u1', sport_key: 'bjj' };
    const saved = await provider.saveSession(base);
    expect(saved.perspective).toBeNull();
  });
});

// ── Migration 024 ───────────────────────────────────────────────────────────

describe('migration 024', () => {
  const addColumn = slice(SQL, 'alter table public.sessions', ';');
  const comment = slice(
    SQL,
    'comment on column public.sessions.perspective is',
    '$$;',
  );

  it('adds a nullable column idempotently', () => {
    expect(addColumn).toMatch(/add column if not exists perspective text/);
    // Nullable with no default: a default would write a value nothing
    // recorded, which is the failure the NULL rule exists to prevent.
    expect(addColumn).not.toMatch(/not null/i);
    expect(addColumn).not.toMatch(/\bdefault\b/i);
  });

  it('constrains it to exactly the three values Extraction emits', () => {
    const values = addColumn
      .match(/check \(perspective in \(([^)]*)\)\)/)?.[1]
      ?.split(',')
      .map((v) => v.trim().replace(/'/g, ''));
    expect(values).toEqual(ALLOWED);
  });

  it('states up front that NULL is not recorded, never "could not tell"', () => {
    expect(comment).toMatch(/NULL means NOT RECORDED/);
    expect(comment).toMatch(/never "Extraction could not tell"/);
    // Before the value list, so nobody reads the values without the rule.
    expect(comment.indexOf('NULL means')).toBeLessThan(
      comment.indexOf('unknown  recorded'),
    );
  });

  it("calls 'unknown' a recorded finding", () => {
    expect(comment).toMatch(/unknown\s+recorded: Extraction could not tell/);
    expect(comment).toMatch(/A real finding about the recording/);
  });

  it('says re-analysis overwrites it', () => {
    expect(comment).toMatch(/Re-analysis overwrites it/);
  });

  // A guess written into a column that reads as recorded truth is the failure
  // this column exists to end.
  it('does not backfill', () => {
    expect(SQL).not.toMatch(/^\s*update\s/im);
  });

  it('reloads the API cache so the edge function can write it at once', () => {
    expect(SQL).toMatch(/notify pgrst, 'reload schema';/);
  });
});
