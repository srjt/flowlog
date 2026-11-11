# The Flowlog Pipeline

## Overview

Two-stage AI pipeline deliberately separated to maximize output quality. Sport
context is injected at the pipeline entry point and flows through every stage.

## Run modes (client)

`PipelineClient.run` picks a path from env flags:

- **Demo** (`EXPO_PUBLIC_DEMO_MODE=true`) — canned results, fully offline.
- **Local test** (`EXPO_PUBLIC_LOCAL_PIPELINE=true`) — runs the real
  `FlowlogPipeline` directly in the client with `WhisperProvider` +
  `ClaudeProvider` keyed from `EXPO_PUBLIC_*` vars and an in-memory storage
  provider. No Supabase. LOCAL TESTING ONLY (keys are in the client bundle).
- **Production** (both off) — uploads audio to Storage and invokes the
  `process-session` edge function (secrets server-side).

## Where it runs

The live pipeline runs **server-side** in the Supabase edge function
`supabase/functions/process-session/` (Deno). API secrets live there and never
reach the client. The client entry point is
`src/pipeline/PipelineClient.ts` (`PipelineClient.run`), which uploads the audio
to Storage and invokes the function.

`src/pipeline/FlowlogPipeline.ts` is the **reference implementation** of the
same stages, fully unit-tested with mocked providers. The edge function mirrors
it. When you change pipeline behaviour, change both and keep the tests green.

**The mirror is hand-maintained, and it has already drifted once.** Grounding
was added to the client providers and to the edge function's *signature*, but
the edge function never filled `{{GROUNDING}}` — so for every production
session the prompt carried the literal placeholder and no mechanics, while
`sessions.grounding` recorded `grounded` with the injected record ids. Nothing
failed, because `fillTemplate` replaces only the keys it is handed and no test
loads the Deno function. `tests/unit/promptPlaceholders.test.ts` now asserts
that every `{{PLACEHOLDER}}` in a sport prompt is supplied at **every** call
site — client and server — by scanning the sources. Add a placeholder to a
prompt and that test tells you which call sites still need it.

Note that `tsconfig.json` excludes `supabase/functions`, so `npm run typecheck`
does not cover the edge function. Use `deno check
supabase/functions/process-session/index.ts` after changing it.

The stages below describe the logic in both places. Entry point (reference):
`FlowlogPipeline.run(input, onProgress?)`; entry point (production): the edge
function handler. Both fetch sport context from the registry and thread it
through every stage.

## Stage 0: Sport Context Loading

`getSportContext(sportKey)` fetches the active sport config from the registry.
All downstream stages use this context — never hardcoded sport logic.

## Stage 1: Transcription

- Provider: `ITranscriptionProvider` (active: Whisper)
- Vocabulary priming: `sportContext.vocabulary` passed to Whisper
- Output: `TranscriptionResult` with confidence and detected terms
- `TranscriptionService` rejects recordings below `minRecordingSeconds` and
  empty transcripts so junk input never reaches the AI stages.

## Stage 2a: Extraction

- Provider: `IAIProvider` (active: Claude)
- Prompt: `sportContext.extractionPrompt`
- Output: strict JSON `ExtractionOutput`
- Rule: extraction prompt does NOT generate coaching. Separation is intentional
  and must be maintained.
