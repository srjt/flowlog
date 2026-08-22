/**
 * Assembling the mining prompt.
 *
 * The job asked of the model is EXTRACTION, not recall: read the passage in
 * front of you and report what it says. That is the low-risk direction, and it
 * is why every record must carry a verbatim quote — the quote is what makes the
 * claim checkable in ten seconds by someone who knows no jiu-jitsu.
 *
 * Pure — returns a string — so the prompt is inspectable and testable without
 * spending an API call.
 */

import { BJJ_POSITIONS } from '../../src/sports/bjj/bjjPositions.ts';
import type { Chapter, TranscriptLine } from './transcript.ts';

export interface VolumeMeta {
  instructor: string;
  instructional: string;
  volume: number;
}

/**
 * Common transcription errors in the corpus, corrected inline rather than by
 * re-transcribing. Position names survive at roughly 98%; these are the
 * sporadic ones worth naming so the model is not confused by them.
 */
export const KNOWN_TRANSCRIPTION_ERRORS: [string, string][] = [
  ['juditsu', 'jiu-jitsu'],
  ['multi-position', 'mounted position'],
  ['geese leaf', 'gi sleeve'],
  ['the scene that runs', 'the seam that runs'],
];

export function applyCorrections(text: string): string {
  let out = text;
  for (const [wrong, right] of KNOWN_TRANSCRIPTION_ERRORS) {
    out = out.replaceAll(new RegExp(wrong, 'gi'), right);
  }
  return out;
}

/** The transcript as the model sees it: one line per second-stamped segment. */
export function renderTranscript(lines: TranscriptLine[]): string {
  return lines
    .map((l) => `[${l.startSeconds}] ${applyCorrections(l.text)}`)
    .join('\n');
}

export function buildMiningPrompt(
  meta: VolumeMeta,
  lines: TranscriptLine[],
  chapters: Chapter[],
): string {
  const positionIds = BJJ_POSITIONS.map((p) => `${p.id}  (${p.label})`).join(
    '\n',
  );
  const chapterList = chapters.length
    ? chapters.map((c) => `[${c.startSeconds}] ${c.title}`).join('\n')
    : '(this volume ships no chapter index)';

  return `You are reading a transcript of a Brazilian Jiu-Jitsu instructional and extracting its teaching points as structured records.

This is an EXTRACTION task. Report what the transcript says. Do not add jiu-jitsu knowledge of your own, do not smooth over what the instructor actually claims, and do not invent detail that is not spoken.

SOURCE
Instructor: ${meta.instructor}
Instructional: ${meta.instructional}
Volume: ${meta.volume}

The transcript is auto-transcribed and imperfect. Terminology is mostly intact; occasional words are mangled. Read through obvious errors rather than treating them as content.

Each line is prefixed with its start time in seconds: [1234] spoken text.

CHAPTER INDEX (hand-authored; use it to place records, not to bound them)
${chapterList}

POSITION VOCABULARY — closed set. A record's "position" MUST be exactly one of these ids.
Perspective is part of the identity: "top" is the controlling role (holding a pin, passing, on the back), "bottom" is the contained role (pinned, playing guard, back taken). Escape material is almost always "bottom".
If a teaching point does not fit any id below, DROP the record rather than forcing it.

${positionIds}

WHAT TO EXTRACT

One record per distinct teaching point. A volume typically yields dozens. Be exhaustive — work through the whole transcript in order, not just the parts that summarise well. It is better to return many specific records than a few broad ones.

Return STRICT JSON: an array of objects, no markdown, no commentary.

[
  {
    "position": string,        // exactly one id from the vocabulary above
    "prescription": string,    // what the instructor says TO DO, or NOT to do. One or two sentences. Instructors usually phrase mistakes as prohibitions ("never bridge straight up") — capture that as the prescription. Do NOT emit a separate "mistake" field.
    "why": string,             // why it works, or why the alternative fails. This is the most valuable field — capture the instructor's reasoning, not just the instruction.
    "detail": string,          // the concrete mechanical specific: a grip, an angle, a weight shift, a foot position
    "counter": string,         // what the opponent does to defeat it, if the instructor says. Empty string otherwise.
    "preconditions": {
      "gi": "gi" | "no-gi" | "either",        // "gi" if it depends on grips on cloth
      "level": "beginner" | "intermediate" | "advanced" | "any",
      "opponent": string                       // what the opponent must be doing for this to apply. Empty string if unconditional.
    },
    "quote": string,           // VERBATIM from the transcript, 1-3 sentences, backing the prescription. Copy it exactly. Do not paraphrase, tidy, or correct it.
    "startSeconds": number     // the [n] prefix of the line the quote starts on
  }
]

RULES

- "quote" must appear verbatim in the transcript. It is the only thing that makes a record checkable. A record whose quote does not support its prescription is worse than no record.
- Capture PRECONDITIONS carefully. Instructors frequently teach something while saying it only works at a certain level or against a certain reaction — an instructional in this series teaches a mount escape while stating plainly that it does not work at high level. A record that loses that qualification contradicts other records for the same position.
- Prefer the instructor's own words and emphasis over a tidy summary.
- Leave a field as an empty string when the transcript does not supply it. Do not pad.
- Output JSON only.

TRANSCRIPT

${renderTranscript(lines)}`;
}
