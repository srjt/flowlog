# 0007. Typed, validated env as the only `process.env` reader

**Status:** accepted · **Date:** 2026-06-14

`src/config/env.ts` is the single file allowed to read `process.env`. It
validates and throws at startup on misconfiguration, and an ESLint rule forbids
`process.env` everywhere else. Misconfiguration therefore fails fast and loud at
boot instead of surfacing as a confusing runtime bug deep in the pipeline, and
types prevent stringly-typed mistakes.

## Consequences

- One extra indirection to add a new variable.

## Considered options

- **Reading `process.env` ad hoc** — rejected: untyped, unvalidated, and easy to
  leak secrets into the client bundle.
