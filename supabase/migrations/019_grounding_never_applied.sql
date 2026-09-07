-- ─────────────────────────────────────────────────────────────────────────────
-- The grounding columns describe a treatment that was never applied, for every
-- session written by pipeline 1.0.0.
--
-- `generateCoaching` in the edge function took a `groundingRecords` argument,
-- imported `groundingSection`, and never passed one to the other: its
-- `fillTemplate` call had no GROUNDING key. `fillTemplate` replaces only the
-- keys it is handed, so the prompt reached the model carrying the literal
-- characters `{{GROUNDING}}` and no mechanics. The call succeeded. A cue came
-- back. The user saw nothing unusual.
--
-- Everything AROUND the injection worked, which is exactly why nothing showed:
-- candidate positions resolved, the gi filter ran, ranking ran, the A/B arm was
-- assigned, and migration 010's and 018's columns were written precisely as
-- designed. So `grounding = 'grounded'`, `grounding_records = 6` and a
-- populated `grounding_record_ids` are all true statements about what the
-- pipeline SELECTED and false statements about what the model SAW.
--
-- Two things downstream are wrong as a result:
--
--   1. The grounded/withheld experiment is void over these rows. Both arms
--      received an identical ungrounded prompt — the `withheld` arm passed an
--      empty array, the `grounded` arm passed a full one, and both were
--      discarded at the same line. Any difference between them is noise. This
--      cannot be recovered by analysis, only re-run.
--
--   2. `record_feedback_signal` (018) attributes a thumbs-down to the records
--      in `grounding_record_ids`. Over these rows those records were never in
--      the prompt, so every count in that view is currently evidence about
--      records that had no influence on the cue being judged. The review queue
--      it was built to power is reading noise as signal. This migration fixes
--      that view; the experiment can only be re-run.
--
-- NOTHING IS DELETED AND NOTHING IS REWRITTEN. `grounding = 'grounded'` stays,
-- because it remains a true record of what the pipeline intended and of which
-- records ranked highest for that session — a ranking still worth having, and
-- the only surviving trace of it. What changes is that a reader can no longer
-- reach these rows without deciding what to do about them.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── The boundary is a version, not a timestamp ───────────────────────────────
--
-- A timestamp would have to be guessed before `supabase functions deploy` runs
-- and corrected afterwards, and a migration whose correctness depends on being
-- applied within the right minute is a trap — precisely the kind of silent
-- wrongness this whole incident is about.
--
-- The fixed function ships as pipeline 1.1.0. Every row therefore states for
-- itself which pipeline wrote it, and this migration is correct whether it is
-- applied before or after the deploy, and correct for rows written in between.
--
-- Re-analysis (ADR 0011) updates a row in place and rewrites
-- `pipeline_version`, which is the behaviour we want rather than a wrinkle: a
-- 1.0.0 session re-analysed on 1.1.0 really does receive a grounded cue, and
-- really should stop counting as void.
create or replace function public.grounding_reached_model(p_pipeline_version text)
returns boolean
language sql
immutable
parallel safe
as $$
  -- NULL is unknown, and unknown must never be read as "it worked". Same rule
  -- as 018's NULL-vs-{} distinction on grounding_record_ids: absence of
  -- evidence is not evidence of injection.
  select coalesce(p_pipeline_version, '1.0.0') <> '1.0.0';
$$;

comment on function public.grounding_reached_model(text) is
  'Did the coaching prompt for a session of this pipeline version actually '
  'carry the grounding block? False for 1.0.0 and for NULL. The single place '
  'the 1.0.0 boundary is encoded — read it, do not re-type the version.';


-- ── Make the affected columns impossible to read innocently ──────────────────
--
-- Restated in full rather than appended to, because `comment on` replaces.

