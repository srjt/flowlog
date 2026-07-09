# Expo SDK 51 → 54 upgrade runbook

## Why
Apple requires the iOS 26 SDK (Xcode 26) for all App Store / TestFlight uploads.
SDK 51 (RN 0.74) native modules crash at launch on the iOS 26 runtime — first an
`expo-updates` `ErrorRecovery` abort, then an RN `ExceptionsManager` rethrow plus
a native memory fault. SDK 54 (RN 0.81 / React 19.1) is built for Xcode 26 and is
the supported fix.

## What's already changed in the repo
- `package.json`: Expo → `^54.0.0`; React 19.1 / RN 0.81; `nativewind@^4.2`;
  `react-native-reanimated@~4.1` + new `react-native-worklets`; SDK-54 versions
  for all `expo-*`, `react-native-screens`, `safe-area-context`, `async-storage`,
  `react-native-web`. Removed the `metro@0.80.9` `overrides` and metro devDeps
  (SDK 54 uses metro 0.83). `@types/react@19`, `@testing-library/react-native@13`
  (dropped `react-test-renderer`), `typescript@~5.9`, `jest-expo@~54`.
- `babel.config.js`: added `react-native-worklets/plugin` (last) for Reanimated 4,
  with `{ bundleMode: true }` — see the physical-iOS-26 crash section below.
- `app.json`: `newArchEnabled: true` (Reanimated 4 requires New Arch);
  `updates.enabled: false` kept for now.
- `eas.json`: build `node` → `20.19.4` (SDK 54 minimum); iOS `image: latest`.
- `GeminiTranscriptionProvider.ts`: import from `expo-file-system/legacy`
  (the classic `readAsStringAsync`/`EncodingType` API moved there in SDK 54).
- `CLAUDE.md`: toolchain note updated; DECISIONS #009 superseded.

## Run these on your Mac (not in a sandbox — installs need real network)

```bash
cd /path/to/flowlog

# 1. Let Expo pin every SDK-54 package to the exact compatible version.
#    This corrects any version above that isn't precise and regenerates the lockfile.
npx expo install --fix

# 2. Make sure the Reanimated 4 worklets runtime is present (no-op if already added).
npx expo install react-native-worklets

# 3. Sanity-check the project against the installed SDK.
npx expo-doctor

# 4. Verify the JS layer BEFORE spending a build.
npm test
npm run typecheck
npx expo export        # bundles without a native build; must succeed

# 5. Rebuild for TestFlight.
npx eas-cli@latest build --platform ios --profile testflight --auto-submit
```

## Likely follow-ups (fix as they surface in steps 3–4)
- **Reanimated/worklets babel**: if you see "Reanimated plugin" or worklet errors,
  confirm `react-native-worklets/plugin` is the LAST entry in `babel.config.js`
  and that `react-native-reanimated/plugin` is NOT also present (they conflict).
- **Tests**: React 19 + `@testing-library/react-native@13` dropped
  `react-test-renderer`. If a test imports it directly, update it.
- **expo-doctor version nags**: run `npx expo install --fix` again — it's the
  source of truth for versions; the numbers in `package.json` here are best-effort.
- **Metro cache**: if the bundler behaves oddly, `npx expo start -c` once.

## If the 54 build still crashes
Tether the iPhone to the Mac and read the real error via Console.app (filter
"Flowlog") while launching — SDK 54's RN surfaces a readable JS error before any
abort. Paste that message back for a targeted fix.

## Physical iOS 26 launch crash — worklets bundle-mode fix (the real one)
The app built fine and ran on simulators but crashed ~100–400 ms into launch on
**physical** iOS 26 devices (TestFlight build 6). Two non-deterministic native
signatures from the same binary:
1. `EXC_BAD_ACCESS` "possible pointer authentication failure" in Hermes
   `hermesBuiltinCopyDataProperties` under `RuntimeScheduler runEventLoopTick`.
2. `SIGABRT` on `com.meta.react.turbomodulemanager.queue` via
   `ObjCTurboModule::performVoidMethodInvocation → objc_exception_rethrow`.

