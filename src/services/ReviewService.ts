/**
 * Data access for the certification tool (#77).
 *
 * Everything here is scoped by RLS to ACTIVE reviewers (migration 014). A
 * signed-in app user who is not a reviewer sees nothing — not an error, an
 * empty set — so the UI must ask `isReviewer()` rather than infer access from
 * an empty queue.
 */

import { supabase } from '@/lib/supabase';
import type {
  PriorVote,
  ReviewableRecord,
  VoteTally,
} from '@/utils/reviewQueue';
import { logger } from '@/utils/logger';

export type Verdict = 'certify' | 'reject';

export interface ReviewerIdentity {
  id: string;
  displayName: string;
  credential: string | null;
}

/**
 * Why the bench is or is not open to you. Distinguishing these is the
 * difference between a diagnosable failure and a mystery.
 */
export type ReviewerAccess =
  | { state: 'reviewer'; identity: ReviewerIdentity }
  | { state: 'signed-out' }
  | { state: 'not-a-reviewer' }
  | { state: 'error'; message: string };

export interface ReviewQueueData {
  records: ReviewableRecord[];
  tallies: Map<string, VoteTally>;
  myVotes: Set<string>;
  /** Prior votes with their reasoning, keyed by record (#84). */
  priorVotes: Map<string, PriorVote[]>;
  /** This reviewer's own vote, so they can reread and change it (#84). */
  myVoteFor: Map<string, PriorVote>;
}

export class ReviewService {
  /**
   * Who is asking, and may they review?
   *
   * Four outcomes, not two. An earlier version collapsed everything into
   * `null`, so a signed-out visitor, a genuine non-reviewer, and a failing
   * query all rendered the same "Not a reviewer" message.
   *
   * That cost an afternoon: a recursive RLS policy was returning HTTP 500 and
   * the bench reported it as a permissions answer. A backend fault wearing the
   * costume of a policy decision is close to undiagnosable from the UI, which
   * is where it will be seen first.
   */
  async whoAmI(): Promise<ReviewerAccess> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { state: 'signed-out' };
    const { data, error } = await supabase
      .from('reviewers')
      .select('id, display_name, credential, active')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (error) {
      logger.error('reviewer lookup failed', error);
      return { state: 'error', message: error.message };
    }
    if (!data || data.active !== true) return { state: 'not-a-reviewer' };
    return {
      state: 'reviewer',
      identity: {
        id: data.id,
        displayName: data.display_name,
        credential: data.credential ?? null,
      },
    };
  }

  /**
   * Everything the queue needs, in three reads.
   *
   * Tallies are computed here rather than in SQL: the vote table is small
   * (bounded by reviewers x records reviewed) and an aggregate view would be
   * another migration to keep in step with the trigger.
   */
  async loadQueue(reviewerId: string): Promise<ReviewQueueData> {
    // Through an RPC, not the table. `coaching_records` has no grant for
    // `authenticated` (migration 009, deliberately) — a policy alone could
    // never have worked, because RLS filters rows only after the privilege
    // check. `review_queue` is SECURITY DEFINER and returns nothing to a
    // non-reviewer.
    const records: ReviewableRecord[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .rpc('review_queue')
        .order('id')
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as ReviewableRecord[];
      records.push(...page);
      if (page.length < 1000) break;
    }

    const { data: votes, error: voteError } = await supabase
      .from('record_votes')
      .select('record_id, reviewer_id, verdict, note');
    if (voteError) throw new Error(voteError.message);

    // Names come from the roster, readable by active reviewers since #84's
    // migration. Best-effort: an unattributed note is far better than no note,
    // so a roster failure must not cost the reasoning.
    const names = new Map<
      string,
      { name: string; credential: string | null }
    >();
    const { data: roster } = await supabase
      .from('reviewers')
      .select('id, display_name, credential');
    for (const r of roster ?? []) {
      names.set(r.id, {
        name: r.display_name,
        credential: r.credential ?? null,
      });
    }

    const tallies = new Map<string, VoteTally>();
    const myVotes = new Set<string>();
    const priorVotes = new Map<string, PriorVote[]>();
    const myVoteFor = new Map<string, PriorVote>();
    for (const v of votes ?? []) {
      const t = tallies.get(v.record_id) ?? { certify: 0, reject: 0 };
      if (v.verdict === 'certify') t.certify++;
      else t.reject++;
      tallies.set(v.record_id, t);

      const who = names.get(v.reviewer_id);
      const vote: PriorVote = {
        reviewerId: v.reviewer_id,
        reviewerName: who?.name ?? 'A reviewer',
        credential: who?.credential ?? null,
        verdict: v.verdict as PriorVote['verdict'],
        note: v.note ?? null,
      };

      if (v.reviewer_id === reviewerId) {
        myVotes.add(v.record_id);
        myVoteFor.set(v.record_id, vote);
      } else {
        priorVotes.set(v.record_id, [
          ...(priorVotes.get(v.record_id) ?? []),
          vote,
        ]);
      }
    }
    return { records, tallies, myVotes, priorVotes, myVoteFor };
  }

  /**
   * Record a verdict. Upsert, so changing your mind replaces your vote rather
   * than stacking a second opinion from the same person.
   */
  async vote(
    recordId: string,
    reviewerId: string,
    verdict: Verdict,
    note?: string,
  ): Promise<void> {
    const { error } = await supabase.from('record_votes').upsert(
      {
        record_id: recordId,
        reviewer_id: reviewerId,
        verdict,
        note: note?.trim() ? note.trim() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'record_id,reviewer_id' },
    );
    if (error) {
      logger.error('vote failed', error);
      throw new Error(error.message);
    }
  }
}

export const reviewService = new ReviewService();
