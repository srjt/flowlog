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

/** The one route that writes: an operator verdict on a Cue (#132). */
export const WRITE_PATH = '/api/verdict';

/**
 * The method gate. Every route reads, except the one that writes, and that one
 * only writes. HEAD, OPTIONS and the rest are refused everywhere; refusing
 * OPTIONS is what makes the CORS preflight below fail.
 */
export function allowedMethods(path: string): string[] {
  return path === WRITE_PATH ? ['POST'] : ['GET'];
}

export interface WriteHeaders {
  host: string | undefined;
  contentType: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
}

/**
 * Why a write must be refused, or null to let it through. Basic auth does not
 * stop cross-site request forgery: the browser re-sends cached credentials to
 * 127.0.0.1 with a form another site submits. So a write also needs:
 *
 *   - `Content-Type: application/json`. A form cannot send it, and a
 *     cross-origin fetch that does must first pass a preflight, which this
 *     server never approves (it answers no OPTIONS).
 *   - An `Origin`, when there is one, equal to this tool's own origin. The
 *     Host header has already been held to loopback, so this is the page
 *     itself and nothing else.
 *   - A `Sec-Fetch-Site`, when there is one, of `same-origin`.
 */
export function writeRefusal(
  h: WriteHeaders,
): { status: 403 | 415; reason: string } | null {
  if (h.origin !== undefined && h.origin !== `http://${h.host}`) {
    return { status: 403, reason: 'Cross-origin write refused' };
  }
  if (h.secFetchSite !== undefined && h.secFetchSite !== 'same-origin') {
    return { status: 403, reason: 'Cross-site write refused' };
  }
  const mediaType = h.contentType?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return { status: 415, reason: 'Send application/json' };
  }
  return null;
}
