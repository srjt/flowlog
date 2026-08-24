/**
 * Data access for the certification tool (#77).
 *
 * Everything here is scoped by RLS to ACTIVE reviewers (migration 014). A
 * signed-in app user who is not a reviewer sees nothing — not an error, an
 * empty set — so the UI must ask `isReviewer()` rather than infer access from
 * an empty queue.
 */

import { supabase } from '@/lib/supabase';
import type { ReviewableRecord, VoteTally } from '@/utils/reviewQueue';
import { logger } from '@/utils/logger';

export type Verdict = 'certify' | 'reject';

export interface ReviewerIdentity {
  id: string;
  displayName: string;
  credential: string | null;
}

export interface ReviewQueueData {
  records: ReviewableRecord[];
  tallies: Map<string, VoteTally>;
  myVotes: Set<string>;
}

export class ReviewService {
  /**
   * Is the signed-in user an active reviewer?
   *
   * Asked explicitly because RLS makes a non-reviewer's queue look identical
   * to a finished one, and telling someone "all done!" when they simply have
   * no access would be a confusing lie.
   */
  async whoAmI(): Promise<ReviewerIdentity | null> {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
      .from('reviewers')
      .select('id, display_name, credential, active')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (error || !data || data.active !== true) return null;
    return {
      id: data.id,
      displayName: data.display_name,
      credential: data.credential ?? null,
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
    const records: ReviewableRecord[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from('coaching_records')
        .select(
          'id, position, prescription, why, detail, counter, gi, level, opponent, certified, contested, rejected',
        )
        .order('id')
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      records.push(...((data ?? []) as ReviewableRecord[]));
      if (!data || data.length < 1000) break;
    }

    const { data: votes, error: voteError } = await supabase
      .from('record_votes')
      .select('record_id, reviewer_id, verdict');
    if (voteError) throw new Error(voteError.message);

    const tallies = new Map<string, VoteTally>();
    const myVotes = new Set<string>();
    for (const v of votes ?? []) {
      const t = tallies.get(v.record_id) ?? { certify: 0, reject: 0 };
      if (v.verdict === 'certify') t.certify++;
      else t.reject++;
      tallies.set(v.record_id, t);
      if (v.reviewer_id === reviewerId) myVotes.add(v.record_id);
    }
    return { records, tallies, myVotes };
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
