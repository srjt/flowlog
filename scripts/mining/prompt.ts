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

- "quote" must appear VERBATIM in the transcript — copy the characters, do not tidy grammar, do not merge sentences from different moments. It is the only thing that makes a record checkable. A record whose quote does not support its prescription is worse than no record.
- Prefer the instructor's own words and emphasis over a tidy summary.
- Leave a field as an empty string when the transcript does not supply it. Do not pad.
- Output JSON only.

PRECONDITIONS — the most commonly under-filled part. Read this twice.

When an instructor qualifies WHO a technique is for, or WHEN it works, that
qualification belongs in the structured "preconditions" fields — NOT only in the prose
of "prescription" or "why". A qualification left in prose is invisible to everything
downstream, and two records for the same position then look like they contradict each
other when they were simply describing different circumstances.

"level" — set it whenever the instructor signals who the advice is for. Do not default to
"any" out of caution. Signals include "when you're starting out", "at beginner level",
"at high level this won't work", "against a good opponent", "in competition". This volume
contains a clear case: the instructor teaches the bridging escape from mount while saying
plainly that it does not work at high level and is taught to build body movement. The
record for that must be level "beginner" — not "any".

"gi" — set "gi" whenever the mechanic depends on gripping cloth: a sleeve, a lapel, a
collar, a seam, a pant leg. This is a gi instructional and many escapes are grip-dependent.
Only use "either" when the technique genuinely works without a jacket.

"opponent" — what the opponent must be doing for this to apply: their posture, their grips,
their weight, the reaction they just gave you. Most techniques are taught as answers to a
specific situation; name it.

ABSOLUTES MUST BE SCOPED — ANYWHERE IN THE SENTENCE. If a prescription contains
"always", "never", "must", "do not" or "avoid" — in the main clause, a trailing clause, or
a second sentence — the "opponent" field is REQUIRED.

This is the part that gets missed. These all need a scope, and the absolute is not the
first thing said:

  "Lever your two knees in the direction you want to sweep. Do not bridge."
  "Always play the dilemma between the knee lever and the butterfly hook."
  "Never stay flat on your back in deep half guard; maintain a constant angle."

Scoping the main instruction is not enough. If ANY part of the record tells the reader to
always or never do something, name the situation it applies in. An unconditional instruction with no stated
scope cannot be reconciled with one that says the opposite, and both will reach the same
cue. This is a real collision, not a hypothetical:

  "Do not worry about connecting your knee and elbow when playing a LOW knee shield."
  "Always keep your knee and elbow connected when playing a HIGH knee shield."

Both are correct as taught. Neither says so in "opponent", so together they are a coin
flip. The qualifier was RIGHT THERE in the sentence — "when playing a low knee shield" —
and belongs in the structured field as well as the prose.

Do NOT soften the instruction to avoid this. "Never play with an underhook while
maintaining a knee shield" is real coaching and must stay absolute. Scope it, do not
hedge it.

If the instructor genuinely states something with no condition at all — a universal
principle of the position — leave "opponent" empty and keep the absolute. That is a real
category; just make sure it is genuinely unconditional rather than a qualifier you failed
to capture.

COUNTER — the most under-filled field.

Instructors state the counter constantly, and rarely as a heading. Capture it whenever it
is spoken, in any of these shapes:

  - the opponent's reaction:  "he'll base out with his free hand"
  - the conditional failure:  "if he posts, this won't work"
  - the thing you must beat:  "his whole job is to get that underhook back"
  - the pre-emption:          "before he can bring his knee in, you have to..."

Two rules decide most cases:

1. A counter is what the OPPONENT does to stop you, not your next step. "Then you switch
   to the far-side armbar" is not a counter; "he hides the far arm, so you switch to the
   far-side armbar" is — the counter is the hiding.
2. The counter is often spoken BEFORE the technique, as the reason for it: "everybody
   loses this position because he pummels back in, so what we do is...". That opening
   clause is the counter for the record that follows.

Leave "counter" empty only when the instructor genuinely never says how the move gets
stopped.

TRANSCRIPT

${renderTranscript(lines)}`;
}
