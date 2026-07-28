# 0006. Feature flags for unreleased features

**Status:** accepted · **Date:** 2026-06-14

All non-MVP features (trend analysis, game profile, social, video, additional
sports) sit behind env-configured feature flags. This lets us scaffold future
architecture without shipping incomplete features, and keeps flag state explicit
and auditable.

## Consequences

- Flag debt accumulates if flags are not cleaned up post-launch.

## Considered options

- **Separate branches per feature** — rejected: merge conflicts and harder to
  track the overall state of the system.
