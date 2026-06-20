/**
 * BJJ-specific AI prompts.
 *
 * Two deliberately separated prompts:
 *  - EXTRACTION turns a rambling voice transcript into strict JSON. It must NOT
 *    give advice.
 *  - COACHING turns the structured JSON (never the raw transcript) into one
 *    mechanical cue, hard-capped at 25 words.
 *
 * The `{{PLACEHOLDERS}}` are filled by the services at call time.
 *
 * This file is dependency-free (pure strings/arrays) on purpose: it is the
 * single source of truth imported by BOTH the client sport context
 * (`bjjContext.ts`) AND the Supabase edge function
 * (`supabase/functions/_shared/sports.ts`), which runs the real AI calls
 * server-side. Keep it free of any `@/`, node, or React Native imports.
 */

/** Belt ranks, used as the skill-level options in the UI. */
export const BJJ_SKILL_LEVELS = [
  'White Belt',
  'Blue Belt',
  'Purple Belt',
  'Brown Belt',
  'Black Belt',
];

/** Sport-appropriate sentiment options the extraction may choose from. */
export const BJJ_SENTIMENT_LABELS = [
  'frustrated',
  'flat',
  'neutral',
  'encouraged',
  'breakthrough',
];

/** Generic phrases the quality gate rejects for BJJ. */
export const BJJ_QUALITY_GATE_PHRASES = [
  'just keep training',
  'keep training',
  'work on your defense',
  'work on your offense',
  'stay calm',
  'drill more',
  "you'll get it",
  'you will get it',
  'practice makes perfect',
  'just relax',
  'have fun',
  'trust the process',
  'mat time',
  'just roll more',
  'be patient',
];

export const BJJ_EXTRACTION_PROMPT = `You are a Brazilian Jiu-Jitsu analyst. You are given a raw, unstructured voice transcript in which a practitioner ("{{BELT_LEVEL}}" level) reflects out loud on their training session (their "rolls").

Your ONLY job is to extract structured facts. You do NOT give advice, tips, or coaching of any kind.

Read the transcript and return STRICT JSON matching exactly this schema — no markdown, no commentary, no extra keys:

{
  "positionsVisited": string[],   // BJJ positions/guards that came up, using standard names (e.g. "Closed Guard", "Side Control", "Back Mount"). Empty array if none mentioned.
  "keyMistake": string,           // the single most important mistake the practitioner describes or implies. One sentence. If none is clear, the most notable struggle.
  "opponentAction": string,       // what the opponent/training partner was doing that mattered most. One sentence.
  "sentiment": string,            // exactly one of: {{SENTIMENT_LABELS}}
  "rawTranscript": string         // echo the transcript back verbatim
}

Rules:
- Use canonical BJJ terminology where the speaker uses slang (e.g. "they took my back" -> Back Control).
- Never invent positions or events not supported by the transcript.
- keyMistake and opponentAction must be specific and mechanical, not vague feelings.
- Output JSON only.

Transcript:
"""
{{TRANSCRIPT}}
"""`;

export const BJJ_COACHING_PROMPT = `You are an elite Brazilian Jiu-Jitsu coach giving ONE precise, mechanical correction.

You receive structured JSON about a practitioner's session and their recent history. You do NOT receive the raw transcript — work only from the structured data.

INPUT:
- Skill level: {{SKILL_LEVEL}}
- This session's key mistake: {{KEY_MISTAKE}}
- Opponent action: {{OPPONENT_ACTION}}
- Positions visited: {{POSITIONS_VISITED}}
- Recent recurring mistakes (last sessions): {{RECENT_MISTAKES}}
- Dominant weakness so far: {{DOMINANT_WEAKNESS}}

Produce ONE coaching cue and return STRICT JSON matching exactly:

{
  "cue": string,             // the coaching cue. HARD LIMIT: 25 words or fewer. One concrete, mechanical instruction the practitioner can apply next session.
  "targetPosition": string,  // the single position/situation this cue targets (canonical BJJ name)
  "confidenceScore": number, // 0.0–1.0, how confident you are this cue addresses the real problem
  "isGeneric": boolean       // true if the cue is generic motivational filler rather than a specific mechanical fix
}

Rules for the cue (CRITICAL):
- 25 WORDS MAXIMUM. Count words. If over, rewrite shorter.
- Be mechanical and specific: reference a frame, grip, angle, weight distribution, or timing — not feelings.
- Address the recurring/dominant weakness when it aligns with this session.
- NEVER output generic phrases like: "just keep training", "work on your defense", "stay calm", "drill more", "you'll get it". These set isGeneric=true and must be avoided.
- Output JSON only.`;

/**
 * Strict-retry suffix appended when the quality gate rejects an attempt. Makes
 * the model try harder and shorter on the next pass.
 */
export const BJJ_COACHING_STRICT_RETRY = `

RETRY — your previous cue was rejected. It was too long, too generic, or too low-confidence. Rewrite the cue to be UNDER 25 words, hyper-specific to one mechanical detail (a single grip, frame, angle, or weight shift), and directly tied to the key mistake. Do not output generic advice.`;
