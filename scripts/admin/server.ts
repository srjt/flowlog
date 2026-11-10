#!/usr/bin/env node
/**
 * The local cue review tool (docs/ADMIN.md).
 *
 *   scripts/admin/serve.sh
 *
 * A view of every Session: transcript in, Extraction, the Coaching records
 * that grounded it, Cue out. Local on purpose — it shows every athlete's
 * private voice dump, so it binds to 127.0.0.1, sits behind basic auth, and
 * reads Supabase with the service role key that never leaves this process.
 * The browser only ever talks to this server.
 *
 * It reads everything and writes one thing: the operator's verdict on a Cue
 * (#132, migration 026), through the single route `POST /api/verdict`.
 *
 * It also reads the AI second opinions `scripts/judge/opine.sh` stores
 * (migration 027), and sends one to the page only once the operator has judged
 * the same Cue (`revealOpinions`): blind first, enforced here, not in the page.
 */

import { createHash } from 'node:crypto';
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
import {
  WRITE_PATH,
  allowedMethods,
  isAuthorized,
  isLoopbackHost,
  writeRefusal,
} from './auth.ts';
import {
  GROUNDING_COLUMNS,
  RECENT_MISTAKES_WINDOW,
  buildTodaysPrompt,
  compareWithStored,
  inferredPerspective,
  positionsToday,
  recordedPerspective,
  toPoolRecord,
  type PromptSessionRow,
} from './prompt.ts';
import {
  AI_OPINION_COLUMNS,
  UNKNOWN_VERSION_FACTS,
  UUID_PATTERN,
  VERDICT_COLUMNS,
  VERDICT_COLUMNS_BEFORE_027,
  groundingFunnel,
  injectedRecords,
  latestRun,
  parseVerdictRequest,
  recordStatus,
  recordTrail,
  recordsBehindWrongCues,
  revealOpinions,
  toSummary,
  verdictInsert,
  verdictsFor,
  versionKey,
  type AiOpinionRow,
  type PromptAttempt,
  type RecordRow,
  type SessionPromptRecord,
  type SessionRow,
  type VerdictRequest,
  type VerdictRow,
  type VersionFacts,
  type VoteRow,
} from './review.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO_BUCKET = 'session-audio';
const AUDIO_URL_TTL_SECONDS = 600;
const PAGE_SIZE = 1000;
/** Ids per `in.(…)` filter, so a long list never becomes an overlong URL. */
const ID_CHUNK = 100;
/** A verdict body is a few hundred bytes; anything near this is not one. */
const MAX_BODY_BYTES = 16 * 1024;
const RECORD_COLUMNS =
  'id,position,prescription,why,detail,counter,gi,level,opponent,certified,' +
  'contested,rejected';

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

async function rest<T>(
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders, ...init?.headers },
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

async function recordsById(ids: string[]): Promise<RecordRow[]> {
  const rows: RecordRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK).join(',');
    rows.push(
      ...(await rest<RecordRow[]>(
        `coaching_records?select=${RECORD_COLUMNS}&id=in.(${chunk})`,
      )),
    );
  }
  return rows;
}

/**
 * Whether migration 027 is applied (`cue_verdicts.better_cue` exists). Until
 * it is, verdicts still read and save, without a better Cue. Asked once per
 * request: one tiny read, and the answer is never stale after `db push`.
 */
async function hasBetterCueColumn(): Promise<boolean> {
  try {
    await rest<unknown[]>('cue_verdicts?select=better_cue&limit=1');
    return true;
  } catch {
    // Not applied yet, or 026 isn't either; verdictRows reports the latter.
    return false;
  }
}

/**
 * Operator verdicts (#132). Null when the table cannot be read at all —
 * migration 026 not applied yet — which the page reports as such rather than
 * as "nothing judged".
 */
