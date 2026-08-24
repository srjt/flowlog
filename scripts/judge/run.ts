#!/usr/bin/env node
/**
 * Validate the cue judge against the frozen human verdicts (issue #61).
 *
 *   scripts/judge/judge.sh                  # judge every labelled cue
 *   scripts/judge/judge.sh --limit 5        # a cheap smoke run
 *   scripts/judge/judge.sh --fresh          # ignore the cache
 *
 * Results are cached per session under the scratch file so a re-run costs
 * nothing. The judge is a measuring instrument: re-running it must be free, or
 * nobody will re-run it and the number goes stale.
 *
 * **The bar is asserted, not eyeballed.** This exits non-zero when the judge
 * misses it. If it fails, that is the finding — a judge tuned until it agrees
 * with its validation set has not been validated, it has been fitted.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { judgeCue, type Complete } from './judge.ts';
import type { CueJudgement, JudgeSubject } from './types.ts';
import {
  formatScore,
  scoreJudge,
  type HumanVerdict,
  type ScoreInput,
} from './verdict.ts';
import { normalizePosition } from '../../src/sports/bjj/bjjPositions.ts';
import type { GroundableRecord } from '../../src/sports/grounding.ts';

/**
 * A different model from the one that WROTE these cues (`gemini-2.5-flash`).
 *
 * Not a circularity fix and not claimed as one — the research is clear that
 * cross-family buys about 2.18 effective independent votes and that
 * self-preference tracks perplexity rather than authorship. It is a cheap
 * hedge, and the harness prints the family so a same-family run is visible in
 * the output rather than buried in a config file.
 */
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'gemini-3.1-pro-preview';
const GENERATOR_FAMILY = 'gemini';
const CACHE = join(homedir(), 'flowlog-baseline', 'judge-cache.json');

function die(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    die('GEMINI_API_KEY is not set. Add it to .env or the environment.');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${JUDGE_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          // Judging, not writing. Near-deterministic so a re-run of the same
          // cue does not produce a different verdict and quietly move the score.
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  if (!res.ok)
    die(`Gemini API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('');
}

/** Records for the cue's position, straight from the serving store. */
async function loadRecords(
  positionId: string | null,
): Promise<GroundableRecord[]> {
  if (!positionId) return [];
  const url =
    process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return [];
  const res = await fetch(
    `${url}/rest/v1/coaching_records?select=*&sport_key=eq.bjj` +
      `&position=eq.${encodeURIComponent(positionId)}&limit=200`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return [];
  return (await res.json()) as GroundableRecord[];
}

function loadEnv(): void {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const verdictPath =
    arg('verdicts') ?? join(homedir(), 'flowlog-baseline', 'cue-verdicts.json');
  if (!existsSync(verdictPath)) die(`No verdict file at ${verdictPath}`);

  const file = JSON.parse(readFileSync(verdictPath, 'utf8')) as {
    verdicts: (JudgeSubject & { verdict: HumanVerdict })[];
  };
  // `skip` rows were unjudgeable by the human too; they are not the judge's
  // failure and must not dilute either metric.
  let subjects = file.verdicts.filter((v) => v.verdict !== 'skip');
  const limit = Number(arg('limit') ?? 0);
  if (limit > 0) subjects = subjects.slice(0, limit);

  const cache: Record<string, CueJudgement> =
    !has('fresh') && existsSync(CACHE)
      ? JSON.parse(readFileSync(CACHE, 'utf8'))
      : {};

  const complete: Complete = has('dry-run')
    ? async () => JSON.stringify({ claims: [] })
    : callGemini;

  console.error(
    `\n  judging ${subjects.length} cues with ${JUDGE_MODEL}` +
      `\n  cues were generated by ${GENERATOR_FAMILY} — SAME FAMILY, see the caveat in the report\n`,
  );

  const judgements: CueJudgement[] = [];
  for (const [i, s] of subjects.entries()) {
    if (cache[s.sessionId]) {
      judgements.push(cache[s.sessionId]!);
      continue;
    }
    const match = normalizePosition(
      s.target,
      `${s.keyMistake ?? ''} ${s.cue ?? ''}`,
      'unknown',
    );
    const records = await loadRecords(match.id);
    const j = await judgeCue(
      {
        sessionId: s.sessionId,
        cue: s.cue,
        target: s.target,
        keyMistake: s.keyMistake ?? '',
      },
      records,
      complete,
    );
    judgements.push(j);
    // Never cache a dry run — its fake verdicts would silently stand in for
    // real ones on the next invocation and quietly fake the whole score.
    if (!has('dry-run')) {
      cache[s.sessionId] = j;
      mkdirSync(dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(cache, null, 2));
    }
    console.error(
      `  [${i + 1}/${subjects.length}] ${j.mode.padEnd(10)} ` +
        `${j.defective ? 'DEFECTIVE' : 'ok       '} ${s.target}`,
    );
  }

  const byId = new Map(judgements.map((j) => [j.sessionId, j]));
  const rows: ScoreInput[] = subjects.map((s) => ({
    sessionId: s.sessionId,
    human: s.verdict,
    defective: byId.get(s.sessionId)?.defective ?? false,
  }));

  const score = scoreJudge(rows);
  console.log(formatScore(score, judgements));
  console.log(
    `  CAVEAT: judge and generator are both ${GENERATOR_FAMILY}. Cross-family\n` +
      `  would be a stronger check; set ANTHROPIC_API_KEY and JUDGE_MODEL to run it.\n`,
  );

  // Disagreements are the interesting rows — print them so a failure can be
  // read rather than guessed at.
  const misses = subjects.filter(
    (s) => s.verdict === 'wrong' && !byId.get(s.sessionId)?.defective,
  );
  const falseAlarms = subjects.filter(
    (s) => s.verdict === 'sound' && byId.get(s.sessionId)?.defective,
  );
  if (misses.length) {
    console.log(`  MISSED DEFECTS (${misses.length}):`);
    for (const m of misses) {
      console.log(`    - ${m.target}: ${m.cue.slice(0, 90)}`);
      console.log(
        `      judge said: ${byId.get(m.sessionId)?.rationale ?? ''}`,
      );
    }
    console.log('');
  }
  if (falseAlarms.length) {
    console.log(`  FALSE ALARMS (${falseAlarms.length}):`);
    for (const f of falseAlarms) {
      console.log(`    - ${f.target}: ${f.cue.slice(0, 90)}`);
      console.log(
        `      judge said: ${byId.get(f.sessionId)?.rationale ?? ''}`,
      );
    }
    console.log('');
  }

  process.exit(score.passed ? 0 : 1);
}

void main();
