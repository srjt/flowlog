/**
 * "What would the coaching prompt be today?" for the cue review tool
 * (docs/ADMIN.md).
 *
 * NOT the prompt a stored Cue came from. Several of that prompt's inputs were
 * never saved (#121), and the corpus, profile and trends have moved on since.
 * This builds the prompt the pipeline WOULD send if this Session's Extraction
 * arrived now, so it can be copied into other models. It is never evidence
 * about a past Cue, and the page says so next to it.
 *
 * Every step reuses what the edge function uses: its sport registry, and the
 * single-sourced grounding selection and rendering in `src/sports/`. The one
 * piece that cannot be imported is `fillTemplate` (private to the Deno-only
 * `_shared/ai.ts`), so `tests/unit/promptPlaceholders.test.ts` scans the fill
 * below alongside the production call sites.
 */

import { filterByGiContext } from '../../src/sports/giContext.ts';
import {
  candidatePositions,
  groundingSection,
  rankRecords,
} from '../../src/sports/grounding.ts';
import {
  getSportContext,
  type ServerSportContext,
} from '../../supabase/functions/_shared/sports.ts';
import type { SessionRow } from './review.ts';

/**
 * Mirrors `process-session/index.ts`, where these are module-private.
 * `tests/unit/adminPrompt.test.ts` fails if the two disagree.
 */
export const COACHING_CUE_MAX_WORDS = 25;
export const RECENT_MISTAKES_WINDOW = 5;
export const GROUNDING_COLUMNS =
  'id,position,prescription,why,detail,counter,gi,level,opponent,' +
  'certified,contested,rejected';

export interface PromptSessionRow extends SessionRow {
  sport_key: string | null;
}

/** A coaching record shaped the way `loadGroundingRecords` shapes it. */
export interface PoolRecord {
  id: string;
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
  certified: boolean;
  contested: boolean;
  rejected: boolean;
}

/** Same null handling as the edge function, so ranking sees the same text. */
export function toPoolRecord(r: Record<string, unknown>): PoolRecord {
  const text = (v: unknown, fallback = '') =>
    typeof v === 'string' ? v : fallback;
  return {
    id: text(r.id),
    position: text(r.position),
    prescription: text(r.prescription),
    why: text(r.why),
    detail: text(r.detail),
    counter: text(r.counter),
    gi: text(r.gi, 'either'),
    level: text(r.level, 'any'),
    opponent: text(r.opponent),
    certified: r.certified === true,
    contested: r.contested === true,
    rejected: r.rejected === true,
  };
}

export function sportFor(row: PromptSessionRow): ServerSportContext {
  return getSportContext(row.sport_key ?? 'bjj');
}

export type Side = 'top' | 'bottom' | 'unknown';

export interface SideInference {
  side: Side;
  /** Where the side came from; null when it is unknown. */
  source: 'stored records' | 'target position' | null;
}

/**
 * The side the athlete was on.
 *
 * Extraction's perspective was never stored, and without it side-dependent
 * positions ("De La Riva Guard", "half guard") resolve to nothing, so a session
 * the pipeline grounded in 18 records rebuilds with none. Two stand-ins, most
 * direct first:
 *
 *   1. The positions of the records this session was grounded in. The pipeline
 *      selected them using the perspective it had, so their side IS that
 *      perspective. Only trusted when they agree.
 *   2. The stored target position. Resolved from the Cue's target, so it is
 *      absent whenever the Cue named something that is not a canonical
 *      position ("Berimbolo").
 *
 * Neither available means unknown, never a guess.
 */
export function inferredPerspective(
  row: PromptSessionRow,
  storedRecordPositions: string[] = [],
): SideInference {
  const positions = sportFor(row).positions;
  const sideOf = (id: string): Side => {
    const p = positions.find((pos) => pos.id === id)?.perspective;
    return p === 'top' || p === 'bottom' ? p : 'unknown';
  };

  const recordSides = new Set(
    storedRecordPositions.map(sideOf).filter((s) => s !== 'unknown'),
  );
  if (recordSides.size === 1) {
    return { side: [...recordSides][0] as Side, source: 'stored records' };
  }

  const target = row.target_position_id
    ? sideOf(row.target_position_id)
    : 'unknown';
  if (target !== 'unknown') return { side: target, source: 'target position' };

  return { side: 'unknown', source: null };
}

/** Canonical positions to fetch records for, as `process-session` derives them. */
export function positionsToday(row: PromptSessionRow, side: Side): string[] {
  return candidatePositions({
    positionsVisited: row.positions_visited ?? [],
    keyMistake: row.key_mistake ?? '',
    opponentAction: row.opponent_action ?? '',
    perspective: side,
    rawTranscript: row.raw_transcript ?? '',
  });
}

