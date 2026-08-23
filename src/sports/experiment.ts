/**
 * The grounded-cue experiment (wayfinder #30).
 *
 * Dependency-free with relative imports so the Supabase edge function imports
 * the same code as the client reference implementation — an experiment whose
 * two halves disagreed about who is in which arm would be worthless.
 */

/** Which arm a session landed in, and why. */
export type GroundingOutcome =
  | 'grounded'
  | 'withheld'
  | 'no_position'
  | 'no_records'
  | 'declined';

export interface GroundingAssignment {
  outcome: GroundingOutcome;
  /** Records to actually inject. Empty in every arm except `grounded`. */
  inject: number;
  /** Records that matched the mistake and COULD have been injected. */
  available: number;
}

/** Share of eligible sessions that receive grounding. */
export const GROUNDING_ROLLOUT = 0.5;

/**
 * Stable 32-bit hash. Small and deterministic — the point is not cryptographic
 * quality, it is that the same session always lands in the same arm.
 */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Assign a session to an arm.
 *
 * Assignment happens only when records are actually available. A session with
 * nothing to inject is not in the experiment at all — both arms would produce
 * an identical cue, so including it would dilute the comparison with
 * non-events. That makes the control arm mean "had records, withheld them",
 * which is the counterfactual the comparison needs.
 *
 * Deterministic on the session key, so a retry after a timeout cannot flip a
 * session between arms and quietly corrupt the result.
 */
export function assignGrounding(
  sessionKey: string,
  availableRecords: number,
  opts: { hasPosition: boolean; rollout?: number } = { hasPosition: true },
): GroundingAssignment {
  if (!opts.hasPosition) {
    return { outcome: 'no_position', inject: 0, available: 0 };
  }
  if (availableRecords === 0) {
    return { outcome: 'no_records', inject: 0, available: 0 };
  }
  const rollout = opts.rollout ?? GROUNDING_ROLLOUT;
  // A stable, uniformly-distributed value in [0,1) for this session.
  const bucket = hash(`grounding:${sessionKey}`) / 0x100000000;
  return bucket < rollout
    ? {
        outcome: 'grounded',
        inject: availableRecords,
        available: availableRecords,
      }
    : { outcome: 'withheld', inject: 0, available: availableRecords };
}
