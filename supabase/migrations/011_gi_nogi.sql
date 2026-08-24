-- Whether a session was trained in the gi or without it (wayfinder #30, #43).
--
-- Roughly a quarter of the mined corpus is gi-specific — lapel, sleeve, collar,
-- seam. Without this signal a gi-only instruction can reach someone in a rash
-- guard, which is a NEW way to be confidently wrong, introduced by grounding
-- itself.
--
-- It is asked rather than inferred because it usually is not in the recording:
-- across the frozen baseline, 32 of 41 sessions (78%) never mention gi or no-gi
-- at all. People narrate positions and mistakes, not what they are wearing.
alter table public.profiles
  add column if not exists gi_default text
    check (gi_default in ('gi', 'no-gi'));

-- Existing users are backfilled to 'gi': the corpus is a gi instructional and
-- it matches current usage, so it is the correct default for today's data
-- rather than an arbitrary one. They are never re-onboarded for it.
update public.profiles set gi_default = 'gi' where gi_default is null;

-- The value actually used for a session. Separate from the profile default
-- because people train both, and the record screen lets them flip it for a
-- single night without changing their default.
alter table public.sessions
  add column if not exists gi text
    check (gi in ('gi', 'no-gi'));

comment on column public.profiles.gi_default is
  'Default training attire, set once during onboarding. Backfilled to gi.';
comment on column public.sessions.gi is
  'Attire for THIS session — the profile default unless the recorder toggled it.
   Null on rows predating this column and on any take that did not capture it.
   Filtering grounding records by this value is #60; today it is captured only.';
