import {
  WRITE_PATH,
  allowedMethods,
  isAuthorized,
  isLoopbackHost,
  writeRefusal,
} from '../../scripts/admin/auth';
import {
  DEFAULT_FILTERS,
  compareVersions,
  filterSessions,
  groundingFunnel,
  injectedRecords,
  recordTrail,
  toSummary,
  type RecordRow,
  type SessionRow,
  type SessionSummary,
  type VerdictRow,
  type VersionFacts,
} from '../../scripts/admin/review';

const REACHED: VersionFacts = { reachedModel: true, candidatesExact: true };
const V100: VersionFacts = { reachedModel: false, candidatesExact: false };

const row = (o: Partial<SessionRow> = {}): SessionRow => ({
  id: 's1',
  user_id: 'u1',
  session_date: '2026-09-10T18:00:00Z',
  audio_storage_path: null,
  raw_transcript: 'He passed my half guard again',
  positions_visited: ['half guard'],
  key_mistake: 'Flat on my back',
  opponent_action: null,
  sentiment: 'frustrated',
  coaching_cue: 'Get on your side and frame on the hip.',
  target_position: 'Half guard (bottom)',
  target_position_id: 'half-guard-bottom',
  quality_gate_passed: true,
  thumbs_up: null,
  feedback_reason: null,
  feedback_note: null,
  pipeline_version: '1.3.0',
  gi: 'gi',
  grounding: 'grounded',
  grounding_candidates: 652,
  grounding_gate_passed: 70,
  grounding_available: 20,
  grounding_records: 2,
  grounding_record_ids: ['r1', 'r2'],
  reanalyzed_at: null,
  ...o,
});

const summary = (
  o: Partial<SessionRow> = {},
  facts = REACHED,
  verdicts: VerdictRow[] = [],
) =>
  toSummary(row(o), { athlete: 'Ana', positionLabel: null, facts, verdicts });

const verdict = (o: Partial<VerdictRow> = {}): VerdictRow => ({
  id: 'v1',
  session_id: 's1',
  run_id: null,
  cue: 'Get on your side and frame on the hip.',
  verdict: 'sound',
  reason: null,
  note: null,
  better_cue: null,
  record_ids: [],
  record_trail: 'trusted',
  created_at: '2026-09-12T10:00:00Z',
  updated_at: '2026-09-12T10:00:00Z',
  ...o,
});

describe('cue review: record trail', () => {
  it('trusts ids written by a version that records re-analysis', () => {
    expect(recordTrail(row(), REACHED)).toBe('trusted');
  });

  it('knows nothing was selected when ids are empty', () => {
    expect(recordTrail(row({ grounding_record_ids: [] }), REACHED)).toBe(
      'none_selected',
    );
  });

  it('never reads NULL ids as "nothing was selected" (018)', () => {
    expect(recordTrail(row({ grounding_record_ids: null }), REACHED)).toBe(
      'not_recorded',
    );
  });

  it('flags records that never reached the model (019)', () => {
    expect(recordTrail(row({ pipeline_version: '1.0.0' }), V100)).toBe(
      'never_reached_model',
    );
  });

  it('marks pre-1.3.0 rows unverified, since re-analysis left no trace (021)', () => {
    expect(recordTrail(row({ pipeline_version: '1.2.0' }), REACHED)).toBe(
      'unverified',
    );
    // Empty ids are just as stale: an old re-analysis never rewrote them.
    expect(
      recordTrail(
        row({ pipeline_version: '1.2.0', grounding_record_ids: [] }),
        REACHED,
      ),
    ).toBe('unverified');
  });

  it('trusts a pre-1.3.0 stamp once the re-analysis marker is set', () => {
    // reanalyzed_at is only written by the fixed re-analysis path.
    expect(
      recordTrail(
        row({
          pipeline_version: '1.2.0',
          reanalyzed_at: '2026-09-11T00:00:00Z',
        }),
        REACHED,
      ),
    ).toBe('trusted');
  });

  it('treats an unknown version as before every boundary', () => {
    expect(recordTrail(row({ pipeline_version: null }), REACHED)).toBe(
      'unverified',
    );
    expect(recordTrail(row({ pipeline_version: 'dev' }), REACHED)).toBe(
      'unverified',
    );
  });

  it('compares versions numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.3.0')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0);
    expect(compareVersions('1.3', '1.3.0')).toBeNull();
  });
});

