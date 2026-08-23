/**
 * Canonical BJJ position taxonomy.
 *
 * The stable vocabulary everything else keys on: mined instructional records,
 * the extractor's free-text `targetPosition`, and any later grounding lookup.
 *
 * ## Why perspective is part of the identity
 *
 * Being on top of side control and being underneath it are two different
 * situations with opposite advice. A correction drawn from escape material is
 * for the person underneath; served to someone who was on top and losing the
 * pin, it is confidently, precisely wrong. So `side-control-top` and
 * `side-control-bottom` are separate ids — not one id with a modifier that a
 * caller might forget to read.
 *
 * `BJJ_VOCABULARY.positions` cannot serve this purpose: it is a flat list of
 * spellings for transcription priming, with no ids and no way to express which
 * side you were on.
 *
 * ## What top and bottom mean
 *
 * Read them as ROLES, not as literal elevation:
 *
 * - `top`    — the controlling role: holding the pin, passing the guard,
 *              on the back.
 * - `bottom` — the contained role: pinned, playing guard, back taken.
 * - `neutral` — the position has no meaningful sides (standing, 50/50).
 *
 * For guards this matches how the sport already speaks — "half guard bottom"
 * is the guard player, "half guard top" is the passer.
 *
 * ## Ids
 *
 * `{base}-{perspective}`, kebab-case (`mount-bottom`, `de-la-riva-top`), or a
 * bare `{base}` for neutral positions. The convention and the first four base
 * ids (`back-mount`, `closed-guard`, `de-la-riva`, `butterfly-guard`) come from
 * the cue-image effort's seeded positions, so both efforts share one vocabulary
 * rather than maintaining two.
 *
 * This file is dependency-free on purpose: it is imported by BOTH the client
 * sport context AND the Supabase edge function. Keep it free of any `@/`, node,
 * or React Native imports.
 */

import type {
  Perspective,
  PositionMatch,
  SportPosition,
} from '../positionTypes.ts';

export type { Perspective, PositionMatch };

/** How a base position is split into perspectives. */
type Sidedness = 'sided' | 'neutral';

interface PositionBase {
  /** Kebab-case stem of the id. */
  base: string;
  /** Human-readable name, without the perspective suffix. */
  label: string;
  sidedness: Sidedness;
  /**
   * Specific forms matched as a SUBSTRING, case-insensitively. Order does not
   * matter — resolution prefers the LONGEST match, so "deep half guard" cannot
   * be swallowed by "half guard".
   *
   * Only put multi-word or unambiguous forms here. A generic single word like
   * "guard" belongs in `exactAliases`, or "Flying Space Guard" would silently
   * resolve to closed guard.
   */
  aliases: string[];
  /**
   * Generic forms that match ONLY when they are the entire phrase. This is what
   * stops an unrecognised position from being swallowed by a common word it
   * happens to contain — the nearest-match guessing this taxonomy exists to
   * prevent.
   */
  exactAliases?: string[];
}

/** A fully-resolved position: a base plus the side you were on. */
export type BjjPosition = SportPosition;

// ── The taxonomy ────────────────────────────────────────────────────────────
// Ordered head-first by what actually appears in real sessions, then the tail.
// Extend freely; ids are the contract, order is not.