export interface PromptContext {
  /** From the athlete's profile today. */
  skillLevel: string | null;
  /** Key mistakes from the athlete's latest other sessions, newest first. */
  recentMistakes: string[];
  /** From `user_trends` today. */
  dominantWeakness: string | null;
  /** Records for `positionsToday`, ordered by id as the edge function orders them. */
  pool: PoolRecord[];
}

export interface TodaysPrompt {
  prompt: string;
  positions: string[];
  side: SideInference;
  selection: {
    pool: number;
    afterGi: number;
    gatePassed: number;
    injected: number;
    recordIds: string[];
  };
  /** What makes this differ from what the model saw. Most important first. */
  caveats: string[];
}

/** Private in `_shared/ai.ts`; copied because that file cannot load under Node. */
function fillTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
    template,
  );
}

function sideCaveat({ side, source }: SideInference): string {
  const lead = "Records are re-selected from today's corpus.";
  if (source === 'stored records') {
    return `${lead} Perspective was never stored; it is taken as "${side}" from the records this session was grounded in.`;
  }
  if (source === 'target position') {
    return `${lead} Perspective was never stored; it is taken as "${side}" from the stored target position.`;
  }
  return `${lead} Perspective was never stored, and neither the stored records nor the target position carry a side, so positions that depend on a side may not resolve.`;
}

export function buildTodaysPrompt(
  row: PromptSessionRow,
  ctx: PromptContext,
  positions: string[],
  side: SideInference = inferredPerspective(row),
): TodaysPrompt {
  const sport = sportFor(row);
  const keyMistake = row.key_mistake ?? '';
  const gi = row.gi === 'gi' || row.gi === 'no-gi' ? row.gi : null;

  // Same order as process-session: gi filter, then rank. The stored `gi` is
  // already the resolved context, so no re-resolution is needed.
  const eligible = filterByGiContext(ctx.pool, gi);
  const records = rankRecords(
    eligible,
    keyMistake,
    undefined,
    undefined,
    sport.vocabulary,
  );
  const gatePassed = rankRecords(
    eligible,
    keyMistake,
    Number.POSITIVE_INFINITY,
    undefined,
    sport.vocabulary,
  ).length;

  const skillLevel = ctx.skillLevel?.trim() || 'not set';
  const prompt = fillTemplate(sport.coachingPrompt, {
    SKILL_LEVEL: skillLevel,
    KEY_MISTAKE: keyMistake,
    OPPONENT_ACTION: row.opponent_action ?? '',
    POSITIONS_VISITED: (row.positions_visited ?? []).join(', ') || 'none',
    RECENT_MISTAKES: ctx.recentMistakes.join('; ') || 'none recorded',
    GROUNDING: groundingSection(records),
    DOMINANT_WEAKNESS: ctx.dominantWeakness ?? 'not yet established',
    MAX_WORDS: String(COACHING_CUE_MAX_WORDS),
  });

  const caveats = [
    'Built today from current code, coaching records, profile and trends. This is not the prompt this Cue came from.',
    sideCaveat(side),
    `Recent mistakes are this athlete's ${RECENT_MISTAKES_WINDOW} latest other sessions, as of today.`,
    "Base prompt only: the quality gate's stricter retry wording is not included.",
    'Records are injected whenever any survive, as in the grounded arm.',
  ];
  if (!ctx.skillLevel?.trim()) {
    caveats.push('The athlete has no skill level on their profile.');
  }
  if (row.grounding === 'declined') {
    caveats.unshift(
      'This take was declined. The pipeline would not build a coaching prompt for it at all.',
    );
  }

  return {
    prompt,
    positions,
    side,
    selection: {
      pool: ctx.pool.length,
      afterGi: eligible.length,
      gatePassed,
      injected: records.length,
      recordIds: records.map((r) => r.id),
    },
    caveats,
  };
}

export interface StoredComparison {
  stored: number;
  today: number;
  /** Stored records that today's selection also picked. */
  shared: number;
  sameOrder: boolean;
}

/**
 * Today's records against the ids the stored prompt carried. Null when the row
 * names none — not recorded, or nothing was injected. The stored list is only
 * as good as the Session's record trail, which the page shows alongside.
 */
export function compareWithStored(
  row: PromptSessionRow,
  todayIds: string[],
): StoredComparison | null {
  const stored = row.grounding_record_ids;
  if (!stored || stored.length === 0) return null;
  const today = new Set(todayIds);
  return {
    stored: stored.length,
    today: todayIds.length,
    shared: stored.filter((id) => today.has(id)).length,
    sameOrder:
      stored.length === todayIds.length &&
      stored.every((id, i) => id === todayIds[i]),
  };
}
