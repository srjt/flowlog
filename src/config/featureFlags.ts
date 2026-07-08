import { env } from '@/config/env';

/**
 * Feature flags — the single auditable place that maps env-configured flags to
 * runtime booleans. UI and pipeline code read flags from here, never from env
 * or process.env directly.
 *
 * Some flags are additionally gated by progression (e.g. trend analysis unlocks
 * after 10 sessions). Use the helper guards for those so the unlock rule lives
 * in one place.
 */
export const featureFlags = {
  trendAnalysis: env.FEATURE_TREND_ANALYSIS,
  gameProfile: env.FEATURE_GAME_PROFILE,
  social: env.FEATURE_SOCIAL,
  videoIntegration: env.FEATURE_VIDEO_INTEGRATION,
  golfSport: env.FEATURE_GOLF_SPORT,
} as const;

/**
 * Demo mode: when on, the pipeline returns canned results locally (no audio
 * upload, no edge function, no API keys). Use it to prototype the full
 * Record → Processing → Output → Log flow entirely offline.
 */
export const isDemoMode: boolean = env.DEMO_MODE;

/**
 * Local TEST pipeline: run real transcription + AI directly in the client using
 * EXPO_PUBLIC keys (no Supabase / edge function). Local testing only — keys are
 * in the client bundle. Demo mode takes precedence if both are on.
 */
export const isLocalPipeline: boolean = env.LOCAL_PIPELINE;

/**
 * Auth bypass: on when a fixed test account's credentials are configured.
 * TEMPORARY, TESTING ONLY — see env.ts for the full rationale.
 */
export const isAuthBypass: boolean = Boolean(
  env.AUTH_BYPASS_EMAIL && env.AUTH_BYPASS_PASSWORD,
);

export type FeatureFlag = keyof typeof featureFlags;

/** Sessions required before progression-gated features unlock. */
export const SESSIONS_TO_UNLOCK = 10;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}

/** Trend analysis requires both the flag AND enough completed sessions. */
export function canUseTrendAnalysis(sessionCount: number): boolean {
  return featureFlags.trendAnalysis && sessionCount >= SESSIONS_TO_UNLOCK;
}

/** Game profile requires both the flag AND enough completed sessions. */
export function canUseGameProfile(sessionCount: number): boolean {
  return featureFlags.gameProfile && sessionCount >= SESSIONS_TO_UNLOCK;
}
