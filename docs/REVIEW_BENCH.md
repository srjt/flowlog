# The certification bench

Where invited black belts judge mined coaching records, at `/review` on the web
build.

Built in #77. The decision to keep it inside the athlete app rather than build a
separate web UI is recorded at the bottom.

## Inviting a reviewer

**A reviewer must exist as an auth user before they can be made a reviewer** —
`reviewers.id` references `auth.users`, so there is no way to pre-create a row
for someone who has never signed in.

Public signup is disabled, so the order is fixed:

1. **Supabase dashboard → Authentication → Users → Invite user.** They get an
   email, click through, set a password.
2. Find their user id in the same table.
3. Grant reviewer access:

   ```sql
   insert into public.reviewers (id, display_name, credential)
   values ('<their auth uid>', 'Their Name', 'black belt');
   ```

4. Send them `<your-pages-domain>/review`.

To revoke, set `active = false` rather than deleting — their past votes stay
attributed, and the flags derived from those votes stay explicable.

```sql
update public.reviewers set active = false where id = '<uid>';
```

## What a reviewer sees

The **serving record only**: position, prescription, why, detail, counter,
preconditions. Never the source quote.

That is load-bearing, not an aesthetic choice. The review store holds verbatim
instructional text and never leaves the dev machine (#37). Because the bench
shows only distilled mechanics, the page can be handed to people outside the
project without shipping anything derived from a copyrighted instructional.

It works because the records carry enough on their own: of 1,322 records, 99%
have a `why` and 91% a `detail` — only 6 are prescription-only.

## How a record settles

Two agreeing reviewers settle it. The flags on `coaching_records` are DERIVED
from votes by a trigger (migration 014), so they can never drift from the
evidence behind them:

| flag | rule | effect on cues |
| --- | --- | --- |
| `certified` | ≥ 2 certify, 0 reject | sorted first when grounding |
| `contested` | ≥ 1 of each | **never grounds a cue** |
| `rejected` | ≥ 2 reject, 0 certify | **never grounds a cue** |

Certification is a **tiebreak, not a gate**. With 0 of 1,322 records certified,
requiring certification would ground nothing at all and keep grounding nothing
for months — so review improves ranking smoothly instead of switching grounding
off until the queue is done.

Contested records stay IN the queue. A disagreement is exactly what needs a
third opinion; dropping them would freeze every dispute permanently.

## Notes, and why they are shown the way they are

A reject without a reason is a boolean. It cannot be re-mined, corrected, or
argued with, so **the bench refuses a reject with no note.** Certify does not
require one — agreement needs no defence.

**Prior votes: the fact is free, the argument costs a tap.**

Showing another reviewer's reasoning up front tells you what to think before
you have thought. Hiding it entirely makes you re-derive an argument someone
already made — which is how two competent people reach opposite verdicts and
mark a record `contested`, and contested records ground no cues at all. So the
card shows how many said sound and how many said wrong, and puts the reasoning
behind one tap.

Notes are **attributed**, with the credential. "Someone rejected this" invites
dismissal; "Ana, black belt, rejected this because the hook goes outside the
lead leg" is an argument you have to engage with.

A reviewer can change the verdict they **just** sent — a voted card leaves the
queue at once, so that is the only moment anyone notices a mistyped reason.

### Reading them in bulk

```bash
scripts/review/notes.sh          # rejected + contested, with reasons
scripts/review/notes.sh --all    # every note
```

A rejected record is not fixed by being rejected. It is fixed by someone
reading why and either re-mining that position, correcting the record, or
concluding the corpus is wrong about something.

> **Notes are reviewer-authored free text and may name a source** — "Danaher
> teaches this differently". They live in `record_votes` and are NEVER copied
> into `coaching_records`, the table `publish.ts` writes. The leak guard in
> #37 covers mined text, not reviewer text. If anyone later builds "apply
> reviewer corrections", the scrub must be extended BEFORE that text can reach
> a published record.

## Queue order

1. **Records one vote short of settling.** One more review decides them, where
   an untouched record needs two — roughly twice the settled records per unit of
   black-belt attention, which is the scarce resource here.
2. Then unreviewed records grouped by position, so a reviewer stays in one
   context rather than being thrown between closed guard and back mount.

**Not weighted by session demand**, deliberately. #58's grounding log has no
rows yet, so there is no demand signal; ordering by one we do not have would be
guesswork dressed as prioritisation. Revisit once sessions accumulate.

## Deploying

```bash
npm run deploy:web      # exports to dist/ and checks the SPA fallback
```

Then upload `dist/` to Cloudflare Pages.

**Manual on purpose.** This repo is public and merges are frequent; git-
integrated auto-deploy would publish whatever `master` is mid-refactor, to a
URL real reviewers are using.

`public/_redirects` rewrites every path to `index.html`. Without it Cloudflare
404s on `/review` — the one URL reviewers are actually given.

### Supabase configuration this depends on

Both are dashboard settings, not code:

- **Public signup disabled.** The bench ships inside the athlete app, so the web
  build is a second front door into the cohort. Client-side gating would not
  have closed it — `signUp` is a client call with a public anon key.
- **The Pages origin added to allowed redirect URLs.** OAuth and password reset
  redirect to the page origin on web and fail silently without it.

## Why this lives in the athlete app

Considered building a separate web UI. Rejected: every benefit it would have
bought is delivered more cheaply another way.

| Concern | Separate UI | What is actually done |
| --- | --- | --- |
| Reviewers shouldn't land in an onboarding flow | own app | `/review` is reached directly, skipping the gate in `app/index.tsx` |
| Reviewers shouldn't see athlete data | own app | RLS already scopes every table |
| The web build shouldn't be an open door | own app | invite-only auth on the project |
| Reviewers shouldn't download the whole app | own bundle | accepted — 3 MB once, cached after |

A second codebase would have bought a second auth story, a second Supabase
client, and a duplicated record type, in exchange for cosmetics. Revisit if
reviewers ever become strangers rather than people invited by hand.
