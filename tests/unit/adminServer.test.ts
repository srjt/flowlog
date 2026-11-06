/**
 * @jest-environment node
 */
/**
 * One round trip through the local cue review server (#132).
 *
 * The server gained its first write route, so the gate around it is worth
 * driving for real: the actual `scripts/admin/server.ts`, run by Node exactly
 * as `serve.sh` runs it, pointed at a stub Supabase on loopback. No live
 * database is touched. The stub records every request, so each refusal can
 * also prove that nothing reached `cue_verdicts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VerdictRow } from '../../scripts/admin/review';

const SERVER = join(__dirname, '..', '..', 'scripts', 'admin', 'server.ts');
const USER = 'operator';
const PASSWORD = 'correct horse';
const AUTH = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUE = 'Get on your side and frame on the hip before they settle.';

const SESSION = {
  id: SESSION_ID,
  user_id: USER_ID,
  session_date: '2026-10-01T18:00:00Z',
  audio_storage_path: null,
  raw_transcript: 'He passed my half guard again',
  positions_visited: ['half guard'],
  key_mistake: 'Flat on my back',
  opponent_action: null,
  sentiment: 'frustrated',
  coaching_cue: CUE,
  target_position: 'Half guard (bottom)',
  target_position_id: 'half-guard-bottom',
  quality_gate_passed: true,
  thumbs_up: false,
  feedback_reason: 'Too generic',
  feedback_note: null,
  pipeline_version: '1.3.0',
  gi: 'gi',
  perspective: 'bottom',
  grounding: 'grounded',
  grounding_candidates: 40,
  grounding_gate_passed: 9,
  grounding_available: 2,
  grounding_records: 2,
  grounding_record_ids: [R1, R2],
  reanalyzed_at: null,
};

const record = (id: string) => ({
  id,
  position: 'half-guard-bottom',
  prescription: 'Frame on the hip',
  why: null,
  detail: null,
  counter: null,
  gi: 'either',
  level: 'any',
  opponent: null,
  certified: false,
  contested: false,
  rejected: false,
});

const md5 = (text: string) =>
  createHash('md5').update(text, 'utf8').digest('hex');

// ── A stub Supabase: just the PostgREST calls the tool makes ────────────────

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  prefer: string | undefined;
  body: string;
}

let seen: Seen[] = [];
let table: VerdictRow[] = [];
let ids = 0;

const writesToVerdicts = () =>
  seen.filter((r) => r.path === 'cue_verdicts' && r.method !== 'GET');

function stubSupabase(req: IncomingMessage, res: ServerResponse, body: string) {
  const url = new URL(req.url ?? '/', 'http://stub');
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const q = url.searchParams;
  seen.push({
    method: req.method ?? '',
    path,
    query: q,
    prefer: req.headers.prefer as string | undefined,
    body,
  });
  const reply = (payload: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  const page = <T>(rows: T[]) => (Number(q.get('offset') ?? 0) > 0 ? [] : rows);

  if (path.startsWith('rpc/')) return reply(true);
  if (path === 'sessions') {
    const id = q.get('id');
    if (id) return reply(id === `eq.${SESSION_ID}` ? [SESSION] : []);
    return reply(page([SESSION]));
  }
  if (path === 'profiles') {
    return reply(page([{ id: USER_ID, display_name: 'Ana' }]));
  }
  if (path === 'record_votes') return reply(page([]));
  if (path === 'coaching_records') {
    const list = (q.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',');
    return reply(list.filter(Boolean).map(record));
  }
  if (path === 'session_prompts') {
    return reply([
      {
        run_id: RUN_ID,
        run: 'insert',
        attempt: 1,
        strict: false,
        produced_cue: true,
        provider: 'stub',
        model: 'model',
        prompt: 'prompt',
        created_at: '2026-10-01T18:00:05Z',
      },
    ]);
  }
  if (path === 'cue_verdicts') {
    const session = q.get('session_id')?.replace(/^eq\./, '');
    if (req.method === 'GET') {
      return reply(
        page(table.filter((v) => !session || v.session_id === session)),
      );
    }
    if (req.method === 'POST') {
      const now = new Date().toISOString();
      const rows = (JSON.parse(body) as Partial<VerdictRow>[]).map((row) => {
        const existing = table.find(
          (v) => v.session_id === row.session_id && v.cue === row.cue,
        );
        const merged = {
          id: existing?.id ?? `v${++ids}`,
          created_at: existing?.created_at ?? now,
          ...existing,
          ...row,
        } as VerdictRow;
        table = [...table.filter((v) => v !== existing), merged];
        return merged;
      });
      return reply(rows);
    }
    if (req.method === 'DELETE') {
      const hash = q.get('cue_md5')?.replace(/^eq\./, '');
      const gone = table.filter(
        (v) => v.session_id === session && md5(v.cue) === hash,
      );
      table = table.filter((v) => !gone.includes(v));
      return reply(gone);
    }
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: `stub has no ${req.method} ${path}` }));
}

// ── The real server, against the stub ───────────────────────────────────────

let stub: Server;
let child: ChildProcess;
let port: number;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = s.address() as AddressInfo;
      s.close(() => resolve(p));
    });
  });

beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => stubSupabase(req, res, body));
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const stubPort = (stub.address() as AddressInfo).port;
  port = await freePort();

  child = spawn(
    process.execPath,
    [
      '--no-warnings=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      SERVER,
    ],
    {
      // An empty directory, so the server's .env loader finds nothing real.
      cwd: mkdtempSync(join(tmpdir(), 'cue-review-')),
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        SUPABASE_URL: `http://127.0.0.1:${stubPort}`,
        SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role',
        ADMIN_USER: USER,
        ADMIN_PASSWORD: PASSWORD,
        ADMIN_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise<void>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(
      () => reject(new Error(`server did not start:\n${out}`)),
      20_000,
    );
    const watch = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (out.includes('Cue review: http://127.0.0.1:')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', watch);
    child.stderr?.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${out}`));
    });
  });
}, 30_000);

afterAll(async () => {
  child?.removeAllListeners('exit');
  child?.kill();
  await new Promise<void>((r) => (stub ? stub.close(() => r()) : r()));
});

beforeEach(() => {
  seen = [];
  table = [];
});

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: () => Record<string, unknown>;
}

function call(
  method: string,
  path: string,
  o: { headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { Authorization: AUTH, ...o.headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString('utf8')));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: () => JSON.parse(text) as Record<string, unknown>,
          }),
        );
      },
    );
    req.on('error', reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

/** What the page sends: JSON, from its own origin. */
const post = (body: unknown, headers: Record<string, string> = {}) =>
  call('POST', '/api/verdict', {
    headers: {
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const WRONG = {
  sessionId: SESSION_ID,
  cue: CUE,
  verdict: 'wrong',
  reason: 'records_wrong',
  note: '  framed too late  ',
};

describe('POST /api/verdict records a verdict on the Cue the page showed', () => {
  it('upserts a snapshot of the Cue, its run and the records behind it', async () => {
    const res = await post(WRONG);
    expect(res.status).toBe(200);

    const writes = writesToVerdicts();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.query.get('on_conflict')).toBe('session_id,cue_md5');
    expect(writes[0]?.prefer).toContain('resolution=merge-duplicates');
    const [row] = JSON.parse(writes[0]?.body ?? '[]') as VerdictRow[];
    expect(row).toMatchObject({
      session_id: SESSION_ID,
      run_id: RUN_ID,
      cue: CUE,
      verdict: 'wrong',
      reason: 'records_wrong',
      note: 'framed too late',
      record_ids: [R1, R2],
      record_trail: 'trusted',
    });
    // Never the page's word for when it was first judged.
    expect(row).not.toHaveProperty('created_at');

    expect(res.json().current).toMatchObject({
      verdict: 'wrong',
      reason: 'records_wrong',
    });
    expect(res.json().earlier).toEqual([]);
  });

  it('then reads back as judged, separately from the athlete, and as a record signal', async () => {
    await post(WRONG);

    const list = (await call('GET', '/api/sessions')).json();
    expect(list.verdictsAvailable).toBe(true);
    const [summary] = list.sessions as Record<string, unknown>[];
    expect(summary).toMatchObject({
      verdict: 'wrong',
      verdictReason: 'records_wrong',
      earlierVerdicts: 0,
      // The athlete's claim is untouched and stays its own field.
      thumbsUp: false,
      feedbackReason: 'Too generic',
    });

    const signal = (await call('GET', '/api/verdicts/records')).json();
    expect(signal.wrong).toEqual({
      total: 1,
      traced: 1,
      noRecords: 0,
      untraced: 0,
    });
    const records = signal.records as Record<string, unknown>[];
    expect(records.map((r) => r.recordId)).toEqual([R1, R2]);
    expect(records[0]).toMatchObject({
      wrong: 1,
      judged: 1,
      sessionIds: [SESSION_ID],
      status: 'unsettled',
    });
  });

  it('changes a verdict in place, on the same identity', async () => {
    await post(WRONG);
    const res = await post({
      sessionId: SESSION_ID,
      cue: CUE,
      verdict: 'sound',
    });
    expect(res.status).toBe(200);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ verdict: 'sound', reason: null });
  });

  it('clears a verdict back to unjudged with verdict: null', async () => {
    await post(WRONG);
    const res = await post({ sessionId: SESSION_ID, cue: CUE, verdict: null });
    expect(res.status).toBe(200);
    const del = writesToVerdicts().find((w) => w.method === 'DELETE');
    expect(del?.query.get('cue_md5')).toBe(`eq.${md5(CUE)}`);
    expect(table).toEqual([]);
    expect(res.json().current).toBeNull();
  });

  it('refuses a Cue the Session no longer holds, rather than filing it under the new one', async () => {
    const res = await post({ ...WRONG, cue: 'The Cue before a Re-analyze.' });
    expect(res.status).toBe(409);
    expect(writesToVerdicts()).toEqual([]);
  });

  it('answers 404 for a Session that does not exist', async () => {
    const res = await post({
      ...WRONG,
      sessionId: '99999999-9999-4999-8999-999999999999',
    });
    expect(res.status).toBe(404);
    expect(writesToVerdicts()).toEqual([]);
  });
});

