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

## Stage 4: Persistence

- Audio uploaded via `storageProvider.uploadAudio` (failure degrades gracefully
  — the analysed session is still saved with a null audio path)
- Session row written via `storageProvider.saveSession`, tagged with
  `pipeline_version` so it can be reprocessed later

## Adding a Pipeline Stage

1. Define input/output types in `src/types/pipeline.ts`
2. Create service in `src/services/`
3. Add step to `FlowlogPipeline.ts` with sport context threading + a
   `ProcessingStepName`
4. Update this document
5. Add integration test covering happy path and failure path
