-- Harden coaching_records against client access (wayfinder #37/#54).
--
-- 008 enabled RLS with no policy, which denies every ROW — an anon query
-- returns 200 with an empty array. That is safe today but relies on the
-- absence of a policy: add one carelessly later and the table is immediately
-- readable by every client.
--
-- These records are derived from third-party instructional material and are
-- read only by the process-session function through the service role, which
-- bypasses both grants and RLS. So remove the table-level grant entirely.
-- Access then requires the service role, by construction rather than by the
-- continued absence of a policy.
revoke all on public.coaching_records from anon, authenticated;

-- Future tables in this schema should not hand these roles a grant either.
-- (Scoped to this migration's owner; harmless if already the case.)
comment on table public.coaching_records is
  'Distilled coaching mechanics used to ground cues. No link to source material by design; full provenance stays on the authoring machine. Service-role only — grants revoked from anon/authenticated, so clients cannot query it at all.';
