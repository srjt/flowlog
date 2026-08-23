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
const VOLUME_RE = /^VOLUME\s+(\d+)\s*$/i;

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

    const m = CHAPTER_RE.exec(trimmed);
    if (!m) continue;
    const [, h, mm, ss, title] = m;
    chapters.push({
      startSeconds: h
        ? Number(h) * 3600 + Number(mm) * 60 + Number(ss)
        : Number(mm) * 60 + Number(ss),
      title: (title ?? '').trim(),
      volume,
    });
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
  return current;
}

/** `H:MM:SS`, the form used in record provenance. */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