comment on column public.sessions.grounding is
  $$Why the cue was or was not grounded.
    grounded    - records were SELECTED for injection
    withheld    - records WERE available but the experiment assigned this session
                  to the control arm; the counterfactual for 'grounded'
    no_position - the free-text position never resolved to a canonical id
                  (usually the side was unknown, or it was a submission).
                  Fix: taxonomy or extraction.
    no_records  - the id resolved but the corpus has nothing. Fix: mine that position.
    declined    - the take had nothing coachable in it (#44); no cue was written.

    CAVEAT (migration 019). On pipeline_version 1.0.0 this column records what
    was SELECTED, not what the model received: the prompt carried the literal
    `{{GROUNDING}}` and no mechanics. Gate every read on
    grounding_reached_model(pipeline_version). 'grounded' and 'withheld' are
    the same condition over those rows.$$;

comment on column public.sessions.grounding_records is
  $$How many records were selected for injection. 0 unless grounding =
    'grounded'. On pipeline_version 1.0.0, selected but NOT injected — see
    grounding_reached_model().$$;

comment on column public.sessions.grounding_available is
  'How many matched the mistake and COULD have been injected. Equal to '
  'grounding_records in the grounded arm; the same population in the withheld '
  'arm, which is what makes the two comparable — over 1.1.0+ rows only.';

comment on column public.sessions.grounding_record_ids is
  'The coaching_records selected for the coaching prompt, in rank order. NULL '
  'for sessions from before this column existed, and empty for ungrounded '
  'arms — the two are different and must not be conflated: NULL means '
  'unknown, {} means we know nothing was selected. On pipeline_version 1.0.0 '
  'these records were selected and then never reached the model, so they '
  'carry no responsibility for the cue: do not attribute feedback to them.';


-- ── Fix the review queue's evidence ──────────────────────────────────────────
--
-- Column list, names, types and order are unchanged, so this is a genuine
-- replace and any grants on the view survive. The only change is the WHERE.
--
-- Expect the counts to drop to zero or near it on first run. That is the
-- correct reading: the corpus has not been exonerated, it has never been
-- tested. Every thumbs-down this view has ever reported was cast on a cue the
-- named records did not influence.
create or replace view public.record_feedback_signal as
select
  r.id,
  r.position,
  r.prescription,
  count(*) filter (where s.thumbs_up is false) as thumbs_down,
  count(*) filter (where s.thumbs_up is true)  as thumbs_up,
  count(*)                                     as times_grounded,
  array_agg(distinct s.feedback_reason)
    filter (where s.feedback_reason is not null) as reasons
from public.sessions s
  cross join lateral unnest(s.grounding_record_ids) as gid
  join public.coaching_records r on r.id = gid
where public.grounding_reached_model(s.pipeline_version)
group by r.id, r.position, r.prescription;

comment on view public.record_feedback_signal is
  'Per-record user feedback, derived from which records grounded which cues. '
  'A record with several thumbs-down and no thumbs-up is a review candidate — '
  'this is what replaces reading the whole corpus. Restricted to pipeline '
  'versions where the records actually reached the prompt (migration 019); '
  'sessions from 1.0.0 contribute nothing because their records did not '
  'influence the cue being judged.';


-- ── The analysable experiment population ─────────────────────────────────────
--
-- Exists so that re-running the A/B does not require anyone to remember this
-- incident. Reading `sessions` directly and filtering on `grounding` is the
-- mistake this view removes; the void rows are simply not in it.
--
-- No grant to anon/authenticated. This is operator analysis over every user's
-- sessions, and a view is owner-evaluated by default, which would bypass the
-- row-level policy that makes `sessions` safe. Following migration 009: access
-- requires the service role by construction, not by the continued absence of a
-- policy.
create or replace view public.grounding_experiment as
select
  s.id,
  s.sport_key,
  s.session_date,
  s.pipeline_version,
  s.grounding                as arm,
  s.grounding_records,
  s.grounding_available,
  s.grounding_candidates,
  s.grounding_record_ids,
  s.quality_gate_passed,
  s.thumbs_up,
  s.feedback_reason
from public.sessions s
where s.grounding in ('grounded', 'withheld')
  and public.grounding_reached_model(s.pipeline_version);

revoke all on public.grounding_experiment from anon, authenticated;

comment on view public.grounding_experiment is
  'Sessions eligible for the grounded-vs-withheld comparison: both arms, and '
  'only from pipeline versions where injection actually happened. Everything '
  'recorded under 1.0.0 is excluded because both arms received an identical '
  'ungrounded prompt there. Service-role only. Expect this to be empty until '
  '1.1.0 has been deployed and has accumulated sessions.';


-- ── Seeing the damage ────────────────────────────────────────────────────────
--
-- Not a view: this is a one-off question about a closed period, and a view
-- would imply it is worth asking again.
--
--   select grounding,
--          count(*)                                as sessions,
--          count(*) filter (where thumbs_up is false) as disliked,
--          sum(grounding_records)                  as records_credited
--   from public.sessions
--   where not public.grounding_reached_model(pipeline_version)
--     and grounding is not null
--   group by grounding
--   order by sessions desc;
--
-- `records_credited` is the size of the retraction: every one of those
-- attributions was made to a record the model never saw.

-- Applied through the dashboard rather than `db push`? The PostgREST schema
-- cache does not reload itself there, and the new function and view stay
-- invisible to the API until it does. Harmless to run either way.
notify pgrst, 'reload schema';
