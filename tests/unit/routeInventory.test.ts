/**
 * Every route under `app/` is in the route inventory, every inventory entry is
 * a real route, and every route that ships on native has a visible way in
 * (#125, App Review guideline 2.5.19).
 *
 * The certification bench shipped in the iOS app with no button or tab leading
 * to it, only a `flowlog://review` deep link. Nothing flagged it, because a
 * new screen is just a new file and Expo Router routes it automatically. This
 * test makes adding a screen a decision: it fails until the screen is in
 * `src/config/routeInventory.ts` with the UI that opens it.
 *
 * Like the prompt-placeholder test, this is a SOURCE scan. It derives route
 * patterns from file names under `app/` rather than importing the screens, so
 * it needs no device, no router and no native modules.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ROUTE_INVENTORY } from '@/config/routeInventory';

const ROOT = join(__dirname, '..', '..');
const APP_DIR = join(ROOT, 'app');
const INVENTORY_FILE = 'src/config/routeInventory.ts';

const SOURCE_EXT = /\.(tsx|ts|jsx|js)$/;
/** Expo Router merges `foo.web.tsx` / `foo.ios.tsx` into the route `foo`. */
const PLATFORM_EXT = /\.(web|ios|android|native)$/;
/**
 * Files under `app/` that Expo Router treats as structure, not as screens a
 * person can land on: layouts, the web HTML shell, the native deep-link
 * rewriter, and server API routes.
 */
const NOT_A_SCREEN = /^(_layout|\+html|\+native-intent|.*\+api)$/;
/** A route group such as `(tabs)`: organises files, adds nothing to the URL. */
const ROUTE_GROUP = /^\(.+\)$/;

/**
 * The route pattern Expo Router resolves a file under `app/` to, or null when
 * the file is not a screen. Takes a path relative to `app/`, `/`-separated.
 */
function routePattern(file: string): string | null {
  const segments = file
    .replace(SOURCE_EXT, '')
    .replace(PLATFORM_EXT, '')
    .split('/');
  if (NOT_A_SCREEN.test(segments[segments.length - 1]!)) return null;
  const path = segments.filter((s) => !ROUTE_GROUP.test(s));
  if (path[path.length - 1] === 'index') path.pop();
  return `/${path.join('/')}`;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE_EXT.test(entry.name) ? [full] : [];
  });
}

/** Route pattern → the files under `app/` that resolve to it. */
function scanRoutes(): Map<string, string[]> {
  const routes = new Map<string, string[]>();
  for (const full of sourceFiles(APP_DIR)) {
    const file = relative(APP_DIR, full).split(sep).join('/');
    const route = routePattern(file);
    if (route === null) continue;
    routes.set(route, [...(routes.get(route) ?? []), `app/${file}`]);
  }
  return routes;
}

const ROUTES = scanRoutes();
const INVENTORIED = new Set(ROUTE_INVENTORY.map((e) => e.route));

describe('route patterns are derived the way Expo Router resolves them', () => {
  // Guards the guard: if derivation drifts, the comparison below can pass
  // while comparing the wrong strings.
  it.each([
    ['index.tsx', '/'],
    ['(auth)/login.tsx', '/login'],
    ['(tabs)/record.tsx', '/record'],
    ['digest/index.tsx', '/digest'],
    ['digest/history.tsx', '/digest/history'],
    ['session/[id].tsx', '/session/[id]'],
    ['digest/[weekId].tsx', '/digest/[weekId]'],
    ['review/index.web.tsx', '/review'],
    ['(group)/nested/(inner)/index.tsx', '/nested'],
    ['+not-found.tsx', '/+not-found'],
  ])('%s → %s', (file, route) => {
    expect(routePattern(file)).toBe(route);
  });

  it.each([
    '_layout.tsx',
    '(tabs)/_layout.tsx',
    '+html.tsx',
    '+native-intent.tsx',
    'api/hello+api.ts',
  ])('%s is not a screen', (file) => {
    expect(routePattern(file)).toBeNull();
  });

  it('finds the screens the app is known to have', () => {
    // A scan of the wrong directory would find nothing and pass vacuously.
    expect([...ROUTES.keys()]).toEqual(
      expect.arrayContaining(['/', '/record', '/session/[id]', '/review']),
    );
  });
});

describe('the route inventory matches app/ (#125)', () => {
  it('lists every route under app/', () => {
    const missing = [...ROUTES]
      .filter(([route]) => !INVENTORIED.has(route))
      .map(
        ([route, files]) =>
          `${route} (${files.join(', ')}) has no entry in ${INVENTORY_FILE}. ` +
          'Add one, with the visible UI that opens it.',
      );
    expect(missing).toEqual([]);
  });

  it('lists only routes that exist', () => {
    const stale = ROUTE_INVENTORY.filter((e) => !ROUTES.has(e.route)).map(
      (e) =>
        `${e.route} is in ${INVENTORY_FILE} but no file under app/ resolves ` +
        'to it. Remove the entry, and the feature from docs/APP_REVIEW.md.',
    );
    expect(stale).toEqual([]);
  });

  it('lists each route once', () => {
    const seen = new Set<string>();
    const duplicates = ROUTE_INVENTORY.filter((e) => {
      const dup = seen.has(e.route);
      seen.add(e.route);
      return dup;
    }).map((e) => `${e.route} is listed more than once in ${INVENTORY_FILE}`);
    expect(duplicates).toEqual([]);
  });

  it('gives every route that ships on native a visible way in', () => {
    // Guideline 2.5.19: a native screen nobody can find from the UI is a
    // hidden feature, even if a deep link reaches it.
    const hidden = ROUTE_INVENTORY.filter(
      (e) => e.platforms !== 'web-only' && e.entryPoint.trim() === '',
    ).map(
      (e) =>
        `${e.route} ships on native with no entry point. Name the tab, ` +
        'button or notification that opens it, or make it web-only.',
    );
    expect(hidden).toEqual([]);
  });

  it('keeps every web-only route off native in code, not just on paper', () => {
    // Marking a route web-only must not be a way around the entry-point rule:
    // the file itself has to send native visitors elsewhere.
    const unguarded = ROUTE_INVENTORY.filter(
      (e) => e.platforms === 'web-only',
    ).flatMap((e) =>
      (ROUTES.get(e.route) ?? [])
        .filter((file) => !/\.web\.[jt]sx?$/.test(file))
        .filter((file) => {
          const source = readFileSync(join(ROOT, file), 'utf8');
          return !(
            /Platform\.OS\s*!==\s*'web'/.test(source) &&
            source.includes('<Redirect')
          );
        })
        .map(
          (file) =>
            `${e.route} is web-only in ${INVENTORY_FILE}, but ${file} does ` +
            "not redirect when Platform.OS !== 'web'.",
        ),
    );
    expect(unguarded).toEqual([]);
  });

  it('keeps the certification bench web-only', () => {
    expect(ROUTE_INVENTORY.find((e) => e.route === '/review')?.platforms).toBe(
      'web-only',
    );
  });
});

describe('the App Review doc covers the inventory (#125)', () => {
  // Notes for Review are written from docs/APP_REVIEW.md. A route missing
  // there is a feature App Review was never told about (guideline 2.3.1(a)).
  const doc = readFileSync(join(ROOT, 'docs/APP_REVIEW.md'), 'utf8');

  it('names every inventoried route', () => {
    const undocumented = ROUTE_INVENTORY.filter(
      (e) => !doc.includes(`\`${e.route}\``),
    ).map((e) => `${e.route} is not described in docs/APP_REVIEW.md`);
    expect(undocumented).toEqual([]);
  });
});
