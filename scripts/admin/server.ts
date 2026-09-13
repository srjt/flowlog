#!/usr/bin/env node
/**
 * The local cue review tool (docs/ADMIN.md).
 *
 *   scripts/admin/serve.sh
 *
 * Read-only view of every Session: transcript in, Extraction, the Coaching
 * records that grounded it, Cue out. Local on purpose — it shows every
 * athlete's private voice dump, so it binds to 127.0.0.1, sits behind basic
 * auth, and reads Supabase with the service role key that never leaves this
 * process. The browser only ever talks to this server.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FEEDBACK_REASONS } from '../../src/constants/feedback.ts';
import { BJJ_POSITIONS } from '../../src/sports/bjj/bjjPositions.ts';
import { isAuthorized, isLoopbackHost } from './auth.ts';
import {
  GROUNDING_COLUMNS,
  RECENT_MISTAKES_WINDOW,
  buildTodaysPrompt,
  compareWithStored,
  inferredPerspective,
  positionsToday,
  toPoolRecord,
  type PromptSessionRow,
} from './prompt.ts';
import {
  UNKNOWN_VERSION_FACTS,
  groundingFunnel,
  injectedRecords,
  latestRun,
  recordTrail,
  toSummary,
  versionKey,
  type RecordRow,
  type SessionPromptRecord,
  type SessionRow,
  type VersionFacts,
  type VoteRow,
} from './review.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO_BUCKET = 'session-audio';
const AUDIO_URL_TTL_SECONDS = 600;
const PAGE_SIZE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

loadEnv();

const SUPABASE_URL = (
  process.env.SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  ''
).replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ADMIN_USER = process.env.ADMIN_USER ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const PORT = Number(process.env.ADMIN_PORT ?? 4321);

// Refuse to start rather than run open: a missing password must never
// quietly mean "no password".
const missing = [
  ['SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY],
  ['ADMIN_USER', ADMIN_USER],
  ['ADMIN_PASSWORD', ADMIN_PASSWORD],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length > 0) {
  console.error(`\n  Missing in .env: ${missing.join(', ')}\n`);
  process.exit(1);
}

const POSITION_LABELS: Record<string, string> = Object.fromEntries(
  BJJ_POSITIONS.map((p) => [p.id, p.label]),
);

// ── Supabase (service role) ─────────────────────────────────────────────────

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders,
  });
  if (!res.ok) {
    throw new Error(
      `${path.split('?')[0]} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

/** Every row, not the first page — the #114 lesson. */
async function restAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest<T[]>(`${path}&limit=${PAGE_SIZE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Ask the database's own predicates, once per distinct version. */
async function versionFacts(
  versions: (string | null)[],
): Promise<Map<string, VersionFacts>> {
  const ask = async (fn: string, version: string | null): Promise<boolean> => {
    try {
      const answer = await rest<unknown>(`rpc/${fn}`, {
        method: 'POST',
        body: JSON.stringify({ p_pipeline_version: version }),
      });
      return answer === true;
    } catch (err) {
      console.warn(
        `  ! ${fn}(${version}) failed, treating as unknown: ${(err as Error).message}`,
      );
      return false;
    }
  };
  const facts = new Map<string, VersionFacts>();
  for (const version of new Set(versions)) {
    facts.set(versionKey(version), {
      reachedModel: await ask('grounding_reached_model', version),
      candidatesExact: await ask('grounding_candidates_is_exact', version),
    });
  }
  return facts;
}

async function athleteNames(): Promise<Map<string, string | null>> {
  const rows = await restAll<{ id: string; display_name: string | null }>(
    'profiles?select=id,display_name&order=id',
  );
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

async function sessionById(id: string): Promise<SessionRow | null> {
  const rows = await rest<SessionRow[]>(`sessions?select=*&id=eq.${id}`);
  return rows[0] ?? null;
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function listSessions() {
  const [rows, names] = await Promise.all([
    restAll<SessionRow>('sessions?select=*&order=session_date.desc,id'),
    athleteNames(),
  ]);
  const facts = await versionFacts(rows.map((r) => r.pipeline_version));
  const sessions = rows.map((row) =>
    toSummary(row, {
      athlete: names.get(row.user_id) ?? null,
      positionLabel: row.target_position_id
        ? (POSITION_LABELS[row.target_position_id] ?? null)
        : null,
      facts:
        facts.get(versionKey(row.pipeline_version)) ?? UNKNOWN_VERSION_FACTS,
    }),
  );

  const athletes = new Map(sessions.map((s) => [s.userId, s.athlete]));
  const positions = new Set(
    sessions.map((s) => s.targetPositionId).filter((p): p is string => !!p),
  );
  return {
    sessions,
    athletes: [...athletes]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    positions: [...positions]
      .map((id) => ({ id, label: POSITION_LABELS[id] ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    positionLabels: POSITION_LABELS,
    reasons: FEEDBACK_REASONS,
  };
}

/**
 * Prompts exactly as sent (#121). Null when the log cannot be read at all —
 * migration 023 not applied yet — which the page reports as such rather than
 * as "nothing recorded".
 */
async function sessionPrompts(
  id: string,
): Promise<SessionPromptRecord[] | null> {
  try {
    return await rest<SessionPromptRecord[]>(
      'session_prompts?select=run_id,run,attempt,strict,produced_cue,provider,' +
        `model,prompt,created_at&session_id=eq.${id}&order=created_at.asc,attempt.asc`,
    );
  } catch (err) {
    console.warn(`  ! session_prompts unavailable: ${(err as Error).message}`);
    return null;
  }
}

async function sessionDetail(id: string) {
  const row = await sessionById(id);
  if (!row) return null;

  const ids = row.grounding_record_ids ?? [];
  const idList = ids.join(',');
  const [records, votes, names, facts, prompts] = await Promise.all([
    ids.length
      ? rest<RecordRow[]>(
          'coaching_records?select=id,position,prescription,why,detail,' +
            `counter,gi,level,opponent,certified,contested,rejected&id=in.(${idList})`,
        )
      : Promise.resolve([]),
    ids.length
      ? restAll<VoteRow>(
          `record_votes?select=record_id,verdict&record_id=in.(${idList})`,
        )
      : Promise.resolve([]),
    rest<{ display_name: string | null }[]>(
      `profiles?select=display_name&id=eq.${row.user_id}`,
    ),
    versionFacts([row.pipeline_version]),
    sessionPrompts(id),
  ]);
  const versionFact =
    facts.get(versionKey(row.pipeline_version)) ?? UNKNOWN_VERSION_FACTS;

  return {
    session: row,
    athlete: names[0]?.display_name?.trim() || 'Unnamed athlete',
    positionLabel: row.target_position_id
      ? (POSITION_LABELS[row.target_position_id] ?? null)
      : null,
    facts: versionFact,
    trail: recordTrail(row, versionFact),
    funnel: groundingFunnel(row, versionFact),
    records: injectedRecords(row.grounding_record_ids, records, votes),
    hasAudio: !!row.audio_storage_path,
    prompts:
      prompts === null
        ? { available: false, latest: null }
        : { available: true, latest: latestRun(prompts) },
  };
}

async function audioUrl(id: string): Promise<string | null> {
  const row = await sessionById(id);
  if (!row?.audio_storage_path) return null;
  const encoded = row.audio_storage_path
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${AUDIO_BUCKET}/${encoded}`,
    {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ expiresIn: AUDIO_URL_TTL_SECONDS }),
    },
  );
  if (!res.ok) {
    throw new Error(`audio signing failed: ${res.status} ${await res.text()}`);
  }
  const { signedURL } = (await res.json()) as { signedURL: string };
  return signedURL.startsWith('/storage/v1')
    ? `${SUPABASE_URL}${signedURL}`
    : `${SUPABASE_URL}/storage/v1${signedURL}`;
}

