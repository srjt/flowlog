/**
 * Request gates for the local cue review tool (docs/ADMIN.md).
 *
 * The server binds to 127.0.0.1, which keeps other machines out. These close
 * the gap that binding leaves: another page in your own browser reaching
 * localhost, directly or through a DNS-rebound hostname.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time on the digest, so length differences leak nothing either. */
function same(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** HTTP basic auth against the credentials from `.env`. */
export function isAuthorized(
  header: string | undefined,
  user: string,
  password: string,
): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString(
    'utf8',
  );
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  // Both compared unconditionally: no early exit on a wrong username.
  const userOk = same(decoded.slice(0, colon), user);
  const passwordOk = same(decoded.slice(colon + 1), password);
  return userOk && passwordOk;
}

/**
 * Only loopback Host headers. A DNS-rebinding page arrives on 127.0.0.1 with
 * its own hostname in Host; refusing it means the browser never gets as far
 * as a credentials prompt on that origin.
 */
export function isLoopbackHost(
  host: string | undefined,
  port: number,
): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
