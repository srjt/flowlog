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
- **Last Updated:** 2026-06-14
- **Build Status:** Scaffold complete and VERIFIED. `npm test` (59 tests,
  6 suites) passes, `tsc --noEmit` is clean, and `expo export` bundles all 1090
  modules with Expo Router discovering every screen. Recording capture (expo-av)
  and Supabase auth are stubbed with TODOs.
- **Pinned toolchain (do NOT bump without re-verifying):** `metro@0.80.9`,
  `nativewind@4.0.36`, `react-native-reanimated@~3.10.1`. These are the
  Expo SDK 51 / RN 0.74 compatible versions. Newer NativeWind (4.2.x) pulls a
  new-architecture Reanimated/worklets chain that breaks the SDK 51 bundle.
  See `docs/DECISIONS.md` #009.

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
