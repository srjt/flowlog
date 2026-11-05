import { env } from '@/config/env';

/**
 * Pipeline tuning constants. Values that affect behaviour are sourced from
 * `env` so they stay configurable; values here are tuning defaults and pricing
 * estimates used for cost monitoring.
 */
/**
 * The `pipeline_version` stamp the reference `FlowlogPipeline` writes on the
 * rows it creates or re-analyses. Production rows come from the edge function;
 * this value only reaches local-test mode (`EXPO_PUBLIC_LOCAL_PIPELINE`, an
 * in-memory store) and tests.
 *
 * It is a claim about behaviour, not a build number. Migrations 019–021 and
 * the admin review's `recordTrail` decide what a row's grounding columns mean
 * from this value, so it must name the behaviour of the code that wrote the
 * row. The version history lives beside `PIPELINE_VERSION` in
 * `supabase/functions/process-session/index.ts`; this pipeline mirrors that
 * function, so the two values are identical:
 *
 *   1.2.0  `grounding_candidates` is an exact count, never a truncated fetch.
 *          Client-side `getCoachingRecords` has no row cap to truncate at.
 *   1.3.0  re-analysis writes the grounding columns it changes the truth of
 *          and honours the inherited arm (#117 brought this to the client).
 *
 * `tests/unit/groundingFetch.test.ts` fails if the two values differ. When a
 * fix bumps the edge version, make the same change here (or say why this
 * pipeline does not do it) in the same commit.
 */
export const PIPELINE_VERSION = '1.3.0';

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
  /**
   * Safe message returned when the quality gate exhausts all retries.
   * Deliberately avoids every phrase in a sport's `qualityGatePhrases` — this
   * text bypasses the gate, so it must not contain what the gate rejects.
   */
  fallbackCoachingCue:
    'Pick one detail from this session and drill it deliberately next time. Ask your coach to watch that specific moment.',
  /**
   * Backstop for the sufficiency check (issue #44). Extraction judges whether a
   * transcript has anything to coach on; this word floor is insurance for when
   * that judgement is fooled or the provider omits the field. It is a crude
   * proxy on purpose — it cannot be talked out of its answer the way a model can.
   *
   * Deliberately LOW. The two checks have different jobs: the floor catches
   * "there is almost nothing here", the model catches "there are words but no
   * content" (feelings only, a plan rather than a session). A floor high enough
   * to catch the second kind also throws away genuine terse reflections —
   * "I kept getting stuck in turtle and gave up my back" is 11 words and
   * perfectly coachable. 8 is under the length of any real reflection that
   * names a position and a problem.
   */
  minTranscriptWords: 8,
  /**
   * Share of eligible sessions that receive grounded cues (#57).
   *
   * Only sessions that actually have matching records are eligible, so the
   * remainder become the control arm — "had records, withheld them" — which is
   * the counterfactual the comparison needs. Raise toward 1 once the experiment
   * shows grounding wins; drop to 0 to disable grounding without a revert.
   */
  groundingRollout: 0.5,
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
