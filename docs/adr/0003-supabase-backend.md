# 0003. Supabase as the sole backend

**Status:** accepted · **Date:** 2026-06-14

Supabase is the only backend platform: auth, Postgres, Storage, Edge Functions,
and RLS in one place. This means no dedicated backend engineer is needed at the
MVP stage.

## Consequences

- Vendor lock-in and less infrastructure control.

## Considered options

- **Firebase** — rejected: weaker Postgres querying for trend analysis.
- **Custom Node.js backend** — rejected: too much overhead for an MVP.