describe('cue review: filters', () => {
  const sessions: SessionSummary[] = [
    summary({ id: 'a', session_date: '2026-09-01T10:00:00Z', thumbs_up: true }),
    summary({
      id: 'b',
      session_date: '2026-09-05T10:00:00Z',
      thumbs_up: false,
      feedback_reason: 'Too generic',
      quality_gate_passed: false,
    }),
    summary({
      id: 'c',
      session_date: '2026-09-08T10:00:00Z',
      grounding: 'declined',
      coaching_cue: null,
      user_id: 'u2',
    }),
    summary({
      id: 'd',
      session_date: '2026-09-09T10:00:00Z',
      pipeline_version: '1.1.0',
      target_position_id: 'mount-bottom',
      raw_transcript: 'Got stuck under MOUNT',
    }),
  ];
  const ids = (filters: Partial<typeof DEFAULT_FILTERS>) =>
    filterSessions(sessions, { ...DEFAULT_FILTERS, ...filters }).map(
      (s) => s.id,
    );

  it('hides declined takes by default, newest first', () => {
    expect(ids({})).toEqual(['d', 'b', 'a']);
    expect(ids({ grounding: 'all' })).toEqual(['d', 'c', 'b', 'a']);
    expect(ids({ grounding: 'declined' })).toEqual(['c']);
  });

  it('searches transcript, Cue and key mistake case-insensitively', () => {
    expect(ids({ query: 'mount' })).toEqual(['d']);
    expect(ids({ query: 'FRAME ON THE HIP' })).toEqual(['d', 'b', 'a']);
    expect(ids({ query: 'flat on my back' })).toEqual(['d', 'b', 'a']);
  });

  it('filters athlete feedback and its reason', () => {
    expect(ids({ feedback: 'up' })).toEqual(['a']);
    expect(ids({ feedback: 'down' })).toEqual(['b']);
    expect(ids({ feedback: 'none' })).toEqual(['d']);
    expect(ids({ reason: 'Too generic' })).toEqual(['b']);
  });

  it('filters quality gate, position, athlete and record trail', () => {
    expect(ids({ gate: 'fell_back' })).toEqual(['b']);
    expect(ids({ position: 'mount-bottom' })).toEqual(['d']);
    expect(ids({ athlete: 'u2', grounding: 'all' })).toEqual(['c']);
    expect(ids({ trail: 'untrustworthy' })).toEqual(['d']);
    expect(ids({ trail: 'trustworthy' })).toEqual(['b', 'a']);
  });

  it('treats the date range as inclusive calendar days', () => {
    expect(ids({ from: '2026-09-05', to: '2026-09-09' })).toEqual(['d', 'b']);
  });
});

describe('cue review: filtering by the operator verdict (#132)', () => {
  const CUE = 'Get on your side and frame on the hip.';
  const sessions: SessionSummary[] = [
    // Judged wrong, about the Cue it holds.
    summary({ id: 'w', session_date: '2026-09-01T10:00:00Z' }, REACHED, [
      verdict({ session_id: 'w', verdict: 'wrong', reason: 'off_target' }),
    ]),
    // Judged sound, and the athlete disagreed: two separate facts.
    summary(
      { id: 's', session_date: '2026-09-02T10:00:00Z', thumbs_up: false },
      REACHED,
      [verdict({ session_id: 's', verdict: 'sound' })],
    ),
    // Re-analysed since: the only verdict judged text it no longer holds.
    summary(
      {
        id: 'e',
        session_date: '2026-09-03T10:00:00Z',
        coaching_cue: 'Frame first, then shrimp.',
      },
      REACHED,
      [
        verdict({
          session_id: 'e',
          cue: CUE,
          verdict: 'wrong',
          reason: 'extraction_wrong',
        }),
      ],
    ),
    // Never judged.
    summary({ id: 'u', session_date: '2026-09-04T10:00:00Z' }),
    // No Cue at all: nothing to judge, so never "unjudged" either.
    summary({
      id: 'n',
      session_date: '2026-09-05T10:00:00Z',
      coaching_cue: null,
      grounding: 'declined',
    }),
  ];
  const ids = (filters: Partial<typeof DEFAULT_FILTERS>) =>
    filterSessions(sessions, {
      ...DEFAULT_FILTERS,
      grounding: 'all',
      ...filters,
    }).map((s) => s.id);

  it('reads a verdict about an earlier Cue as no verdict on this one', () => {
    const earlier = sessions.find((s) => s.id === 'e');
    expect(earlier).toMatchObject({ verdict: null, earlierVerdicts: 1 });
  });

  it('keeps the athlete’s thumbs beside the verdict, never merged into it', () => {
    expect(sessions.find((s) => s.id === 's')).toMatchObject({
      verdict: 'sound',
      thumbsUp: false,
    });
  });

  it('finds unjudged Cues, including one whose verdict is about an earlier Cue', () => {
    expect(ids({ verdict: 'unjudged' })).toEqual(['u', 'e']);
  });

  it('filters judged Cues, each verdict, and its reason', () => {
    expect(ids({ verdict: 'judged' })).toEqual(['s', 'w']);
    expect(ids({ verdict: 'wrong' })).toEqual(['w']);
    expect(ids({ verdict: 'sound' })).toEqual(['s']);
    expect(ids({ verdict: 'shallow' })).toEqual([]);
    expect(ids({ verdictReason: 'off_target' })).toEqual(['w']);
    // The reason belongs to the current Cue's verdict, so the earlier one is out.
    expect(ids({ verdictReason: 'extraction_wrong' })).toEqual([]);
  });

  it('finds Sessions with a verdict about an earlier Cue', () => {
    expect(ids({ verdict: 'earlier' })).toEqual(['e']);
  });

  it('shows everything by default', () => {
    expect(ids({})).toEqual(['n', 'u', 'e', 's', 'w']);
  });
});

