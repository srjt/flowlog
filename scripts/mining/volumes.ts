/**
 * The volume number in a filename, or null if there isn't one (issue #75).
 *
 * Order is the whole point. An earlier version took the trailing number and
 * called every other convention an index file, which silently dropped 415k
 * words — three whole series — with no warning and a zero exit.
 *
 * An explicit `vol` marker MUST win over position, because a trailing number
 * is not always the volume:
 *
 *   "Back Attacks Vol 4 Workings of Straitjacket System 2"  -> 4, not 2
 *
 * There the trailing 2 belongs to the chapter title, and reading it as the
 * volume both loses volume 4 and collides with the real volume 2.
 *
 * Bare position is only consulted once no marker exists, trailing first (the
 * commonest convention) and leading last ("1 Ageless Jiu Jitsu - Top Game").
 * Deliberately NOT "any number anywhere": that matches the 720 in "720p" and
 * the 264 in "x264".
 */
export function volumeNumber(stem: string): number | null {
  for (const re of [
    /\bvol(?:ume)?\s*\.?\s*(\d+)/i, // explicit marker, anywhere
    /(\d+)\s*$/, // trailing
    /^\s*(\d+)\b/, // leading
  ]) {
    const m = re.exec(stem);
    if (m) return Number(m[1]);
  }
  return null;
}

const MARKER_RE = /\bvol(?:ume)?\s*\.?\s*(\d+)/i;

/** Volume from position alone: trailing first, then leading. */
function positionalVolume(stem: string): number | null {
  for (const re of [/(\d+)\s*$/, /^\s*(\d+)\b/]) {
    const m = re.exec(stem);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Volume numbers for a whole directory at once, which is the only way to tell
 * a per-file marker from a series label.
 *
 * `volumeNumber` reads one filename and must prefer an explicit `vol` marker,
 * because a trailing number is often part of a chapter title:
 *
 *   Back Attacks Vol 1 - Straitjacket System      -> 1
 *   Back Attacks Vol 4 Workings of Straitjacket System 2  -> 4, not 2
 *
 * But the same rule collapses a whole series when the marker names the SERIES
 * and the trailing number names the file:
 *
 *   John Danaher Feet to Floor Vol.3 - 1
 *   John Danaher Feet to Floor Vol.3 - 2   ... through - 8
 *
 * All eight report volume 3. They then share one slug, so seven of the eight
 * were silently dropped from every mining run and their records overwrote each
 * other — the same invisible-skip class as #75, and it hid for as long as it
 * did because a collapsed series looks exactly like a series with one volume.
 *
 * Seen together the two cases separate cleanly: a marker that is IDENTICAL
 * across every file in the directory cannot be distinguishing them, so it is a
 * series label and position decides. A marker that varies is the volume.
 */
export function volumeNumbersForDirectory(
  stems: string[],
): Map<string, number | null> {
  const markers = stems.map((s) => MARKER_RE.exec(s)?.[1]);
  const seriesLabel =
    stems.length > 1 &&
    markers.every((m) => m !== undefined) &&
    new Set(markers).size === 1;

  const out = new Map<string, number | null>();
  for (const stem of stems) {
    out.set(stem, seriesLabel ? positionalVolume(stem) : volumeNumber(stem));
  }
  return out;
}