async function verdictRows(
  filter: string,
  withBetterCue: boolean,
): Promise<VerdictRow[] | null> {
  try {
    const columns = withBetterCue
      ? VERDICT_COLUMNS
      : VERDICT_COLUMNS_BEFORE_027;
    const rows = await restAll<VerdictRow>(
      `cue_verdicts?select=${columns}${filter}&order=id`,
    );
    return rows.map((v) => ({ ...v, better_cue: v.better_cue ?? null }));
  } catch (err) {
    console.warn(`  ! cue_verdicts unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * AI second opinions (migration 027), about any Cue. Null when the table can't
 * be read (027 not applied). Never sent to the page as they are: every route
 * passes them through `revealOpinions` first.
 */
async function opinionRows(filter = ''): Promise<AiOpinionRow[] | null> {
  try {
    return await restAll<AiOpinionRow>(
      `cue_ai_opinions?select=${AI_OPINION_COLUMNS}${filter}&order=id`,
    );
  } catch (err) {
    console.warn(`  ! cue_ai_opinions unavailable: ${(err as Error).message}`);
    return null;
  }
}

/** The page's view of a Session's opinions: revealed only once it's judged. */
function opinionView(
  row: Pick<SessionRow, 'coaching_cue'>,
  verdicts: VerdictRow[],
  opinions: AiOpinionRow[] | null,
) {
  if (opinions === null) return { available: false, shown: [], hidden: 0 };
  const judged = verdictsFor(row.coaching_cue, verdicts).current !== null;
  return {
    available: true,
    ...revealOpinions(row.coaching_cue, judged, opinions),
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * Every prompt-log attempt, without the prompt text, grouped by Session. It's
 * enough to say which model wrote each Cue for the trust report. Null when the
 * log can't be read (migration 023 not applied).
 */
async function promptAttemptsBySession(): Promise<Map<
  string,
  PromptAttempt[]
> | null> {
  try {
    const rows = await restAll<PromptAttempt & { session_id: string }>(
      // Ordered by the primary key so offset paging is stable; runs are
      // grouped and attempts sorted in `cueWriter`, not here.
      'session_prompts?select=session_id,run_id,run,attempt,produced_cue,model,created_at' +
        '&order=id.asc',
    );
    const out = new Map<string, PromptAttempt[]>();
    for (const r of rows) {
      out.set(r.session_id, [...(out.get(r.session_id) ?? []), r]);
    }
    return out;
  } catch (err) {
    console.warn(`  ! session_prompts unavailable: ${(err as Error).message}`);
    return null;
  }
}

async function listSessions() {
  const betterCue = await hasBetterCueColumn();
  const [rows, names, verdicts, attempts, opinions] = await Promise.all([
    restAll<SessionRow>('sessions?select=*&order=session_date.desc,id'),
    athleteNames(),
    verdictRows('', betterCue),
    promptAttemptsBySession(),
    opinionRows(),
  ]);
  const facts = await versionFacts(rows.map((r) => r.pipeline_version));
  const verdictsBySession = new Map<string, VerdictRow[]>();
  for (const v of verdicts ?? []) {
    verdictsBySession.set(v.session_id, [
      ...(verdictsBySession.get(v.session_id) ?? []),
      v,
    ]);
  }
  const opinionsBySession = new Map<string, AiOpinionRow[]>();
  for (const o of opinions ?? []) {
    opinionsBySession.set(o.session_id, [
      ...(opinionsBySession.get(o.session_id) ?? []),
      o,
    ]);
  }
  const sessions = rows.map((row) =>
    toSummary(row, {
      athlete: names.get(row.user_id) ?? null,
      positionLabel: row.target_position_id
        ? (POSITION_LABELS[row.target_position_id] ?? null)
        : null,
      facts:
        facts.get(versionKey(row.pipeline_version)) ?? UNKNOWN_VERSION_FACTS,
      verdicts: verdictsBySession.get(row.id) ?? [],
      promptAttempts: attempts?.get(row.id) ?? [],
      // `toSummary` reveals only the opinions on a judged Cue.
      opinions: opinionsBySession.get(row.id) ?? [],
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
    verdictsAvailable: verdicts !== null,
    opinionsAvailable: opinions !== null,
    betterCueAvailable: betterCue,
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
  const betterCue = await hasBetterCueColumn();
  const [records, votes, names, facts, prompts, verdicts, opinions] =
    await Promise.all([
      recordsById(ids),
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
      verdictRows(`&session_id=eq.${id}`, betterCue),
      opinionRows(`&session_id=eq.${id}`),
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
    // The operator's, shown beside the athlete's thumbs on `session`, never
    // merged with them.
    verdicts:
      verdicts === null
        ? { available: false, current: null, earlier: [] }
        : { available: true, ...verdictsFor(row.coaching_cue, verdicts) },
    betterCueAvailable: betterCue,
    // Blind first: the AI's opinion only once this Cue has a verdict.
    opinions: opinionView(row, verdicts ?? [], opinions),
  };
}

/** The records that keep sitting behind wrong Cues (#132 story 6). */
async function recordsBehindWrong() {
  // Only ids and reasons are read here; the better Cue isn't needed.
  const verdicts = await verdictRows('', false);
  if (verdicts === null) return { available: false };
  const signal = recordsBehindWrongCues(verdicts);
  const records = await recordsById(signal.records.map((r) => r.recordId));
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    available: true,
    wrong: signal.wrong,
    records: signal.records.map((s) => {
      const record = byId.get(s.recordId) ?? null;
      return { ...s, record, status: record ? recordStatus(record) : null };
    }),
  };
}

const md5 = (text: string) =>
  createHash('md5').update(text, 'utf8').digest('hex');

/**
 * Upserts or clears one verdict, then answers with all of the Session's
 * verdicts so the page can update without reloading.
 *
 * Recording is against the Session as stored NOW: the Cue the operator read
 * must still be the one the row holds (409 if a Re-analyze replaced it), and
 * the record trail, run and record ids are snapshotted here, server side,
 * never taken from the page. Clearing works on any of the Session's verdicts,
 * an earlier Cue's included.
 */
async function recordVerdict(
  req: VerdictRequest,
): Promise<{ status: number; body: unknown }> {
  const row = await sessionById(req.sessionId);
  if (!row) return { status: 404, body: { error: 'No such session' } };
  const hasColumn = await hasBetterCueColumn();

  if (req.verdict === null) {
    const cleared = await rest<VerdictRow[]>(
      `cue_verdicts?session_id=eq.${row.id}&cue_md5=eq.${md5(req.cue)}`,
      { method: 'DELETE', headers: { Prefer: 'return=representation' } },
    );
    if (cleared.length === 0) {
      return { status: 404, body: { error: 'No verdict on that Cue' } };
    }
  } else {
    const [facts, prompts] = await Promise.all([
      versionFacts([row.pipeline_version]),
      sessionPrompts(row.id),
    ]);
    const trail = recordTrail(
      row,
      facts.get(versionKey(row.pipeline_version)) ?? UNKNOWN_VERSION_FACTS,
    );
    const runId = prompts ? (latestRun(prompts)?.runId ?? null) : null;
    const shaped = verdictInsert(req, row, { trail, runId });
    if (!shaped.ok) return { status: 409, body: { error: shaped.error } };
    // Before 027 there is no column to send, null or not.
    const { better_cue: betterCue, ...withoutBetterCue } = shaped.value;
    if (!hasColumn && betterCue !== null) {
      return {
        status: 409,
        body: {
          error:
            'Keeping a better Cue needs migration 027. Apply it, or save without one.',
        },
      };
    }
    // No created_at, so changing a verdict keeps when it was first made.
    await rest<VerdictRow[]>('cue_verdicts?on_conflict=session_id,cue_md5', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([
        {
          ...(hasColumn ? shaped.value : withoutBetterCue),
          updated_at: new Date().toISOString(),
        },
      ]),
    });
  }

  const [verdicts, opinions] = await Promise.all([
    verdictRows(`&session_id=eq.${row.id}`, hasColumn),
    opinionRows(`&session_id=eq.${row.id}`),
  ]);
  return {
    status: 200,
    body: {
      verdicts: verdicts ?? [],
      ...verdictsFor(row.coaching_cue, verdicts ?? []),
      // Judging the Cue reveals the AI's opinion on it; clearing hides it again.
      opinions: opinionView(row, verdicts ?? [], opinions),
    },
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
  // The side the Session recorded comes first (#130, migration 024). Only a
  // Session from before that recorded none, and for those the side the
  // pipeline used lives in the positions of the records it was grounded in.
  // `select=*` above carries the column once 024 is applied.
  const storedIds =
    recordedPerspective(row) === null ? (row.grounding_record_ids ?? []) : [];
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

/** The body as text, or null when it is larger than any verdict could be. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk as Buffer);
  }
  return size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8');
}

const header = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join(', ') : value;

/** `POST /api/verdict`: the CSRF guard, then the validation the tests run. */
async function writeVerdict(req: IncomingMessage, res: ServerResponse) {
  const refusal = writeRefusal({
    host: req.headers.host,
    contentType: req.headers['content-type'],
    origin: req.headers.origin,
    secFetchSite: header(req.headers['sec-fetch-site']),
  });
  if (refusal) return send(res, refusal.status, refusal.reason, 'text/plain');

  const raw = await readBody(req);
  if (raw === null) return json(res, 413, { error: 'Body too large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'Body is not JSON' });
  }
  const parsed = parseVerdictRequest(body);
  if (!parsed.ok) return json(res, 400, { error: parsed.error });

  const out = await recordVerdict(parsed.value);
  return json(res, out.status, out.body);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!isLoopbackHost(req.headers.host, PORT)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }
  if (!isAuthorized(req.headers.authorization, ADMIN_USER, ADMIN_PASSWORD)) {
    return send(res, 401, 'Authentication required', 'text/plain', {
      'WWW-Authenticate': 'Basic realm="Flowlog cue review", charset="UTF-8"',
    });
  }

  const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;
  const allowed = allowedMethods(path);
  if (!allowed.includes(req.method ?? '')) {
    return send(res, 405, 'Method not allowed', 'text/plain', {
      Allow: allowed.join(', '),
    });
  }
  if (path === WRITE_PATH) return writeVerdict(req, res);

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
  if (path === '/api/verdicts/records') {
    return json(res, 200, await recordsBehindWrong());
  }

  const detail = path.match(/^\/api\/sessions\/([^/]+)(?:\/(audio|prompt))?$/);
  if (detail) {
    const [, id, sub] = detail;
    if (!id || !UUID_PATTERN.test(id)) {
      return json(res, 400, { error: 'Bad id' });
    }
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
