#!/usr/bin/env node
/**
 * Publish mined records to the serving store.
 *
 *   scripts/mining/publish.sh --dry-run     # transform + leak check, no upload
 *   scripts/mining/publish.sh               # upload to Supabase
 *   scripts/mining/publish.sh --sql out.sql # emit SQL instead of uploading
 *
 * Reads the local review store, strips every link to the source, refuses to
 * continue if any marker survives, and upserts into `coaching_records`.
 *
 * The review store never leaves this machine. Only distilled mechanics travel.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { findLeaks, toServingRecord, type ServingRecord } from './publish.ts';

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}
function arg(f: string): string | null {
  const i = process.argv.indexOf(f);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (f: string) => process.argv.includes(f);

function loadDotEnv(): void {
  const p = join(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (!k || process.env[k]) continue;
    const val = (v ?? '').replace(/^['"]|['"]$/g, '').trim();
    if (val) process.env[k] = val;
  }
}

/**
 * review id -> opaque serving id.
 *
 * Local only, and the reason certification survives a re-publish: without a
 * stable mapping, every publish would mint new ids and orphan whatever a
 * reviewer had certified. The mapping is the expensive artifact's lifeline.
 */
function loadMapping(path: string): Record<string, string> {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function main(): void {
  loadDotEnv();
  const recordsDir = arg('--records') ?? join(homedir(), 'flowlog-records');
  const mappingPath = arg('--mapping') ?? join(recordsDir, 'id-mapping.json');

  if (!existsSync(recordsDir)) die(`no records directory: ${recordsDir}`);
  const files = readdirSync(recordsDir).filter((f) =>
    f.endsWith('.records.json'),
  );
  if (files.length === 0) die(`no *.records.json in ${recordsDir}`);

  const review: Record<string, unknown>[] = [];
  for (const f of files)
    review.push(...JSON.parse(readFileSync(join(recordsDir, f), 'utf8')));
  console.error(
    `\nreview store   ${review.length} records across ${files.length} volumes`,
  );

  const mapping = loadMapping(mappingPath);
  let minted = 0;
  const serving: ServingRecord[] = review.map((r) => {
    const reviewId = String(r.id ?? '');
    if (!reviewId) die('a review record has no id — cannot map it stably');
    if (!mapping[reviewId]) {
      mapping[reviewId] = randomUUID();
      minted++;
    }
    return toServingRecord(r, mapping[reviewId]!);
  });
  console.error(
    `serving store  ${serving.length} records  (${minted} new ids, ` +
      `${serving.length - minted} reused — certification preserved)`,
  );

  // ── the backstop ────────────────────────────────────────────────────────
  const leaks = findLeaks(serving);
  if (leaks.length) {
    console.error(
      `\nREFUSING TO PUBLISH — ${leaks.length} source marker(s) survived:\n`,
    );
    const byField = new Map<string, number>();
    for (const l of leaks)
      byField.set(l.field, (byField.get(l.field) ?? 0) + 1);
    for (const [f, n] of byField) console.error(`  ${n}x in ${f}`);
    console.error('\n  examples:');
    for (const l of leaks.slice(0, 5)) {
      console.error(`    [${l.field}] …${l.excerpt}…`);
    }
    console.error(
      '\nFix the miner or extend SCRUBBED_NAMES, then re-publish. Nothing was uploaded.\n',
    );
    process.exit(1);
  }
  console.error('leak check     clean — no source markers survive');

  const certified = serving.filter((r) => r.certified).length;
  console.error(`certified      ${certified}/${serving.length}`);

  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + '\n', 'utf8');

  if (has('--dry-run')) {
    console.error(
      `\nDRY RUN — nothing uploaded. Mapping written to ${mappingPath}\n`,
    );
    return;
  }

  const sqlOut = arg('--sql');
  if (sqlOut) {
    writeFileSync(sqlOut, toSql(serving), 'utf8');
    console.error(`\nSQL written to ${sqlOut} — run it in the SQL editor.\n`);
    return;
  }

  void upload(serving, mappingPath);
}

function esc(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function toSql(records: ServingRecord[]): string {
  const rows = records
    .map(
      (r) =>
        `  (${esc(r.id)}::uuid, ${esc(r.sportKey)}, ${esc(r.position)}, ${esc(r.prescription)}, ` +
        `${esc(r.why)}, ${esc(r.detail)}, ${esc(r.counter)}, ${esc(r.gi)}, ${esc(r.level)}, ` +
        `${esc(r.opponent)}, ${r.certified}, ${r.contested})`,
    )
    .join(',\n');
  return (
    `-- Generated by scripts/mining/publish.sh. Distilled mechanics only.\n` +
    `insert into public.coaching_records\n` +
    `  (id, sport_key, position, prescription, why, detail, counter, gi, level, opponent, certified, contested)\n` +
    `values\n${rows}\n` +
    `on conflict (id) do update set\n` +
    `  position = excluded.position,\n` +
    `  prescription = excluded.prescription,\n` +
    `  why = excluded.why,\n` +
    `  detail = excluded.detail,\n` +
    `  counter = excluded.counter,\n` +
    `  gi = excluded.gi,\n` +
    `  level = excluded.level,\n` +
    `  opponent = excluded.opponent,\n` +
    // Review state is NOT overwritten from the file — a reviewer may have
    // certified a record in the database since the last publish.
    `  updated_at = now();\n`
  );
}

async function upload(
  records: ServingRecord[],
  mappingPath: string,
): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    die(
      'Upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (shell or .env).\n' +
        '  Or run with --sql <file> to emit SQL and paste it into the SQL editor,\n' +
        '  or --dry-run to transform and leak-check without uploading.',
    );
  }
  const CHUNK = 250;
  let done = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = records.slice(i, i + CHUNK).map((r) => ({
      id: r.id,
      sport_key: r.sportKey,
      position: r.position,
      prescription: r.prescription,
      why: r.why,
      detail: r.detail,
      counter: r.counter,
      gi: r.gi,
      level: r.level,
      opponent: r.opponent,
      contested: r.contested,
    }));
    const res = await fetch(`${url}/rest/v1/coaching_records?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // Upsert, and do NOT clobber `certified` — a reviewer may have set it
        // in the database since the last publish.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok)
      die(
        `upload failed at ${done}: ${res.status} ${(await res.text()).slice(0, 300)}`,
      );
    done += batch.length;
    process.stderr.write(`\r  uploaded ${done}/${records.length}`);
  }
  console.error(`\n\nPublished ${done} records. Mapping: ${mappingPath}\n`);
}

main();
