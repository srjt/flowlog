-- Let reviewers see who else reviewed (#84).
--
-- Migration 014 already lets every active reviewer read every vote — seeing
-- that someone disagreed is the point. But `reviewers` was "read your own row"
-- only, so a note could be shown without a name attached to it.
--
-- Unattributed dissent is much weaker evidence. "Someone rejected this" invites
-- you to dismiss it; "Ana, black belt, rejected this because the De La Riva
-- hook goes outside the lead leg" is an argument you have to engage with. The
-- credential is the reason the vote carries weight, so it has to travel with
-- the note.
--
-- Scoped to ACTIVE reviewers reading OTHER reviewers. This is not a public
-- directory: an athlete with an account still sees nothing here.
create policy "Active reviewers read the reviewer roster"
  on public.reviewers for select
  using (
    exists (
      select 1 from public.reviewers r
      where r.id = auth.uid() and r.active
    )
  );

comment on table public.reviewers is
  'Invite-only certification reviewers (#77). Revoke with active = false rather
   than deleting: past votes stay attributed and the flags derived from them
   stay explicable.';
