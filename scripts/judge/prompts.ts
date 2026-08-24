/**
 * Judge prompts (issue #61).
 *
 * Two stages, deliberately separate: decompose, then check each claim on its
 * own. The prior-art research is explicit that holistic grounded grading sits
 * near chance against experts, while per-claim checking against a retrieved
 * passage is what reaches high agreement. A single "is this cue good?" call
 * would be the cheap version of this and would measure almost nothing.
 */

/**
 * Stage 1 — pull the cue apart into independently checkable assertions.
 *
 * The decomposer is told nothing about whether the cue is good. It is a
 * parsing job, and letting it form an opinion here would leak that opinion
 * into every claim it writes.
 */
export const DECOMPOSE_PROMPT = `You are decomposing a Brazilian Jiu-Jitsu coaching cue into atomic claims.

You are NOT judging the cue. Do not say whether it is good, correct, or useful. Your only
job is to split it into the separate assertions it makes, so each can be checked on its own.

POSITION: {{TARGET}}
CUE: "{{CUE}}"

Rules:
- One mechanic per claim. "Secure an underhook and crossface, then drive your hips" is
  THREE claims, not one.
- Write each claim as a standalone instruction that still makes sense on its own. Carry
  the position into the claim if the cue relied on context for it.
- Keep the cue's own meaning. Do not repair vague wording, do not add detail it did not
  give, and do not soften an instruction that is stated absolutely.
- Ignore filler that asserts nothing ("focus up", "be patient").
- If the cue makes no checkable instruction at all, return an empty array.

Return STRICT JSON, no markdown:
{"claims": ["...", "..."]}`;

/**
 * Stage 2 — check one claim.
 *
 * The mistake is in the prompt because half the defects in the labelled set
 * are cues that are individually true and aimed at the wrong problem. A check
 * that only asked "is this correct jiu-jitsu?" would pass every one of them.
 */
export const CHECK_CLAIM_PROMPT = `You are a Brazilian Jiu-Jitsu black belt checking ONE claim from a coaching cue.

POSITION: {{TARGET}}
WHAT WENT WRONG IN THE SESSION: {{KEY_MISTAKE}}
CLAIM TO CHECK: "{{CLAIM}}"
{{EVIDENCE}}

Classify the claim as exactly one of:

- "contradicted" — the claim is mechanically wrong, or impossible in the named position.
  This includes instructions that require a grip, limb, or angle that is not available
  from that position, and instructions that describe a different position's mechanics.
  Be concrete about what is impossible; a claim you merely dislike is not contradicted.

- "off_target" — the claim is correct jiu-jitsu, but it does not address what went wrong.
  Use this when the advice would not have changed the outcome described. A cue about
  finishing a sweep is off_target for a session about failing to enter one.

- "supported" — the claim is correct AND it addresses what went wrong.

- "unsupported" — you cannot tell. Use this when the claim is about a position or detail
  you have no reliable basis to assess.

Two rules that decide most cases:

1. **Silence is not contradiction.** If evidence is provided and does not mention this
   claim, that is "unsupported" or your own assessment — NOT "contradicted". The evidence
   is drawn from one instructional series and is full of gaps.

2. **Correct but useless is a real failure.** Do not stretch to call something supported
   because it is technically true. If it does not speak to the mistake, it is off_target.

Return STRICT JSON, no markdown:
{"status": "...", "reason": "one sentence, mechanical, no hedging"}`;

/** Rendered into `{{EVIDENCE}}` when the sufficiency gate passed. */
export function evidenceBlock(
  records: { prescription: string; why: string; detail: string }[],
): string {
  if (records.length === 0) {
    return `
EVIDENCE: none available. Judge the claim on your own knowledge of the position.`;
  }
  return `
EVIDENCE — how experienced instructors teach this position:
${records
  .map((r) =>
    [
      `- ${r.prescription}`,
      r.why && `  Why: ${r.why}`,
      r.detail && `  Detail: ${r.detail}`,
    ]
      .filter(Boolean)
      .join('\n'),
  )
  .join('\n')}

Remember: this evidence has gaps. A claim it does not mention is not thereby wrong.`;
}

export function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.split(`{{${k}}}`).join(v),
    template,
  );
}
