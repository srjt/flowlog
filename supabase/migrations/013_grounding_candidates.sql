-- How many records existed for the position BEFORE filtering (#58).
--
-- Without this, `grounding = 'no_records'` conflates three different failures
-- that have three different fixes:
--
--   1. the corpus has nothing for this position          -> MINE IT
--   2. records existed, but none applied to the gi context (#60)
--   3. records existed, but none scored above the relevance gate (#57)
--
-- Only the first is a mining problem. #58 exists to stop exactly this kind of
-- conflation — it already separates `no_position` from `no_records` because
-- they have opposite fixes — and the gi filter and relevance gate added two
-- more causes underneath `no_records` after that split was designed.
--
-- A backlog built without this column would send you mining positions whose
-- records were merely filtered out, which is the same error one layer down.
--
--   grounding_candidates  records found for the position (pre-filter)
--   grounding_available   survived gi + relevance (the control's counterfactual)
--   grounding_records     actually injected (0 unless grounded)
--
-- So: candidates = 0 is a corpus gap. candidates > 0 with available = 0 is a
-- filter outcome, and mining more would not change it.
alter table public.sessions
  add column if not exists grounding_candidates integer;

comment on column public.sessions.grounding_candidates is
  'Records found for the resolved position before the gi filter and relevance
   gate (#58). Null on rows predating this column. With grounding = no_records:
   0 means the corpus is empty for that position (mine it), > 0 means records
   existed but were filtered out (mining will not help).';
