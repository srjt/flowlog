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

## Rollback
Most of this is one git commit's worth of diffs:
```bash
git checkout -- package.json babel.config.js metro.config.js app.json eas.json \
  CLAUDE.md src/providers/transcription/GeminiTranscriptionProvider.ts
rm -rf patches   # removes the metro bundle-mode SHA-1 patch
```

## After it launches cleanly
- Re-enable OTA updates: set `app.json` `updates.enabled: true`, restore the
  `channel` on the `testflight` profile in `eas.json`, then `eas update`.
- Plan the `expo-av` → `expo-audio` migration before SDK 55 (av is removed there).
