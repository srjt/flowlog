/**
 * Operator verdicts on Cues (#132): the shaping, the "earlier Cue" rule,
 * coverage and the per-record signal, all in the review tool's pure model
 * module, plus migration 026 asserted at the source the way 023's is.
 *
 * What is asserted is the recorded verdict and what the list and the record
 * signal then say about it, never how the page renders a control.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CUE_VERDICTS,
  NOTE_MAX_LENGTH,
  RECORD_TRAILS,
  WRONG_REASONS,
  isAboutCurrentCue,
  parseVerdictRequest,
  recordsBehindWrongCues,
  reviewCoverage,
  toSummary,
  verdictInsert,
  verdictsFor,
  withVerdicts,
  type SessionRow,
  type SetVerdictRequest,
  type VerdictRow,
} from '../../scripts/admin/review';

const SQL = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '026_cue_verdicts.sql'),
  'utf8',
);

const SID = '11111111-1111-4111-8111-111111111111';
const CUE = 'Get on your side and frame on the hip.';

const row = (o: Partial<SessionRow> = {}): SessionRow => ({
  id: SID,
  user_id: 'u1',
  session_date: '2026-09-10T18:00:00Z',
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
  thumbs_up: null,
  feedback_reason: null,
  feedback_note: null,
  pipeline_version: '1.3.0',
  gi: 'gi',
  grounding: 'grounded',
  grounding_candidates: 40,
  grounding_gate_passed: 9,
  grounding_available: 2,
  grounding_records: 2,
  grounding_record_ids: ['r1', 'r2'],
  reanalyzed_at: null,
  ...o,
});

let n = 0;
const verdict = (o: Partial<VerdictRow> = {}): VerdictRow => ({
  id: `v${++n}`,
  session_id: SID,
  run_id: null,
  cue: CUE,
  verdict: 'sound',
  reason: null,
  note: null,
  better_cue: null,
  record_ids: [],
  record_trail: 'none_selected',
  created_at: '2026-09-12T10:00:00Z',
  updated_at: '2026-09-12T10:00:00Z',
  ...o,
});

const wrong = (
  reason: VerdictRow['reason'],
  record_ids: string[],
  o: Partial<VerdictRow> = {},
) =>
  verdict({
    verdict: 'wrong',
    reason,
    record_ids,
    record_trail: record_ids.length > 0 ? 'trusted' : 'none_selected',
    ...o,
  });

// ── Validation ──────────────────────────────────────────────────────────────

describe('a verdict request', () => {
  const body = (o: Record<string, unknown> = {}) => ({
    sessionId: SID,
    cue: CUE,
    verdict: 'wrong',
    reason: 'records_wrong',
    note: null,
    ...o,
  });

  it('accepts each verdict, with a reason exactly when it is wrong', () => {
    expect(parseVerdictRequest(body())).toEqual({
      ok: true,
      value: {
        sessionId: SID,
        cue: CUE,
        verdict: 'wrong',
        reason: 'records_wrong',
        note: null,
        betterCue: null,
      },
    });
    for (const v of ['sound', 'shallow']) {
      expect(parseVerdictRequest(body({ verdict: v, reason: null }))).toEqual({
        ok: true,
        value: {
          sessionId: SID,
          cue: CUE,
          verdict: v,
          reason: null,
          note: null,
          betterCue: null,
        },
      });
    }
    // An absent reason is the same as null.
    expect(
      parseVerdictRequest({ sessionId: SID, cue: CUE, verdict: 'sound' }).ok,
    ).toBe(true);
  });

  it('requires a reason when wrong, and refuses one otherwise', () => {
    expect(parseVerdictRequest(body({ reason: null })).ok).toBe(false);
    expect(parseVerdictRequest(body({ reason: undefined })).ok).toBe(false);
    expect(
      parseVerdictRequest(body({ verdict: 'sound', reason: 'off_target' })).ok,
    ).toBe(false);
  });

  it('refuses values outside the vocabulary', () => {
    for (const v of ['fine', 'Sound', '', 'certify', 1, true]) {
      expect(parseVerdictRequest(body({ verdict: v, reason: null })).ok).toBe(
        false,
      );
    }
    for (const r of ['misheard', 'Records wrong', '', 1]) {
      expect(parseVerdictRequest(body({ reason: r })).ok).toBe(false);
    }
  });

  it('accepts every reason in the vocabulary', () => {
    for (const reason of WRONG_REASONS) {
      expect(parseVerdictRequest(body({ reason })).ok).toBe(true);
    }
  });

  it('never defaults a missing verdict to anything: null must be said', () => {
    const { verdict: _, ...noVerdict } = body();
    expect(parseVerdictRequest(noVerdict).ok).toBe(false);
  });

  it('clears with verdict: null, and only on its own', () => {
    expect(
      parseVerdictRequest({ sessionId: SID, cue: CUE, verdict: null }),
    ).toEqual({ ok: true, value: { sessionId: SID, cue: CUE, verdict: null } });
    expect(parseVerdictRequest(body({ verdict: null })).ok).toBe(false);
    expect(
      parseVerdictRequest(body({ verdict: null, reason: null, note: 'x' })).ok,
    ).toBe(false);
  });

  it('trims the note, reads blank as none, and bounds it', () => {
    const note = (value: unknown) => {
      const out = parseVerdictRequest(body({ note: value }));
      return out.ok && out.value.verdict !== null ? out.value.note : 'refused';
    };
    expect(note('  framed late  ')).toBe('framed late');
    expect(note('   ')).toBeNull();
    expect(note(undefined)).toBeNull();
    expect(note('x'.repeat(NOTE_MAX_LENGTH))).toHaveLength(NOTE_MAX_LENGTH);
    expect(note('x'.repeat(NOTE_MAX_LENGTH + 1))).toBe('refused');
    expect(note(42)).toBe('refused');
  });

  it('refuses a bad session id, a blank Cue, unknown fields and non-objects', () => {
    expect(parseVerdictRequest(body({ sessionId: 's1' })).ok).toBe(false);
    expect(parseVerdictRequest(body({ sessionId: `${SID})` })).ok).toBe(false);
    expect(parseVerdictRequest(body({ cue: '  ' })).ok).toBe(false);
    expect(parseVerdictRequest(body({ cue: null })).ok).toBe(false);
    expect(parseVerdictRequest(body({ record_ids: ['r9'] })).ok).toBe(false);
    for (const bad of [null, [], 'wrong', 3]) {
      expect(parseVerdictRequest(bad).ok).toBe(false);
    }
  });
});

// ── Shaping against the stored Session ──────────────────────────────────────

describe('shaping a verdict into a row', () => {
  const req: SetVerdictRequest = {
    sessionId: SID,
    cue: CUE,
    verdict: 'wrong',
    reason: 'records_misapplied',
    note: 'right records, wrong half of the position',
    betterCue: null,
  };

  it('snapshots the Cue, the run and the trusted records behind it', () => {
    expect(
      verdictInsert(req, row(), { trail: 'trusted', runId: 'run1' }),
    ).toEqual({
      ok: true,
      value: {
        session_id: SID,
        run_id: 'run1',
        cue: CUE,
        verdict: 'wrong',
        reason: 'records_misapplied',
        note: 'right records, wrong half of the position',
        better_cue: null,
        record_ids: ['r1', 'r2'],
        record_trail: 'trusted',
      },
    });
  });

  it('keeps a Session from before the prompt log, with no run', () => {
    const out = verdictInsert(req, row(), { trail: 'trusted', runId: null });
    expect(out.ok && out.value.run_id).toBeNull();
  });

  it.each(['not_recorded', 'never_reached_model', 'unverified'] as const)(
    'copies no ids when the trail is %s, and says so',
    (trail) => {
      // These ids may belong to an earlier Cue or never have reached the
      // model; counting them would charge this Cue to records not behind it.
      const out = verdictInsert(req, row(), { trail, runId: null });
      expect(out.ok && out.value).toMatchObject({
        record_ids: [],
        record_trail: trail,
      });
    },
  );

  it('refuses a Cue the Session no longer holds', () => {
    const out = verdictInsert(
      req,
      row({ coaching_cue: 'Frame, then shrimp.' }),
      {
        trail: 'trusted',
        runId: null,
      },
    );
    expect(out.ok).toBe(false);
    expect(
      verdictInsert(req, row({ coaching_cue: null }), {
        trail: 'trusted',
        runId: null,
      }).ok,
    ).toBe(false);
  });

  it('never trims or normalises the Cue: the snapshot is exact', () => {
    const spaced = `${CUE} `;
    expect(
      verdictInsert({ ...req, cue: spaced }, row(), {
        trail: 'trusted',
        runId: null,
      }).ok,
    ).toBe(false);
  });
});

// ── About the current Cue, or an earlier one ────────────────────────────────

describe('a verdict about an earlier Cue', () => {
  it('judges the current Cue only while the text is exactly the same', () => {
    expect(isAboutCurrentCue({ cue: CUE }, CUE)).toBe(true);
    expect(isAboutCurrentCue({ cue: CUE }, `${CUE} Then shrimp.`)).toBe(false);
    // A Re-analyze that declined leaves no Cue: nothing judges it.
    expect(isAboutCurrentCue({ cue: CUE }, null)).toBe(false);
  });

  it('is split out from the current verdict, newest first', () => {
    const current = verdict({ cue: 'Frame, then shrimp.', verdict: 'sound' });
    const older = verdict({ updated_at: '2026-09-01T00:00:00Z' });
    const newer = verdict({
      cue: 'Bridge first.',
      updated_at: '2026-09-05T00:00:00Z',
    });
    expect(verdictsFor('Frame, then shrimp.', [older, current, newer])).toEqual(
      {
        current,
        earlier: [newer, older],
      },
    );
  });

  it('never shows as the verdict on a Re-analyzed Session’s new Cue', () => {
    const summary = toSummary(row({ coaching_cue: 'Frame, then shrimp.' }), {
      athlete: 'Ana',
      positionLabel: null,
      facts: { reachedModel: true, candidatesExact: true },
      verdicts: [wrong('off_target', ['r1'])],
    });
    expect(summary).toMatchObject({
      verdict: null,
      verdictReason: null,
      earlierVerdicts: 1,
    });
  });

  it('is recomputed from the Session’s verdicts after a write', () => {
    const before = toSummary(row(), {
      athlete: 'Ana',
      positionLabel: null,
      facts: { reachedModel: true, candidatesExact: true },
      verdicts: [],
    });
    expect(before.verdict).toBeNull();
    expect(withVerdicts(before, [wrong('model_wrong', [])])).toMatchObject({
      verdict: 'wrong',
      verdictReason: 'model_wrong',
    });
  });
});

// ── Coverage ────────────────────────────────────────────────────────────────

describe('review coverage', () => {
  const summary = (
    id: string,
    o: Partial<SessionRow>,
    verdicts: VerdictRow[] = [],
  ) =>
    toSummary(row({ id, ...o }), {
      athlete: 'Ana',
      positionLabel: null,
      facts: { reachedModel: true, candidatesExact: true },
      verdicts,
    });

  it('counts judged Cues against the Cues there are, and nothing by default', () => {
    expect(
      reviewCoverage([
        summary('a', {}, [verdict({ session_id: 'a', verdict: 'sound' })]),
        summary('b', {}, [wrong('records_wrong', ['r1'], { session_id: 'b' })]),
        summary('c', {}, [verdict({ session_id: 'c', verdict: 'shallow' })]),
        summary('d', {}),
        summary('e', {}),
        // No Cue: not something that could have been judged.
        summary('f', { coaching_cue: null, grounding: 'declined' }),
        // Re-analysed: its verdict is about an earlier Cue, so it is unjudged.
        summary('g', { coaching_cue: 'Frame, then shrimp.' }, [
          verdict({ session_id: 'g' }),
        ]),
      ]),
    ).toEqual({
      cues: 6,
      judged: 3,
      unjudged: 3,
      sound: 1,
      shallow: 1,
      wrong: 1,
      earlier: 1,
    });
  });

  it('is all zeros over nothing', () => {
    expect(reviewCoverage([])).toMatchObject({ cues: 0, judged: 0 });
  });
});

// ── Records behind wrong Cues ───────────────────────────────────────────────

describe('records behind wrong Cues', () => {
  it('counts wrong verdicts per record, by reason, worst first', () => {
    const signal = recordsBehindWrongCues([
      wrong('off_target', ['r1', 'r2'], { session_id: 's1' }),
      wrong('off_target', ['r1'], { session_id: 's2' }),
      wrong('records_wrong', ['r3', 'r2'], { session_id: 's3' }),
      verdict({
        session_id: 's4',
        record_ids: ['r1'],
        record_trail: 'trusted',
      }),
    ]);
    expect(signal.records.map((r) => r.recordId)).toEqual(['r2', 'r3', 'r1']);
    expect(signal.records[0]).toMatchObject({
      recordId: 'r2',
      wrong: 2,
      judged: 2,
      byReason: { off_target: 1, records_wrong: 1, model_wrong: 0 },
    });
    // r1 sat behind a sound Cue too: that is in the denominator, not the count.
    expect(signal.records[2]).toMatchObject({ wrong: 2, judged: 3 });
  });

  it('ranks a record the operator blamed above one merely present more often', () => {
    const signal = recordsBehindWrongCues([
      wrong('transcript_misheard', ['busy']),
      wrong('extraction_wrong', ['busy']),
      wrong('off_target', ['busy']),
      wrong('records_wrong', ['blamed']),
    ]);
    expect(signal.records.map((r) => r.recordId)).toEqual(['blamed', 'busy']);
  });

  it('breaks a tie in wrong verdicts by the larger share', () => {
    const signal = recordsBehindWrongCues([
      wrong('off_target', ['often', 'rarely']),
      verdict({ record_ids: ['often'], record_trail: 'trusted' }),
      verdict({ record_ids: ['often'], record_trail: 'trusted' }),
    ]);
    expect(signal.records.map((r) => [r.recordId, r.wrong, r.judged])).toEqual([
      ['rarely', 1, 1],
      ['often', 1, 3],
    ]);
  });

  it('leaves out records behind no wrong Cue', () => {
    expect(
      recordsBehindWrongCues([
        verdict({ record_ids: ['r1'], record_trail: 'trusted' }),
        verdict({
          verdict: 'shallow',
          record_ids: ['r2'],
          record_trail: 'trusted',
        }),
      ]).records,
    ).toEqual([]);
  });

  it('keeps counting the records behind an earlier Cue, from its own snapshot', () => {
    // The Session has since been re-analysed and grounded in other records;
    // the verdict still names the records that were behind what it judged.
    const signal = recordsBehindWrongCues([
      wrong('records_wrong', ['old'], { cue: 'The Cue before a Re-analyze.' }),
    ]);
    expect(signal.records.map((r) => r.recordId)).toEqual(['old']);
  });

  it('lists each Session once, most recently judged first', () => {
    const signal = recordsBehindWrongCues([
      wrong('off_target', ['r1'], {
        session_id: 'early',
        updated_at: '2026-09-01T00:00:00Z',
      }),
      wrong('off_target', ['r1'], {
        session_id: 'late',
        updated_at: '2026-09-09T00:00:00Z',
      }),
      wrong('records_wrong', ['r1'], {
        session_id: 'late',
        cue: 'An earlier Cue of the same Session.',
        updated_at: '2026-09-05T00:00:00Z',
      }),
    ]);
    expect(signal.records[0]).toMatchObject({
      wrong: 3,
      sessionIds: ['late', 'early'],
    });
  });

  it('says how many wrong verdicts could be traced to records at all', () => {
    const signal = recordsBehindWrongCues([
      wrong('records_wrong', ['r1']),
      wrong('model_wrong', []),
      wrong('records_wrong', [], { record_trail: 'unverified' }),
      wrong('off_target', [], { record_trail: 'not_recorded' }),
      verdict({ verdict: 'sound' }),
    ]);
    expect(signal.wrong).toEqual({
      total: 4,
      traced: 1,
      noRecords: 1,
      untraced: 2,
    });
    expect(signal.records.map((r) => r.recordId)).toEqual(['r1']);
  });
});

// ── Migration 026 ───────────────────────────────────────────────────────────

describe('migration 026 keeps verdicts server-side and about a Cue', () => {
  it('revokes client grants rather than relying on no policy (023)', () => {
    expect(SQL).toMatch(
      /alter table public\.cue_verdicts enable row level security;/,
    );
    expect(SQL).toMatch(
      /revoke all on public\.cue_verdicts from anon, authenticated;/,
    );
    expect(SQL).not.toMatch(/create policy/i);
    expect(SQL).not.toMatch(/^\s*grant\s/im);
  });

  it('deletes verdicts with their Session', () => {
    expect(SQL).toMatch(
      /session_id uuid not null\s+references public\.sessions\(id\) on delete cascade/,
    );
  });

  it('snapshots the exact Cue judged, and keys the identity on it', () => {
    expect(SQL).toMatch(/\n\s+cue text not null,/);
    expect(SQL).toMatch(
      /cue_md5 text generated always as \(md5\(cue\)\) stored/,
    );
    expect(SQL).toMatch(
      /constraint cue_verdicts_one_per_cue unique \(session_id, cue_md5\)/,
    );
  });

  it('keeps run_id nullable, for Sessions from before the prompt log', () => {
    expect(SQL).toMatch(/\n\s+run_id uuid,/);
  });

  it('constrains the verdict to exactly the module’s vocabulary', () => {
    const listed = SQL.match(/check \(verdict in \(([^)]*)\)\)/)?.[1];
    expect(listed?.match(/'(\w+)'/g)?.map((s) => s.slice(1, -1))).toEqual(
      CUE_VERDICTS,
    );
    expect(SQL).toMatch(/verdict text not null/);
  });

  it('constrains the reason to exactly the module’s vocabulary', () => {
    const listed = SQL.match(/check \(reason in \(([^)]*)\)\)/)?.[1];
    expect(listed?.match(/'(\w+)'/g)?.map((s) => s.slice(1, -1))).toEqual(
      WRONG_REASONS,
    );
  });

  it('requires a reason when wrong and forbids one otherwise', () => {
    expect(SQL).toMatch(
      /constraint cue_verdicts_reason_iff_wrong\s+check \(\(verdict = 'wrong'\) = \(reason is not null\)\)/,
    );
  });

  it('snapshots record ids only when the trail vouches for them', () => {
    expect(SQL).toMatch(/record_ids uuid\[\] not null default '\{\}'/);
    const listed = SQL.match(/check \(record_trail in \(([^)]*)\)\)/)?.[1];
    expect(listed?.match(/'(\w+)'/g)?.map((s) => s.slice(1, -1))).toEqual(
      RECORD_TRAILS,
    );
    expect(SQL).toMatch(
      /check \(\(record_trail = 'trusted'\) = \(cardinality\(record_ids\) > 0\)\)/,
    );
  });

  it('says in the schema what absence means and what it is never used for', () => {
    expect(SQL).toMatch(/No row means UNJUDGED/);
    expect(SQL).toMatch(/never averaged with/i);
    expect(SQL).toMatch(/An observation, not a gate/);
    expect(SQL).toMatch(/notify pgrst, 'reload schema';/);
  });

  it('touches no other table', () => {
    expect(SQL).not.toMatch(/alter table public\.(?!cue_verdicts)/);
    expect(SQL).not.toMatch(/record_feedback_signal as/);
  });
});