- Besides the facts, Extraction makes the judgements that need the language:
  whether there is anything to coach (`hasCoachableContent`, #44), which side
  the athlete was on (`perspective`, #48), whether the gi was stated
  (`statedGi`, #60), and what the key mistake is about (`mistakeConcerns`,
  #153): `position`, `submission` (their own attack), `transition` or
  `unknown`. Each is normalised on both sides, and an unexpected value becomes
  `unknown`. `normaliseMistakeConcerns` is single-sourced in
  `src/sports/grounding.ts`, so the client and the edge cannot disagree.

## Stage 2a½: Grounding

Selects the Coaching records placed in front of the coaching model. It runs
BEFORE coaching, from the extraction: the cue's own target position is resolved
from the coaching output, too late to inform the call it is part of. The
decisions are dependency-free and shared by `FlowlogPipeline.loadGrounding` and
the edge function: `src/sports/grounding.ts` (scope, ranking, rendering) and
`src/sports/experiment.ts` (outcomes and the arm).

1. **Whether to ground at all** (`groundingScope`, #153). When Extraction says
   the key mistake is about a `submission` or a `transition`, grounding
   abstains: no records are looked up, ranked or injected, and the Session
   records `grounding = 'not_positional'`. The positions co-mentioned beside
   such a mistake ("couldn't finish the reverse triangle" with
   `["Side Control", "Reverse Triangle"]`) would otherwise ground the cue in a
   different problem; #116 measured 3 of 16 grounded Sessions doing so.
   `position` and `unknown` ground exactly as before, so an unsure Extraction
   never quietly loses grounding.
2. **Candidate positions**: every position in `positionsVisited` that resolves
   to a canonical id, using the side and the transcript.
3. **Fetch, gi filter, rank, cap**: records for those positions, filtered by gi
   context, ranked by overlap with the key mistake, gated by
   `GROUNDING_MIN_RELEVANCE` and capped at `GROUNDING_RECORD_LIMIT`.
4. **Outcome** (`sessions.grounding`): `grounded` or `withheld` (the arms, at a
   rollout of 1 always `grounded`), or the eligibility outcomes `no_position`
   (nothing resolved: a taxonomy problem), `no_records` (nothing survived: a
   corpus or filter problem), `declined` (nothing to coach) and
   `not_positional` (abstained on purpose: neither of the first two, and
   nothing for the mining backlog). Re-analysis inherits only an arm;
   eligibility is recomputed from the edited extraction.

The funnel is stored beside the outcome: `grounding_candidates` (the pool),
`grounding_gate_passed` (cleared the relevance gate) and `grounding_records`
(injected). When nothing was looked up (declined, abstained, or a failed
lookup) the first two are NULL, meaning not measured, never 0.

## Stage 2b: Coaching Generation

- Provider: `IAIProvider` (active: Claude)
- Prompt: `sportContext.coachingPrompt`
- Input: structured JSON from extraction + last 5 session mistakes + skill level
  + dominant weakness
- Output: `CoachingOutput` with 25-word cue
- Rule: coaching prompt receives structured JSON only, never raw transcript

## Stage 3: Quality Gate

- Location: `src/services/QualityGateService.ts`
- Checks word count, generic phrase list from `sportContext.qualityGatePhrases`,
  model `isGeneric` flag, and confidence >= 0.6
- On failure: retry up to `QUALITY_GATE_RETRY_LIMIT` with a stricter prompt
  (the pipeline passes `strict: true` to the coaching provider on each retry)
- On max retry: log failure to monitoring, return a safe capped fallback, never
  crash or expose an error to the user

## Stage 3b: Cue → diagram spec (#135, best-effort, inert until phase c)

The Cue is to be shown beside a deterministic force diagram: a certified base
pose of the position with the Cue's mechanic drawn over it from a small
structured **spec**. This stage produces the spec. It is strictly additive: it
runs after the gate on the Cue that will be saved, it can describe that Cue but
never change it, and nothing it does can fail the Session.

- Decisions: `runDiagramStage` in `src/visualization/diagramStage.ts`, shared
  by `FlowlogPipeline` (through `DiagramSpecService`) and the edge function
  (`cueDiagram`), so the two cannot disagree about when the model is called or
  what the row records. The pure prompt, schema and parser are
  `src/visualization/specStage.ts` (see `src/visualization/README.md`).
- When it calls the model: only when the gate passed with a real Cue (not its
  fallback) AND the sport's base library (`sportContext.diagram`, from
  `src/sports/{sport}/`) has a base for the Session's canonical position
  (`targetPositionId`). Bases are keyed by the sided id (`de-la-riva-bottom`).
- The call: `IAIProvider.generateDiagramSpec` / `generateDiagramSpec` in
  `supabase/functions/_shared/ai.ts`, on the extraction model (`GEMINI_MODEL`),
  JSON mode, temperature 0, aborted after `SPEC_STAGE_TIMEOUT_MS` (6 s). The
  structured-output schema is built but NOT sent natively (Gemini's
  `responseSchema` rejects the `additionalProperties` it relies on), so the
  constraints travel in the prompt and `parseSpecResponse` + `validateSpec`
  are the floor in code. Providers never throw; a failure is `null`.
- Output: `diagramOutcome` (`spec`, `no_base`, `not_attempted`, `empty`,
  `invalid`, `unavailable`), the validated spec when there is one, and the
  `GRAMMAR_VERSION` / base library version / `SPEC_PROMPT_VERSION` that
  produced it. Written on all four Session writes (see `docs/DATABASE.md`).
- **Inert today.** The BJJ base library (`src/sports/bjj/bjjDiagramBases.ts`)
  is empty until certified poses exist (phase c, #136), so every Session records
  `no_base` and no model call is made: zero cost, zero latency. The Cue, the
  quality gate and Grounding are untouched, and `pipeline_version` was not
  bumped. `no_base` grouped by `target_position_id` is phase c's authoring
  backlog.
- No processing step: the stage adds nothing to the UI's step list.

## Stage 4: Persistence

- Audio uploaded via `storageProvider.uploadAudio` (failure degrades gracefully
  — the analysed session is still saved with a null audio path)
- Session row written via `storageProvider.saveSession`, tagged with
  `pipeline_version` so it can be reprocessed later

## Re-analysis (correcting a saved session)

The cue is shown immediately after recording — there is no pre-cue review step.
If a word was mis-heard, the user edits the saved session's transcript (on
Session detail) and re-analyzes. Re-analysis re-runs Stages 2a → 3b (extraction →
coaching → quality gate → diagram spec) on the edited text — **no transcription, no audio** —
and **updates the same session row in place** (bumping `pipeline_version`), never
inserting a new one. Reference entry point: `FlowlogPipeline.reanalyze(input)`;
production: the `process-session` reprocess branch (`reanalyzeSessionId` +
`editedTranscript`), which verifies ownership and skips the insert-time
idempotency and daily-cap checks. See ADR 0011.

## Adding a Pipeline Stage

1. Define input/output types in `src/types/pipeline.ts`
2. Create service in `src/services/`
3. Add step to `FlowlogPipeline.ts` with sport context threading + a
   `ProcessingStepName`
4. Update this document
5. Add integration test covering happy path and failure path
