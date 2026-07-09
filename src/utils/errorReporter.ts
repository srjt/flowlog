/**
 * Crash-visibility reporter. Loaded from the app entry (`/index.js`) BEFORE
 * any other app module so that fatal JS errors are logged in a readable form
 * instead of React Native's default `String(error)` — which prints
 * "[object Object]" for any thrown non-Error value and made TestFlight
 * crashes undiagnosable (see docs/SDK54_UPGRADE.md, build 20).
 *
 * MUST import nothing: `src/config/env.ts` throws at import time on bad
 * config (and `logger` imports it), and this module exists precisely to
 * report that class of startup failure.
 */

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler(): GlobalErrorHandler;
  setGlobalHandler(handler: GlobalErrorHandler): void;
}

const MAX_DEPTH = 4;
const MAX_OUTPUT_CHARS = 8000;
const LOG_CHUNK_CHARS = 1000;

function describeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null;
  if (value === undefined) return '[undefined]';
  const type = typeof value;
  if (type === 'function') {
    const name = (value as { name?: string }).name;
    return `[Function: ${name || 'anonymous'}]`;
  }
  if (type === 'bigint') return `${String(value)}n`;
  if (type !== 'object') return value;

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(obj);

  const out: Record<string, unknown> = {};
  let names: string[] = [];
  try {
    // Own-property names, not Object.keys: Error props are non-enumerable.
    names = Object.getOwnPropertyNames(obj);
  } catch {
    return '[unreadable object]';
  }
  for (const key of names) {
    try {
      out[key] = describeValue(
        (obj as Record<string, unknown>)[key],
        depth + 1,
        seen,
      );
    } catch {
      out[key] = '[threw on read]';
    }
  }
  return out;
}

function prototypeChainNames(value: object): string {
  const names: string[] = [];
  let proto: object | null = value;
  try {
    for (let i = 0; i < 5 && proto !== null; i++) {
      const ctor = (proto as { constructor?: { name?: string } }).constructor;
      names.push(ctor?.name || '(anonymous)');
      proto = Object.getPrototypeOf(proto) as object | null;
      if (proto === Object.prototype || proto === null) break;
    }
  } catch {
    names.push('(prototype walk threw)');
  }
  return names.join(' -> ');
}

/**
 * Best-effort deep serialization of any thrown value. Never throws.
 */
export function serializeThrown(value: unknown): string {
  try {
    if (value !== null && typeof value === 'object') {
      const obj = value as {
        name?: unknown;
        message?: unknown;
        stack?: unknown;
      };
      const parts: string[] = [];
      const isErrorLike =
        typeof obj.name === 'string' && typeof obj.message === 'string';
      if (isErrorLike) {
        parts.push(`${String(obj.name) || 'Error'}: ${String(obj.message)}`);
      } else {
        parts.push(`non-Error object (chain: ${prototypeChainNames(value)})`);
      }
      if (typeof obj.stack === 'string' && obj.stack.length > 0) {
        parts.push(`stack:\n${obj.stack}`);
      }
      const described = describeValue(value, 0, new WeakSet());
      parts.push(`props: ${JSON.stringify(described)}`);
      return parts.join('\n').slice(0, MAX_OUTPUT_CHARS);
    }
    return `${typeof value}: ${String(value)}`.slice(0, MAX_OUTPUT_CHARS);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable thrown value]';
    }
  }
}

/**
 * Logs a serialized thrown value via console.error in chunks — iOS os_log
 * truncates long single messages, and Console.app is the only channel a
 * TestFlight tester has.
 */
export function logThrown(prefix: string, value: unknown): void {
  try {
    const text = serializeThrown(value);
    const total = Math.max(1, Math.ceil(text.length / LOG_CHUNK_CHARS));
    for (let i = 0; i < total; i++) {
      const chunk = text.slice(i * LOG_CHUNK_CHARS, (i + 1) * LOG_CHUNK_CHARS);
      console.error(`${prefix} [${i + 1}/${total}] ${chunk}`);
    }
  } catch {
    // Never let the reporter itself throw.
  }
}

/**
 * Wraps React Native's global error handler so every unhandled JS error is
 * deep-logged before RN's default fatal behavior runs (which is preserved —
 * the previous handler is always called through).
 */
export function installGlobalErrorReporter(): void {
  const g = globalThis as {
    __flowlogErrorReporterInstalled?: boolean;
    ErrorUtils?: ErrorUtilsLike;
  };
  if (g.__flowlogErrorReporterInstalled) return;
  const errorUtils = g.ErrorUtils;
  if (!errorUtils) return; // web / jest / node — nothing to wrap
  g.__flowlogErrorReporterInstalled = true;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    logThrown(`[flowlog] GLOBAL JS ERROR (isFatal=${String(isFatal)})`, error);
    previous(error, isFatal);
  });
}

try {
  installGlobalErrorReporter();
} catch {
  // A broken reporter must never break startup.
}
