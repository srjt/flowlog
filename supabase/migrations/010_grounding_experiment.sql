-- Grounding outcome + A/B arm (wayfinder #30; #58 logging, plus the experiment).
--
-- Two jobs in one set of columns, because they are the same plumbing:
--
--  1. WHY a cue was or was not grounded, split by cause. The two ungrounded
--     causes have opposite fixes, so lumping them together would send you
--     mining positions when the real problem was that you could not identify
--     the position.
--
--  2. WHICH ARM of the grounded/ungrounded experiment the session landed in.
--     Assignment happens only AFTER records are found to be available, so the
--     control arm means "had records, deliberately did not use them" — a true
--     counterfactual. Sessions with nothing to inject are not in the
--     experiment at all; including them would dilute it with non-events.
alter table public.sessions
  add column if not exists grounding text
    check (grounding in ('grounded', 'withheld', 'no_position', 'no_records', 'declined')),
  add column if not exists grounding_records integer,
  add column if not exists grounding_available integer;

comment on column public.sessions.grounding is
  $$Why the cue was or was not grounded.
    grounded    - records were injected
    withheld    - records WERE available but the experiment assigned this session
                  to the control arm; the counterfactual for 'grounded'
    no_position - the free-text position never resolved to a canonical id
                  (usually the side was unknown, or it was a submission).
                  Fix: taxonomy or extraction.
    no_records  - the id resolved but the corpus has nothing. Fix: mine that position.
    declined    - the take had nothing coachable in it (#44); no cue was written.$$;

comment on column public.sessions.grounding_records is
  'How many records were actually injected. 0 unless grounding = grounded.';

comment on column public.sessions.grounding_available is
  'How many matched the mistake and COULD have been injected. Equal to
   grounding_records in the grounded arm; the same population in the withheld
   arm, which is what makes the two comparable.';

-- The mining backlog: positions users hit that the corpus cannot serve.
create index if not exists sessions_grounding
  on public.sessions(sport_key, grounding);
