import { env } from '@/config/env';
import { PIPELINE_CONFIG } from '@/constants/pipelineConfig';
import { CoachingService } from '@/services/CoachingService';
import type { ISportContext } from '@/sports/ISportContext';
import type { CoachingOutput, QualityGateResult } from '@/types/pipeline';
import { reportToMonitoring } from '@/utils/logger';

/** A single evaluation of a coaching output against the gate's rules. */
export interface GateEvaluation {
  passed: boolean;
  failureReasons: string[];
}

/**
 * Quality gate — the last line of defence before any coaching cue reaches the
 * UI. Three checks:
 *   1. Word count <= max (hard reject if over).
 *   2. Not generic — model `isGeneric` flag OR a match against the sport's
 *      generic-phrase blocklist.
 *   3. Confidence >= 0.6.
 *
 * On failure it retries with a stricter prompt up to QUALITY_GATE_RETRY_LIMIT.
 * If every retry fails it logs to monitoring and returns a safe fallback —
 * it never throws and never lets a bad cue through.
 */
export class QualityGateService {
  private readonly maxWords = PIPELINE_CONFIG.coachingCueMaxWords;
  private readonly minConfidence = PIPELINE_CONFIG.qualityGateMinConfidence;
  private readonly retryLimit = env.QUALITY_GATE_RETRY_LIMIT;
  private readonly enabled = PIPELINE_CONFIG.qualityGateEnabled;

  /**
   * Pure evaluation of one coaching output. Exported behaviour so it can be
   * unit-tested against every blocklist phrase without any network calls.
   */
  evaluate(
    coaching: CoachingOutput,
    sportContext: ISportContext,
  ): GateEvaluation {
    const failureReasons: string[] = [];

    if (CoachingService.exceedsWordCap(coaching.cue, this.maxWords)) {
      failureReasons.push(
        `cue exceeds ${this.maxWords}-word cap (${CoachingService.countWords(
          coaching.cue,
        )} words)`,
      );
    }

    if (coaching.cue.trim().length === 0) {
      failureReasons.push('cue is empty');
    }

    if (coaching.isGeneric) {
      failureReasons.push('model flagged cue as generic');
    }

    const lowerCue = coaching.cue.toLowerCase();
    const hit = sportContext.qualityGatePhrases.find((phrase) =>
      lowerCue.includes(phrase.toLowerCase()),
    );
    if (hit) {
      failureReasons.push(`cue contains generic phrase: "${hit}"`);
    }

    if (coaching.confidenceScore < this.minConfidence) {
      failureReasons.push(
        `confidence ${coaching.confidenceScore.toFixed(2)} below ${this.minConfidence}`,
      );
    }

    return { passed: failureReasons.length === 0, failureReasons };
  }

  /**
   * Run the gate with retries. `regenerate(strict)` produces a fresh coaching
   * output; the gate calls it with `strict=true` on each retry.
   */
  async enforce(
    initial: CoachingOutput,
    sportContext: ISportContext,
    regenerate: (strict: boolean) => Promise<CoachingOutput>,
  ): Promise<QualityGateResult> {
    // Gate disabled — pass through unchanged (still record attempts).
    if (!this.enabled) {
      return {
        passed: true,
        coaching: initial,
        attempts: 1,
        failureReasons: [],
        usedFallback: false,
      };
    }

    let current = initial;
    let lastReasons: string[] = [];
    let attempts = 1;

    // attempt 1 is `initial`; then up to retryLimit regenerations.
    for (let i = 0; i <= this.retryLimit; i++) {
      const evaluation = this.evaluate(current, sportContext);
      if (evaluation.passed) {
        return {
          passed: true,
          coaching: current,
          attempts,
          failureReasons: [],
          usedFallback: false,
        };
      }

      lastReasons = evaluation.failureReasons;
      if (i < this.retryLimit) {
        attempts++;
        current = await regenerate(true);
      }
    }

    // Every attempt failed — log and return a safe, capped fallback.
    reportToMonitoring('quality_gate_exhausted', {
      sport: sportContext.sportKey,
      attempts,
      failureReasons: lastReasons,
      lastCue: current.cue,
    });

    return {
      passed: false,
      coaching: this.buildFallback(),
      attempts,
      failureReasons: lastReasons,
      usedFallback: true,
    };
  }

  private buildFallback(): CoachingOutput {
    return {
      cue: CoachingService.truncateToWordCap(
        PIPELINE_CONFIG.fallbackCoachingCue,
        this.maxWords,
      ),
      targetPosition: 'general',
      confidenceScore: 0,
      isGeneric: true,
    };
  }
}