/**
 * The coaching prompt this Session's Extraction would get TODAY (prompt.ts).
 * Fetches the same inputs `process-session` fetches, in the same shape, except
 * that the recent mistakes exclude this session — at generation time it had
 * not been inserted yet.
 */
async function todaysPrompt(id: string) {
  const rows = await rest<PromptSessionRow[]>(`sessions?select=*&id=eq.${id}`);
  const row = rows[0];
  if (!row) return null;

  const sportKey = encodeURIComponent(row.sport_key ?? 'bjj');
  // The side the pipeline used lives in the positions of the records it
  // grounded this session in — perspective itself was never stored.
  const storedIds = row.grounding_record_ids ?? [];
  const storedRecordPositions =
    storedIds.length > 0
      ? (
          await rest<{ position: string }[]>(
            `coaching_records?select=position&id=in.(${storedIds.join(',')})`,
          )
        ).map((r) => r.position)
      : [];
  const side = inferredPerspective(row, storedRecordPositions);
  const positions = positionsToday(row, side.side);
  const positionList = encodeURIComponent(
    positions.map((p) => `"${p}"`).join(','),
  );
  const [profile, mistakes, trends, pool] = await Promise.all([
    rest<{ skill_level: string | null }[]>(
      `profiles?select=skill_level&id=eq.${row.user_id}`,
    ),
    rest<{ key_mistake: string | null }[]>(
      `sessions?select=key_mistake&user_id=eq.${row.user_id}&id=neq.${row.id}` +
        `&key_mistake=not.is.null&order=session_date.desc&limit=${RECENT_MISTAKES_WINDOW}`,
    ),
    rest<{ dominant_weakness: string | null }[]>(
      `user_trends?select=dominant_weakness&user_id=eq.${row.user_id}` +
        `&sport_key=eq.${sportKey}&limit=1`,
    ),
    // Ordered by id like loadGroundingRecords: ranking ties keep input order.
    positions.length > 0
      ? restAll<Record<string, unknown>>(
          `coaching_records?select=${GROUNDING_COLUMNS}&sport_key=eq.${sportKey}` +
            `&position=in.(${positionList})&order=id.asc`,
        )
      : Promise.resolve([]),
  ]);

  const built = buildTodaysPrompt(
    row,
    {
      skillLevel: profile[0]?.skill_level ?? null,
      recentMistakes: mistakes
        .map((m) => m.key_mistake)
        .filter((m): m is string => Boolean(m)),
      dominantWeakness: trends[0]?.dominant_weakness ?? null,
      pool: pool.map(toPoolRecord),
    },
    positions,
    side,
  );
  return {
    ...built,
    stored: compareWithStored(row, built.selection.recordIds),
  };
}

