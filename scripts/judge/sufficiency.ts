/**
 * The sufficiency gate (issue #61).
 *
 * Runs BEFORE the judge and decides whether there is enough evidence to judge
 * a cue *against records* at all. This is its own component on purpose: the
 * prior-art research found that thin or wrong evidence makes grounded judging
 * **worse than ungrounded**, because the judge treats an unrelated passage as
 * the standard and condemns a perfectly good cue for disagreeing with it.
 *
 * Abstaining here does not mean declining to judge. It means dropping to
 * ungrounded judging, where the model checks the mechanics on its own
 * knowledge instead of against a passage that was never about this problem.
 * That distinction matters for this corpus: of the 17 known-defective cues in
 * the frozen set, only 5 name a position that resolves to records at all, so a
 * gate that refused to judge the rest would cap recall at 5/17 before a single
 * model call.
 */

import {
  rankRecords,
  type GroundableRecord,
} from '../../src/sports/grounding.ts';

/**
 * How many relevant records the gate needs before grounded judging is worth
 * doing.
 *
 * Set to 3 rather than the injection path's higher bar. The jobs differ: the
 * coaching prompt wants enough depth to build a specific cue, while the judge
 * only needs enough to contradict a false claim. One record can refute a
 * mechanic; it just cannot do so reliably, and two agreeing records are
 * markedly better than one that might itself be a mis-mined line.
 */
export const SUFFICIENCY_MIN_RECORDS = 3;

export interface SufficiencyResult {
  sufficient: boolean;
  /** The records that survived ranking — what grounded judging would see. */
  records: GroundableRecord[];
  reason: string;
}

/**
 * Decide whether records support grounded judging of this cue.
 *
 * Relevance is measured against the KEY MISTAKE, not the cue. Ranking against
 * the cue would be circular — it would retrieve whatever the cue happens to
 * talk about and then congratulate the cue for matching it, which is exactly
 * the failure mode a judge exists to catch.
 */
export function checkSufficiency(
  records: GroundableRecord[],
  keyMistake: string,
  minRecords: number = SUFFICIENCY_MIN_RECORDS,
): SufficiencyResult {
  if (records.length === 0) {
    return {
      sufficient: false,
      records: [],
      reason: 'no records for position',
    };
  }
  if (!keyMistake.trim()) {
    // Without a mistake there is nothing to rank against, so "relevant" is
    // undefined and any selection would be arbitrary.
    return {
      sufficient: false,
      records: [],
      reason: 'no key mistake to rank against',
    };
  }
  const relevant = rankRecords(records, keyMistake);
  if (relevant.length < minRecords) {
    return {
      sufficient: false,
      records: relevant,
      reason: `only ${relevant.length} relevant record(s), need ${minRecords}`,
    };
  }
  return {
    sufficient: true,
    records: relevant,
    reason: `${relevant.length} relevant records`,
  };
}
