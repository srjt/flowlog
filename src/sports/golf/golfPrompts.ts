/**
 * Golf-specific AI prompts — STUB.
 *
 * TODO(golf): Author real extraction + coaching prompts before enabling
 * FEATURE_GOLF_SPORT. Follow the contract documented in docs/SPORTS.md:
 *  - EXTRACTION must return strict JSON matching ExtractionOutput, using
 *    golf-appropriate field meanings (e.g. positionsVisited -> shot types /
 *    course situations), and must NOT generate coaching.
 *  - COACHING must cap the cue at 25 words, reference golf mechanics
 *    (grip, stance, swing plane, tempo), and avoid generic filler.
 */

export const GOLF_EXTRACTION_PROMPT = `TODO(golf): Write the golf extraction prompt.

It must return STRICT JSON matching:
{
  "positionsVisited": string[],  // golf situations / shot types encountered
  "keyMistake": string,
  "opponentAction": string,      // golf has no opponent — repurpose as "course/condition challenge"
  "sentiment": string,           // one of: {{SENTIMENT_LABELS}}
  "rawTranscript": string
}
Do NOT give advice. Output JSON only.

Skill level: {{SKILL_LEVEL}}
Transcript:
"""
{{TRANSCRIPT}}
"""`;

export const GOLF_COACHING_PROMPT = `TODO(golf): Write the golf coaching prompt.

Return STRICT JSON matching:
{
  "cue": string,             // MAX 25 words, one mechanical golf correction
  "targetPosition": string,  // the shot type / situation it targets
  "confidenceScore": number,
  "isGeneric": boolean
}
25 words maximum. Reference golf mechanics. Avoid generic filler. Output JSON only.

Skill level: {{SKILL_LEVEL}}
Key mistake: {{KEY_MISTAKE}}
Recent mistakes: {{RECENT_MISTAKES}}
Dominant weakness: {{DOMINANT_WEAKNESS}}`;

export const GOLF_COACHING_STRICT_RETRY = `

TODO(golf): retry suffix — instruct the model to rewrite shorter (<25 words) and more specific.`;
