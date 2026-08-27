/**
 * Turning a canonical position id into something a reviewer can act on.
 *
 * `back-mount-bottom` is unambiguous to the pipeline and close to useless to a
 * human under time pressure. A reviewer read that slug and had to work out,
 * before judging anything, that it meant "someone has your back and you are
 * escaping". Every second spent decoding is a second not spent on the actual
 * question, and a reviewer who misreads the side judges the wrong technique
 * entirely.
 *
 * The word "bottom" is the trap: in a guard it means you are PLAYING guard,
 * with the initiative. In a pin it means you are contained. Same suffix,
 * opposite situations. So framing is derived per family rather than per
 * suffix.
 *
 * Bench-only on purpose. The taxonomy in `src/sports/` is imported by the edge
 * function and shapes what gets grounded; adding a field there to serve a UI
 * copy problem risks the pipeline for no gain. A test asserts every base has
 * framing, so a new position cannot silently arrive unlabelled.
 */

import { positionById } from '@/sports/bjj/bjjPositions';

type Family = 'guard' | 'pin' | 'passing' | 'neutral';

/**
 * Which family each base belongs to. Mirrors the section comments in the
 * taxonomy — "Guards (bottom = guard player, top = passer)" and "Pins and
 * control (top = controlling, bottom = contained)".
 */
const FAMILY: Record<string, Family> = {
  'closed-guard': 'guard',
  'de-la-riva': 'guard',
  'reverse-de-la-riva': 'guard',
  'half-guard': 'guard',
  'deep-half-guard': 'guard',
  'knee-shield-half-guard': 'guard',
  'butterfly-guard': 'guard',
  'k-guard': 'guard',
  'x-guard': 'guard',
  'single-leg-x': 'guard',
  'spider-guard': 'guard',
  'lasso-guard': 'guard',
  'collar-sleeve-guard': 'guard',
  'sit-up-guard': 'guard',
  'shin-to-shin': 'guard',
  'matrix-guard': 'guard',
  'tarantula-guard': 'guard',
  'rubber-guard': 'guard',
  'open-guard': 'guard',
  mount: 'pin',
  'high-mount': 'pin',
  's-mount': 'pin',
  'technical-mount': 'pin',
  'side-control': 'pin',
  'north-south': 'pin',
  'knee-on-belly': 'pin',
  'kesa-gatame': 'pin',
  'back-mount': 'pin',
  turtle: 'pin',
  crucifix: 'pin',
  truck: 'pin',
  headquarters: 'passing',
  standing: 'neutral',
  'fifty-fifty': 'neutral',
};

/**
 * Bases whose generic family wording would be misleading.
 *
 * "You are pinned" is wrong for the back — nobody is lying on you — and wrong
 * for turtle, where you are folded up rather than flattened. Getting these
 * right matters more than the others: they are the positions where a reviewer
 * is most likely to picture the wrong thing.
 */
const OVERRIDES: Record<string, { top: string; bottom: string }> = {
  'back-mount': {
    top: 'You have their back.',
    bottom: 'They have your back. You are the one escaping.',
  },
  turtle: {
    top: 'They are turtled up. You are on top of them.',
    bottom:
      'You are turtled up, defending, trying to get out or recover guard.',
  },
  crucifix: {
    top: 'You have them in the crucifix, both their arms trapped.',
    bottom: 'Your arms are trapped in the crucifix. You are escaping.',
  },
  truck: {
    top: 'You have the truck.',
    bottom: 'They have the truck on you. You are defending.',
  },
  'knee-on-belly': {
    top: 'Your knee is on their belly.',
    bottom: 'Their knee is on your belly. You are escaping.',
  },
};

const GENERIC: Record<Family, { top: string; bottom: string }> = {
  guard: {
    top: 'They are playing guard. You are trying to pass it.',
    bottom:
      'You are playing guard, on your back or hip, with your legs between you and them.',
  },
  pin: {
    top: 'You are on top, holding the pin.',
    bottom: 'You are underneath, pinned, trying to escape.',
  },
  passing: {
    top: 'You are the passer, working through their legs.',
    bottom: 'They are passing your guard. You are trying to stop it.',
  },
  neutral: {
    top: 'Neither of you has the dominant position.',
    bottom: 'Neither of you has the dominant position.',
  },
};

export interface PositionFraming {
  /** "Back mount" — the position, without the perspective parenthetical. */
  title: string;
  /** "You are underneath" — the side, in three or four words. */
  side: string;
  /** One sentence putting the reviewer in the situation. */
  situation: string;
}

const SIDE_WORD: Record<Family, { top: string; bottom: string }> = {
  guard: { top: 'You are passing', bottom: 'You are playing guard' },
  pin: { top: 'You are on top', bottom: 'You are underneath' },
  passing: { top: 'You are passing', bottom: 'Your guard is being passed' },
  neutral: { top: 'Neutral', bottom: 'Neutral' },
};

/**
 * Frame a canonical position id for a human reader.
 *
 * Falls back to the raw id rather than inventing a description: a reviewer
 * seeing an unfamiliar slug is a smaller problem than one confidently told the
 * wrong side.
 */
export function framePosition(id: string): PositionFraming {
  const position = positionById(id);
  if (!position) {
    return { title: id, side: '', situation: '' };
  }
  const family = FAMILY[position.base];
  const title = position.label.replace(/\s*\((top|bottom)\)\s*$/i, '');
  if (!family || position.perspective === 'neutral') {
    return {
      title,
      side: '',
      situation: family ? GENERIC[family].top : '',
    };
  }
  const side = position.perspective === 'top' ? 'top' : 'bottom';
  const copy = OVERRIDES[position.base] ?? GENERIC[family];
  return { title, side: SIDE_WORD[family][side], situation: copy[side] };
}

/** Preconditions, in words rather than enum values. */
export function frameApplicability(record: {
  gi: string;
  level: string;
  opponent: string | null;
}): string[] {
  const out: string[] = [];
  // "either" is a database value, not something a reviewer should have to read.
  out.push(
    record.gi === 'gi'
      ? 'Gi only'
      : record.gi === 'no-gi'
        ? 'No-gi only'
        : 'Gi and no-gi',
  );
  if (record.level && record.level !== 'any') out.push(`${record.level} level`);
  return out;
}

/** Every base the taxonomy knows, for the coverage test. */
export const FRAMED_BASES = Object.keys(FAMILY);
