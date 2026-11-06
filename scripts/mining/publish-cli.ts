#!/usr/bin/env node
/**
 * Publish mined records to the serving store.
 *
 *   scripts/mining/publish.sh --dry-run     # transform + both checks, no upload
 *   scripts/mining/publish.sh               # upload to Supabase
 *   scripts/mining/publish.sh --sql out.sql # emit SQL instead of uploading
 *   scripts/mining/publish.sh --which-store # print the canonical store, exit
 *
 *   --records <dir>               publish another store (default: canonical)
 *   --mapping <file>              id mapping (default: <records>/id-mapping.json)
 *   --partial-publish "<reason>"  publish a store that does NOT account for the
 *                                 live store, on purpose. The leak check still runs.
 *
 * Reads the local review store, strips every link to the source, refuses to
 * continue if any marker survives OR if the store does not account for what is
 * already live, and upserts into `coaching_records`.
 *
 * Every mode counts the live store first, dry-run included, so it needs
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (shell or .env).
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
import { randomUUID } from 'node:crypto';

import {
  PARTIAL_PUBLISH_FLAG,
  buildUpsertSql,
  classifyMappingDrift,
  parseContentRangeTotal,
  parsePublishArgs,
  preflight,
  toServingRecord,
  toUpsertRow,
  type ReconcileDecision,
  type ServingRecord,
} from './publish.ts';
import { canonicalStorePath, storeOrDie } from './stores.ts';

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

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

interface Credentials {
  url: string;
  key: string;
}

function credentials(): Credentials | null {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
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

function recordFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.records.json'));
}

/**
 * Count the live serving store for the sports this publish writes.
 *
 * One request returning at most one row. PostgREST caps a plain select at
 * 1000 rows, so the total comes from `count=exact`, never from the body.
 */
