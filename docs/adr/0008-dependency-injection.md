# 0008. Dependency injection for services and the pipeline

**Status:** accepted · **Date:** 2026-06-14

Services and `FlowlogPipeline` accept their collaborators via constructors,
defaulting to the env-selected singletons. This makes the pipeline and services
unit- and integration-testable with mocks while keeping production call sites
zero-config.

## Consequences

- Slightly more constructor boilerplate.

## Considered options

- **Importing singletons directly inside services** — rejected: impossible to
  mock cleanly and forces real network calls in tests.
