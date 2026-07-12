# Flowlog — Agent Entry Point

## What Flowlog Does

Flowlog is a voice reflection tool for serious hobbyists. The user records a
60–90 second post-session voice dump. A two-stage AI pipeline transcribes it
using sport-specific vocabulary priming, extracts structured positional data,
and returns one mechanical coaching cue (max 25 words). Sessions accumulate into
a trend log that surfaces recurring weaknesses over time.

Tagline: "Talk. Reflect. Improve."

## Current State

- **Phase:** 1 — Project scaffold, provider abstraction layer, sport context system
- **Active Sport:** BJJ (beachhead market)
- **Stubbed Sport:** Golf (structure only)
- **Last Updated:** 2026-06-20
- **Build Status:** Migrating to **Expo SDK 54** (RN 0.81 / React 19.1 /
  Reanimated 4). Reason: Apple requires the iOS 26 SDK (Xcode 26) for all App
  Store / TestFlight uploads, and SDK 51 (RN 0.74) native modules crash at launch
  on the iOS 26 runtime (expo-updates `ErrorRecovery` abort, then an RN
  ExceptionsManager rethrow). After bumping deps, run `npx expo install --fix`
  on a real machine, then `npm test` / `tsc --noEmit` / `expo export` to
  re-verify before the EAS rebuild. See `docs/TESTFLIGHT.md`.
- **New Architecture is ON** (`app.json` `newArchEnabled: true`) — Reanimated 4
  requires it. **OTA updates are ON** (`updates.enabled: true`, channel
  `testflight` in `eas.json`): JS-only fixes ship with
  `npx eas-cli update --channel testflight` — no EAS build needed. NEVER bump
  `app.json` `version` in a JS-only change (runtimeVersion policy is
  `appVersion`; a bump orphans shipped builds off the update stream). Version
  bumps happen only alongside a planned EAS build.
- **Toolchain (SDK 54 compatible):** `react-native@0.81`, `react@19.1`,
  `nativewind@^4.2`, `react-native-reanimated@~4.3.2` +
  `react-native-worklets@~0.8.3` (its worklet plugin must be last in
  `babel.config.js`). Reanimated/worklets are INTENTIONALLY ahead of SDK 54's
  pins (listed in `package.json` `expo.install.exclude`) — do NOT let
  `expo install --fix` downgrade them; see `docs/SDK54_UPGRADE.md` build 22.
  Worklets Bundle Mode was removed with 0.8.3. The app entry is `./index.js`
  (loads `src/utils/errorReporter.ts` before expo-router so fatal JS errors
  are readable). The old `metro@0.80.9` overrides have been REMOVED (SDK 54
  needs metro 0.83). `expo-av` still works in 54 (removed in 55) — migrate to
  `expo-audio` before SDK 55. Supersedes `docs/DECISIONS.md` #009, which
  applied only to SDK 51.

## Pipeline Runtime (IMPORTANT)

