# 0002. Two-stage AI pipeline

**Status:** accepted · **Date:** 2026-06-14

Extraction and coaching are two sequential AI calls, not one combined prompt. A
single prompt degraded both outputs; separating them lets us optimize each
prompt independently, monitor cost per stage, and target the quality gate more
precisely.

## Consequences

- Roughly 2x latency and 2x cost per session versus a single call.

## Considered options

- **Single combined prompt** — rejected: tested in the Wizard-of-Oz validation
  phase and output quality was inconsistent.
