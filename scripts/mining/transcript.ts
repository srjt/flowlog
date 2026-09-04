/**
 * Parsing the raw corpus: timestamped transcripts and chapter indexes.
 *
 * Pure functions only — no filesystem, no network — so the awkward parts are
 * unit-testable without a corpus present.
 */

/** One transcript line with the time it was spoken. */
export interface TranscriptLine {
  /** Seconds from the start of the volume. */
  startSeconds: number;
  text: string;
}

/** One chapter from a hand-authored index, if the title ships one. */
export interface Chapter {
  startSeconds: number;
  title: string;
  /** Volume number when the index covers several volumes in one file. */
  volume: number | null;
  /**
   * End of the chapter, when the index states a range.
   *
   * Absent for the `MM:SS - Title` form, where a chapter is assumed to run
   * until the next one starts. A stated end is strictly better: it bounds the
   * LAST chapter (otherwise open to infinity) and it makes gaps visible —
   * material that belongs to no chapter is material a chapter-bounded reader
   * would skip.
   */
  endSeconds?: number;
}

const LINE_RE = /^\[(\d+):(\d{2}):(\d{2})(?:\.\d+)?\s*->\s*[^\]]+\]\s*(.*)$/;

/**
 * Parse a transcript produced by `scripts/transcribe.py --timestamps`.
 *
 * Lines that carry no timestamp are kept and attributed to the previous
 * timestamp — dropping them would silently lose content, and the whole point of
 * mining is that nothing worth quoting disappears.
 */
export function parseTranscript(raw: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = LINE_RE.exec(trimmed);
    if (m) {
      const [, h, mm, ss, text] = m;
      out.push({
        startSeconds: Number(h) * 3600 + Number(mm) * 60 + Number(ss),
        text: (text ?? '').trim(),
      });
    } else if (out.length > 0) {
      const prev = out[out.length - 1]!;
      prev.text += ' ' + trimmed;
    } else {
      out.push({ startSeconds: 0, text: trimmed });
    }
  }
  return out;
}

const CHAPTER_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—]\s*(.+?)\s*$/;

/**
 * The third convention: timestamp first, separated by SPACE rather than a dash.
 *
 *   00:00:00 Introduction To Feet To Floor Volume 1
 *   01:40:55 The Second Precursor Skill: Fighting For A Grip - Understanding...
 *
 * Tried only after the dash form, so a title that itself contains a dash still
 * parses correctly — the dash rule requires the separator immediately after
 * the timestamp, which this format never has.
 *
 * Missing this cost a whole box: Feet to Floor Volume 1 ships a well-formed
 * 8-volume index and the miner reported "no chapter index", falling back to
 * fixed windows and losing the completeness check. An index that silently does
 * not parse is worse than an absent one, because nothing says so.
 */
const CHAPTER_SPACE_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(\S.*?)\s*$/;

/**
 * The other convention in the wild: title first, then a start-end range.
 *
 *   Escapes Overview<TAB>6:56 - 43:37
 *   Bridging<TAB>1:25:21 - 1:33:00
 *
 * Distinguishable from `CHAPTER_RE` without ambiguity because the timestamps
 * are at the END of the line rather than the start, so the two are tried in
 * order and cannot both match a well-formed line.
 */
const RANGE_CHAPTER_RE =
  /^(.+?)[\t ]+(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—]\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*$/;

/**
 * Volume headers, in both the bare and the titled form:
 *   VOLUME 3
 *   Volume 01: Pin Escapes & Turtle Escapes 1
 */
const VOLUME_RE = /^VOL(?:UME)?\s*\.?\s*(\d+)\s*(?::.*)?$/i;

/** Column headers in a pasted table. Not chapters, and must not become one. */
const HEADER_RE = /^(chapter\s*title|start\s*time|end\s*time|title|time)$/i;

const hms = (h: string | undefined, m: string, s: string) =>
  (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s);

/**
 * Parse a hand-authored chapter index.
 *
 * Roughly a third of the library ships one, and where present it is far better
 * than anything inferred: real boundaries, and titles that are already position
 * labels. Absence is normal and must not be treated as an error — the caller
 * simply mines without chapter tags.
 *
 * Handles the `MM:SS - Title` / `HH:MM:SS - Title` form, optionally grouped
 * under `VOLUME n` headers. The HTML table form some titles use is not
 * supported yet; it returns nothing rather than half-parsing.
 */