The live pipeline runs SERVER-SIDE in the Supabase edge function
`supabase/functions/process-session/`. API secrets (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`) live there via `supabase secrets set` and NEVER reach the
client (Expo only ships `EXPO_PUBLIC_*` vars). The client calls it via
`src/pipeline/PipelineClient.ts` (`usePipeline` hook): upload audio to Storage →
invoke the function → render the result.

`src/pipeline/FlowlogPipeline.ts` + `src/services/` + `src/providers/` are the
unit-tested REFERENCE implementation the edge function mirrors. Sport content
(`src/sports/`) is single-sourced and imported by both. See `docs/PIPELINE.md`.

## Non-Negotiable Rules for Every Agent

1. NEVER call an external AI/transcription API from a component or screen, and
   NEVER put `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in client code. Those calls
   belong in the `process-session` edge function. The client orchestrates only
   via `src/pipeline/PipelineClient.ts`. The `src/providers/` + `FlowlogPipeline`
   reference implementation is mirrored server-side in `supabase/functions/`.
2. NEVER hardcode API keys or sport-specific logic. Config from
   `src/config/env.ts`, sport logic from `src/sports/`.
3. NEVER add a sport's vocabulary, prompts, or logic anywhere outside
   `src/sports/{sportKey}/`.
4. NEVER modify the database schema without a new migration file in
   `supabase/migrations/`.
5. NEVER bypass the quality gate before returning output to the UI.
6. The coaching cue is HARD capped at 25 words. Enforced in `CoachingService.ts`
   AND in the Claude system prompt (`src/sports/{sportKey}/{sport}Prompts.ts`).
   Do not change this without updating both.
7. NEVER use `process.env` directly — always use `src/config/env.ts`. This is
   enforced by an ESLint rule.
8. Run `npm test` before marking any task complete. Zero test failures required.

## Where to Start

- Understand the pipeline: `docs/PIPELINE.md`
- Understand provider swapping: `docs/PROVIDERS.md`
- Understand how to add a sport: `docs/SPORTS.md`
- Understand the data model: `docs/DATABASE.md`
- See all architecture decisions: `docs/DECISIONS.md`
- Architecture overview & layer rules: `docs/ARCHITECTURE.md`
- Testing standards: `docs/TESTING.md`

## Active Providers

- Transcription: `WhisperProvider` (OpenAI)
- AI: `ClaudeProvider` (Anthropic `claude-sonnet-4-6`)
- Storage: `SupabaseStorageProvider`
- Payments: `RevenueCatProvider` (stubbed)

## Feature Flags (all false in MVP)

- `FEATURE_TREND_ANALYSIS` — unlocks after 10 sessions
- `FEATURE_GAME_PROFILE` — unlocks after 10 sessions
- `FEATURE_SOCIAL` — not in MVP
- `FEATURE_VIDEO_INTEGRATION` — not in MVP
- `FEATURE_GOLF_SPORT` — not in MVP

## What Is Explicitly NOT Built Yet

- Golf sport context content (structure exists, content is TODO)
- Real audio recording (expo-av) — BUILT (web via MediaRecorder)
- Supabase auth — BUILT (`src/services/AuthService.ts`); login/signup are real,
  plus Google/Apple OAuth (PKCE, no client secrets) and password reset. OAuth
  providers must be enabled in the Supabase dashboard (server/config side).
- Weekly re-engagement digest — BUILT (`DigestSettings` + `applyDigestPrefs`;
  local weekly notification summarizing focus area + recurring leak, opens
  Trends; summary baked from `computeTrends`, refreshed on Trends focus)
- Accessibility — labels/state on icon/emoji/record/chip controls, OS Dynamic
  Type respected (`Text` never forces `allowFontScaling` off), reduced-motion on
  the record pulse + first-result celebration, ≥44px interactive targets
- First-run onboarding — BUILT (`app/(onboarding)/`, account-first; gated by
  `profiles.onboarding_complete`, migration 004)
- Local post-training reminders — BUILT (`src/services/NotificationService.ts`
  + Profile prefs; native only, web no-ops; deep-links into Record on tap)
- First-result celebration + unlock progress — BUILT
  (`src/components/FirstResultCelebration.tsx`, one-time persisted flag)
- Log week-grouping / search / filter — BUILT (`SectionList` in
  `app/(tabs)/log.tsx`, `src/utils/groupSessionsByWeek.ts`)
- Session detail native header + Share + Delete — BUILT (`app/session/[id].tsx`;
  delete via `sessionsSource.deleteSession`, RLS "Users own their sessions")
- The pipeline supports Whisper/Claude AND Gemini (transcription + analysis),
  client and server, selectable by env. See `supabase/SETUP.md` for the
  Gemini-on-Supabase production setup.
- Video integration
- Social or sharing features
- Game profile (behind feature flag)
- Trend analysis UI (behind feature flag)
- Trend computation edge function (`supabase/functions/` — note: the
  `process-session` pipeline function IS built; trend recompute is not)
- B2B coach dashboard
- Android-specific testing

## Quick Commands

```bash
npm install        # install dependencies
npm start          # expo start
npm test           # run the test suite (must pass before any commit)
npm run lint       # eslint (enforces the process.env rule)
npm run typecheck  # tsc --noEmit (strict mode)
```
