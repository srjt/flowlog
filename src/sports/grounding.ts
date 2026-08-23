/**
 * Grounding selection — which instructional records reach the coaching prompt,
 * and how they are rendered (issue #41/#57).
 *
 * Dependency-free on purpose, with relative imports only: this file is imported
 * by BOTH the client reference implementation AND the Supabase edge function,
 * exactly like the sport prompts. The two must select and render identically —
 * a cue measured in one place means nothing if the other built a different
 * prompt. Keep it free of any `@/`, node, or React Native imports.
 */

import { normalizePosition } from './bjj/bjjPositions.ts';
import type { Perspective } from './positionTypes.ts';

/** Ceiling on how many records reach the prompt. */
export const GROUNDING_RECORD_LIMIT = 20;

/**
 * Minimum overlap with the key mistake before a record is worth injecting.
 *
 * A blind trial found that injecting the top 20 records for a position made
 * cues WORSE — the practitioner preferred the ungrounded cue two-to-one. The
 * records were about the right position and the wrong problem, and the model
 * dutifully built a specific cue around a mechanic that answered a different
 * question. Specificity is worthless if it is aimed elsewhere.
 *
 * So a record must share at least this many meaningful terms with the mistake.
 * Measured over the frozen baseline, a bar of 2 keeps 17 of 23 resolvable
 * sessions grounded while cutting the median injected set from 25 to 4.
 */
export const GROUNDING_MIN_RELEVANCE = 2;

/** The shape grounding needs. Structural so both sides can pass their own type. */
export interface GroundableRecord {
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
}

/** The extraction fields grounding reads. */
export interface GroundableExtraction {
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  perspective: Perspective | 'unknown';
  /**
   * The transcript. Load-bearing, not decorative: the practitioner states which
   * side they were on far more often than the extracted summary does, and
   * without it a session resolves for storage but not for grounding.
   */
  rawTranscript: string;
}

/**
 * Canonical position ids this session might be grounded against.
 *
 * Every position mentioned is a candidate, not just one. The key mistake
 * usually concerns a single position, and ranking the records afterwards
 * settles which — whereas picking one up front would have to guess, and
 * guessing wrong grounds the cue in the wrong situation entirely.
 */
export function candidatePositions(extraction: GroundableExtraction): string[] {
  // Include the transcript. The extracted mistake is a tidy summary and
  // routinely drops the side — "unable to sweep from half guard" says nothing
  // about who was underneath, while the recording almost always does. Omitting
  // it made grounding strictly weaker than the storage-side resolution, so a
  // session could resolve to `half-guard-bottom` for the database and to
  // nothing at all for the prompt.
  const context = [
    extraction.keyMistake,
    extraction.opponentAction,
    extraction.rawTranscript,
  ]
    .filter(Boolean)
    .join(' ');
  const ids = new Set<string>();
  for (const raw of extraction.positionsVisited) {
    const match = normalizePosition(raw, context, extraction.perspective);
    if (match.id) ids.add(match.id);
  }
  return [...ids];
}

/**
 * Words common to almost every extracted mistake. They would dominate the
 * overlap score without distinguishing anything.
 */
const STOPWORDS = new Set([
  'practitioner',
  'opponent',
  'their',
  'them',
  'they',
  'this',
  'that',
  'with',
  'from',
  'when',
  'while',
  'unable',
  'failed',
  'could',
  'been',
  'being',
  'into',
  'onto',
  'were',
  'where',
  'which',
]);

/**
 * Rank by overlap with the key mistake, then cap.
 *
 * Cost is not the constraint — 20 records is ~2,100 tokens on a prompt that is
 * otherwise tiny. **Dilution** is: `half-guard-bottom` alone has 145 records,
 * and burying the one relevant correction among them makes the model pick
 * badly. Ranking is crude on purpose; it operates on a shortlist already
 * filtered by position and perspective, which does most of the work.
 *
 * Ties keep input order, so a stable input yields a stable prompt — an
 * unstable prompt makes before/after comparisons noisy for no reason.
 */
export function rankRecords<T extends GroundableRecord>(
  records: T[],
  keyMistake: string,
  limit: number = GROUNDING_RECORD_LIMIT,
  minRelevance: number = GROUNDING_MIN_RELEVANCE,
): T[] {
  const terms = new Set(
    (keyMistake.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
      (w) => !STOPWORDS.has(w),
    ),
  );
  // Nothing to match against means we cannot tell relevance from irrelevance.
  // Injecting arbitrary records for the position is exactly what made cues
  // worse, so ground nothing instead.
  if (terms.size === 0) return [];

  return (
    records
      .map((record, index) => {
        const haystack =
          `${record.prescription} ${record.why} ${record.detail}`.toLowerCase();
        let score = 0;
        for (const term of terms) if (haystack.includes(term)) score++;
        return { record, score, index };
      })
      // The gate: a record about the right position but the wrong problem is
      // worse than no record, because the model will build a confident, specific
      // cue around it.
      .filter((entry) => entry.score >= minRelevance)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((entry) => entry.record)
  );
}

/**
 * The block that replaces `{{GROUNDING}}` in the coaching prompt.
 *
 * Empty when ungrounded, so the prompt collapses back to exactly what it was —
 * an ungrounded cue must be indistinguishable from one the pipeline produced
 * before grounding existed.
 */
export function groundingSection(records: GroundableRecord[]): string {
  if (records.length === 0) return '';
  const lines = records.map((r) => {
    const parts = [`- ${r.prescription}`];
    if (r.why) parts.push(`  Why: ${r.why}`);
    if (r.detail) parts.push(`  Detail: ${r.detail}`);
    if (r.counter) parts.push(`  They counter with: ${r.counter}`);
    const when = [
      r.gi !== 'either' ? r.gi : '',
      r.level !== 'any' ? r.level : '',
      r.opponent,
    ]
      .filter(Boolean)
      .join(', ');
    if (when) parts.push(`  Applies when: ${when}`);
    return parts.join('\n');
  });
  return [
    '',
    '',
    'REFERENCE MECHANICS for this position, as experienced instructors teach it:',
    lines.join('\n'),
    '',
    'REFERENCE MECHANICS — how experienced instructors teach this position:',
    '',
    'THE MISTAKE IS THE JOB. Your cue must address what went wrong in THIS session.',
    'The mechanics below are offered as help, not as an assignment. They were selected',
    'because they mention some of the same things the mistake does, which is a weak',
    'signal — several of them will be about this position but not about this problem.',
    '',
    'For each one, ask: does this actually fix what went wrong? If yes, use its concrete',
    'detail — the grip, the direction, the body part — rather than the general principle',
    'behind it. If no, discard it.',
    '',
    'IF NONE OF THEM FIT, IGNORE THEM ALL and coach the mistake directly. That is a',
    'correct outcome, not a failure. A cue that addresses the real mistake in ordinary',
    'terms is far more useful than a precise cue aimed at a different problem — and',
    'aiming elsewhere is the most common way these notes get misused.',
    '',
    '- If a mechanic carries an "Applies when" line, honour it. One taught for beginners',
    '  is not automatically right for an advanced practitioner, and one that depends on a',
    '  grip only works when that grip is available.',
    '- Never mention these notes, where they came from, or that you were given references.',
  ].join('\n');
}
