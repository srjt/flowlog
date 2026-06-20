import { isDev } from '@/config/env';
import { COST_ESTIMATES } from '@/constants/pipelineConfig';
import { logger } from '@/utils/logger';

/**
 * Development cost logging. Every provider call routes its estimated cost
 * through here so cost regressions are visible during development, long before
 * they reach a production bill.
 */
export function logCost(label: string, estimatedUsd: number): void {
  if (!isDev) return;
  logger.info(`cost: ${label} ≈ $${estimatedUsd.toFixed(4)}`);
}

export function estimateWhisperCost(durationSeconds: number): number {
  return (durationSeconds / 60) * COST_ESTIMATES.whisperPerMinute;
}
