# Provider System

## How to Swap a Provider

1. Create new provider implementing the relevant interface
2. Add to provider `index.ts` map
3. Set new provider key in `.env.local`
4. Run provider test suite

Example — swapping transcription from Whisper to a future Deepgram provider:
implement `ITranscriptionProvider` in `DeepgramProvider.ts`, add
`deepgram: () => new DeepgramProvider()` to
`src/providers/transcription/index.ts`, set `TRANSCRIPTION_PROVIDER=deepgram`.
No service, pipeline, or screen code changes.

## How to Add a New Provider

1. Create `src/providers/{category}/YourProvider.ts`
2. Implement the full interface — no partial implementations
3. Add mock to `tests/mocks/`
4. Add unit tests: happy path, network failure, malformed response, timeout
5. Add to `index.ts` provider map
6. Document in `docs/DECISIONS.md`

## Where providers run

The AI and transcription providers make calls that require secret API keys, so
in production they run **server-side** inside the `process-session` edge
function (`supabase/functions/_shared/ai.ts`), which reads keys from
`Deno.env`. The `src/providers/ai` and `src/providers/transcription`
implementations are the unit-tested reference that the function mirrors — they
are not invoked from the client app. The **storage** provider DOES run on the
client (audio upload, reading session history); only the secret-bearing calls
moved server-side.

## Current Provider Status

| Category      | Interface              | Active                  | Stubs Available |
| ------------- | ---------------------- | ----------------------- | --------------- |
| Transcription | ITranscriptionProvider | WhisperProvider         | —               |
| AI            | IAIProvider            | ClaudeProvider          | OpenAIProvider  |
| Storage       | IStorageProvider       | SupabaseStorageProvider | —               |
| Payments      | IPaymentsProvider      | RevenueCatProvider      | —               |

## Provider Selection

Each category's `index.ts` reads the active provider key from `@/config/env` and
constructs the matching implementation from a factory map. Selection happens
once at module load; an unknown key throws a descriptive error listing the
available providers.

## Cost Monitoring

Every provider logs estimated cost per call to the console in development (via
`src/utils/cost.ts`). Use `src/constants/pipelineConfig.ts` `COST_ESTIMATES` for
pricing estimates. This makes cost regression visible during development before
it hits production billing; the pipeline integration test also asserts the
estimated per-session cost stays under the alert threshold.
