# Architecture

## Core Principle

Every external dependency is behind an interface in `src/providers/`. Every
sport-specific element is isolated in `src/sports/`. The pipeline and services
depend on interfaces and sport contexts — never on concrete implementations or
hardcoded sport logic.

## Expansion Model

Adding a new sport requires exactly:

1. Create `src/sports/{sportKey}/` with context, vocabulary, and prompts
2. Register it in `src/sports/index.ts`
3. Set feature flag in env
4. Zero changes to pipeline, services, or providers

## Data Flow

The live pipeline runs server-side so secrets never reach the client:

```
Screen → usePipeline → PipelineClient
       → upload audio to Supabase Storage
       → invoke edge function `process-session`  ─────────────┐
                                                              │ (server, secrets here)
   getSportContext → transcribe(Whisper) → extract(Claude) ──┤
   → coach(Claude) → quality gate → persist to Postgres      │
       ← PipelineOutput ──────────────────────────────────────┘
       → Screen
```

`src/pipeline/FlowlogPipeline.ts` + `src/services/` + `src/providers/` are the
unit-tested reference implementation; the edge function under
`supabase/functions/process-session/` is its production deployment. Sport
content in `src/sports/` is single-sourced and imported by both.

## Layer Responsibilities

| Layer          | Location          | Rule                                                     |
| -------------- | ----------------- | -------------------------------------------------------- |
| Screens        | `app/`            | UI only. Calls pipeline (via hook) or store. No business logic |
| Pipeline       | `src/pipeline/`   | Orchestrates services. Single entry point for all AI ops |
| Services       | `src/services/`   | Business logic. Uses providers via interfaces            |
| Providers      | `src/providers/`  | External API implementations. Swappable via env          |
| Sport Contexts | `src/sports/`     | All sport-specific config, vocabulary, prompts           |
| Store          | `src/store/`      | Client state only. No async API calls                    |
| Types          | `src/types/`      | Shared interfaces. No implementation                     |
| Config         | `src/config/`     | Env vars and feature flags. Single source of truth       |

## Dependency Injection

Services and the pipeline accept their collaborators through constructors,
defaulting to the env-selected singletons. This is what makes the system
testable: integration tests construct `new FlowlogPipeline({ ...mocks })` and
unit tests construct `new CoachingService(mockAIProvider)`. Production code uses
the zero-arg defaults.

## Key Constraints

- Max recording: 90 seconds (env configurable)
- Min recording: 20 seconds (pipeline rejects below this)
- Coaching cue: 25 words maximum, hard enforced at service and prompt level
- Quality gate: runs before any output reaches UI, max 2 retries
- Pipeline cost target: under $0.02 per session at current API pricing
- All tables have RLS enabled — users access only their own data
