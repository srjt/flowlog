# Architecture Decision Log

---

### 001 — Sport context isolation pattern

**Date:** 2026-06-14
**Decision:** All sport-specific logic (vocabulary, prompts, config) isolated in
`src/sports/{sportKey}/` behind `ISportContext` interface
**Rationale:** Horizontal expansion to golf, tennis, chess requires zero pipeline
code changes. Adding a sport is purely a content task.
**Trade-offs:** More files per sport, context injection adds slight complexity
**Alternatives Rejected:** Sport-specific switch statements in pipeline (creates
coupling, untestable, doesn't scale)

### 002 — Two-stage AI pipeline

**Date:** 2026-06-14
**Decision:** Separate extraction and coaching into two sequential AI calls
**Rationale:** Single combined prompt degrades both outputs. Separation allows
independent prompt optimization, cost monitoring per stage, and easier quality
gate targeting
**Trade-offs:** ~2x latency, ~2x cost per session vs single call
**Alternatives Rejected:** Single prompt (tested in Wizard of Oz validation phase
— output quality was inconsistent)

### 003 — Supabase over custom backend

**Date:** 2026-06-14
**Decision:** Supabase as sole backend platform
**Rationale:** Auth + Postgres + Storage + Edge Functions + RLS in one platform.
No dedicated backend engineer needed at MVP stage.
**Trade-offs:** Vendor lock-in, less infrastructure control
**Alternatives Rejected:** Firebase (weaker Postgres querying for trend
analysis), custom Node.js (too much overhead for MVP)

### 004 — RevenueCat over direct Stripe mobile

**Date:** 2026-06-14
**Decision:** RevenueCat for mobile subscription management
**Rationale:** Handles App Store and Google Play subscription complexity, receipt
validation, and webhook normalization out of the box
**Trade-offs:** Additional vendor dependency, revenue share above free tier
**Alternatives Rejected:** Direct Stripe SDK (no native App Store subscription
support)

### 005 — Expo Router over React Navigation

**Date:** 2026-06-14
**Decision:** File-based routing via Expo Router
**Rationale:** Faster iteration, built-in deep linking, aligned with Expo SDK 51+
**Trade-offs:** Less flexibility for complex custom navigation flows
**Alternatives Rejected:** React Navigation (more boilerplate, slower to iterate
at MVP stage)

### 006 — Feature flags for unreleased features

**Date:** 2026-06-14
**Decision:** All non-MVP features (trend analysis, game profile, social, video,
additional sports) behind env-configured feature flags
**Rationale:** Allows scaffold of future architecture without shipping incomplete
features. Flag state is explicit and auditable.
**Trade-offs:** Flag debt accumulates if not cleaned up post-launch
**Alternatives Rejected:** Separate branches per feature (merge conflicts, harder
to track overall state)

### 007 — Typed, validated env as the only `process.env` reader

**Date:** 2026-06-14
**Decision:** `src/config/env.ts` is the single file allowed to read
`process.env`; it validates and throws at startup on misconfiguration. An ESLint
rule forbids `process.env` everywhere else.
**Rationale:** Misconfiguration fails fast and loud at boot instead of surfacing
as a confusing runtime bug deep in the pipeline; types prevent stringly-typed
mistakes.
**Trade-offs:** One extra indirection to add a new variable
**Alternatives Rejected:** Reading `process.env` ad hoc (untyped, unvalidated,
easy to leak secrets to the client bundle)

### 008 — Dependency injection for services and the pipeline

**Date:** 2026-06-14
**Decision:** Services and `FlowlogPipeline` accept collaborators via
constructors, defaulting to env-selected singletons.
**Rationale:** Makes the pipeline and services unit/integration testable with
mocks while keeping production call sites zero-config.
**Trade-offs:** Slightly more constructor boilerplate
**Alternatives Rejected:** Importing singletons directly inside services
(impossible to mock cleanly, forces network in tests)

### 009 — Pin Metro 0.80.9, NativeWind 4.0.36, Reanimated 3.10.1

**Date:** 2026-06-14
**Decision:** Pin `metro@0.80.9` (via `overrides` + direct devDeps),
`nativewind@4.0.36`, and `react-native-reanimated@~3.10.1`.
**Rationale:** These are the Expo SDK 51 / React Native 0.74 compatible
versions. npm otherwise hoists newer transitive versions that break the build:
Metro 0.84 moved the `TerminalReporter` export that `@expo/cli` imports;
NativeWind 4.2.x ships a css-interop built for the new architecture that requires
`react-native-worklets` (peer `react-native@0.83+`), which is incompatible with
RN 0.74. The pins were validated end-to-end with `expo export` (1090 modules
bundled). The committed `package-lock.json` locks the full verified tree.
**Trade-offs:** Must consciously re-verify these when upgrading the Expo SDK.
**Alternatives Rejected:** Letting npm resolve latest (produces a tree that
fails to bundle); using `expo install` to auto-align (correct in principle, but
the same pins must end up in package.json for reproducible CI installs).
**How to apply:** When bumping the Expo SDK, update all three pins together to
the versions the new SDK expects (check `expo`'s bundled versions), then re-run
`npm test`, `npm run typecheck`, and `npx expo export`.

### 010 — Pipeline runs in a Supabase edge function (secrets server-side)

**Date:** 2026-06-15
**Decision:** The live pipeline executes in the `process-session` Supabase edge
function (Deno). The client uploads audio to Storage and invokes the function;
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` live in function secrets. The client
entry point is `src/pipeline/PipelineClient.ts`.
**Rationale:** Expo only exposes `EXPO_PUBLIC_*` env vars to the app, and API
keys must never ship in a client bundle. Running the transcription + AI calls
server-side keeps secrets secure and lets the server hold the service role for
privileged writes. The function derives `userId` from the caller's JWT rather
than trusting client input.
**Trade-offs:** The pipeline logic now exists in two places — the unit-tested
reference in `src/` and the Deno edge function. They must be kept in sync. Sport
content is single-sourced (`_shared/sports.ts` imports the pure files from
`src/sports/`) to limit drift to the orchestration + AI-call code.
**Alternatives Rejected:** Calling OpenAI/Anthropic directly from the client
(leaks keys, and the keys aren't even available on the Expo client); a separate
Node backend (Supabase edge functions are already part of the stack — decision
#003).
**How to apply:** Change pipeline behaviour in BOTH `src/` (with tests) and
`supabase/functions/`. Deploy with `supabase functions deploy process-session`
after `supabase secrets set ...`.