describe('POST /api/verdict refuses anything a cross-site page could send', () => {
  it.each([
    ['a form post', { 'Content-Type': 'application/x-www-form-urlencoded' }],
    ['text/plain', { 'Content-Type': 'text/plain' }],
    ['multipart', { 'Content-Type': 'multipart/form-data; boundary=x' }],
  ])('refuses %s with 415', async (_, headers) => {
    const res = await post(WRONG, headers);
    expect(res.status).toBe(415);
    expect(writesToVerdicts()).toEqual([]);
  });

  it.each([
    ['a foreign Origin', () => ({ Origin: 'http://evil.example' })],
    // Another origin, even though it reaches the same server.
    ['the other loopback name', () => ({ Origin: `http://localhost:${port}` })],
    ['an opaque Origin', () => ({ Origin: 'null' })],
    ['a cross-site fetch', () => ({ 'Sec-Fetch-Site': 'cross-site' })],
  ])('refuses %s with 403', async (_, headers) => {
    const res = await post(WRONG, headers());
    expect(res.status).toBe(403);
    expect(writesToVerdicts()).toEqual([]);
  });

  it.each([
    ['a body that is not JSON', 'verdict=wrong'],
    ['a wrong Cue with no reason', { ...WRONG, reason: null }],
    ['a reason on a sound Cue', { ...WRONG, verdict: 'sound' }],
    ['an unknown verdict', { ...WRONG, verdict: 'fine', reason: null }],
    ['an unknown reason', { ...WRONG, reason: 'vibes' }],
    ['an unknown field', { ...WRONG, thumbs_up: true }],
  ])('refuses %s with 400', async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(writesToVerdicts()).toEqual([]);
  });

  it('refuses a body far larger than a verdict with 413', async () => {
    const res = await post({ ...WRONG, note: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(writesToVerdicts()).toEqual([]);
  });

  it('still needs the credentials and a loopback Host', async () => {
    const unauthorised = await call('POST', '/api/verdict', {
      headers: { Authorization: '', 'Content-Type': 'application/json' },
      body: JSON.stringify(WRONG),
    });
    expect(unauthorised.status).toBe(401);
    const rebound = await call('POST', '/api/verdict', {
      headers: {
        Host: `evil.example:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(WRONG),
    });
    expect(rebound.status).toBe(403);
    expect(writesToVerdicts()).toEqual([]);
  });
});

describe('the method gate', () => {
  it.each(['PUT', 'PATCH', 'DELETE', 'GET', 'OPTIONS', 'HEAD'])(
    'answers %s on the write route with 405, Allow: POST',
    async (method) => {
      const res = await call(method, '/api/verdict');
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    },
  );

  it.each(['/api/sessions', `/api/sessions/${SESSION_ID}`, '/', '/nowhere'])(
    'keeps %s read-only: a POST is 405, Allow: GET',
    async (path) => {
      const res = await call('POST', path, {
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(writesToVerdicts()).toEqual([]);
    },
  );

  it('still serves reads', async () => {
    expect((await call('GET', '/api/sessions')).status).toBe(200);
  });
});
