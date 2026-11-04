/**
 * Route inventory (#125): every screen under `app/`, the platforms it ships
 * on, and the visible UI a person uses to reach it.
 *
 * App Review guideline 2.5.19 rejects apps with hidden, dormant or
 * undocumented features. A screen with no button, tab or notification leading
 * to it is exactly that, even when it is "only" reachable by deep link. This
 * list is the answer to "what can a person open in this build, and how?", and
 * `docs/APP_REVIEW.md` (Notes for Review) is written from it.
 *
 * `tests/unit/routeInventory.test.ts` scans `app/` and fails when:
 *  - a route has no entry here (add one, and decide how people reach it);
 *  - an entry here has no route (remove it, and update the App Review doc);
 *  - an entry that ships on native has no entry point.
 *
 * Data only: this module imports nothing from the app, so the test can read it
 * without loading a single screen.
 */

/**
 * Where a route ships. `all` means every platform the app builds for (iOS,
 * Android and the web). `web-only` routes must redirect away on native, and
 * the inventory test checks the route file does so.
 */
export type RoutePlatforms = 'all' | 'web-only';

export interface RouteInventoryEntry {
  /**
   * The route pattern as Expo Router resolves it: route groups such as
   * `(tabs)` removed, `index` collapsed into its folder, dynamic segments kept
   * as `[param]`. `app/(tabs)/record.tsx` is `/record`; `app/digest/index.tsx`
   * is `/digest`; `app/session/[id].tsx` is `/session/[id]`.
   */
  readonly route: string;
  readonly platforms: RoutePlatforms;
  /**
   * The visible UI that opens this route: a tab, a screen plus the label of
   * the button on it, a notification the user turned on, or app launch through
   * the entry route. Required for every route that ships on native.
   */
  readonly entryPoint: string;
}

export const ROUTE_INVENTORY: readonly RouteInventoryEntry[] = [
  {
    route: '/',
    platforms: 'all',
    entryPoint:
      'App launch. The entry route sends the person to login, onboarding, the feature tour or Record, by sign-in and onboarding state.',
  },
  {
    route: '/login',
    platforms: 'all',
    entryPoint:
      'Signed out at app launch, or after "Sign out" in the Profile tab.',
  },
  {
    route: '/signup',
    platforms: 'all',
    entryPoint:
      'The "Flowlog is invite-only" button on login. An explanatory notice; there is nothing to fill in.',
  },
  {
    route: '/welcome',
    platforms: 'all',
    entryPoint:
      'First sign-in, before onboarding is complete (sport, level, gi or no-gi, microphone).',
  },
  {
    route: '/tour',
    platforms: 'all',
    entryPoint:
      'Finishing onboarding, and the "Replay tour" button in the Profile tab.',
  },
  {
    route: '/record',
    platforms: 'all',
    entryPoint:
      'The Record tab. The app also opens here once onboarding and the tour are done, and a training reminder the user turns on in Profile opens it.',
  },
  {
    route: '/log',
    platforms: 'all',
    entryPoint: 'The Log tab, and "View log" on the result screen.',
  },
  {
    route: '/trends',
    platforms: 'all',
    entryPoint: 'The Trends tab.',
  },
  {
    route: '/profile',
    platforms: 'all',
    entryPoint: 'The Profile tab.',
  },
  {
    route: '/processing',
    platforms: 'all',
    entryPoint: 'Tapping "Submit" on Record after a 20 to 90 second recording.',
  },
  {
    route: '/output',
    platforms: 'all',
    entryPoint:
      'Opens by itself when processing finishes, after "Submit" on Record.',
  },
  {
    route: '/session/[id]',
    platforms: 'all',
    entryPoint:
      'Tapping a session in the Log tab, or "Cue seem off? Review transcript" on the result screen.',
  },
  {
    route: '/digest',
    platforms: 'all',
    entryPoint:
      'The weekly digest notification, which the user turns on under "Weekly digest" in the Profile tab.',
  },
  {
    route: '/digest/history',
    platforms: 'all',
    entryPoint:
      'The "View weekly digests" button in the Profile tab, or "View all digests" on the digest screen.',
  },
  {
    route: '/digest/[weekId]',
    platforms: 'all',
    entryPoint: 'Tapping a week in the digest history.',
  },
  {
    route: '/review',
    platforms: 'web-only',
    entryPoint:
      'A link to the web build, shared with invited reviewers (docs/REVIEW_BENCH.md). In the iOS and Android app this route redirects to the entry route.',
  },
];
