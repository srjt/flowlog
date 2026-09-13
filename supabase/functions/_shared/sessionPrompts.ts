// Store what the coaching model received (#121, migration 023).
//
// Best-effort by design. The prompt log exists for review after the fact; an
// athlete must never lose their Cue because the log could not be written — a
// missing migration, a transient network error, a payload too large. Failures
// are logged loudly instead, the same trade `updateUserTrends` makes.

import { dbInsertRows } from './supabaseRest.ts';
import {
  promptLogRows,
  type CoachingAttempt,
  type PromptRun,
} from '../../../src/services/promptLog.ts';

export async function storeCoachingPrompts<T>(
  sessionId: string,
  run: PromptRun,
  attempts: CoachingAttempt<T>[],
  gate: { usedFallback: boolean; coaching: unknown },
): Promise<void> {
  const rows = promptLogRows(
    { sessionId, runId: crypto.randomUUID(), run },
    attempts,
    // Identity with an attempt's output is how the kept attempt is found. The
    // fallback Cue is a fresh object that matches none, but say so explicitly.
    gate.usedFallback ? null : (gate.coaching as T),
  );
  try {
    await dbInsertRows('session_prompts', rows);
  } catch (err) {
    console.error(
      `[flowlog] storing coaching prompts failed (non-fatal) [session=${sessionId}]:`,
      (err as Error)?.message,
    );
  }
}
