import { isDev } from '@/config/env';

/**
 * Tiny logging shim. In development it writes to console; in production it is a
 * no-op for info/debug and a stub for error reporting (wire to Sentry/monitoring
 * later). Centralised so the cost logger and monitoring hook share one path.
 */
export const logger = {
  debug(...args: unknown[]): void {
    if (isDev) console.debug('[flowlog]', ...args);
  },
  info(...args: unknown[]): void {
    if (isDev) console.info('[flowlog]', ...args);
  },
  warn(...args: unknown[]): void {
    console.warn('[flowlog]', ...args);
  },
  error(...args: unknown[]): void {
    console.error('[flowlog]', ...args);
  },
};

/**
 * Monitoring hook for pipeline failures that must never crash the app.
 * Replace the body with a real monitoring integration (Sentry, Logflare, etc).
 */
export function reportToMonitoring(
  event: string,
  context: Record<string, unknown>,
): void {
  logger.error(`monitoring:${event}`, context);
  // TODO: forward to monitoring backend.
}
