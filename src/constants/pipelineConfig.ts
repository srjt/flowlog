import { env } from '@/config/env';

/**
 * Pipeline tuning constants. Values that affect behaviour are sourced from
 * `env` so they stay configurable; values here are tuning defaults and pricing
 * estimates used for cost monitoring.
 */
export const PIPELINE_VERSION = '1.0.0';

export const PIPELINE_CONFIG = {
  /** Hard cap on coaching cue length. Enforced in service AND prompt. */
  coachingCueMaxWords: env.COACHING_CUE_MAX_WORDS,
  /** Quality gate confidence floor. */
  qualityGateMinConfidence: 0.6,
  qualityGateEnabled: env.QUALITY_GATE_ENABLED,
  qualityGateRetryLimit: env.QUALITY_GATE_RETRY_LIMIT,
  /** Recording bounds (seconds). Pipeline rejects audio below the minimum. */
  minRecordingSeconds: env.MIN_RECORDING_SECONDS,
  maxRecordingSeconds: env.MAX_RECORDING_SECONDS,
  /** How many recent mistakes feed the coaching prompt. */
  recentMistakesWindow: 5,
  /** Safe message returned when the quality gate exhausts all retries. */
  fallbackCoachingCue:
    'Focus on one thing next session: stay calm and move deliberately. Review this roll with your coach.',
} as const;

/**
 * Per-call pricing estimates (USD). Used for development cost logging so cost
 * regressions are visible before they hit production billing. Update when
 * provider pricing changes.
 */
export const COST_ESTIMATES = {
  /** Whisper: $0.006 / minute of audio. */
  whisperPerMinute: 0.006,
  /** Claude Sonnet: rough blended estimate per extraction call. */
  claudeExtractionPerCall: 0.004,
  /** Claude Sonnet: rough blended estimate per coaching call. */
  claudeCoachingPerCall: 0.003,
  /** Alert threshold — integration tests flag if a session exceeds this. */
  perSessionAlertThreshold: 0.03,
  /** Target cost per session at current pricing. */
  perSessionTarget: 0.02,
} as const;
