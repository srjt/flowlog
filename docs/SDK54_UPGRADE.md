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

## Rollback
Most of this is one git commit's worth of diffs:
```bash
git checkout -- package.json babel.config.js metro.config.js app.json eas.json \
  CLAUDE.md src/providers/transcription/GeminiTranscriptionProvider.ts
rm -rf patches   # removes the metro bundle-mode SHA-1 patch and the
                 # RCTTurboModule.mm async-void-NSException patch
```

## After it launches cleanly
- Re-enable OTA updates: set `app.json` `updates.enabled: true`, restore the
  `channel` on the `testflight` profile in `eas.json`, then `eas update`.
- Plan the `expo-av` → `expo-audio` migration before SDK 55 (av is removed there).
