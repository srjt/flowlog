/**
 * Turning per-claim checks into a verdict on the cue (issue #61), and scoring
 * the judge against the frozen human labels.
 *
 * Pure on purpose — every decision here is testable without a model call.
 */

import type { ClaimCheck, CueJudgement } from './types.ts';

/**
 * Is the cue defective, given what each of its claims turned out to be?
 *
 * Two ways to fail, matching the two failure modes visible in the labelled
 * set:
 *
 * 1. **A contradicted claim.** One mechanically wrong instruction spoils the
 *    cue regardless of what else it says — the athlete cannot tell which half
 *    to trust, and a confident wrong detail is the whole problem.
 * 2. **Nothing on target.** Every claim can be individually true and the cue
 *    still fail, because it answers a question the athlete did not ask. Half
 *    the defects in the frozen set are this: sound jiu-jitsu, aimed elsewhere.
 *
 * `unsupported` never contributes. The corpus is one instructional series;
 * absence of a mechanic from it is not evidence against the mechanic.
 */
export function judgeFromClaims(checks: ClaimCheck[]): {
  defective: boolean;
  rationale: string;
} {
  if (checks.length === 0) {
    // Nothing extractable from the cue is itself a defect — a cue with no
    // checkable instruction in it has not told the athlete to do anything.
    return { defective: true, rationale: 'no checkable claim in the cue' };
  }
  const contradicted = checks.filter((c) => c.status === 'contradicted');
  if (contradicted.length > 0) {
    return {
      defective: true,
      rationale: `${contradicted.length} contradicted claim(s): ${contradicted[0]?.reason ?? ''}`,
    };
  }
  const onTarget = checks.filter((c) => c.status === 'supported');
  if (onTarget.length === 0) {
    const offTarget = checks.filter((c) => c.status === 'off_target');
    if (offTarget.length > 0) {
      return {
        defective: true,
        rationale: `nothing addresses the mistake: ${offTarget[0]?.reason ?? ''}`,
      };
    }
    // Everything came back unsupported. That is a coverage gap, not a defect;
    // condemning here would punish cues for naming positions the corpus never
    // covered, which is most of them.
    return { defective: false, rationale: 'no claim supported or refuted' };
  }
  return {
    defective: false,
    rationale: `${onTarget.length} claim(s) on target`,
  };
}

// ── Scoring against the frozen human labels ────────────────────────────────

/** The practitioner's label. `skip` rows are excluded upstream. */
export type HumanVerdict = 'wrong' | 'sound' | 'shallow' | 'skip';

export interface ScoreInput {
  sessionId: string;
  human: HumanVerdict;
  defective: boolean;
}

export interface Score {
  /** Defects the judge caught, of the `wrong` cues. */
  caught: number;
  defects: number;
  /** Sound cues the judge wrongly condemned. */
  falsePositives: number;
  sound: number;
  /** Reported, never scored — see below. */
  shallowFlagged: number;
  shallow: number;
  passed: boolean;
  failures: string[];
}

/**
 * The pass bar, from #35's design and #36's labelling run.
 *
 * **Overall agreement is deliberately not the metric.** The set is 47% wrong,
 * so a judge that condemned everything would post 47% "accuracy" while being
 * completely blind. Recall is what the judge is for — it has to be able to see
 * a 47%→25% improvement, and one missing half the defects cannot. The
 * false-positive ceiling is what kills the degenerate flag-everything judge.
 */
export const PASS_MIN_CAUGHT = 12;
export const PASS_MAX_FALSE_POSITIVES = 2;

/**
 * **Shallow cues are counted but never scored.** The sound/shallow line is
 * genuinely subjective — it is the difference between a correct cue and a
 * correct cue that says something obvious — and demanding the judge reproduce
 * it would fail a judge that is good at the thing that matters. It is reported
 * so a judge that flags every single shallow cue is visible as suspicious,
 * not so it can be graded.
 */
export function scoreJudge(
  rows: ScoreInput[],
  minCaught: number = PASS_MIN_CAUGHT,
  maxFalsePositives: number = PASS_MAX_FALSE_POSITIVES,
): Score {
  const of = (v: HumanVerdict) => rows.filter((r) => r.human === v);
  const wrong = of('wrong');
  const sound = of('sound');
  const shallow = of('shallow');

  const caught = wrong.filter((r) => r.defective).length;
  const falsePositives = sound.filter((r) => r.defective).length;

  const failures: string[] = [];
  if (caught < minCaught) {
    failures.push(
      `recall: caught ${caught}/${wrong.length} defects, needs at least ${minCaught}`,
    );
  }
  if (falsePositives > maxFalsePositives) {
    failures.push(
      `false positives: condemned ${falsePositives}/${sound.length} sound cues, ceiling is ${maxFalsePositives}`,
    );
  }
  return {
    caught,
    defects: wrong.length,
    falsePositives,
    sound: sound.length,
    shallowFlagged: shallow.filter((r) => r.defective).length,
    shallow: shallow.length,
    passed: failures.length === 0,
    failures,
  };
}

export function formatScore(score: Score, judgements: CueJudgement[]): string {
  const modes = judgements.reduce<Record<string, number>>((acc, j) => {
    acc[j.mode] = (acc[j.mode] ?? 0) + 1;
    return acc;
  }, {});
  return [
    '',
    '  CUE JUDGE — validation against the frozen human verdicts',
    '  ' + '─'.repeat(62),
    `  defects caught      ${score.caught}/${score.defects}   (needs >= ${PASS_MIN_CAUGHT})`,
    `  false positives     ${score.falsePositives}/${score.sound}   (ceiling ${PASS_MAX_FALSE_POSITIVES})`,
    `  shallow flagged     ${score.shallowFlagged}/${score.shallow}   (reported, not scored)`,
    '',
    `  judged grounded     ${modes.grounded ?? 0}`,
    `  judged ungrounded   ${modes.ungrounded ?? 0}`,
    '  ' + '─'.repeat(62),
    score.passed
      ? '  RESULT: PASS'
      : `  RESULT: FAIL\n${score.failures.map((f) => `    - ${f}`).join('\n')}`,
    '',
  ].join('\n');
}
