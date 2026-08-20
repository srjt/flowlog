# Flowlog Docs — Primary Agent Entry Point

This is the documentation index. The canonical project-state summary and the
non-negotiable rules live in the **root** [`/CLAUDE.md`](../CLAUDE.md) (Claude
Code discovers that file first). Read it before anything else, then use this
index to go deep.

## Read in this order

1. [`/CLAUDE.md`](../CLAUDE.md) — project state, rules, active providers, flags.
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, responsibilities, expansion model.
3. [`PIPELINE.md`](./PIPELINE.md) — the two-stage AI pipeline, stage by stage.
4. [`PROVIDERS.md`](./PROVIDERS.md) — how to swap or add an external provider.
5. [`SPORTS.md`](./SPORTS.md) — how to add a new sport (3 files + 1 registry line).
6. [`DATABASE.md`](./DATABASE.md) — schema, RLS, migration rules.
   - [`MIGRATIONS.md`](./MIGRATIONS.md) — keeping prod schema in sync with
     `supabase/migrations/`, and recovering from drift.
7. [`TESTING.md`](./TESTING.md) — what must be tested and the coverage targets.
8. [`adr/`](./adr/) — architecture decision records: why the architecture is the way it is.

## The one-paragraph mental model

A screen hands an audio URI to `FlowlogPipeline.run()`. The pipeline loads the
sport context from the registry (Stage 0), transcribes with vocabulary priming
(Stage 1), extracts structured data (Stage 2a), generates one ≤25-word coaching
cue (Stage 2b), runs it through the quality gate with retries (Stage 3), and
persists everything to Supabase (Stage 4). Every external call is behind a
provider interface; every sport-specific element is behind a sport context. Core
code never branches on sport and never touches `process.env`.