describe('cue review: detail', () => {
  const record = (id: string, o: Partial<RecordRow> = {}): RecordRow => ({
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
    ...o,
  });

  it('keeps rank order, tallies votes, and names records that vanished', () => {
    const out = injectedRecords(
      ['r2', 'gone', 'r1'],
      [record('r1', { contested: true }), record('r2')],
      [
        { record_id: 'r1', verdict: 'certify' },
        { record_id: 'r1', verdict: 'reject' },
        { record_id: 'r2', verdict: 'certify' },
      ],
    );
    expect(out.map((e) => [e.rank, e.id, e.status])).toEqual([
      [1, 'r2', 'unsettled'],
      [2, 'gone', null],
      [3, 'r1', 'contested'],
    ]);
    expect(out[2]).toMatchObject({ certifyVotes: 1, rejectVotes: 1 });
    expect(out[1]?.record).toBeNull();
  });

  it('reports a capped candidate fetch as a lower bound (020)', () => {
    expect(
      groundingFunnel(row({ grounding_candidates: 200 }), V100).candidates,
    ).toEqual({ value: 200, atLeast: true });
    expect(groundingFunnel(row(), REACHED).candidates.atLeast).toBe(false);
  });

  it('keeps an unrecorded gate count unknown, not zero (022)', () => {
    const { grounding_gate_passed: _, ...before022 } = row();
    expect(groundingFunnel(before022 as SessionRow, REACHED).gatePassed).toBe(
      null,
    );
  });
});

describe('cue review: request gates', () => {
  const basic = (credentials: string) =>
    `Basic ${Buffer.from(credentials).toString('base64')}`;

  it('accepts only the exact credentials', () => {
    expect(isAuthorized(basic('me:secret'), 'me', 'secret')).toBe(true);
    expect(isAuthorized(basic('me:wrong'), 'me', 'secret')).toBe(false);
    expect(isAuthorized(basic('you:secret'), 'me', 'secret')).toBe(false);
    expect(isAuthorized(basic('me:secret:extra'), 'me', 'secret')).toBe(false);
    expect(isAuthorized(undefined, 'me', 'secret')).toBe(false);
    expect(isAuthorized('Bearer x', 'me', 'secret')).toBe(false);
  });

  it('allows a colon inside the password', () => {
    expect(isAuthorized(basic('me:a:b'), 'me', 'a:b')).toBe(true);
  });

  it('refuses non-loopback Host headers', () => {
    expect(isLoopbackHost('127.0.0.1:4321', 4321)).toBe(true);
    expect(isLoopbackHost('localhost:4321', 4321)).toBe(true);
    expect(isLoopbackHost('evil.example:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:9999', 4321)).toBe(false);
    expect(isLoopbackHost(undefined, 4321)).toBe(false);
  });

  it('reads everywhere and writes only on the verdict route (#132)', () => {
    expect(allowedMethods(WRITE_PATH)).toEqual(['POST']);
    expect(allowedMethods('/api/sessions')).toEqual(['GET']);
    expect(allowedMethods('/api/verdict/')).toEqual(['GET']);
  });

  describe('writes', () => {
    const page = {
      host: '127.0.0.1:4321',
      contentType: 'application/json',
      origin: 'http://127.0.0.1:4321',
      secFetchSite: 'same-origin',
    };

    it('lets the page itself write JSON', () => {
      expect(writeRefusal(page)).toBeNull();
      expect(
        writeRefusal({
          ...page,
          contentType: 'application/json; charset=utf-8',
        }),
      ).toBeNull();
      // curl and other non-browser clients send neither header.
      expect(
        writeRefusal({ ...page, origin: undefined, secFetchSite: undefined }),
      ).toBeNull();
    });

    it('refuses anything but JSON, which a form cannot send', () => {
      for (const contentType of [
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
        'text/plain',
        undefined,
      ]) {
        expect(writeRefusal({ ...page, contentType })?.status).toBe(415);
      }
    });

    it('refuses another origin, an opaque one, and a cross-site fetch', () => {
      for (const origin of [
        'http://evil.example',
        'http://localhost:4321',
        'https://127.0.0.1:4321',
        'null',
      ]) {
        expect(writeRefusal({ ...page, origin })?.status).toBe(403);
      }
      expect(
        writeRefusal({ ...page, secFetchSite: 'cross-site' })?.status,
      ).toBe(403);
      expect(writeRefusal({ ...page, secFetchSite: 'same-site' })?.status).toBe(
        403,
      );
    });
  });
});
