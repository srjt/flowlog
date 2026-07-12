import { isDev } from '@/config/env';
import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';

/**
 * Tiny logging shim. debug/info are dev-console-only; warn/error always reach
 * the console. `logger.error` (and `reportToMonitoring`) additionally
 * fire-and-forget a row into the `client_events` table so production failures
 * are visible in the Supabase dashboard without a crash-reporting SDK — see
 * "Checking production errors" in supabase/SETUP.md.
 */

// Hard cap per launch: a crash-looping screen must not spam the table.
const MAX_REPORTS_PER_LAUNCH = 20;
const MAX_DETAIL_CHARS = 2000;
const MAX_EVENT_CHARS = 200;
let reportsSent = 0;
let reporting = false; // recursion guard: a failing report must never re-report

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
    void sendClientEvent('error', args);
  },
};

/**
 * Monitoring hook for pipeline failures that must never crash the app.
 * Uses raw console.error (NOT logger.error) so each monitored event is
 * reported to client_events exactly once.
 */
export function reportToMonitoring(
  event: string,
  context: Record<string, unknown>,
): void {
  console.error('[flowlog]', `monitoring:${event}`, context);
  void sendClientEvent('error', [`monitoring:${event}`, context]);
}

async function sendClientEvent(level: string, args: unknown[]): Promise<void> {
  try {
    // Gate on the compile-time __DEV__ flag, NOT env-derived isDev: APP_ENV is
    // a non-EXPO_PUBLIC var that reads as undefined in release Hermes bundles,
    // so isDev is (wrongly) true in TestFlight — gating on it would silently
    // disable reporting exactly where it matters. See docs/SDK54_UPGRADE.md.
    const dev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (dev || isDemoMode || isLocalPipeline) return;
    if (reporting || reportsSent >= MAX_REPORTS_PER_LAUNCH) return;
    reporting = true;
    reportsSent += 1;
    // Lazy require keeps logger a leaf module at init time (the zero-import
    // errorReporter entry loads before everything) and keeps the Supabase
    // client out of unit tests that only exercise logging.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { supabase } =
      require('@/lib/supabase') as typeof import('@/lib/supabase');
    const [first, ...rest] = args;
    const event =
      typeof first === 'string' ? first.slice(0, MAX_EVENT_CHARS) : 'error';
    const detail = safeStringify(typeof first === 'string' ? rest : args).slice(
      0,
      MAX_DETAIL_CHARS,
    );
    // user_id defaults to auth.uid() server-side; RLS rejects signed-out
    // inserts, which is fine — we swallow every failure below.
    await supabase.from('client_events').insert({ level, event, detail });
  } catch {
    // Never throw, never log through logger (recursion) — swallow.
  } finally {
    reporting = false;
  }
}

function safeStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_key, val) =>
        val instanceof Error
          ? {
              name: val.name,
              message: val.message,
              stack: val.stack?.slice(0, 500),
            }
          : val,
      ) ?? ''
    );
  } catch {
    return '[unserializable]';
  }
}