const POSITION_BASES: PositionBase[] = [
  // ── Guards (bottom = guard player, top = passer) ─────────────────────────
  {
    base: 'closed-guard',
    label: 'Closed guard',
    sidedness: 'sided',
    aliases: ['closed guard', 'full guard'],
    exactAliases: ['guard'],
  },
  {
    base: 'de-la-riva',
    label: 'De La Riva',
    sidedness: 'sided',
    aliases: ['de la riva', 'de la riva guard', 'dlr', 'delariva'],
  },
  {
    base: 'reverse-de-la-riva',
    label: 'Reverse De La Riva',
    sidedness: 'sided',
    aliases: ['reverse de la riva', 'reverse dlr', 'rdlr'],
  },
  {
    base: 'half-guard',
    label: 'Half guard',
    sidedness: 'sided',
    aliases: ['half guard', 'half-guard'],
  },
  {
    base: 'deep-half-guard',
    label: 'Deep half guard',
    sidedness: 'sided',
    aliases: ['deep half guard', 'deep half'],
  },
  {
    base: 'knee-shield-half-guard',
    label: 'Knee shield half guard',
    sidedness: 'sided',
    aliases: ['knee shield half guard', 'knee shield', 'z guard', 'z-guard'],
  },
  {
    base: 'butterfly-guard',
    label: 'Butterfly guard',
    sidedness: 'sided',
    aliases: ['butterfly guard'],
    exactAliases: ['butterfly'],
  },
  {
    base: 'k-guard',
    label: 'K guard',
    sidedness: 'sided',
    aliases: ['k guard', 'k-guard'],
  },
  {
    base: 'x-guard',
    label: 'X guard',
    sidedness: 'sided',
    aliases: ['x guard', 'x-guard'],
  },
  {
    base: 'single-leg-x',
    label: 'Single leg X',
    sidedness: 'sided',
    aliases: [
      'single leg x',
      'single leg x-guard',
      'single leg x guard',
      'slx',
      'ashi garami',
    ],
  },
  {
    base: 'spider-guard',
    label: 'Spider guard',
    sidedness: 'sided',
    aliases: ['spider guard'],
    exactAliases: ['spider'],
  },
  {
    base: 'lasso-guard',
    label: 'Lasso guard',
    sidedness: 'sided',
    aliases: ['lasso guard'],
    exactAliases: ['lasso'],
  },
  {
    base: 'collar-sleeve-guard',
    label: 'Collar sleeve guard',
    sidedness: 'sided',
    aliases: ['collar sleeve guard', 'collar sleeve', 'collar and sleeve'],
  },
  {
    base: 'sit-up-guard',
    label: 'Sit-up guard',
    sidedness: 'sided',
    aliases: ['sit up guard', 'sit-up guard', 'seated guard'],
  },
  {
    base: 'shin-to-shin',
    label: 'Shin to shin',
    sidedness: 'sided',
    aliases: ['shin to shin', 'shin-to-shin'],
  },
  {
    base: 'matrix-guard',
    label: 'Matrix guard',
    sidedness: 'sided',
    aliases: ['matrix guard'],
    exactAliases: ['matrix'],
  },
  {
    base: 'tarantula-guard',
    label: 'Tarantula guard',
    sidedness: 'sided',
    aliases: ['tarantula guard'],
    exactAliases: ['tarantula'],
  },
  {
    base: 'rubber-guard',
    label: 'Rubber guard',
    sidedness: 'sided',
    aliases: ['rubber guard'],
  },
  {
    base: 'open-guard',
    label: 'Open guard',
    sidedness: 'sided',
    aliases: ['open guard'],
  },

  // ── Pins and control (top = controlling, bottom = contained) ─────────────
  {
    base: 'mount',
    label: 'Mount',
    sidedness: 'sided',
    aliases: ['mounted position', 'full mount'],
    exactAliases: ['mount', 'mounted'],
  },
  {
    base: 'high-mount',
    label: 'High mount',
    sidedness: 'sided',
    aliases: ['high mount'],
  },
  {
    base: 's-mount',
    label: 'S-mount',
    sidedness: 'sided',
    aliases: ['s mount', 's-mount'],
  },
  {
    base: 'technical-mount',
    label: 'Technical mount',
    sidedness: 'sided',
    aliases: ['technical mount'],
  },
  {
    base: 'side-control',
    label: 'Side control',
    sidedness: 'sided',
    aliases: ['side control', 'side-control', 'side mount', 'cross side'],
  },
  {
    base: 'north-south',
    label: 'North-south',
    sidedness: 'sided',
    aliases: ['north south', 'north-south'],
  },
  {
    base: 'knee-on-belly',
    label: 'Knee on belly',
    sidedness: 'sided',
    aliases: ['knee on belly', 'knee-on-belly', 'knee ride'],
  },
  {
    base: 'kesa-gatame',
    label: 'Kesa gatame',
    sidedness: 'sided',
    aliases: ['kesa gatame', 'scarf hold', 'reverse kesa'],
    exactAliases: ['kesa'],
  },
  {
    base: 'back-mount',
    label: 'Back control',
    sidedness: 'sided',
    aliases: ['back control', 'back mount', 'rear mount', 'seat belt'],
    exactAliases: ['back'],
  },
  {
    base: 'turtle',
    label: 'Turtle',
    sidedness: 'sided',
    aliases: ['turtle position'],
    exactAliases: ['turtle', 'turtled'],
  },
  {
    base: 'crucifix',
    label: 'Crucifix',
    sidedness: 'sided',
    aliases: [],
    exactAliases: ['crucifix'],
  },
  {
    base: 'truck',
    label: 'Truck',
    sidedness: 'sided',
    aliases: ['the truck'],
    exactAliases: ['truck'],
  },

  // ── Passing positions (the passer's side is the meaningful one) ──────────
  {
    base: 'headquarters',
    label: 'Headquarters',
    sidedness: 'sided',
    aliases: ['headquarters', 'headquarters position', 'hq position'],
  },

  // ── Neutral: no meaningful sides ────────────────────────────────────────
  {
    base: 'standing',
    label: 'Standing',
    sidedness: 'neutral',
    aliases: ['standing', 'standing up', 'on the feet', 'feet to floor'],
  },
  {
    base: 'fifty-fifty',
    label: '50/50',
    sidedness: 'neutral',
    aliases: ['50 50', '50-50', 'fifty fifty'],
  },
];

