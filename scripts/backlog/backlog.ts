#!/usr/bin/env node
/**
 * Print the mining backlog (#58).
 *
 *   scripts/backlog/backlog.sh
 *
 * The gap log IS the mining backlog. This turns grounding outcomes into a
 * ranked list of what to mine next, driven by live traffic rather than by one
 * person's guess about which positions matter.
 *
 * The SQL equivalent, with more detail, is `mining-backlog.sql`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { rankBacklog, type SessionOutcomeRow } from './rank.ts';

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
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      '\n  Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (shell or .env).\n',
    );
    process.exit(1);
  }

  const rows: SessionOutcomeRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/sessions?select=grounding,grounding_candidates,` +
        `target_position_id,positions_visited,user_id&order=created_at&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) {
      console.error(`\n  Query failed: ${res.status} ${await res.text()}\n`);
      process.exit(1);
    }
    const page = (await res.json()) as SessionOutcomeRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const b = rankBacklog(rows);

  const section = (title: string, note: string) =>
    console.log(`\n  ${title}\n  ${'─'.repeat(66)}\n  ${note}\n`);

  console.log(`\n  MINING BACKLOG — ${rows.length} sessions\n`);
  for (const [outcome, n] of Object.entries(b.outcomes)) {
    console.log(`    ${outcome.padEnd(14)} ${String(n).padStart(5)}`);
  }

  section('MINE THESE', 'the position resolved and the corpus had nothing');
  if (b.mine.length === 0) console.log('    (nothing)');
  for (const r of b.mine) {
    console.log(
      `    ${r.position.padEnd(30)} ${String(r.sessions).padStart(4)} session(s)  ${r.users} user(s)`,
    );
  }

  section(
    'NOT A MINING PROBLEM',
    'records existed; the gi filter or relevance gate removed them all',
  );
  if (b.filteredOut.length === 0) console.log('    (nothing)');
  for (const r of b.filteredOut) {
    console.log(
      `    ${r.position.padEnd(30)} ${String(r.sessions).padStart(4)} session(s)  up to ${r.mostAvailable} record(s) available`,
    );
  }

  section(
    'TAXONOMY GAPS',
    'never resolved to a canonical id — fix extraction, not the corpus',
  );
  if (b.unresolved.length === 0) console.log('    (nothing)');
  for (const r of b.unresolved) {
    console.log(
      `    ${r.position.padEnd(30)} ${String(r.sessions).padStart(4)} time(s)`,
    );
  }
  console.log('');
}

void main();