**It is NOT a Hermes PAC bug, and `buildReactNativeFromSource: true` does NOT fix
it — it CAUSES a related crash.** The reporter of the headline "PAC" issue
([expo#44356](https://github.com/expo/expo/issues/44356)) confirmed their crash
came from `buildReactNativeFromSource: true` dead-code-stripping TurboModule
registrations; prebuilt Hermes is safe. We already use prebuilt (no
`expo-build-properties`), so do **not** add that flag.

Root cause ([reanimated#9443](https://github.com/software-mansion/react-native-reanimated/issues/9443),
[expo#44606](https://github.com/expo/expo/issues/44606),
[react-native#54859](https://github.com/facebook/react-native/issues/54859)):
`react-native-worklets` re-parses worklet **source** at runtime via
`valueUnpacker`. On iOS 26 that parse hits the `callGuardDEV` symbol, Hermes
throws a `SyntaxError`, and the unhandled C++ exception aborts through the
TurboModule void-invocation path (signature 2), sometimes corrupting the Hermes
heap first (signature 1). The upstream source fix (worklets dropping
`callGuardDEV`) is only in versions **> 0.8.x**, outside what reanimated 4.1.x
allows (`0.5 – 0.8`) and what SDK 54 pins (worklets `0.5.1`). So the fix for our
pinned stack is the maintainer-endorsed workaround: **Bundle Mode** — worklets
are serialized into the Metro bundle at build time, so nothing is parsed at
runtime.

What changed (worklets 0.5.1, no version bumps):
- `babel.config.js`: `['react-native-worklets/plugin', { bundleMode: true }]`
  (still LAST).
- `metro.config.js`: bundle-mode serializer/resolver. worklets 0.5.1 ships
  `bundleModeMetroConfig`, but its helper hard-requires `@react-native/metro-config`
  (absent in Expo), so we inline the equivalent against Expo's default config.
- `patches/metro+0.83.3.patch` (+ `patch-package` devDep + `postinstall` script):
  Bundle Mode writes generated worklet modules into
  `node_modules/react-native-worklets/__generatedWorklets/` **during** the Babel
  pass, after Metro's file-map crawl, so `getOrComputeSha1` throws "Failed to get
  the SHA-1" on a clean build. The patch falls back to hashing those files off
  disk. This is the "temporary Metro patch" the worklets bundle-mode docs mention.

Verified locally: `npm test` (only the 3 pre-existing `NotificationService`
failures remain), `tsc --noEmit` clean, and a **cold** `npx expo export --platform
ios --clear` succeeds first-try (valid `entry-*.hbc`). Rebuild with a clean cache
so the generated worklets regenerate from scratch:
```bash
npx eas-cli@latest build -p ios --profile testflight --clear-cache --auto-submit
```

Two EAS-specific pitfalls surfaced getting this to actually build (TestFlight
builds 7–10), independent of the fix itself:

- **Commit before building.** Without `eas.json` `cli.requireCommit: true`,
  EAS's uncommitted-changes packaging path can serve a stale version of one
  file (e.g. `package-lock.json`) alongside a fresh version of another (e.g.
  `package.json`) from the same upload — a known class of bug
  ([eas-cli#1501](https://github.com/expo/eas-cli/issues/1501)). We now set
  `requireCommit: true`, so always commit before running `eas build`.
- **Generate the lockfile with the SAME npm version EAS uses.** `eas.json`
  pins `node: "20.19.4"`, which bundles **npm 10.8.2**. A lockfile written by
  a newer local npm (11.x) can be silently accepted by `npm ci` locally while
  npm 10.8.2 on EAS rejects it ("Missing: X from lock file") — npm's lockfile
  sync-check logic differs across majors. If `npm ci` ever disagrees between
  your machine and an EAS log, download the exact Node build EAS uses and
  regenerate the lock with its bundled npm:
  ```bash
  curl -fsSL -o /tmp/node20.tar.gz https://nodejs.org/dist/v20.19.4/node-v20.19.4-darwin-arm64.tar.gz
  tar xzf /tmp/node20.tar.gz -C /tmp
  rm -rf node_modules
  /tmp/node-v20.19.4-darwin-arm64/bin/npm install   # rewrites package-lock.json
  /tmp/node-v20.19.4-darwin-arm64/bin/npm ci --include=dev   # must pass
  ```
  (swap `darwin-arm64` for your EAS build image's platform/arch if different).

## Build 10 crash — EXPO_PUBLIC_ vars missing at runtime (real cause, not PAC)
Build 10 (the first successful upload after the worklets bundle-mode fix above)
still crashed on launch — deterministically, on every launch, unlike the
non-deterministic memory-corruption crashes earlier in this doc. A live
Console.app capture during a repro showed the real cause immediately:
```
EnvError: [env] Missing required environment variable "EXPO_PUBLIC_SUPABASE_URL"
Unhandled JS Exception: EnvError: ...
TypeError: Cannot read property 'ErrorBoundary' of undefined
  at ContextNavigator → ExpoRoot → App
```
...then `SIGABRT`. Confirmed by extracting the shipped `.ipa` and grepping the
compiled Hermes bytecode (`main.jsbundle`): the real Supabase URL string
appeared **zero** times; the bare key name `"EXPO_PUBLIC_SUPABASE_URL"` appeared
once — proof the value was never inlined, only looked up dynamically by name.

Root cause: [`src/config/env.ts`](../src/config/env.ts) read every var, including
`EXPO_PUBLIC_*` ones, via `raw[key]` — a dynamic, variable-indexed lookup
(`const raw = process.env`, then `raw[key]` where `key` is a function
parameter). Metro's Babel env-inlining plugin can only statically replace a
literal `process.env.EXPO_PUBLIC_X` member expression with a string at bundle
time; it cannot see through bracket-notation indirection. In dev/Jest a real
`process.env` object exists, so the dynamic lookup works and masked the bug
completely — `jest.setup.js`'s `process.env.EXPO_PUBLIC_SUPABASE_URL = '...'`
runtime assignment made every test pass. In the release Hermes bytecode bundle
there is no real `process.env` on-device — only whatever got statically
inlined — so the lookup always returned `undefined`, 100% reproducibly.

Fix: `env.ts`'s helpers (`required`/`optional`/`asBool`/`asInt`/`asEnum`) now
accept an optional `literal` argument. Every `EXPO_PUBLIC_*` call site passes
its value as a literal `process.env.EXPO_PUBLIC_X` expression (e.g.
`required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL)`),
so Metro can inline it; server-only vars are unchanged and keep the dynamic
`raw[key]` lookup (correct — those must never reach the client bundle).
Verified by re-running `expo export` and grepping the output bundle for the
real URL/key substrings (present after the fix, absent before), and confirming
`npm test` still passes unchanged (Jest's Babel transform is gated off
inlining under `NODE_ENV=test`, so `jest.setup.js`'s override still works).

## Build 11 crash — expo-font resolved to an SDK 56 version, not SDK 54's
Build 11 (carrying the env-var fix above) got further — the `EnvError` was
gone — but still crashed on launch (`SIGSEGV`) with:
```
[Error: Cannot find native module 'ExpoFontLoader']
Unhandled JS Exception: Error: Cannot find native module 'ExpoFontLoader'
```
`expo-font` was never a direct dependency in `package.json` — only pulled in
transitively via `@expo/vector-icons`'s unusually loose peer range
(`>=14.0.4`). npm satisfied that with whatever was newest on the registry:
**`expo-font@56.0.7`**, an SDK-56-era release, while `expo/bundledNativeModules.json`
says SDK 54 wants `~14.0.12`. Because it wasn't a direct dependency, `npx expo
install --check` / `expo-doctor` never saw it to flag the mismatch — both only
validate declared dependencies. The newer version's native module didn't
register under the legacy bridge name `ExpoFontLoader` that the rest of the
SDK-54 stack expects, so every font-loading call (icons, `expo-router`) threw
at native-module lookup time.

Fixed with `npx expo install expo-font`, which added it as a direct dependency
pinned to `~14.0.12` and correctly downgraded the resolved version; it also
auto-registered the `expo-font` config plugin in `app.json`. Verified
autolinking now discovers it (`npx expo-modules-autolinking search --platform
ios`), `expo-doctor` is clean (17/17), and swept every other `expo-*` package
present only transitively against `bundledNativeModules.json` to confirm none
of the others have the same silent-mismatch problem (they don't — `expo-font`
was uniquely affected by that one loose peer range).

**Lesson:** any `expo-*` package your code (or a UI library like
`@expo/vector-icons`) actually calls into at runtime should be a **direct**
dependency with Expo's own SDK-pinned version range, even if npm would resolve
it transitively anyway — otherwise nothing in the standard tooling (`expo
install --check`, `expo-doctor`) can catch a version drift.

## Build 14 crash — async-void TurboModule NSException heap corruption (recurring)
After the OAuth navigation fix above, a genuinely new bug surfaced on build 14:
a segfault in `hermes::vm::JSObject::getPrototypeOf` (an `instanceof` check),
during `Runtime::drainJobs()` microtask draining, no app frames in the trace.
Feedback comment: "Failing after enabling mic" — i.e. it happened using
`Audio.requestPermissionsAsync()` / `Audio.setAudioModeAsync()` /
`Audio.Recording.createAsync()` in [`app/(tabs)/record.tsx`](../app/(tabs)/record.tsx).

This is the **same confirmed root cause** already identified earlier in this
doc's Bundle Mode section — [facebook/hermes#1957](https://github.com/facebook/hermes/issues/1957):
an async void TurboModule method throws an `NSException`;
`ObjCTurboModule::performVoidMethodInvocation` converts it to a JSError from a
background dispatch-queue thread, and Hermes's JSI runtime isn't thread-safe —
that cross-thread access corrupts the heap, which then surfaces later, in
whatever unrelated Hermes VM operation happens to touch the corrupted memory
next (last time `regExpExec`, this time `getPrototypeOf`). Hitting this at a
**second, unrelated call site** (mic/audio, not just launch) confirmed it's a
systemic vulnerability — any async-void native module call anywhere in the app
can trigger it — not something fixable by patching one call site.

The confirmed upstream fix ([facebook/react-native#56265](https://github.com/facebook/react-native/pull/56265))
was already identified when Bundle Mode was applied, but not used at the time
because it requires compiling React Native from source (that file ships
prebuilt otherwise) — `expo-build-properties` `buildReactNativeFromSource: true`
was previously avoided because [expo#44356](https://github.com/expo/expo/issues/44356)
showed it can cause a *different* crash (dead-code-stripped TurboModule
registrations) for another team. After hitting this bug twice at unrelated call
sites, that trade-off flipped: applied now via:

- `app.json`: `expo-build-properties` plugin,
  `ios.buildReactNativeFromSource: true`.
- `patches/react-native+0.81.5.patch`: backports the exact upstream fix to
  `RCTTurboModule.mm`'s `performVoidMethodInvocation` — mirrors the sibling
  function `performMethodInvocation`'s existing pattern (already present in our
  RN 0.81.5), which re-throws the raw exception instead of converting it when
  the call is async, avoiding the cross-thread JSI access entirely.

**This could not be verified locally** — a from-source build only compiles on
EAS, and local `expo export` doesn't touch native code at all. If a future
build reintroduces the dead-code-stripping symptom from expo#44356 (native
modules silently failing to register, `Cannot find native module 'X'` for
something that previously worked), that's the known residual risk of this
config; investigate linker flags (`-ObjC`/`-all_load`) before reverting, since
reverting reopens this heap-corruption class of crash.

## Build 15 attempt 1 — fmt library fails to compile under Xcode 26 (unrelated to the risk above)
The very first from-source build hit a *different* problem than the
dead-code-stripping risk we were watching for — a straight compile error, not
a runtime crash:
```
call to consteval function 'fmt::basic_format_string<...>...' is not a
constant expression
```
5 of these, all in `fmt/include/fmt/format-inl.h`. Root cause (confirmed via
[expo#44229](https://github.com/expo/expo/issues/44229), which reports the
identical error on SDK 54 too): React Native vendors `fmt 11.0.2`, which turns
on `FMT_USE_CONSTEVAL` when it detects a modern-enough Clang. Xcode 26's Apple
Clang enforces stricter consteval rules than fmt 11.0.2 accounts for, so its
`FMT_STRING` macro fails to compile. **Only affects building from source** —
prebuilt binaries were built with a compatible Clang at release time, so this
never surfaced before. Already fixed upstream in React Native; not yet in an
Expo SDK 54/55 release.

Fixed with a local config plugin, [`plugins/withFmtConstevalFix.js`](../plugins/withFmtConstevalFix.js)
(registered in `app.json`, since there's no committed `ios/` directory to hand-edit
— `expo prebuild` regenerates the Podfile on every EAS build): it patches the
generated Podfile's `post_install` hook to flip `FMT_USE_CONSTEVAL` from `1` to
`0` in the installed `fmt` pod's `base.h`, right after CocoaPods installs it.
That disables fmt's compile-time format-string checking; it falls back to its
normal runtime validation, so this is safe. Verified by running
`npx expo prebuild --platform ios --no-install --clean` locally and confirming
the generated `ios/Podfile` contains the patch in the right place and passes
`ruby -c` syntax checking (no local CocoaPods/Xcode available to compile it
for real — that only happens on EAS). Remove this plugin once Expo ships an RN
version with a fixed `fmt`.

## Build 16 crash 1 — onboarding PATCH /rest/v1/profiles always 400 (DB migrations never applied)
Reproduced on the "Enable microphone & start" onboarding step: `EXC_BAD_ACCESS`
in `hermes::vm::JSObject::getPrototypeOf`, reached via `instanceof` during
`Runtime::drainJobs()`. Static analysis chased this as a Hermes/Proxy bug for
several rounds (Supabase's `userNotAvailableProxy`, `react-native-worklets`'
`INACCESSIBLE_OBJECT`) — a controlled reinstall test (fresh app, no persisted
storage) ruled out the session-restore theory, since that Proxy only fires when
*restoring* a stale persisted session.

The real cause surfaced from Supabase's own dashboard logs (`Logs → API`), not
the client crash log: `completeOnboarding()`'s `.update()` call (PostgREST
`PATCH /rest/v1/profiles`) was failing with `400` on *every* attempt. Read-only
`npx supabase migration list` confirmed why — `supabase_migrations.schema_migrations`
didn't exist on the live project (Postgres `42P01`), meaning **none** of
`supabase/migrations/001-004` had ever been applied via the CLI. The tables
existed (created some other way, historically), but `profiles.onboarding_complete`
(migration 004) genuinely didn't — PostgREST rejects updates referencing
unrecognized columns with 400, and something in Supabase-js/Hermes's handling of
that failure is what actually crashed.

Fixed on the database, not in code — no rebuild needed for this part:
```bash
npx supabase migration repair --status applied 001 002 003   # bookkeeping only; 001-003's tables already existed
npx supabase db push                                          # applies only the genuinely-pending 004
```
Takeaway: never assume `supabase/migrations/*.sql` reflects the live schema
just because the files exist in the repo — `supabase migration list` is
read-only and cheap; check it before chasing a "schema mismatch" as a client
bug.

## Build 16 crash 2 — sign-in race between the explicit onSuccess path and the root layout's auth listener
Same crash signature as above, now reproducing on sign-in itself instead of
onboarding-finish (confirmed via a live Console.app capture): the OAuth code
exchange completes (200), then two `getUser()`-shaped network calls fire and
resolve within milliseconds of each other, and the crash follows within ~50ms
of both completing.

Root cause: two independent code paths both react to the same sign-in and both
mutate the user store. `app/(auth)/login.tsx` and `signup.tsx` each pass an
explicit `onSuccess` handler to `SocialAuthButtons` that deterministically
calls `getSessionUser()` → `getProfile()` → `setAuthUser`/`setProfile` →
navigates. Separately, `app/_layout.tsx` subscribes to
`authService.onAuthChange()`, which fired on *every* Supabase auth event
including `SIGNED_IN` — doing the exact same `getUser()`/`getProfile()`/store
work a second time, concurrently, unawaited relative to the first. Two
independent async chains landing on Hermes's microtask queue at nearly the
same tick is what crashed it — the earlier Proxy/`instanceof` theories were
chasing the same underlying concurrent-microtask crash shape, just from a
different trigger each time.

Fixed by making `AuthService.onAuthChange()` only fire on sign-out (session
`null`) — every sign-in path already handles its own success deterministically
(password login/signup, both OAuth `onSuccess` handlers, and this file's own
`getSessionUser()` call on cold launch for session restore), so reacting to
`SIGNED_IN` in the listener was always redundant, not just risky. Note the
same redundant-listener pattern likely existed for the password-login path
too (not just OAuth) — this fix covers both.

## Build 17 crash — same JSProxy::getPrototypeOf signature persists after the onAuthChange race fix; testing buildReactNativeFromSource as the cause
The sign-in race fix above (build 17) did not resolve the crash — confirmed via
two more symbolicated `.ips`/`.crash` files, including one gathered after a
genuine full delete+reinstall (ruling out stale AsyncStorage/Keychain data).
Both show the **identical** stack trace to build 14/16's crash:
`JSProxy::getPrototypeOf` → `ordinaryHasInstance` → `instanceOfOperator_RJS` →
`Runtime::drainJobs()`/`drainMicrotasks`, `SIGSEGV` at a near-null address
(`0x28`). The crashing thread is confirmed to be `RCTJSThreadManager`'s run
loop via `RuntimeScheduler_Modern::performMicrotaskCheckpoint` — the **main JS
runtime**, not a separate UI/worklet runtime thread.

Extensive candidate search (a dedicated sub-agent pass over
`node_modules`) ruled out every plausible trap-less-`getPrototypeOf` `Proxy` in
the reachable dependency chain: `@supabase/auth-js`'s `userNotAvailableProxy`/
`insecureUserWarningProxy` (wrong trigger conditions, and disproven directly by
the clean-reinstall test), `react-native-worklets`'s `INACCESSIBLE_OBJECT`
(only materializes on the UI/worklet runtime, not the main JS thread this
crash is confirmed on), `Proxy.revocable()` (zero usages anywhere in
`node_modules`), and no `new Proxy(` usage at all in `expo-router`,
`@react-navigation/*`, or `zustand`.

Reading Hermes's actual `JSProxy::getPrototypeOf` source: this crash shape
requires the Proxy's internal `target`/`handler` slots to already be
null/invalid **before** the function is even called — not a JS-level Proxy
misconfiguration a library would produce, but memory corruption. That's the
same *class* of bug as the build 14 async-void-TurboModule heap corruption
already fixed via `buildReactNativeFromSource: true` + the backported patch —
raising the question of whether that from-source build itself introduced a
*different* corruption source (e.g. an ABI mismatch between the freshly-built
RN core and the still-prebuilt `hermes.framework`), given the crash's first
appearance coincides with that change and worklets Bundle Mode (a separate,
already-applied fix) should independently prevent the original callGuardDEV
trigger from ever firing, making the from-source build's own patch
non-load-bearing.

No local Xcode available to test this via live debugger (this machine has
only Command Line Tools, and Xcode 26.6 requires macOS Tahoe 26.2 — the dev
machine is on Sonoma 14.8.2 and can't be upgraded). Testing via EAS build
instead: **reverted** `expo-build-properties`'s `ios.buildReactNativeFromSource`
and the now-coupled `./plugins/withFmtConstevalFix` (only needed when building
from source — see the fmt section above) from `app.json`, going back to
Expo's prebuilt RN core. `patches/react-native+0.81.5.patch` was left in place
un-removed (harmless — patch-package still applies it to a source file that
simply won't be compiled with the prebuilt core; trivial to re-enable by
restoring the two `app.json` plugin entries if this doesn't pan out).

**Not yet verified as the fix** — this is a single-variable test to confirm or
rule out the from-source build as the cause, not a confirmed root-caused
resolution. If this build 18 crashes identically, the from-source build is
ruled out and the investigation continues elsewhere (native/JSI-level, per the
sub-agent's other finding, or a genuine unreported Hermes engine bug). If the
crash disappears, the *original* callGuardDEV risk this config was protecting
against needs to be watched for on subsequent builds, though Bundle Mode
should independently prevent it.

## Build 18 result — inconclusive; buildReactNativeFromSource restored
The revert built successfully and genuinely took effect — confirmed via the
crash log's binary images, which now show `React.framework` and
`ReactNativeDependencies.framework` as separate prebuilt frameworks (build 17
had RN statically linked directly into the main `Flowlog` binary, as expected
when building from source).

The crash still happened, in the same operational shape: `instanceof` →
`getPrototypeOf` → `drainMicrotasks`, on the main JS thread, right after an
async continuation. **But** the crash address changed from a consistent
near-null `0x28` (every prior occurrence) to a large, effectively-random
`0x4647646c` — inconsistent with a single deterministic bug and more
consistent with a *different* corruption source now in play.

The reason: reverting `buildReactNativeFromSource` doesn't just change how RN
compiles — it also silently stops `patches/react-native+0.81.5.patch` from
applying, since that patch targets `RCTTurboModule.mm`, a source file that
only gets compiled when building from source. Build 18 wasn't a clean
single-variable test: it removed the from-source build **and** reintroduced
the exact heap-corruption class of bug that patch exists to prevent
(facebook/hermes#1957 / facebook/react-native#56265), at the same time. The
changed crash address is consistent with a second, different corruption
source now contributing, not with `buildReactNativeFromSource` being cleanly
ruled in or out.

Investigated `@react-native-async-storage/async-storage` as a candidate
uncovered call site (Supabase persists sessions through it on every sign-in,
and its native methods are async-completion-via-block, the same shape as the
original bug) — but its `codegenConfig`/podspec confirm it's a real Codegen'd
TurboModule exposing `Promise`-returning methods to JS, and
`ObjCTurboModule`'s dispatcher routes by the JS-facing signature, not the raw
ObjC one — so its calls go through `performMethodInvocation` (the
already-safe, promise-based path), not the vulnerable
`performVoidMethodInvocation`. Weakens this as the specific culprit, though a
different not-yet-identified async-void call site remains possible.

**Reverted the revert** — `ios.buildReactNativeFromSource: true` and
`./plugins/withFmtConstevalFix` restored in `app.json` (now identical to the
state before build 18's test commit), since removing them cost a known
protection without yielding clean evidence. The `JSProxy`/`JSObject`
`getPrototypeOf` crash remains **unresolved and not root-caused**. Next
diagnosis needs either genuine native-debugger access (blocked on this
machine — see the Xcode/macOS-version discussion above) or upstream input
(a detailed report to React Native/Hermes/Expo, since this crash signature
was not found in any existing public issue as of this writing).

## Auth bypass — testing everything else while sign-in stays unresolved
Confirmed via three unrelated trigger paths (OAuth, password signup, and — via
a live device test — that a crashed sign-in never persists a session, so
"just relaunch" doesn't recover one either) that the crash lives somewhere in
Supabase-js's own post-auth processing, not in any app-level code, and not
tied to any one sign-in method. Rather than keep spending build cycles on
narrower guesses, the pragmatic call: unblock everything *else* (profile
config, recording, the real edge-function pipeline, DB persistence) by
skipping the sign-in/signup UI entirely for now.

`src/services/authBypass.ts`'s `bootstrapAuthBypassSession()` — gated by
`isAuthBypass` (`src/config/featureFlags.ts`), on when both
`EXPO_PUBLIC_AUTH_BYPASS_EMAIL`/`_PASSWORD` are set — makes a **raw `fetch()`**
call to Supabase's `/auth/v1/token?grant_type=password` endpoint (no
Supabase-js involved at all) for a dedicated test account, then writes the
resulting session directly into the exact AsyncStorage key
(`sb-<project-ref>-auth-token`) and shape `supabase.auth.getSession()`
restores from on cold launch. `app/_layout.tsx` calls it before its existing
session-restore call. This deliberately never touches
`signInWithPassword`/`signInWithOAuth`/`exchangeCodeForSession`/`setSession`
— every method already proven or suspected to hit the crash — so the rest of
the app sees an already-authenticated user exactly as it would after a normal
successful login on a previous day, with real Supabase for everything
downstream (unlike `isDemoMode`/`isLocalPipeline`, which bypass Supabase
entirely and wouldn't exercise the real pipeline/DB at all).

Deliberately fetches a **fresh** session at launch rather than baking a
static one into the build: a token baked in at build time would likely
already be past its 1-hour expiry by the time the build reaches TestFlight
and gets installed, forcing an immediate `autoRefreshToken` refresh on
launch — which re-enters Supabase-js's own session-saving code, the exact
risk this is trying to avoid.

**Not a fix** — the sign-in crash itself remains open. Delete
`src/services/authBypass.ts`, its one call site in `app/_layout.tsx`, the
`AUTH_BYPASS_EMAIL`/`AUTH_BYPASS_PASSWORD` fields in `src/config/env.ts`, and
the `EXPO_PUBLIC_AUTH_BYPASS_*` entries in `eas.json`'s `testflight` profile
once real sign-in is resolved.

### Bug found while testing the bypass: Index redirected to /login before the async restore resolved
Build 19 shipped the bypass above but the tester still landed on the login
screen on every launch — a bug in the bypass wiring, not the underlying
crash. `app/index.tsx` read `authUser` from the store and redirected
synchronously on its first render; the root layout's session restore (now
with the bypass's extra `fetch()` round-trip in front of it) is async, so
`authUser` is still `null` at that first render regardless of whether a
real or bypassed session is about to load successfully. Once `Index`
redirects to `/login`, nothing routes the user away from it even after the
store updates moments later — only `Index` itself decides where to go, and
by then it's unmounted.

This same race always existed for a normal returning (already logged-in)
user too, just narrow enough to usually pass unnoticed as a brief flash
rather than a stuck screen. Fixed generally: added `authBootstrapped`
(`src/store/userStore.ts`), set once the root layout's initial restore
resolves (in every branch: demo/local mode and production, whether or not a
user was found). `Index` now renders a loading spinner instead of
redirecting until that flag is true.

## Build 20 — bypass unblocked new screens, revealing a different crash class
With the bypass landing straight in the app (confirmed working), the tester
reached `onboarding-finish`'s DB write and — for the first time ever in this
investigation — `app/(tabs)/record.tsx`, the only screen using
`react-native-reanimated`/`react-native-worklets`. The resulting crash was
structurally new: `RCTFatalException`/`SIGABRT`, not the native `SIGSEGV`
pattern from every build before it. The live capture showed a clean (if
unhelpfully generic) JS-level stack:
```
Unhandled JS Exception: [object Object]
*** Terminating app due to uncaught exception 'RCTFatalException: ...
_construct@5196:66
Wrapper@5168:24
_callSuper@3807:109
SyntheticError@5012:37
handleException@5094:34
handleError@29512:43
reportFatalError@757:38
guardedLoadModule@96:42
metroRequire@42:91
loadRoute@128110:41
getQualifiedRouteComponent@111363:31
```
`RCTFatalException` is React Native's *normal* handling of an uncaught JS
exception — not memory corruption. The thrown value stringified to
`"[object Object]"` with an empty `name`, consistent with a malformed Error
instance rather than a deliberately-thrown app error.

## Root cause found: `@react-native/babel-preset` downlevels classes for Hermes too
`_construct`/`Wrapper`/`_callSuper` are `@babel/runtime` helpers
(`helpers/construct.js`, `helpers/wrapNativeSuper.js`, `helpers/callSuper.js`)
that Babel emits when it transpiles `class X extends Error {}` down to an
ES5-compatible form — `Wrapper` calls `Reflect.construct(Error, args,
newTarget)`, and `_callSuper` does the same one level up. `SyntheticError` is
React Native's own internal class (`class SyntheticError extends Error`,
constructed by `handleException`/`reportFatalError` — RN's *global error
handler* — every time **anything** throws an uncaught error anywhere in the
app), so this ES5 downlevel path runs on every unhandled exception, not just
this one.

Checked `node_modules/@react-native/babel-preset/src/configs/main.js`
(`"main": "src/index.js"` in its `package.json` — it ships and runs as source,
no separate build step, so it's patchable the same way as the RN core patch
above). Every ES2015+ syntax transform in that file is explicitly gated behind
`!isHermes` (arrow functions, optional chaining, nullish coalescing, logical
assignment, computed properties, spread, object-rest-spread — Hermes supports
all of these natively, so the preset skips lowering them) — **except
`@babel/plugin-transform-classes`**, which runs unconditionally whenever the
source contains the string `class`:
```js
if (hasClass) {
  extraPlugins.push([require('@babel/plugin-transform-classes')]);
}
```
Hermes has supported native ES2015 classes, including `extends`-ing built-ins
like `Error`, since its first release — this transform gains nothing for a
Hermes target and only exists (per the surrounding pattern) because it was
never added to the `!isHermes` gate the other syntax transforms already use.
Patched to match:
```js
if (hasClass && !isHermes) {
  extraPlugins.push([require('@babel/plugin-transform-classes')]);
}
```
via `patches/@react-native+babel-preset+0.81.5.patch` (same `patch-package`
mechanism as the existing RN-core and Metro patches; picked up automatically
by the `postinstall` hook).

**Locally verified** (no build spent): a cold `expo export --no-bytecode
--no-minify` before vs. after the patch shows `SyntheticError` compiling to
native `class SyntheticError extends Error { ... }` instead of the
`_construct`/`_callSuper`/`Wrapper` chain. `npm run typecheck` and `npm test`
both pass identically before/after (the 3 pre-existing `notifications.test.ts`
failures — `Notifications.SchedulableTriggerInputTypes.CALENDAR` undefined in
the test mock — are confirmed unrelated: reproduced with the patch reverted
too; tracked separately, not part of this fix).

A pre-built third-party dependency (bundled `AssertionError`, Metro module
1571) still shows the same `_wrapNativeSuper`/`Reflect.construct` shape —
expected and out of scope, since it ships already-compiled and was never
processed by this project's Babel config to begin with, patched or not.

**Why this plausibly explains the whole session, not just this crash**: every
crash since build 16 has centered on `Reflect.construct`/`getPrototypeOf`/
`instanceof` around Error-like objects (`ErrorConstructor`/`JSError::setMessage`
in the very first crash; `JSProxy`/`JSObject::getPrototypeOf` during
`instanceof` in builds 16-19) — different surface triggers (DB error, auth
race, OAuth redirect, module load) but the same construction path underneath,
because `SyntheticError` is what RN's own error handler builds to report
*any* of them. If that shared path was the thing breaking, unrelated errors
that should have been caught and displayed gracefully could instead crash the
app via the reporting mechanism itself — which would explain why the trigger
kept moving across builds while the crash shape stayed so similar.

**Not yet confirmed on-device** — this is a strong, evidence-backed hypothesis
(direct match to the exact crashing stack trace, consistent with every prior
crash's frames, and cleanly, locally verified in the compiled bundle) but not
proven until a real TestFlight build reproduces the full flow without
crashing.

## Rollback
Most of this is one git commit's worth of diffs:
```bash
git checkout -- package.json babel.config.js metro.config.js app.json eas.json \
  CLAUDE.md src/providers/transcription/GeminiTranscriptionProvider.ts
rm -rf patches   # removes the metro bundle-mode SHA-1 patch, the
                 # RCTTurboModule.mm async-void-NSException patch, and the
                 # babel-preset Hermes-class-transform patch
```

## After it launches cleanly
- Re-enable OTA updates: set `app.json` `updates.enabled: true`, restore the
  `channel` on the `testflight` profile in `eas.json`, then `eas update`.
- Plan the `expo-av` → `expo-audio` migration before SDK 55 (av is removed there).
