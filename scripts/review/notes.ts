#!/usr/bin/env node
/**
 * Read what reviewers actually said (#84).
 *
 *   scripts/review/notes.sh              # rejected + contested, with reasons
 *   scripts/review/notes.sh --all        # every note, including on certified
 *
 * A verdict without its reasoning cannot be acted on. A rejected record is not
 * fixed by being rejected — it is fixed by someone reading why and either
 * re-mining that position, correcting the record, or concluding the corpus is
 * wrong about something. This is where that reading happens.
 *
 * NOTE ON PUBLISHING: reviewer notes are free text and may name a source
 * ("Danaher teaches this differently"). They live in `record_votes` and are
 * NEVER copied into `coaching_records`, which is the table publish.ts writes.
 * The leak guard covers mined text, not reviewer-authored text — so if anyone
 * later builds "apply reviewer corrections", the scrub has to be extended
 * BEFORE that text reaches a published record.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface Vote {
  record_id: string;
  reviewer_id: string;
  verdict: string;
  note: string | null;
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
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\n  Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n');
    process.exit(1);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) {
      console.error(`\n  Query failed: ${res.status} ${await res.text()}\n`);
      process.exit(1);
    }
    return (await res.json()) as T;
  };

  const all = process.argv.includes('--all');
  const votes = await get<Vote[]>('record_votes?select=*&limit=5000');
  const roster = await get<
    { id: string; display_name: string; credential: string | null }[]
  >('reviewers?select=id,display_name,credential');
  const names = new Map(roster.map((r) => [r.id, r]));

  const withNotes = votes.filter((v) => v.note?.trim());
  if (withNotes.length === 0) {
    console.log('\n  No reviewer notes yet.\n');
    return;
  }

  const ids = [...new Set(withNotes.map((v) => v.record_id))];
  const records = await get<
    {
      id: string;
      position: string;
      prescription: string;
      certified: boolean;
      contested: boolean;
      rejected: boolean;
    }[]
  >(
    `coaching_records?select=id,position,prescription,certified,contested,rejected&id=in.(${ids.join(',')})`,
  );
  const byId = new Map(records.map((r) => [r.id, r]));

  const interesting = withNotes.filter((v) => {
    const r = byId.get(v.record_id);
    return all || (r && (r.rejected || r.contested));
  });

  console.log(
    `\n  REVIEWER NOTES — ${interesting.length} of ${withNotes.length} note(s)` +
      `${all ? '' : ' on rejected or contested records'}\n`,
  );

  const grouped = new Map<string, Vote[]>();
  for (const v of interesting) {
    grouped.set(v.record_id, [...(grouped.get(v.record_id) ?? []), v]);
  }

  for (const [recordId, group] of grouped) {
    const r = byId.get(recordId);
    if (!r) continue;
    const state = r.rejected
      ? 'REJECTED'
      : r.contested
        ? 'CONTESTED'
        : r.certified
          ? 'certified'
          : 'unsettled';
    console.log(`  ${'─'.repeat(70)}`);
    console.log(`  [${state}] ${r.position}`);
    console.log(`  ${r.prescription}`);
    for (const v of group) {
      const who = names.get(v.reviewer_id);
      const label = who
        ? `${who.display_name}${who.credential ? `, ${who.credential}` : ''}`
        : 'a reviewer';
      console.log(
        `\n    ${v.verdict === 'certify' ? 'sound' : 'WRONG'} — ${label}`,
      );
      console.log(`    ${v.note?.trim()}`);
    }
    console.log('');
  }
}

void main();
