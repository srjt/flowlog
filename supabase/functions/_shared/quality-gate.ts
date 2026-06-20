// Server-side quality gate. Mirrors `src/services/QualityGateService.ts`:
// word-cap, generic-phrase blocklist, model `isGeneric` flag, confidence floor,
// with stricter retries and a safe fallback that never throws.

import type { ServerSportContext } from './sports.ts';
import type { CoachingOutput } from './types.ts';

const MIN_CONFIDENCE = 0.6;
const FALLBACK_CUE =
  'Focus on one thing next session: stay calm and move deliberately. Review this roll with your coach.';

export function countWords(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

export function evaluate(
  coaching: CoachingOutput,
  sport: ServerSportContext,
  maxWords: number,
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (countWords(coaching.cue) > maxWords) {
    reasons.push(`cue exceeds ${maxWords}-word cap`);
  }
  if (coaching.cue.trim().length === 0) reasons.push('cue is empty');
  if (coaching.isGeneric) reasons.push('model flagged cue as generic');
  const lower = coaching.cue.toLowerCase();
  const hit = sport.qualityGatePhrases.find((p) =>
    lower.includes(p.toLowerCase()),
  );
  if (hit) reasons.push(`cue contains generic phrase: "${hit}"`);
  if (coaching.confidenceScore < MIN_CONFIDENCE) {
    reasons.push(`confidence below ${MIN_CONFIDENCE}`);
  }
  return { passed: reasons.length === 0, reasons };
}

export interface GateResult {
  passed: boolean;
  coaching: CoachingOutput;
  attempts: number;
  usedFallback: boolean;
}

export async function enforce(
  initial: CoachingOutput,
  sport: ServerSportContext,
  maxWords: number,
  retryLimit: number,
  regenerate: (strict: boolean) => Promise<CoachingOutput>,
): Promise<GateResult> {
  let current = initial;
  let attempts = 1;
  for (let i = 0; i <= retryLimit; i++) {
    if (evaluate(current, sport, maxWords).passed) {
      return { passed: true, coaching: current, attempts, usedFallback: false };
    }
    if (i < retryLimit) {
      attempts++;
      current = await regenerate(true);
    }
  }
  const words = FALLBACK_CUE.trim().split(/\s+/);
  return {
    passed: false,
    coaching: {
      cue: words.slice(0, maxWords).join(' '),
      targetPosition: 'general',
      confidenceScore: 0,
      isGeneric: true,
    },
    attempts,
    usedFallback: true,
  };
}
