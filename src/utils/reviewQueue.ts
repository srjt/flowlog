/**
 * Ordering the certification queue (#77).
 *
 * Pure, so the rule that decides where scarce black-belt attention goes is
 * testable without a database.
 */

export interface ReviewableRecord {
  id: string;
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string | null;
  certified: boolean;
  contested: boolean;
  rejected: boolean;
}

export interface VoteTally {
  /** Reviewers who called it sound. */
  certify: number;
  /** Reviewers who called it wrong. */
  reject: number;
}

/**
 * How many agreeing votes settle a record. Mirrors migration 014's trigger —
 * if one changes the other must too, or the queue will keep offering cards
 * that are already decided.
 */
export const VOTES_TO_SETTLE = 2;

/**
 * Order the queue.
 *
 * **Records one vote short of settling come first.** A record with a single
 * vote is one review away from becoming certified or rejected; an untouched
 * one needs two. Finishing what someone started produces roughly twice the
 * settled records per unit of attention, and attention is the scarce resource
 * this whole exercise is rationing.
 *
 * Then unreviewed records, grouped so a reviewer stays in one position rather
 * than being thrown between closed guard and back mount card by card —
 * judging is faster when the context holds still.
 *
 * NOT weighted by live session demand, deliberately. That data does not exist
 * yet: #58's grounding log has zero rows because no session has been recorded
 * since it shipped. Ordering by a demand signal we do not have would be
 * guesswork dressed as prioritisation. Revisit once the backlog populates.
 */
export function orderQueue(
  records: ReviewableRecord[],
  tallies: Map<string, VoteTally>,
  myVotes: Set<string>,
  positionPriority: string[] = [],
): ReviewableRecord[] {
  const rank = new Map(positionPriority.map((p, i) => [p, i]));
  const priorityOf = (p: string) => rank.get(p) ?? Number.MAX_SAFE_INTEGER;

  return records
    .filter((r) => {
      // Already voted on by this reviewer: their opinion is recorded and a
      // second look adds nothing.
      if (myVotes.has(r.id)) return false;
      // Already settled by others. Contested stays IN the queue — a third
      // opinion is exactly what a disagreement needs.
      if (r.certified || r.rejected) return false;
      return true;
    })
    .map((r) => {
      const t = tallies.get(r.id) ?? { certify: 0, reject: 0 };
      const votes = t.certify + t.reject;
      return { r, votes, nearlyDone: votes === VOTES_TO_SETTLE - 1 };
    })
    .sort(
      (a, b) =>
        Number(b.nearlyDone) - Number(a.nearlyDone) ||
        priorityOf(a.r.position) - priorityOf(b.r.position) ||
        a.r.position.localeCompare(b.r.position) ||
        a.r.id.localeCompare(b.r.id),
    )
    .map((e) => e.r);
}

export interface QueueProgress {
  settled: number;
  contested: number;
  remaining: number;
  total: number;
}

/** What the reviewer sees at the top: is this queue finite and shrinking? */
export function queueProgress(
  records: ReviewableRecord[],
  queue: ReviewableRecord[],
): QueueProgress {
  return {
    settled: records.filter((r) => r.certified || r.rejected).length,
    contested: records.filter((r) => r.contested).length,
    remaining: queue.length,
    total: records.length,
  };
}
