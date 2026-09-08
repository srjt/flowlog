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

/**
 * Share of eligible sessions that receive grounding.
 *
 * Was 0.5 while the experiment ran. Concluded at 1.0 — every eligible session
 * is now grounded.
 *
 * **The experiment did not show grounding helps.** Over its run: grounded 4 up
 * / 4 down, withheld 4 up / 2 down. The point estimate favours the CONTROL,
 * and with six and eight rated sessions neither result means anything — the
 * comparison was nowhere near powered, and at the observed rate it would have
 * taken months to become so.
 *
 * It is concluded rather than continued because the question has changed.
 * Withholding records from half of a 20-50 user cohort now costs real cue
 * quality to keep measuring something that will not resolve, and the feedback
 * those sessions produce is worth more pointed at WHICH records fail than at
 * whether records help at all.
 *
 * The cost is honest and worth stating: at 1.0 there is no control arm, so
 * "does grounding help" can no longer be answered from production data. If
 * that question matters again, set this to 0.9 rather than 0.5 — a small
 * holdout preserves the comparison at a fraction of the quality cost.
 */
export const GROUNDING_ROLLOUT = 1;

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
  opts: {
    hasPosition: boolean;
    rollout?: number;
    /**
     * The arm this session was ALREADY assigned, for re-analysis (#117).
     *
     * Re-analysis regenerates a cue for a session that has one, so its arm is
     * not a new draw — it is a fact already recorded on the row, and re-drawing
     * it could flip the session between arms and corrupt the comparison the
     * same way a retry would.
     *
     * Passed rather than re-derived because the original key CANNOT be
     * reconstructed. The insert path keys on `clientSessionId ?? user.id:
     * sessionDate`, using the REQUEST's sessionDate — but the row stores
     * `sessionDate ?? now()`. For a request that omitted it (13 of 64 rows at
     * time of writing) the stored timestamp was never in the key, so rebuilding
     * the key from the row yields a different string and a different arm.
     *
     * Only `grounded` and `withheld` are arms. `no_position`, `no_records` and
     * `declined` are ELIGIBILITY, which depends on the current extraction and
     * must be recomputed — a corrected transcript can resolve a position that
     * previously did not — so they are ignored here and fall through to a fresh
     * assignment. That split is the point: eligibility is a function of the
     * text, assignment is a property of the session.
     *
     * Typed as a plain string because it arrives from a text column, and only
     * two of its values mean anything here. Narrowing it at the boundary would
     * force every caller to assert a shape the database does not enforce.
     */
    inheritedArm?: string | null;
  } = { hasPosition: true },
): GroundingAssignment {
  if (!opts.hasPosition) {
    return { outcome: 'no_position', inject: 0, available: 0 };
  }
  if (availableRecords === 0) {
    return { outcome: 'no_records', inject: 0, available: 0 };
  }
  // Eligibility is settled above and the session is in the experiment. An arm
  // it already holds is the assignment; re-drawing would be recomputing an
  // identity.
  if (opts.inheritedArm === 'grounded') {
    return {
      outcome: 'grounded',
      inject: availableRecords,
      available: availableRecords,
    };
  }
  if (opts.inheritedArm === 'withheld') {
    return { outcome: 'withheld', inject: 0, available: availableRecords };
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