// ── HTTP ────────────────────────────────────────────────────────────────────

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; script-src 'self'; " +
    `media-src ${SUPABASE_URL}; frame-ancestors 'none'`,
};

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type: string,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');

const staticFile = (name: string) => readFileSync(join(HERE, name), 'utf8');

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!isLoopbackHost(req.headers.host, PORT)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }
  if (!isAuthorized(req.headers.authorization, ADMIN_USER, ADMIN_PASSWORD)) {
    return send(res, 401, 'Authentication required', 'text/plain', {
      'WWW-Authenticate': 'Basic realm="Flowlog cue review", charset="UTF-8"',
    });
  }
  if (req.method !== 'GET') {
    return send(res, 405, 'Read-only', 'text/plain', { Allow: 'GET' });
  }

  const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;

  if (path === '/') {
    return send(res, 200, staticFile('index.html'), 'text/html; charset=utf-8');
  }
  if (path === '/app.js') {
    return send(res, 200, staticFile('app.js'), 'text/javascript');
  }
  if (path === '/app.css') {
    return send(res, 200, staticFile('app.css'), 'text/css');
  }
  // The same module jest tests, with its types stripped. Read per request so
  // an edit shows up on reload.
  if (path === '/review.js') {
    return send(
      res,
      200,
      stripTypeScriptTypes(staticFile('review.ts')),
      'text/javascript',
    );
  }

  if (path === '/api/sessions') return json(res, 200, await listSessions());

  const detail = path.match(/^\/api\/sessions\/([^/]+)(?:\/(audio|prompt))?$/);
  if (detail) {
    const [, id, sub] = detail;
    if (!id || !UUID.test(id)) return json(res, 400, { error: 'Bad id' });
    if (sub === 'audio') {
      const url = await audioUrl(id);
      return url
        ? json(res, 200, { url })
        : json(res, 404, { error: 'No audio stored for this session' });
    }
    if (sub === 'prompt') {
      const body = await todaysPrompt(id);
      return body
        ? json(res, 200, body)
        : json(res, 404, { error: 'No such session' });
    }
    const body = await sessionDetail(id);
    return body
      ? json(res, 200, body)
      : json(res, 404, { error: 'No such session' });
  }

  return send(res, 404, 'Not found', 'text/plain');
}

createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) {
      json(res, 502, { error: (err as Error).message ?? 'Request failed' });
    } else {
      res.end();
    }
  });
})
  .on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(
      `\n  Port ${PORT} is already in use — is the cue review already running?` +
        `\n  Stop it, or set ADMIN_PORT to another port in .env.\n`,
    );
    process.exit(1);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Cue review: http://127.0.0.1:${PORT}\n`);
  });