/** Every canonical position, expanded from the bases. */
export const BJJ_POSITIONS: BjjPosition[] = POSITION_BASES.flatMap(
  (b): BjjPosition[] =>
    b.sidedness === 'neutral'
      ? [
          {
            id: b.base,
            base: b.base,
            label: b.label,
            perspective: 'neutral',
          },
        ]
      : (['top', 'bottom'] as const).map((p) => ({
          id: `${b.base}-${p}`,
          base: b.base,
          label: `${b.label} (${p})`,
          perspective: p,
        })),
);

const BY_ID = new Map(BJJ_POSITIONS.map((p) => [p.id, p]));

/** Look up a canonical position by exact id. */
export function positionById(id: string): BjjPosition | null {
  return BY_ID.get(id) ?? null;
}

// ── Normalisation ───────────────────────────────────────────────────────────

const NO_MATCH: PositionMatch = {
  id: null,
  base: null,
  label: null,
  perspective: 'unknown',
};

/**
 * Phrases that reveal which side the speaker was on. Longest-first so
 * "took my back" is tested before "my back".
 *
 * These are deliberately conservative. An ambiguous phrase yields no
 * perspective, which yields a null id, which makes the caller abstain — the
 * correct outcome. Guessing here manufactures exactly the confident-but-wrong
 * cue this taxonomy exists to prevent.
 */
const BOTTOM_CUES = [
  'took my back',
  'taking my back',
  'got my back taken',
  'stuck underneath',
  'stuck under',
  'flattened out',
  'i was underneath',
  'underneath',
  'under',
  'he mounted me',
  'they mounted me',
  'she mounted me',
  'got mounted',
  'i got passed',
  'passed my guard',
  'escaping',
  'escape from',
  'defense from',
  'defending from',
  'i was pinned',
  'pinned me',
  'held me',
  'on top of me',
  'bottom',
  'playing guard',
  'my guard',
  'i played',
];

const TOP_CUES = [
  'i took his back',
  'i took her back',
  'i took their back',
  'i took the back',
  'took the back',
  'i mounted',
  'i got mount',
  'i had mount',
  'i passed',
  'passing',
  'i was on top',
  'on top',
  'i held',
  'i pinned',
  'in his guard',
  'in her guard',
  'in their guard',
  'top',
];