async function fetchLiveCount(
  creds: Credentials,
  sportKeys: string[],
): Promise<number> {
  const q = `select=id&sport_key=in.(${sportKeys.map(encodeURIComponent).join(',')})`;
  const res = await fetch(`${creds.url}/rest/v1/coaching_records?${q}`, {
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const total = parseContentRangeTotal(res.headers.get('content-range'));
  if (total === null) {
    throw new Error(
      `no total in Content-Range: ${res.headers.get('content-range')}`,
    );
  }
  return total;
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
}

function whichStore(): void {
  const canonical = canonicalStorePath();
  console.log(canonical);
  if (!existsSync(canonical)) {
    console.error('  MISSING. Every mining and publish default points here.');
    process.exitCode = 1;
    return;
  }
  const mappingPath = join(canonical, 'id-mapping.json');
  const mapped = Object.keys(loadMapping(mappingPath)).length;
  console.error(
    `  ${recordFiles(canonical).length} volumes, ${mapped} ids in ${mappingPath}`,
  );
  console.error('  (defined in scripts/mining/stores.ts)');
}

function printRefusal(
  d: ReconcileDecision,
  recordsDir: string,
  mappingPath: string,
  minted: number,
): void {
  const canonical = canonicalStorePath();
  console.error(
    `\nREFUSING TO PUBLISH: this store accounts for ${pct(d.coverage)} of the live ` +
      `serving store (needs ${pct(d.threshold)}).\n`,
  );
  console.error(`  store        ${recordsDir}`);
  console.error(
    `               ${d.writes} records, ${d.carried} with an existing serving id` +
      (minted ? `, ${minted} minted fresh` : ''),
  );
  console.error(`  mapping      ${mappingPath}`);
  console.error(`  live store   ${d.liveCount} records`);
  console.error(
    recordsDir === canonical
      ? '\n  This IS the canonical store. Either it has lost records the live store\n' +
          '  still serves, or its id mapping no longer matches what was published.'
      : `\n  The canonical store is ${canonical}.\n` +
          '  Publishing a different store would merge it over the live corpus.',
  );
  console.error(
    `\n  If a partial publish is genuinely intended, say why:\n` +
      `    ${PARTIAL_PUBLISH_FLAG} "<reason>"\n` +
      '  The leak check runs either way.',
  );
}

async function main(): Promise<void> {
  loadDotEnv();
  let opts;
  try {
    opts = parsePublishArgs(process.argv.slice(2));
  } catch (err) {
    die((err as Error).message);
  }
  if (opts.whichStore) return whichStore();

  const store = storeOrDie(opts.records, '--records');
  const recordsDir = store.path;
  const mappingPath = opts.mapping ?? join(recordsDir, 'id-mapping.json');

  if (!existsSync(recordsDir)) die(`no records directory: ${recordsDir}`);
  const files = recordFiles(recordsDir);
  if (files.length === 0) die(`no *.records.json in ${recordsDir}`);

  console.error(
    `\nstore          ${recordsDir}` +
      (store.isDefault ? '  (canonical)' : '  (explicit --records)'),
  );
  const review: Record<string, unknown>[] = [];
  for (const f of files)
    review.push(...JSON.parse(readFileSync(join(recordsDir, f), 'utf8')));
  console.error(
    `review store   ${review.length} records across ${files.length} volumes`,
  );

  const mapping = loadMapping(mappingPath);
  const drift = classifyMappingDrift(
    Object.keys(mapping),
    review.map((r) => String(r.id ?? '')),
  );
  const minted = new Set<string>();
  const serving: ServingRecord[] = review.map((r) => {
    const reviewId = String(r.id ?? '');
    if (!reviewId) die('a review record has no id — cannot map it stably');
    if (!mapping[reviewId]) {
      mapping[reviewId] = randomUUID();
      minted.add(mapping[reviewId]!);
    }
    return toServingRecord(r, mapping[reviewId]!);
  });
  console.error(
    `serving store  ${serving.length} records  (${minted.size} new ids, ` +
      `${serving.length - minted.size} reused — certification preserved)`,
  );
  if (drift.warn) {
    // Soft: it does not refuse on its own. The live-store guard below is what
    // stops the publish this usually precedes.
    console.error(
      `id mapping     WARNING: ${drift.mapped} entries in ${mappingPath} share NO id ` +
        `with this store's ${drift.review} records.\n` +
        '               It belongs to a different store. Every id would be minted fresh.',
    );
  } else if (drift.kind === 'none') {
    console.error(
      `id mapping     none at ${mappingPath}: every id would be minted fresh`,
    );
  } else {
    console.error(
      `id mapping     ${drift.overlap}/${drift.review} records already mapped` +
        (drift.unmapped ? `, ${drift.unmapped} not yet published` : '') +
        (drift.orphaned
          ? `; ${drift.orphaned} entries match no record here`
          : ''),
    );
  }

  // ── reconcile with the live store, then the leak backstop ──────────────
  // Both run in every mode, dry-run included: a rehearsal that cannot tell
  // you the real run would be refused is not a rehearsal.
  const creds = credentials();
  if (!creds) {
    die(
      'the pre-flight counts the live serving store, so every mode (dry-run\n' +
        '  and --sql included) needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n' +
        '  (shell or .env). Nothing was uploaded and the mapping was not written.',
    );
  }
  const sportKeys = [...new Set(serving.map((r) => r.sportKey))];
  let liveCount: number;
  try {
    liveCount = await fetchLiveCount(creds, sportKeys);
  } catch (err) {
    die(
      `could not count the live serving store: ${(err as Error).message}\n` +
        '  The publish guard has not run, so nothing proceeds. Nothing was\n' +
        '  uploaded and the mapping was not written.',
    );
  }

  const gate = preflight({
    serving,
    mintedIds: minted,
    liveCount,
    partialPublishReason: opts.partialPublishReason,
  });
  const d = gate.reconciliation;
  console.error(
    `live store     ${d.liveCount} records` +
      (d.coverage === null
        ? ' (empty: first publish)'
        : `; this publish carries ${d.carried} of them (${pct(d.coverage)})`),
  );
  if (d.basis === 'partial-publish-declared') {
    console.error(
      `PARTIAL PUBLISH declared: "${d.partialPublishReason}"\n` +
        `               accounts for ${pct(d.coverage)} of live, below ${pct(d.threshold)}. ` +
        'The leak check still runs.',
    );
  } else if (d.partialPublishReason) {
    console.error(
      `partial publish declared ("${d.partialPublishReason}") but not needed: ` +
        'this publish accounts for the live store.',
    );
  }
  if (!d.permit) printRefusal(d, recordsDir, mappingPath, minted.size);

  const leaks = gate.leaks;
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
    console.error('\nFix the miner or extend SCRUBBED_NAMES, then re-publish.');
  } else {
    console.error('leak check     clean — no source markers survive');
  }

  if (!gate.ok) {
    console.error('\nNothing was uploaded and the mapping was not written.\n');
    process.exit(1);
  }

  const certified = serving.filter((r) => r.certified).length;
  console.error(`certified      ${certified}/${serving.length}`);

  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + '\n', 'utf8');

  if (opts.dryRun) {
    console.error(
      `\nDRY RUN — nothing uploaded. Mapping written to ${mappingPath}\n`,
    );
    return;
  }

  if (opts.sql) {
    writeFileSync(opts.sql, buildUpsertSql(serving), 'utf8');
    console.error(`\nSQL written to ${opts.sql} — run it in the SQL editor.\n`);
    return;
  }

  await upload(creds, serving, mappingPath);
}

async function upload(
  creds: Credentials,
  records: ServingRecord[],
  mappingPath: string,
): Promise<void> {
  const { url, key } = creds;
  const CHUNK = 250;
  let done = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = records.slice(i, i + CHUNK).map(toUpsertRow);
    const res = await fetch(`${url}/rest/v1/coaching_records?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // An upsert overwrites every column it sends, so the rows carry no
        // review state (certified, contested, rejected). Reviewers' votes own
        // those, through migration 014's trigger (#145).
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

main().catch((err) => die(String(err?.stack ?? err)));
