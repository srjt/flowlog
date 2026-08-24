/**
 * The cue judge (issue #61).
 *
 * Orchestration only: the sufficiency gate, the decomposition, and the
 * per-claim checks are each their own piece, and the model call is injected so
 * the whole flow can be exercised in tests without spending a token.
 */

import {
  CHECK_CLAIM_PROMPT,
  DECOMPOSE_PROMPT,
  evidenceBlock,
  fill,
} from './prompts.ts';
import { checkSufficiency } from './sufficiency.ts';
import type {
  ClaimCheck,
  ClaimStatus,
  CueJudgement,
  JudgeSubject,
} from './types.ts';
import { judgeFromClaims } from './verdict.ts';
import type { GroundableRecord } from '../../src/sports/grounding.ts';

/** A model call. Returns raw text; the judge parses it. */
export type Complete = (prompt: string) => Promise<string>;

const STATUSES: ClaimStatus[] = [
  'supported',
  'contradicted',
  'off_target',
  'unsupported',
];

/**
 * Parse a model response that is supposed to be JSON.
 *
 * Tolerant of fencing, because a judge that crashes on a stray ```json is a
 * judge that silently drops evidence. Returns null rather than throwing so the
 * caller can decide what an unparseable response means.
 */
export function parseJson<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Constrain a model-reported status.
 *
 * Anything unrecognised becomes `unsupported`, never `contradicted`. A judge
 * that turns its own parse failures into accusations would post recall it has
 * not earned, which is precisely the kind of number this exercise exists to
 * avoid producing.
 */
export function normaliseStatus(value: unknown): ClaimStatus {
  return STATUSES.includes(value as ClaimStatus)
    ? (value as ClaimStatus)
    : 'unsupported';
}

export async function judgeCue(
  subject: JudgeSubject,
  records: GroundableRecord[],
  complete: Complete,
): Promise<CueJudgement> {
  const gate = checkSufficiency(records, subject.keyMistake);
  const evidence = gate.sufficient
    ? evidenceBlock(gate.records)
    : evidenceBlock([]);

  const decomposed = parseJson<{ claims?: unknown }>(
    await complete(
      fill(DECOMPOSE_PROMPT, { TARGET: subject.target, CUE: subject.cue }),
    ),
  );
  const claims = Array.isArray(decomposed?.claims)
    ? decomposed.claims.filter(
        (c): c is string => typeof c === 'string' && c.trim() !== '',
      )
    : [];

  // Checked one at a time, not in a batch. Handing the model every claim at
  // once invites it to grade the cue as a whole and back-fill the parts, which
  // is the holistic grading the research found sits near chance.
  const checks: ClaimCheck[] = [];
  for (const claim of claims) {
    const raw = await complete(
      fill(CHECK_CLAIM_PROMPT, {
        TARGET: subject.target,
        KEY_MISTAKE: subject.keyMistake || '(the session did not state one)',
        CLAIM: claim,
        EVIDENCE: evidence,
      }),
    );
    const parsed = parseJson<{ status?: unknown; reason?: unknown }>(raw);
    checks.push({
      claim,
      status: normaliseStatus(parsed?.status),
      reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
    });
  }

  const { defective, rationale } = judgeFromClaims(checks);
  return {
    sessionId: subject.sessionId,
    mode: gate.sufficient ? 'grounded' : 'ungrounded',
    recordsAvailable: gate.records.length,
    claims: checks,
    defective,
    rationale,
  };
}