export function parseChapterIndex(raw: string): Chapter[] {
  const chapters: Chapter[] = [];
  let volume: number | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const vol = VOLUME_RE.exec(trimmed);
    if (vol) {
      volume = Number(vol[1]);
      continue;
    }

    if (HEADER_RE.test(trimmed)) continue;

    const m = CHAPTER_RE.exec(trimmed) ?? CHAPTER_SPACE_RE.exec(trimmed);
    if (m) {
      const [, h, mm, ss, title] = m;
      chapters.push({
        startSeconds: hms(h, mm!, ss!),
        title: (title ?? '').trim(),
        volume,
      });
      continue;
    }

    const r = RANGE_CHAPTER_RE.exec(trimmed);
    if (r) {
      const [, title, sh, sm, ss, eh, em, es] = r;
      const startSeconds = hms(sh, sm!, ss!);
      const endSeconds = hms(eh, em!, es!);
      // A range that runs backwards is a mis-parse, not a chapter — most
      // likely a title that itself ended in something time-shaped.
      if (endSeconds <= startSeconds) continue;
      chapters.push({
        startSeconds,
        title: (title ?? '').trim(),
        volume,
        endSeconds,
      });
    }
  }
  return chapters;
}

/**
 * Chapters belonging to one volume, ordered. When the index has no volume
 * headers every chapter is returned — a single-volume index.
 */
export function chaptersForVolume(
  chapters: Chapter[],
  volume: number,
): Chapter[] {
  const scoped = chapters.some((c) => c.volume !== null)
    ? chapters.filter((c) => c.volume === volume)
    : chapters;
  return [...scoped].sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Which chapter a moment falls in. Null when there is no index. */
export function chapterAt(
  chapters: Chapter[],
  seconds: number,
): Chapter | null {
  let current: Chapter | null = null;
  for (const c of chapters) {
    if (c.startSeconds <= seconds) current = c;
    else break;
  }
  // A stated end is a real boundary. Without one a chapter runs until the next
  // begins, which is the right assumption; with one, a moment past the end sits
  // in a gap the index deliberately left, and belongs to no chapter. Claiming
  // it for the previous chapter would mislabel provenance.
  if (current?.endSeconds !== undefined && seconds >= current.endSeconds) {
    return null;
  }
  return current;
}

/** `H:MM:SS`, the form used in record provenance. */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Split a volume into time windows for chunked mining.
 *
 * Whole-volume mining asks one question: "read 17,000 tokens and exhaust
 * them." A frontier model does that. A local one summarises instead — it
 * returned 58% of Gemini's records on the same volume — and its quotes drift,
 * because copying a sentence exactly out of 17,000 tokens is a retrieval
 * problem that gets harder with distance.
 *
 * Chunking turns one hard question into eight easy ones. It costs more prefill
 * (the instruction preamble repeats per chunk) which is why it is not the
 * default for a metered provider — but prefill is the cheap half locally, and
 * a local run has no per-token bill to trade against.
 *
 * Windows break on chapter boundaries where the title ships an index, so a
 * technique is not cut in half; otherwise on a fixed span.
 */
export function chunkLines(
  lines: TranscriptLine[],
  chapters: Chapter[],
  windowSeconds: number,
): TranscriptLine[][] {
  if (lines.length === 0) return [];

  const first = lines[0]!.startSeconds;
  const last = lines[lines.length - 1]!.startSeconds;
  const boundaries: number[] = [];

  if (chapters.length > 1) {
    // Chapter starts are the PREFERRED place to break, not the only one.
    //
    // The first version broke at the first boundary at or after the target,
    // which overshoots badly: chapters averaging five minutes produced 9-12
    // minute windows against an eight minute target, and the model summarised
    // them. On one volume that cost more than half the records — 18 against 33
    // — and collapsed three positions into one. An over-long window is the
    // exact failure chunking exists to prevent, so a tidy boundary is not
    // worth buying it.
    //
    // Take the boundary CLOSEST to the target, before or after, and cut
    // mid-chapter when no boundary is near enough.
    const cap = windowSeconds * 1.25;
    const starts = chapters.map((c) => c.startSeconds);
    let windowStart = first;
    while (windowStart + windowSeconds < last) {
      const target = windowStart + windowSeconds;
      let best: number | null = null;
      for (const b of starts) {
        if (b <= windowStart || b > windowStart + cap) continue;
        if (best === null || Math.abs(b - target) < Math.abs(best - target)) {
          best = b;
        }
      }
      const next = best ?? target;
      boundaries.push(next);
      windowStart = next;
    }
  } else {
    for (let t = first + windowSeconds; t < last; t += windowSeconds) {
      boundaries.push(t);
    }
  }

  const chunks: TranscriptLine[][] = [[]];
  let next = 0;
  for (const line of lines) {
    while (next < boundaries.length && line.startSeconds >= boundaries[next]!) {
      chunks.push([]);
      next++;
    }
    chunks[chunks.length - 1]!.push(line);
  }
  return chunks.filter((c) => c.length > 0);
}
