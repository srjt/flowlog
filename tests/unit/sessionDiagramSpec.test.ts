/**
 * The Session keeps its Cue's force-diagram spec and provenance (#135 phase b,
 * migration 025).
 *
 * One seam: the persisted Session row. The EDGE FUNCTION half is a source scan,
 * for the reason `sessionPerspective` and `reanalysisProvenance` give: it is
 * Deno and cannot load under Jest. Each Session write is sliced on its own,
 * because the declined paths are the ones historically forgotten (#117).
 *
 * The stage's decisions (when to call, what each outcome records) are NOT
 * scanned here: they live in `src/visualization/diagramStage.ts`, which the
 * edge function imports unchanged and `forceDiagramPipelineStage.test.ts` runs
 * for real. What is scanned is that the function hands every write that
 * module's record, and makes the model call only through it.
 *
 * The client reference pipeline runs for real in
 * `tests/integration/FlowlogPipeline.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SupabaseStorageProvider } from '@/providers/storage/SupabaseStorageProvider';
import { DIAGRAM_OUTCOMES } from '@/visualization/diagramStage';

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
const SQL = read('supabase/migrations/025_session_cue_diagram.sql');

const COLUMNS = [
  'diagram_outcome',
  'diagram_spec',
  'grammar_version',
  'base_library_version',
  'spec_prompt_version',
];

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** The `{ … }` block that opens at the first match of `opener` in `source`. */
function block(source: string, opener: RegExp): string {
  const at = source.search(opener);
  expect(at).toBeGreaterThan(-1);
  const open = source.indexOf(
    '{',
    at + (source.slice(at).match(opener)?.[0].length ?? 1) - 1,
  );
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced block');
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

// ── The edge function ───────────────────────────────────────────────────────

describe('process-session writes the diagram on all four Session writes', () => {
  const reanalysis = slice(EDGE, "stage = 'reanalyze'", 'One-shot record flow');
  const oneShot = EDGE.slice(EDGE.indexOf('One-shot record flow'));
  const insertHelper = slice(
    oneShot,
    'const insertSession = async',
    '// ── Decline path (issue #44)',
  );
  const declinedInsert = slice(
    oneShot,
    '// ── Decline path (issue #44)',
    '// History for coaching',
  );
  const oneShotInsert = slice(
    oneShot,
    '// ── Stage 3: quality gate',
    'return jsonResponse(output, 200);',
  );
  const declinedUpdate = slice(
    reanalysis,
    'if (!extraction.hasCoachableContent)',
    'const { recentMistakes',
  );
  const update = slice(
    reanalysis,
    'const gate = await enforce(',
    'storeCoachingPrompts(',
  );

  // The structural guarantee: every write that carries an Extraction carries
  // the diagram group. Removing it from any one of them fails here.
  it('leaves no Session write without the diagram columns', () => {
    const writes = [...EDGE.matchAll(/db(Insert|Update)\(\s*[`']sessions\b/g)]
      .map((m) => writtenObject(EDGE.slice(m.index)))
      .filter((w) => w.includes('key_mistake:'));
    expect(writes).toHaveLength(3);
    for (const w of writes) expect(w).toMatch(/\.\.\.diagramColumns\(/);
  });

  it('writes the columns only through the one mapper', () => {
    // So all five travel together: a spec beside another run's outcome or
    // versions cannot be written.
    for (const column of COLUMNS)
      expect(EDGE.match(new RegExp(`\\b${column}:`, 'g'))).toHaveLength(1);
    const mapper = block(EDGE, /function diagramColumns\(d: DiagramRecord\)/);
    expect(mapper).toMatch(/diagram_outcome:\s*d\.diagramOutcome,/);
    expect(mapper).toMatch(/diagram_spec:\s*d\.diagramSpec,/);
    expect(mapper).toMatch(/grammar_version:\s*d\.grammarVersion,/);
    expect(mapper).toMatch(/base_library_version:\s*d\.baseLibraryVersion,/);
    expect(mapper).toMatch(/spec_prompt_version:\s*d\.specPromptVersion,/);
  });

  it('the insert helper writes the record it is handed', () => {
    expect(writtenObject(insertHelper)).toMatch(
      /\.\.\.diagramColumns\(analysis\.diagram\),/,
    );
  });

  it('the one-shot insert: a fresh record for the Cue that passed the gate', () => {
    const gateAt = oneShotInsert.indexOf('const gate = await enforce(');
    const stageAt = oneShotInsert.indexOf(
      'const diagram = await cueDiagram(sport, gate, resolved.id);',
    );
    const insertAt = oneShotInsert.indexOf('await insertSession({');
    expect(gateAt).toBeGreaterThan(-1);
    expect(stageAt).toBeGreaterThan(gateAt);
    expect(insertAt).toBeGreaterThan(stageAt);
    expect(block(oneShotInsert.slice(insertAt), /insertSession\(/)).toMatch(
      /^\s*diagram,$/m,
    );
  });

  it('the declined insert: not_attempted, and no stage at all', () => {
    expect(block(declinedInsert, /insertSession\(/)).toMatch(
      /diagram: NOT_ATTEMPTED,/,
    );
    expect(declinedInsert).not.toContain('cueDiagram(');
  });

  it('the Re-analyze update: regenerated for the new Cue', () => {
    expect(update).toMatch(
      /const reDiagram = await cueDiagram\(sport, gate, reResolved\.id\);/,
    );
    expect(writtenObject(update)).toMatch(/\.\.\.diagramColumns\(reDiagram\),/);
    // Never carried over from the row it replaces.
    expect(reanalysis).not.toMatch(
      /existing\.(diagram|grammar|base_library|spec_prompt)/,
    );
  });

  it('the declined Re-analyze update: cleared to not_attempted, a null spec', () => {
    expect(writtenObject(declinedUpdate)).toMatch(
      /\.\.\.diagramColumns\(NOT_ATTEMPTED\),/,
    );
    expect(declinedUpdate).not.toContain('cueDiagram(');
  });

  it('NOT_ATTEMPTED is the shared record, with a null spec', () => {
    expect(EDGE).toMatch(
      /import \{\s*NOT_ATTEMPTED,\s*STAGE_FAILED,\s*runDiagramStage,\s*\} from '\.\.\/\.\.\/\.\.\/src\/visualization\/diagramStage\.ts';/,
    );
  });
});

describe('process-session makes the model call only behind the base check', () => {
  const stage = block(EDGE, /async function cueDiagram\(/);

  // `runDiagramStage` checks the Cue and the base before it calls; the
  // function must never call the model any other way.
  it('hands the call to the shared stage and never makes it itself', () => {
    expect(EDGE.match(/generateDiagramSpec/g)).toHaveLength(2); // import + hand-off
    expect(EDGE).not.toMatch(/generateDiagramSpec\(/);
    expect(stage).toMatch(
      /runDiagramStage\(\{[^}]*call: generateDiagramSpec,/s,
    );
  });

  it('passes the sport library, the gate verdict and the canonical position', () => {
    expect(stage).toMatch(/library: sport\.diagram,/);
    expect(stage).toMatch(/cue: gate\.coaching\.cue,/);
    // The fallback is generic by design: nothing in it to draw.
    expect(stage).toMatch(/coachable: gate\.passed && !gate\.usedFallback,/);
    expect(stage).toMatch(/positionId,/);
  });

  it('is wrapped so it cannot throw into the Session', () => {
    expect(stage).toMatch(
      /try \{[\s\S]*\} catch \(err\) \{[\s\S]*return \{ \.\.\.STAGE_FAILED \};/,
    );
  });

  it('runs the stage only on the two paths that have a Cue', () => {
    expect(EDGE.match(/await cueDiagram\(/g)).toHaveLength(2);
  });
});

describe('the server call (_shared/ai.ts)', () => {
  const fn = block(AI, /export async function generateDiagramSpec\(/);

  it('uses the extraction model, never the coaching model', () => {
    expect(fn).toMatch(/model: geminiModel\(\),/);
    expect(fn).not.toMatch(/geminiCoachingModel/);
  });

  it('supports both providers, the way extract does', () => {
    expect(fn).toMatch(/aiProvider\(\) === 'gemini'/);
    expect(fn).toMatch(
      /geminiGenerate\(\[\{ text: request\.prompt \}\], \d+, true,/,
    );
    expect(fn).toMatch(/claude\(request\.prompt, \d+, controller\.signal\)/);
  });

  it('aborts at the deadline and never throws', () => {
    expect(fn).toMatch(
      /setTimeout\(\(\) => controller\.abort\(\), request\.timeoutMs\)/,
    );
    expect(fn).toMatch(/signal: controller\.signal,/);
    expect(fn).toMatch(
      /\} catch \(err\) \{[\s\S]*return null;[\s\S]*\} finally \{\s*clearTimeout\(timer\);/,
    );
  });

  // A request field the API refuses would fail every call. JSON mode + the
  // prompt's constraints + validation in code is the verified floor.
  it('does not send a native response schema', () => {
    // Comments explain the alternative; the code must not use it.
    const code = AI.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/responseSchema|response_schema|input_schema/);
    expect(code).toContain('generateDiagramSpec');
    expect(
      block(code, /export async function generateDiagramSpec\(/),
    ).not.toMatch(/request\.schema/);
  });
});

// ── Migration 025 ───────────────────────────────────────────────────────────

describe('migration 025', () => {
  const addColumns = slice(SQL, 'alter table public.sessions', ';');
  const outcome = slice(
    SQL,
    'comment on column public.sessions.diagram_outcome is',
    '$$;',
  );

  it.each([
    ['diagram_spec', 'jsonb'],
    ['diagram_outcome', 'text'],
    ['grammar_version', 'text'],
    ['base_library_version', 'text'],
    ['spec_prompt_version', 'text'],
  ])('adds %s %s, nullable and idempotent', (column, type) => {
    expect(addColumns).toMatch(
      new RegExp(`add column if not exists ${column} ${type}\\b`),
    );
  });

  it('adds nothing NOT NULL and no default', () => {
    // A default would write a value nothing recorded: the failure the NULL
    // rule exists to prevent.
    expect(addColumns).not.toMatch(/not null/i);
    expect(addColumns).not.toMatch(/\bdefault\b/i);
  });

  // A value the CHECK rejects fails the whole Session write, so the code's
  // set and the column's set must be the same set.
  it('constrains the outcome to exactly the values the stage emits', () => {
    const values = addColumns
      .match(/check \(diagram_outcome in \(([^)]*)\)\)/)?.[1]
      ?.split(',')
      .map((v) => v.trim().replace(/'/g, ''));
    expect(values).toEqual([...DIAGRAM_OUTCOMES]);
  });

  it('states up front that NULL is not recorded, never "no diagram"', () => {
    expect(outcome).toMatch(/NULL means NOT RECORDED/);
    expect(outcome).toMatch(/never "no diagram"/);
    // Before the value list, so nobody reads the values without the rule.
    expect(outcome.indexOf('NULL means')).toBeLessThan(
      outcome.indexOf('spec           a validated spec'),
    );
  });

  it('documents every outcome', () => {
    for (const value of DIAGRAM_OUTCOMES)
      expect(outcome).toMatch(new RegExp(`^\\s+${value}\\s{2,}`, 'm'));
  });

  it('names no_base by position as the authoring backlog', () => {
    expect(outcome).toMatch(
      /Grouped by target_position_id, this is the base-authoring\s+backlog/,
    );
  });

  it('says re-analysis overwrites it', () => {
    expect(outcome).toMatch(/Re-analysis overwrites it/);
  });

  it('does not backfill, and is not a pipeline_version boundary', () => {
    expect(SQL).not.toMatch(/^\s*update\s/im);
    expect(SQL).toMatch(/`pipeline_version` is deliberately NOT bumped/);
  });

  it('states the deploy order', () => {
    expect(SQL).toMatch(/apply this migration\s+BEFORE deploying/);
  });

  it('reloads the API cache so the edge function can write it at once', () => {
    expect(SQL).toMatch(/notify pgrst, 'reload schema';/);
  });
});

// ── The client row mapping ──────────────────────────────────────────────────

describe('SupabaseStorageProvider maps the diagram columns', () => {
  const provider = new SupabaseStorageProvider();
  const analysis = {
    rawTranscript: 'Played De La Riva and lost the hook.',
    positionsVisited: ['De La Riva'],
    keyMistake: 'Hook went slack',
    opponentAction: 'Stepped forward',
    sentiment: 'frustrated',
    coachingCue: 'Drive the hooking heel into the hamstring.',
    targetPosition: null,
    targetPositionId: 'de-la-riva-bottom',
    qualityGatePassed: true,
    pipelineVersion: '1.3.0',
  };
  const base = {
    ...analysis,
    userId: 'u1',
    sportKey: 'bjj' as const,
    sessionDate: '2026-11-05T10:00:00.000Z',
    audioStoragePath: null,
  };
  const spec = {
    specVersion: 1,
    base: 'de-la-riva-bottom',
    annotations: [{ type: 'base' as const, anchor: 'posting_forearm' }],
  };
  const recorded = {
    diagramOutcome: 'spec' as const,
    diagramSpec: spec,
    grammarVersion: '0.1.0',
    baseLibraryVersion: '1.0.0',
    specPromptVersion: '0.2.0',
  };

  beforeEach(() => {
    mockWrites.length = 0;
    mockRowFromDb = null;
  });

  it('inserts all five and reads them back', async () => {
    const saved = await provider.saveSession({ ...base, ...recorded });
    expect(mockWrites[0]?.payload).toMatchObject({
      diagram_outcome: 'spec',
      diagram_spec: spec,
      grammar_version: '0.1.0',
      base_library_version: '1.0.0',
      spec_prompt_version: '0.2.0',
    });
    expect(saved).toMatchObject(recorded);
  });

  it('writes NULL, never an outcome, when the caller recorded nothing', async () => {
    await provider.saveSession(base);
    for (const column of COLUMNS)
      expect(mockWrites[0]?.payload[column]).toBeNull();
  });

  it('overwrites the group on re-analysis, clears it, or leaves it alone', async () => {
    await provider.updateSessionAnalysis('row-1', { ...analysis, ...recorded });
    await provider.updateSessionAnalysis('row-1', {
      ...analysis,
      diagramOutcome: 'not_attempted',
      diagramSpec: null,
      grammarVersion: null,
      baseLibraryVersion: null,
      specPromptVersion: null,
    });
    await provider.updateSessionAnalysis('row-1', analysis);

    expect(mockWrites[0]?.payload).toMatchObject({
      diagram_outcome: 'spec',
      diagram_spec: spec,
    });
    // Cleared: the old spec must not survive beside a new Cue.
    expect(mockWrites[1]?.payload).toMatchObject({
      diagram_outcome: 'not_attempted',
      diagram_spec: null,
      grammar_version: null,
      base_library_version: null,
      spec_prompt_version: null,
    });
    // Omitted: none of the five is touched.
    for (const column of COLUMNS)
      expect(mockWrites[2]?.payload).not.toHaveProperty(column);
  });

  it('reads a row from before migration 025 as not recorded', async () => {
    mockRowFromDb = { id: 'old', user_id: 'u1', sport_key: 'bjj' };
    const saved = await provider.saveSession(base);
    expect(saved).toMatchObject({
      diagramOutcome: null,
      diagramSpec: null,
      grammarVersion: null,
      baseLibraryVersion: null,
      specPromptVersion: null,
    });
  });
});
