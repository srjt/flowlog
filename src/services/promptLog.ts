/**
 * What the coaching model actually received, per attempt (#121).
 *
 * The Cue on a Session comes from one of up to three coaching attempts — the
 * first, or a strict retry after the quality gate rejected the one before — or
 * from none of them, when every attempt failed and the gate substituted its
 * safe fallback. Rebuilding that prompt afterwards is not possible: skill
 * level, recent mistakes and dominant weakness are read at generation time and
 * never stored, and publishing edits record text in place. So the prompt is
 * kept exactly as sent, in `session_prompts` (migration 023).
 *
 * Dependency-free with no imports, like `pagedSelect.ts`: the edge function
 * imports it, and Jest tests it.
 */

export interface SentPrompt {
  /** Exactly the text sent to the model, strict-retry suffix included. */
  prompt: string;
  provider: string;
  model: string;
}

export type PromptRun = 'insert' | 'reanalysis';

export interface CoachingAttempt<T> {
  strict: boolean;
  sent: SentPrompt;
  output: T;
}

/** One `session_prompts` row. */
export interface SessionPromptRow {
  session_id: string;
  run_id: string;
  run: PromptRun;
  attempt: number;
  strict: boolean;
  produced_cue: boolean;
  provider: string;
  model: string;
  prompt: string;
}

/**
 * Wraps a coaching call so every attempt is kept, in order.
 *
 * Call `coach(false)` for the first attempt and hand `coach` to the quality
 * gate as its regenerate callback, so the gate's retries are recorded by the
 * same path as the first attempt rather than by a second one that can drift.
 */
export function recordAttempts<T extends { sent: SentPrompt }>(
  generate: (strict: boolean) => Promise<T>,
): {
  coach: (strict: boolean) => Promise<T>;
  attempts: CoachingAttempt<T>[];
} {
  const attempts: CoachingAttempt<T>[] = [];
  const coach = async (strict: boolean): Promise<T> => {
    const output = await generate(strict);
    attempts.push({ strict, sent: output.sent, output });
    return output;
  };
  return { coach, attempts };
}

/**
 * Rows for every attempt of one run.
 *
 * `kept` is the output the quality gate returned, or null when it fell back.
 * Matched by identity, not by text: two attempts can return the same cue, and
 * only the one the gate actually kept produced it. On a fallback no attempt
 * produced the Cue, and every row says so.
 */
export function promptLogRows<T>(
  ids: { sessionId: string; runId: string; run: PromptRun },
  attempts: CoachingAttempt<T>[],
  kept: T | null,
): SessionPromptRow[] {
  return attempts.map((a, i) => ({
    session_id: ids.sessionId,
    run_id: ids.runId,
    run: ids.run,
    attempt: i + 1,
    strict: a.strict,
    produced_cue: kept !== null && a.output === kept,
    provider: a.sent.provider,
    model: a.sent.model,
    prompt: a.sent.prompt,
  }));
}
