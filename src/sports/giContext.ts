/**
 * Gi / no-gi context — what the athlete was wearing, and which reference
 * records that lets through (issue #60, design decided in #43).
 *
 * Dependency-free with relative imports only: imported by BOTH the client
 * reference implementation AND the Supabase edge function, exactly like
 * `grounding.ts`. A record excluded on one side must be excluded on the other,
 * or a cue measured in one place says nothing about the other.
 */

/** What the athlete was wearing. Null means we do not know. */
export type GiContext = 'gi' | 'no-gi';

/** Where the value in `sessions.gi` came from, so a misfire is countable. */
export type GiSource =
  /** The record-screen toggle (itself seeded from the profile default). */
  | 'toggle'
  /** The athlete said so out loud, contradicting the toggle. */
  | 'transcript'
  /** No toggle and no statement — grounding treats this as unknown. */
  | 'none';

/**
 * Phrases that state the session's context outright.
 *
 * Deliberately narrow. The override exists to catch "I was in a no-gi class
 * today", NOT to infer context from technique talk: a stray "collar" or
 * "sleeve" must never flip anything, because incidental grip words are not a
 * declaration of what you were wearing. Someone can describe a collar choke
 * they were caught in during a no-gi class while drilling with a jacket on the
 * side, and someone reviewing gi footage says "lapel" all the time.
 *
 * Bare "gi" is excluded on purpose — it appears inside "no-gi", it is what
 * people call the garment rather than the class, and mishearing it is the
 * single most likely transcription error in this vocabulary.
 */
const NO_GI_MARKERS = [
  'no-gi',
  'no gi',
  'nogi',
  'without the gi',
  'without a gi',
  'rash guard',
  'rashguard',
  'no jacket',
  'without the jacket',
];

const GI_MARKERS = [
  'gi class',
  'gi session',
  'gi round',
  'gi training',
  'gi today',
  'gi practice',
  'in the gi',
  'in a gi',
  'wearing a gi',
  'wearing the gi',
  'kimono',
];

/**
 * The explicit statement in the transcript, if there is one.
 *
 * Returns null when the transcript says nothing explicit, and ALSO when it says
 * both — "we did gi class then no-gi rounds" is a real session shape, and there
 * is no honest way to pick one, so it falls back to the toggle rather than
 * guessing.
 */
export function explicitGiStatement(transcript: string): GiContext | null {
  const text = transcript.toLowerCase();
  // No-gi first: "no-gi class" contains "gi class".
  const saidNoGi = NO_GI_MARKERS.some((m) => text.includes(m));
  // Strip the no-gi phrasings before looking for gi ones, so the substring
  // overlap cannot register as a gi statement.
  let stripped = text;
  for (const m of NO_GI_MARKERS) stripped = stripped.split(m).join(' ');
  const saidGi = GI_MARKERS.some((m) => stripped.includes(m));

  if (saidNoGi && saidGi) return null;
  if (saidNoGi) return 'no-gi';
  if (saidGi) return 'gi';
  return null;
}

export interface GiResolution {
  /** The context to use for this session. Null means unknown. */
  gi: GiContext | null;
  source: GiSource;
  /** True when the recording corrected a toggle that said otherwise. */
  overrode: boolean;
}

/**
 * Settle the session's context from the toggle and the recording.
 *
 * **The recording wins on an explicit contradiction.** Trusting a stale toggle
 * serves lapel-and-sleeve instructions to someone in a rash guard — broken.
 * Trusting the recording loses at most the 27% of records that are gi-specific
 * for one session — thinner. One failure is broken, the other is thinner.
 *
 * It also matches the precedent set for perspective: the most specific signal
 * wins, and "no-gi class today" about the session in hand is more specific than
 * a default set weeks ago.
 *
 * Two signals must agree before an override fires. The model reports the
 * statement (`stated`); the transcript must independently contain an explicit
 * marker. Models are eager to fill a field they were given, and a
 * silently-flipped context is precisely the kind of surprise this feature is
 * supposed to prevent — so an unconfirmed claim keeps the toggle.
 */
export function resolveGiContext(args: {
  toggle: GiContext | null;
  stated: GiContext | null;
  transcript: string;
}): GiResolution {
  const { toggle, stated, transcript } = args;
  const confirmed = explicitGiStatement(transcript);
  const explicit = stated !== null && stated === confirmed ? stated : null;

  if (explicit !== null) {
    return {
      gi: explicit,
      source: 'transcript',
      overrode: toggle !== null && toggle !== explicit,
    };
  }
  if (toggle !== null) return { gi: toggle, source: 'toggle', overrode: false };
  return { gi: null, source: 'none', overrode: false };
}

/**
 * Drop records whose precondition contradicts the session.
 *
 * `'either'` records always survive — they are 692 of the 953 mined, and the
 * mechanics that do not depend on cloth are most of what makes grounding worth
 * doing at all.
 *
 * **An unknown context excludes gi-specific records rather than gambling.** The
 * asymmetry is the same one throughout this feature: excluding costs depth,
 * including risks handing a collar grip to someone who has no collar. Depth is
 * recoverable — the athlete can set the toggle — and a confidently wrong cue
 * is not.
 */
export function filterByGiContext<T extends { gi: string }>(
  records: T[],
  gi: GiContext | null,
): T[] {
  return records.filter((r) => {
    if (r.gi !== 'gi' && r.gi !== 'no-gi') return true; // 'either' / unset
    return r.gi === gi;
  });
}