/** Explicit parenthetical/suffix forms the extractor already emits. */
function explicitPerspective(text: string): Perspective | null {
  if (/\((?:the\s+)?bottom\)|\bbottom\b\s*$/.test(text)) return 'bottom';
  if (/\((?:the\s+)?top\)|\btop\b\s*$/.test(text)) return 'top';
  return null;
}

function detectPerspective(text: string): Perspective | 'unknown' {
  const explicit = explicitPerspective(text);
  if (explicit) return explicit;

  // Longest cue wins, so a specific phrase beats a generic substring of it.
  let best: { p: Perspective; len: number } | null = null;
  for (const cue of BOTTOM_CUES) {
    if (text.includes(cue) && (!best || cue.length > best.len)) {
      best = { p: 'bottom', len: cue.length };
    }
  }
  for (const cue of TOP_CUES) {
    if (text.includes(cue) && (!best || cue.length > best.len)) {
      best = { p: 'top', len: cue.length };
    }
  }
  return best?.p ?? 'unknown';
}

/** Strip a trailing "(bottom)" / "(top)" so exact matching still applies. */
function barePhrase(text: string): string {
  return text.replace(/\((?:the\s+)?(?:top|bottom)\)\s*$/, '').trim();
}

function findBase(text: string): PositionBase | null {
  const bare = barePhrase(text);
  let best: { b: PositionBase; len: number } | null = null;

  for (const b of POSITION_BASES) {
    // Generic forms only count when they ARE the phrase — otherwise
    // "Flying Space Guard" resolves to closed guard, which is a guess.
    for (const alias of b.exactAliases ?? []) {
      if (bare === alias && (!best || alias.length > best.len)) {
        best = { b, len: alias.length };
      }
    }
    for (const alias of b.aliases) {
      // Longest alias wins so "deep half guard" is not eaten by "half guard".
      if (text.includes(alias) && (!best || alias.length > best.len)) {
        best = { b, len: alias.length };
      }
    }
  }
  return best?.b ?? null;
}

/**
 * Map free text — the extractor's `targetPosition`, a phrase from a transcript,
 * an instructional chapter title — onto a canonical position.
 *
 * Returns a null `id` when the position is unrecognised OR when it is
 * recognised but the text never says which side. **There is no nearest-match
 * fallback**: a wrong position is worse than no position, because everything
 * downstream then reasons confidently about the wrong situation.
 *
 * Note that submissions and concepts routinely arrive here — real sessions have
 * produced `targetPosition` values of "Armbar Setup", "Kimura submission" and
 * "Base Fundamentals". Those are not positions and must not be coerced into one.
 *
 * `context` supplies extra text (the key mistake, the opponent's action, the
 * transcript) to read the side from when the position phrase alone is silent.
 * `perspectiveHint` is a side reported directly by an earlier stage, used only
 * when neither the phrase nor the context says.
 */
export function normalizePosition(
  input: string | null | undefined,
  context = '',
  perspectiveHint: Perspective | 'unknown' = 'unknown',
): PositionMatch {
  const raw = (input ?? '').toLowerCase().trim();
  if (!raw) return NO_MATCH;

  const base = findBase(raw);
  if (!base) return NO_MATCH;

  if (base.sidedness === 'neutral') {
    return {
      id: base.base,
      base: base.base,
      label: base.label,
      perspective: 'neutral',
    };
  }

  // Precedence: the position phrase itself, then the surrounding text, then
  // whatever an earlier stage reported. A side written into the phrase is the
  // most specific signal there is and must not be overridden by a hint.
  let perspective = detectPerspective(raw);
  if (perspective === 'unknown' && context) {
    perspective = detectPerspective(context.toLowerCase());
  }
  if (perspective === 'unknown' && perspectiveHint !== 'unknown') {
    perspective = perspectiveHint;
  }

  if (perspective === 'unknown' || perspective === 'neutral') {
    return {
      id: null,
      base: base.base,
      label: base.label,
      perspective: 'unknown',
    };
  }

  return {
    id: `${base.base}-${perspective}`,
    base: base.base,
    label: `${base.label} (${perspective})`,
    perspective,
  };
}
