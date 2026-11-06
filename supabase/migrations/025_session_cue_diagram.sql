-- ─────────────────────────────────────────────────────────────────────────────
-- Keep the Cue's force-diagram spec, and why there is or is not one (#135).
--
-- A Cue is to be shown beside a deterministic force diagram: a certified base
-- pose of the position, with the Cue's mechanic drawn over it from a small
-- structured spec. The spec comes from a best-effort pipeline stage that runs
-- after the quality gate. This migration stores what that stage decided, plus
-- the versions of the three things that produced it, so a diagram can be
-- re-rendered later and a change in quality can be traced:
--
--   diagram_spec          the validated spec (jsonb)
--   diagram_outcome       why there is or is not a spec
--   grammar_version       the annotation grammar that validated it
--   base_library_version  the sport's base library that was consulted
--   spec_prompt_version   the prompt that was sent
--
-- The versions sit BESIDE the spec, never inside it, so the spec stays a pure
-- re-renderable record.
--
-- ── Inert until phase c ─────────────────────────────────────────────────────
--
-- The base library is empty until certified poses exist (phase c, blocked on
-- #136). So every Session records `no_base`, and the stage makes no model call
-- at all: zero cost, zero latency, and no effect on the Cue. The Cue, the
-- quality gate and Grounding are untouched.
--
-- ── NULL is "not recorded", and is said so up front ─────────────────────────
--
-- The rule 024 states on day one, for the same reason (018 to 022 each had to
-- repair a column whose empty value could be read as a finding):
--
--   NULL             not recorded. Every Session written before this
--                    migration. It is NEVER "no diagram", and must not be
--                    counted as one.
--   'no_base' etc.   recorded: the stage ran and this is why there is no spec.
--
-- So a coverage rate is `diagram_outcome = 'spec'` over
-- `diagram_outcome is not null`, and never over the whole table.
--
-- ── The authoring backlog ───────────────────────────────────────────────────
--
-- Like Grounding's `no_records`, `no_base` grouped by `target_position_id` is
-- the list of positions users actually hit that have no certified base, most
-- hit first. It is what phase c authors from. A `no_base` row with a NULL
-- `target_position_id` is different: the position itself never resolved, so
-- no base could help (the fix is the taxonomy or Extraction, as for
-- Grounding's `no_position`).
--
-- ── Written on every Session write ──────────────────────────────────────────
--
-- The one-shot insert, the declined insert, the Re-analyze update and the
-- declined Re-analyze update. The declined paths write `not_attempted` and a
-- NULL spec. Re-analysis OVERWRITES all five columns: it regenerates the Cue,
-- so an old spec would describe a Cue the row no longer holds (the reasoning
-- 021 applied to the grounding provenance).
--
-- ── What this is NOT ─────────────────────────────────────────────────────────
--
--   * Not a version boundary. `pipeline_version` is deliberately NOT bumped,
--     by 022's rule: the prompt, the records and the Cue are unchanged. The
--     new columns are self-describing, so there is nothing to segment.
--   * Not a backfill. A past Session's spec was never generated.
--   * Not shown to the athlete yet. The diagram component waits on a native
--     build, and nothing in the app reads these columns.
--
-- `diagram_outcome` is constrained to the values the stage emits
-- (`DIAGRAM_OUTCOMES` in src/visualization/diagramStage.ts; a test holds the
-- two together), because a value the CHECK rejects fails the whole Session
-- write and the athlete would lose the Session, not just the diagram. For the
-- same reason "a spec exactly when the outcome is 'spec'" is NOT a constraint:
-- the stage builds both from one record, and a test asserts it.
--
-- Deletion: the columns live on the Session row, which the delete-account
-- function deletes with the account.
--
-- ORDER MATTERS ON DEPLOY. `process-session` writes these columns on every
-- Session it inserts or re-analyses, so apply this migration BEFORE deploying
-- that function. The other order fails every write with PGRST204 (the
-- `feedback_reason` incident in docs/MIGRATIONS.md). The same function also
-- writes 024's `perspective`, so 024 must be applied too.
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sessions
  add column if not exists diagram_spec jsonb,
  add column if not exists diagram_outcome text
    check (diagram_outcome in ('spec', 'no_base', 'not_attempted', 'empty', 'invalid', 'unavailable')),
  add column if not exists grammar_version text,
  add column if not exists base_library_version text,
  add column if not exists spec_prompt_version text;

comment on column public.sessions.diagram_outcome is
  $$Why this Session's Cue does or does not have a force-diagram spec (#135).

    NULL means NOT RECORDED: the Session was written before migration 025. It
    is never "no diagram" and must not be counted as one. There is no backfill.

    spec           a validated spec is stored in diagram_spec
    no_base        no certified base for target_position_id, so no model call.
                   Grouped by target_position_id, this is the base-authoring
                   backlog. With a NULL target_position_id the position never
                   resolved, and no base could help.
    not_attempted  no coachable Cue: a declined Take, or the quality gate's
                   fallback. No model call.
    empty          the model was asked and returned no annotations: the Cue's
                   mechanic could not be placed on the base's roles. The answer
                   the prompt asks for in that case, not an error.
    invalid        the model's answer failed validation (malformed, an unknown
                   role, an illegal relation)
    unavailable    the model call failed or timed out

    Written on every Session write. Re-analysis overwrites it with the outcome
    for the regenerated Cue.$$;

comment on column public.sessions.diagram_spec is
  $$The validated force-diagram spec for the Cue (#135): { specVersion, base,
    annotations }. Present exactly when diagram_outcome = 'spec', NULL
    otherwise. Re-validate it against its base before drawing; the versions
    that produced it are in grammar_version, base_library_version and
    spec_prompt_version, not inside it.$$;

comment on column public.sessions.grammar_version is
  $$The annotation grammar version (#135) that validated the spec. Set whenever
    a prompt was built: diagram_outcome in (spec, empty, invalid, unavailable).
    NULL for no_base and not_attempted, where no grammar was involved, and on
    every row from before migration 025.$$;

comment on column public.sessions.base_library_version is
  $$The sport's force-diagram base library version (#135) that was consulted:
    which bases existed, how they were posed, and the spec persona. Set for
    every outcome except not_attempted, so a no_base row says which library
    lacked the base. NULL for a sport with no library at all, and on every row
    from before migration 025.$$;

comment on column public.sessions.spec_prompt_version is
  $$The cue -> spec prompt version (#135) that was sent. Set whenever a prompt
    was built: diagram_outcome in (spec, empty, invalid, unavailable). NULL for
    no_base and not_attempted, where no prompt was sent, and on every row from
    before migration 025.$$;

notify pgrst, 'reload schema';
