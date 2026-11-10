/**
 * The pure half of `opine.ts`: which live Cues still need an AI second
 * opinion, what the judge is told about each, and the row that stores what it
 * said (migration 027). No I/O here, so it is tested without a model or a
 * database.
 *
 * The judge is told the Cue, its target position and the key mistake: exactly
 * what it was validated on. It is never told the operator's verdict, reason,
 * note or better Cue, so its opinion stays independent of them.
 */

import type { CueJudgement, JudgeSubject } from './types.ts';

/** A Session as `opine.ts` reads it: only what the judge is given. */
export interface LiveCue {
  id: string;
  coaching_cue: string | null;
  key_mistake: string | null;
  target_position: string | null;
  target_position_id: string | null;
}

export const LIVE_CUE_COLUMNS =
  'id,coaching_cue,key_mistake,target_position,target_position_id';

/** The identity of a stored opinion, less the generated md5. */
export interface OpinionKey {
  session_id: string;
  cue: string;
  judge_model: string;
  judge_version: string;
}

/** What `opine.ts` inserts into `cue_ai_opinions`. */
export interface OpinionInsert extends OpinionKey {
  defective: boolean;
  mode: CueJudgement['mode'];
  records_available: number;
  claims: CueJudgement['claims'];
  rationale: string;
}

/**
 * Cues no opinion from this judge covers yet, in the order given. A Session
 * whose Cue was replaced by a Re-analyze needs a fresh opinion: an opinion
 * names the exact text it read, so one about the old Cue covers nothing.
 */
export function pendingCues(
  sessions: LiveCue[],
  existing: OpinionKey[],
  judge: { model: string; version: string },
): LiveCue[] {
  const covered = new Set(
    existing
      .filter(
        (o) =>
          o.judge_model === judge.model && o.judge_version === judge.version,
      )
      .map((o) => `${o.session_id}\u0000${o.cue}`),
  );
  return sessions.filter(
    (s) =>
      typeof s.coaching_cue === 'string' &&
      s.coaching_cue.trim() !== '' &&
      !covered.has(`${s.id}\u0000${s.coaching_cue}`),
  );
}

/** What the judge is asked about a live Cue. */
export function subjectOf(s: LiveCue): JudgeSubject {
  return {
    sessionId: s.id,
    cue: s.coaching_cue ?? '',
    target:
      s.target_position?.trim() ||
      s.target_position_id ||
      '(no target position)',
    keyMistake: s.key_mistake?.trim() ?? '',
  };
}

/** The stored row for a judgement on the exact Cue text the judge read. */
export function opinionInsert(
  s: LiveCue,
  j: CueJudgement,
  judge: { model: string; version: string },
): OpinionInsert {
  return {
    session_id: s.id,
    cue: s.coaching_cue ?? '',
    defective: j.defective,
    mode: j.mode,
    records_available: j.recordsAvailable,
    claims: j.claims,
    rationale: j.rationale,
    judge_model: judge.model,
    judge_version: judge.version,
  };
}

/** Rough model calls for a run: one to decompose, about three claims each. */
export const estimatedCalls = (cues: number): number => cues * 4;
