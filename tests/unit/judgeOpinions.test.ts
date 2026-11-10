/**
 * The pure half of `scripts/judge/opine.ts` (migration 027): which live Cues
 * still need an AI second opinion, what the judge is told, and the stored row.
 * No model and no database: the I/O is in `opine.ts` and `services.ts`.
 */
import { createHash } from 'node:crypto';

import { JUDGE_VERSION } from '../../scripts/judge/judge';
import {
  estimatedCalls,
  opinionInsert,
  pendingCues,
  subjectOf,
  type LiveCue,
  type OpinionKey,
} from '../../scripts/judge/opinion';
import {
  CHECK_CLAIM_PROMPT,
  DECOMPOSE_PROMPT,
} from '../../scripts/judge/prompts';
import { SUFFICIENCY_MIN_RECORDS } from '../../scripts/judge/sufficiency';
import type { CueJudgement } from '../../scripts/judge/types';

const JUDGE = { model: 'judge-model', version: '1' };

const live = (id: string, o: Partial<LiveCue> = {}): LiveCue => ({
  id,
  coaching_cue: `Cue for ${id}.`,
  key_mistake: 'Flat on my back',
  target_position: 'Half guard (bottom)',
  target_position_id: 'half-guard-bottom',
  ...o,
});

const key = (s: LiveCue, o: Partial<OpinionKey> = {}): OpinionKey => ({
  session_id: s.id,
  cue: s.coaching_cue ?? '',
  judge_model: JUDGE.model,
  judge_version: JUDGE.version,
  ...o,
});

describe('pendingCues: what still needs an opinion from this judge', () => {
  it('skips Sessions with no Cue, and ones this judge already covers', () => {
    const a = live('a');
    const b = live('b');
    const sessions = [
      a,
      b,
      live('declined', { coaching_cue: null }),
      live('blank', { coaching_cue: '   ' }),
    ];
    expect(pendingCues(sessions, [key(a)], JUDGE)).toEqual([b]);
  });

  it('judges a Re-analyzed Cue afresh: an opinion covers exact text only', () => {
    const a = live('a');
    const before = key(a, { cue: 'The Cue before the Re-analyze.' });
    expect(pendingCues([a], [before], JUDGE)).toEqual([a]);
  });

  it('treats another model or another version as a different instrument', () => {
    const a = live('a');
    expect(
      pendingCues([a], [key(a, { judge_model: 'other-model' })], JUDGE),
    ).toEqual([a]);
    expect(pendingCues([a], [key(a, { judge_version: '0' })], JUDGE)).toEqual([
      a,
    ]);
  });

  it('keeps the order given, so a limit takes the newest first', () => {
    const sessions = [live('c'), live('b'), live('a')];
    expect(pendingCues(sessions, [], JUDGE).map((s) => s.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
});

describe('subjectOf: what the judge is told', () => {
  it('is the Cue, its target and the key mistake, as validated', () => {
    expect(subjectOf(live('a'))).toEqual({
      sessionId: 'a',
      cue: 'Cue for a.',
      target: 'Half guard (bottom)',
      keyMistake: 'Flat on my back',
    });
  });

  it('falls back to the position id, then says there is none', () => {
    expect(subjectOf(live('a', { target_position: null })).target).toBe(
      'half-guard-bottom',
    );
    expect(
      subjectOf(live('a', { target_position: ' ', target_position_id: null }))
        .target,
    ).toBe('(no target position)');
    expect(subjectOf(live('a', { key_mistake: null })).keyMistake).toBe('');
  });
});

describe('opinionInsert: the stored row', () => {
  const judgement: CueJudgement = {
    sessionId: 'a',
    mode: 'grounded',
    recordsAvailable: 4,
    claims: [{ claim: 'Frame first', status: 'supported', reason: 'r' }],
    defective: false,
    rationale: '1 claim(s) on target',
  };

  it('names the exact Cue read and the instrument that read it', () => {
    expect(opinionInsert(live('a'), judgement, JUDGE)).toEqual({
      session_id: 'a',
      cue: 'Cue for a.',
      defective: false,
      mode: 'grounded',
      records_available: 4,
      claims: judgement.claims,
      rationale: '1 claim(s) on target',
      judge_model: 'judge-model',
      judge_version: '1',
    });
  });

  it('carries nothing of the operator: the opinion stays independent', () => {
    const row = opinionInsert(live('a'), judgement, JUDGE);
    for (const field of ['verdict', 'reason', 'note', 'better_cue']) {
      expect(row).not.toHaveProperty(field);
    }
  });
});

describe('the judge as an instrument', () => {
  it('pins the prompts to JUDGE_VERSION, so a prompt edit is a new version', () => {
    // Changed a prompt or the sufficiency gate? Bump JUDGE_VERSION in
    // scripts/judge/judge.ts and record the new fingerprint here: opinions from
    // the old judge must not be pooled with the new one's.
    const fingerprint = createHash('md5')
      .update(
        `${DECOMPOSE_PROMPT}\u0000${CHECK_CLAIM_PROMPT}\u0000${SUFFICIENCY_MIN_RECORDS}`,
      )
      .digest('hex');
    expect({ version: JUDGE_VERSION, fingerprint }).toEqual({
      version: '1',
      fingerprint: '1b5462141c98428bbff89306eeb2c454',
    });
  });

  it('estimates a run before it spends anything', () => {
    expect(estimatedCalls(0)).toBe(0);
    expect(estimatedCalls(10)).toBe(40);
  });
});
