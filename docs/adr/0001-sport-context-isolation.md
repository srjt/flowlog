# 0001. Sport context isolation pattern

**Status:** accepted · **Date:** 2026-06-14

All sport-specific logic (vocabulary, prompts, config) is isolated in
`src/sports/{sportKey}/` behind the `ISportContext` interface. The pipeline is
sport-agnostic: it takes a sport key, fetches the matching context from the
registry, and threads it through every stage. We chose this so horizontal
expansion to golf, tennis, or chess is a pure content task with zero pipeline,
service, or provider changes.

## Consequences

- More files per sport, and context injection adds slight complexity.

## Considered options

- **Sport-specific switch statements in the pipeline** — rejected: creates
  coupling, is untestable, and does not scale as sports are added.
