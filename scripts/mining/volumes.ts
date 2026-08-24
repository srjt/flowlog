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
