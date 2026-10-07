/**
 * Every coaching prompt is kept exactly as sent (#121).
 *
 * `promptLog.test.ts` proves the recorder and the row shape. Nothing there
 * proves the edge function still routes every attempt through them: a second,
 * unrecorded `generateCoaching` call — say, a retry callback written inline
 * again — would pass every other test and quietly log a first attempt beside a
 * Cue that came from a retry. So this is a SOURCE SCAN, for the reason
 * `promptPlaceholders` gives: the edge function is Deno and cannot load under
 * Jest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', rel), 'utf8');

const EDGE = read('supabase/functions/process-session/index.ts');
const AI = read('supabase/functions/_shared/ai.ts');
const STORE = read('supabase/functions/_shared/sessionPrompts.ts');
const SQL = read('supabase/migrations/023_session_prompts.sql');

function slice(start: string, end: string): string {
  const from = EDGE.indexOf(start);
  const to = EDGE.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return EDGE.slice(from, to);
}

const count = (source: string, needle: string) =>
  source.split(needle).length - 1;

describe('generateCoaching reports what it sent', () => {
  it('returns the prompt, provider and model with its output', () => {
    expect(AI).toContain('sent: { prompt, provider, model }');
  });

  it('names the model the request actually went to, not the one intended', () => {
    // Coaching runs on its own model (GEMINI_COACHING_MODEL), and a transient
    // 503 on a preview model falls back to another. If the log kept the
    // INTENDED model it would quietly misattribute every fallback cue — and
    // this log is the record used to diagnose a bad cue, so a lie here is
    // worse than no log.
    expect(AI).toMatch(/let model = provider === 'gemini'/);
    expect(AI).toMatch(/onModelUsed: \(m\) => \{/);
  });

  it('reports the model that answered, including after a fallback', () => {
    // geminiGenerate must tell the caller which model replied, AFTER any
    // retry — not before it.
    const fn = AI.slice(AI.indexOf('async function geminiGenerate'));
    const reported = fn.indexOf('opts.onModelUsed?.(model)');
    const retried = fn.indexOf('model = fallback');
    expect(retried).toBeGreaterThan(-1);
    expect(reported).toBeGreaterThan(retried);
  });

  it('only falls back on a transient status, and never to itself', () => {
    expect(AI).toMatch(/isTransient\(res\.status\)/);
    expect(AI).toMatch(/fallback !== primary/);
  });
});

describe.each([
  {
    path: 're-analysis',
    body: () => slice("stage = 'reanalyze'", 'One-shot record flow'),
    run: 'reanalysis',
    persisted: 'const updated = await dbUpdate(',
  },
  {
    path: 'insert',
    body: () =>
      slice('One-shot record flow', 'return jsonResponse(output, 200);'),
    run: 'insert',
    persisted: "if ('conflictOutput' in inserted) return",
  },
])('the $path path', ({ body, run, persisted }) => {
  const branch = body();

  it('calls the model only through the recorder', () => {
    expect(count(branch, 'generateCoaching(')).toBe(1);
    expect(branch).toMatch(
      /recordAttempts\(\(strict: boolean\) =>\s*generateCoaching\(/,
    );
  });

  it('hands the recorder to the quality gate for its retries', () => {
    expect(branch).toMatch(/QUALITY_GATE_RETRY_LIMIT,\s*\w+\.coach,/);
  });

  it(`stores the prompts as a '${run}' run after the session is written`, () => {
    const store = branch.indexOf('storeCoachingPrompts(');
    expect(store).toBeGreaterThan(-1);
    // After persistence: a conflicting duplicate returns before this point,
    // and its losing attempts must not be attributed to the winner's row.
    expect(store).toBeGreaterThan(branch.indexOf(persisted));
    expect(branch.slice(store, store + 200)).toContain(`'${run}'`);
  });
});

describe('storing prompts never costs the athlete their Cue', () => {
  it('catches and logs a failed write instead of throwing', () => {
    expect(STORE).toMatch(/try \{[\s\S]*dbInsertRows\([\s\S]*\} catch/);
    expect(STORE).toContain('console.error');
    expect(STORE).not.toMatch(/\bthrow\b/);
  });
});

describe('migration 023 keeps prompts off devices', () => {
  it('revokes client grants rather than relying on no policy (009)', () => {
    expect(SQL).toMatch(
      /revoke all on public\.session_prompts from anon, authenticated;/,
    );
    expect(SQL).toMatch(
      /alter table public\.session_prompts enable row level security;/,
    );
    expect(SQL).not.toMatch(/create policy/i);
  });

  it('deletes prompts with their session', () => {
    expect(SQL).toMatch(/references public\.sessions\(id\) on delete cascade/);
  });
});
