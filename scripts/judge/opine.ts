#!/usr/bin/env node
/**
 * AI second opinions on live Cues (migration 027).
 *
 *   scripts/judge/opine.sh             # dry run: how many Cues, how many calls
 *   scripts/judge/opine.sh --go        # judge them and store the opinions
 *   scripts/judge/opine.sh --go --limit 10
 *
 * Runs the cue judge (#61) on every Cue that has no opinion yet from this
 * judge (`JUDGE_MODEL`, default gemini-3.1-pro-preview, at `JUDGE_VERSION`),
 * against the records for the Cue's target position, and stores each result
 * in `cue_ai_opinions`. Idempotent: a re-run only judges what is new, so it
 * costs nothing when nothing changed.
 *
 * **Blind first.** This prints how many opinions it stored, never what they
 * say. The review tool shows an opinion only after you've judged the same Cue,
 * so a terminal that printed "DEFECTIVE" next to a Session would defeat it.
 *
 * Runs on the operator's machine with the service-role key from `.env`, like
 * the review tool. Nothing here is reachable from the app.
 */

import { JUDGE_VERSION, judgeCue } from './judge.ts';
import {
  LIVE_CUE_COLUMNS,
  estimatedCalls,
  opinionInsert,
  pendingCues,
  subjectOf,
  type LiveCue,
  type OpinionKey,
} from './opinion.ts';
import {
  familyOf,
  fetchRecords,
  judgeModel,
  loadEnv,
  modelCall,
  supabaseAdmin,
} from './services.ts';

function die(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const PAGE = 1000;

async function restAll<T>(
  db: { url: string; key: string },
  path: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${db.url}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`,
      { headers: { apikey: db.key, Authorization: `Bearer ${db.key}` } },
    );
    if (!res.ok) {
      throw new Error(
        `${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const db = supabaseAdmin();
  if (!db) {
    die(
      'Set SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.',
    );
  }
  const judge = { model: judgeModel(), version: JUDGE_VERSION };

  const sessions = await restAll<LiveCue>(
    db,
    `sessions?select=${LIVE_CUE_COLUMNS}&coaching_cue=not.is.null` +
      '&order=session_date.desc,id',
  );
  let existing: OpinionKey[];
  try {
    existing = await restAll<OpinionKey>(
      db,
      'cue_ai_opinions?select=session_id,cue,judge_model,judge_version' +
        `&judge_model=eq.${encodeURIComponent(judge.model)}` +
        `&judge_version=eq.${encodeURIComponent(judge.version)}&order=id`,
    );
  } catch (err) {
    die(
      `cue_ai_opinions can't be read. Is migration 027 applied?\n  ${(err as Error).message}`,
    );
  }

  let pending = pendingCues(sessions, existing, judge);
  const limit = Number(arg('limit') ?? 0);
  if (limit > 0) pending = pending.slice(0, limit);

  console.error(
    `\n  ${sessions.length} Cues, ${existing.length} already ${existing.length === 1 ? 'has' : 'have'} an opinion from ` +
      `${judge.model} (judge v${judge.version}).` +
      `\n  ${pending.length} to judge: about ${estimatedCalls(pending.length)} ` +
      `${familyOf(judge.model)} calls.`,
  );
  if (!has('go')) {
    console.error(
      pending.length
        ? '\n  Dry run. Add --go to judge them and store the opinions.\n'
        : '\n  Nothing to do.\n',
    );
    return;
  }

  const complete = modelCall(judge.model);
  let stored = 0;
  for (const [i, s] of pending.entries()) {
    const records = await fetchRecords(s.target_position_id);
    const judgement = await judgeCue(subjectOf(s), records, complete);
    const res = await fetch(
      `${db.url}/rest/v1/cue_ai_opinions` +
        '?on_conflict=session_id,cue_md5,judge_model,judge_version',
      {
        method: 'POST',
        headers: {
          apikey: db.key,
          Authorization: `Bearer ${db.key}`,
          'content-type': 'application/json',
          // A concurrent run that got there first wins; nothing is overwritten.
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify([opinionInsert(s, judgement, judge)]),
      },
    );
    if (!res.ok) {
      throw new Error(
        `storing an opinion failed (${res.status}): ${(await res.text()).slice(0, 300)}` +
          `\n  ${stored} stored before this; a re-run carries on from here.`,
      );
    }
    stored += 1;
    // Progress only. Never the opinion: see "Blind first" above.
    console.error(`  [${i + 1}/${pending.length}] stored`);
  }

  console.error(
    `\n  ${stored} opinion(s) stored. Each appears in the review tool once you've` +
      `\n  judged that Cue yourself; the Cue trust page compares them with you.\n`,
  );
}

main().catch((err: unknown) =>
  die(err instanceof Error ? err.message : String(err)),
);
