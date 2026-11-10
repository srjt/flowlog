# The cue review tool

A local web page for reading what the pipeline actually did: every Session's
transcript, its Extraction, the Coaching records that grounded it, and the Cue
that came out. It reads everything and writes exactly one thing: the
operator's verdict on a Cue (see [Operator verdicts](#operator-verdicts)).

## Running it

Add to `.env` (never commit these; the repo is public):

```bash
ADMIN_USER=you
ADMIN_PASSWORD=something-long
# optional, defaults to 4321
ADMIN_PORT=4321
```

`SUPABASE_SERVICE_ROLE_KEY` and `EXPO_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`)
must already be there. Then:

```bash
scripts/admin/serve.sh
```

Open <http://127.0.0.1:4321> and sign in with the credentials above. The server
refuses to start if any of them is missing, so a missing password can never
quietly mean "no password".

## What it shows

**List.** Every Session, newest first. Search covers the transcript, Cue and key
mistake. Filters: athlete feedback and 👎 reason, grounding outcome (declined
takes hidden by default), target position, quality gate, date range, record
trail, athlete, operator verdict and its reason. Above the filters, a coverage
line says how much of the log is judged, and a link opens
[Records behind wrong Cues](#records-behind-wrong-cues).

**Detail, in pipeline order:**

1. **Recording & prompt.**
   - _Play recording_ mints a short-lived signed URL only when pressed. This is
     how you tell a _misheard_ Cue (fix vocabulary priming) from a _misjudged_
     one (fix records or the prompt).
   - _Build today's prompt_ rebuilds the coaching prompt this Session's
     Extraction would get **now**, with a copy button for trying it in other
     models. See below.
2. **Transcript.** If `reanalyzed_at` is set, the original transcript and Cue
   were overwritten and are gone.
3. **Extraction.** What the coaching step actually reads. It never sees the
   transcript.
4. **Grounding.** The outcome, the funnel (candidates, then cleared the
   relevance gate, then injected), and the injected records in rank order with
   their _current_ review state.
5. **Prompt the model received.** The coaching prompt exactly as sent, from
   `session_prompts` (#121, migration 023), with provider, model and a copy
   button. It shows the attempt whose Cue the Session holds, from the latest
   run (re-analysis adds a run). Earlier attempts the quality gate rejected
   are collapsed below it; when the gate fell back to its safe Cue, the page
   says no attempt produced it. Sessions generated before 023 show "not
   recorded" and list the inputs that were never saved. If the table cannot be
   read at all, the page says the migration is probably not applied.
6. **Cue.** With quality gate result and the athlete's feedback.
7. **Operator verdict.** Your verdict on the Cue above, beside the athlete's
   thumbs as a separate fact. Verdicts about a Cue the Session no longer holds
   are listed under it, flagged as such. See below.

### The record trail

`grounding_record_ids` does not always describe the Cue the row holds now. The
tool says which case you are looking at rather than showing a list that might
be wrong:

| Trail               | Meaning                                                            | Source |
| ------------------- | ------------------------------------------------------------------ | ------ |
| trusted             | these records went into this Cue's prompt                          |        |
| none selected       | known: no records went in                                          |        |
| not recorded        | NULL ids, row predates the column                                  | 018    |
| never reached model | selected, but the 1.0.0 prompt carried `{{GROUNDING}}` literally   | 019    |
| unverified          | pre-1.3.0 with no re-analysis marker; may belong to an earlier Cue | 021    |

The 1.0.0 and candidate-count boundaries come from the database's own
predicates (`grounding_reached_model`, `grounding_candidates_is_exact`), not
re-typed version strings. The 1.3.0 re-analysis boundary has no predicate, so
it lives once in `scripts/admin/review.ts`.

Record text is shown as it is **today**. Publishing upserts records by id, so
a record may have been edited since the Cue was generated.

### Today's prompt

A rebuilt prompt for copying into other models, **never** evidence about the
Cue on the page. It is what the pipeline would send if this Session's
Extraction arrived now:

| Input                                       | Taken from                                                  |
| ------------------------------------------- | ----------------------------------------------------------- |
| Key mistake, opponent action, positions, gi | the stored Session                                          |
| Skill level                                 | the athlete's profile, today                                |
| Recent mistakes                             | their 5 latest _other_ sessions, today                      |
| Dominant weakness                           | `user_trends`, today                                        |
| Coaching records                            | re-selected from today's corpus with the pipeline's ranking |

It differs from what the model saw in known ways, all listed on the page:
the quality gate's strict-retry wording is left out, and records are injected
as in the grounded arm. Without a side, positions like "De La Riva Guard"
resolve to nothing and the rebuild loses all of its grounding, so the side is
taken from the most direct evidence there is, and the page says which:

1. **The perspective the Session recorded** (`sessions.perspective`,
   migration 024). What Extraction reported, used as is. A recorded `unknown`
   means Extraction could not tell, and the rebuild keeps that abstention
   rather than guessing a side the pipeline never had.
2. Sessions from before 024 recorded none (NULL, which is never read as
   "could not tell"). For those, **the positions of the records the Session
   was grounded in**, when they agree. The pipeline selected them with the
   perspective it had.
3. **The stored target position.** Often missing: a Cue that targets
   "Berimbolo" never resolves to a canonical position.
4. Otherwise **unknown**, never guessed, and labelled as not recorded.

When the Session stored its record ids, the page compares them with today's
selection. Replaying a Session that targeted "Berimbolo" with the side taken
from its records reproduced its 18 stored records in the same order.

`scripts/admin/prompt.ts` reuses the edge function's sport registry and the
single-sourced grounding selection. The template fill is the one copied piece,
so `tests/unit/promptPlaceholders.test.ts` holds it to the same placeholder
contract as production, and `tests/unit/adminPrompt.test.ts` fails if its
mirrored constants drift from `process-session`.

## Operator verdicts

Reading a Cue and deciding it is wrong used to produce nothing durable (#132).
Now the conclusion is kept, in `cue_verdicts` (migration 026), so patterns
across Cues can be counted and the records behind bad Cues found.

### What you can record

Under **Operator verdict**, pick one of three, the labels of the frozen #36
baseline (`cue-verdicts.json`), so the two stay comparable:

| Verdict   | Meaning                                         |
| --------- | ----------------------------------------------- |
| `sound`   | correct, and says something worth hearing       |
| `shallow` | correct, but says something obvious (as in #36) |
| `wrong`   | wrong, and needs a reason                       |

A wrong Cue needs exactly one reason, ordered upstream to downstream so a fix
lands where the fault is:

| Reason                | Meaning                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `transcript_misheard` | the transcript was misheard: a vocabulary-priming problem upstream       |
| `extraction_wrong`    | the wrong mistake, position or side was extracted                        |
| `records_wrong`       | an injected record is itself wrong                                       |
| `records_misapplied`  | the records were right and the model misused them                        |
| `off_target`          | sound jiu-jitsu aimed at the wrong problem (about half of #61's defects) |
| `model_wrong`         | no relevant records, and the model's own jiu-jitsu was wrong             |

**What should it have said?** On a shallow or wrong verdict, an optional box
takes the Cue you would have given, at most 25 words like any Cue (a live word
count shows under it). Paired with the Cue it replaces, each one is a
preference pair: the start of an evaluation set, and the only training data
worth having if Flowlog ever tunes its own model. A sound Cue takes none; the
database refuses one there (migration 027).

A note is optional free text. **No row means unjudged**: there is never a
"fine by default", and _Unjudged_ is its own filter. Saving again changes the
verdict in place; _Clear verdict_ returns the Cue to unjudged. The database
enforces the same rules as the page: the three verdicts, the six reasons, and a
reason when wrong and only then.

### A verdict judges a Cue, not a Session

Re-analyze replaces a Session's Cue in place. A verdict that named only the
Session would then appear to judge text you never read, which is the failure
021 repaired for the grounding columns. So each verdict keeps:

- `cue`: the exact text judged. Identity is one verdict per (Session, judged
  Cue text).
- `run_id`: the prompt log's run behind it (023), or NULL for Sessions from
  before the log. A pointer, not the identity.
- `record_ids` and `record_trail`: the records behind the judged Cue, copied
  from `grounding_record_ids` at the moment you judge, and what the
  [record trail](#the-record-trail) said about them then.

Two consequences you will see:

- **"About an earlier Cue."** When a verdict's `cue` no longer equals the
  Session's `coaching_cue`, the page lists it under the verdict form, flagged,
  with the text it judged. It is never shown as a verdict on the current Cue,
  which reads as unjudged. The list badge is _Earlier Cue judged_, and the
  filter is _About an earlier Cue_. You can clear such a verdict, but not
  change it: you can only judge text you can read.
- **"This Session's Cue changed."** The server records against the Session as
  stored when you press Save, and the page sends the Cue text it showed you.
  If a Re-analyze replaced the Cue in between, the save is refused (409) rather
  than filed under text you never read. Reload and read the new Cue.

Record ids are copied **only when the trail is _trusted_**. A trail that is
_not recorded_, _never reached model_ or _unverified_ does not say which records
produced this Cue, and copying its ids would charge a wrong Cue to records that
were never behind it. Those verdicts keep no ids, and `record_trail` says why,
so an empty list is never read as "no records went in" unless the trail was
_none selected_.

### Coverage

The line above the filters: _Judged 12 of 89 Cues (13%): 3 sound, 2 shallow,
7 wrong_, plus how many verdicts are about an earlier Cue and, when filters
narrow the list, the same count for the current view. Sessions with no Cue (a
declined take) cannot be judged and are not counted. Read a pattern against
this: "7 wrong" means little out of 12 judged.

### Cue trust

Opened from the sidebar link **Cue trust** (`#trust`). It answers the
project's current focus, _"do I trust the cues it gives me?"_, from your own
verdicts. Everything on it is computed in the page from the session list
(`trustReport` in `review.ts`), so it needs no extra request and is unit-tested.

- **The target.** `TRUST_TARGET` in `review.ts`: at most 1 in 5 wrong over your
  last 20 judged Cues. It reads _not enough judged yet_ until 20 are judged,
  then _met_ or _not there yet_. Only verdicts on the Cue a Session holds now
  count; a verdict about an earlier Cue judged text no athlete sees any more.
- **Against the baseline.** Your recent split beside the #36 hand read
  (`FROZEN_BASELINE`: 36 cues, 11 sound, 8 shallow, 17 wrong, 47%), written
  before the Pro coaching model. A link lists the Cues still waiting for a
  verdict.
- **Why the wrong ones are wrong.** The reasons in the window, most common
  first. Each one names the part of the pipeline a fix belongs in, and the
  parked issues it would unpark (`REASON_POINTS_AT`). **This is how the next
  fix is chosen: by the top reason, not by what seems interesting.**
- **By the model that wrote the Cue.** From the latest prompt-log run of each
  Session (`cueWriter`). A Cue from the coaching model's transient-failure
  fallback shows under that model's name, the quality gate's fixed fallback
  shows as such, and Sessions from before the prompt log show as not logged.
  This is #137's "which model actually answered".
- **Cue length.** Median and longest, and how many are within 3 words of the
  25-word cap (#137 asks whether the cap is now the binding constraint).

The session list gains each Cue's writer from one extra read of
`session_prompts`, without the prompt text.

The page ends with **AI second opinion vs you**, described next.

### The AI second opinion

The cue judge (`scripts/judge`, #61) splits a Cue into claims and checks each
one against the Coaching records for its position, as a black belt reading the
corpus would. It **failed** its validation (`scripts/judge/VALIDATION.md`): it
caught 13 of 17 wrong Cues but flagged 4 of 11 sound ones, against a bar of at
most 2. So it runs here as a second opinion that has to earn trust, never as a
verdict.

**Getting opinions.** From the repo root on your Mac, with `GEMINI_API_KEY` and
the service-role key in `.env`:

```bash
scripts/judge/opine.sh
```

```bash
scripts/judge/opine.sh --go
```

The first is a dry run: how many Cues have no opinion yet from this judge, and
roughly how many model calls judging them costs. `--go` judges them and stores
each result in `cue_ai_opinions` (migration 027); `--limit N` takes the newest
N. It is idempotent: a re-run judges only Cues that are new, or whose text a
Re-analyze replaced. `JUDGE_MODEL` picks the model (default
`gemini-3.1-pro-preview`). The judge is told the Cue, its target position and
the key mistake, never your verdict, reason, note or better Cue.

**Blind first.** You see an opinion only after saving your own verdict on the
same Cue, so it can never anchor you. The server enforces it: until then it
sends the page only that an opinion is waiting, never what it says, and
`opine.sh` prints how many it stored, never what they found. Saving a verdict
reveals the opinion under the form: what it said, whether that agrees with
you, whether records backed the check (_grounded_) or it relied on its own
jiu-jitsu (_ungrounded_, where its false alarms came from), and each claim it
checked. Clearing the verdict hides it again. An opinion about an earlier Cue
is never shown against the current one.

**Earning trust.** On the Cue trust page, per judge (model and
`JUDGE_VERSION`, since a changed judge is a new instrument): how many Cues you
have both judged, how many of your wrong Cues it flagged and how many of your
sound ones, each split grounded and ungrounded, and your shallow ones apart,
unscored. The split matters both ways: ungrounded is where its false alarms
came from, and a grounded check reads the records that may have written the Cue
(#62's caveat), so it leans toward passing. Your verdicts are the independent
side that shows either bias. Disagreements are listed so you can read them. The hand-over bar
(`HAND_OVER_BAR` in `review.ts`) is the bar it failed in August, read over many
more Cues: at least 12 in 17 of your wrong Cues flagged and at most 2 in 11 of
your sound ones, over at least 50 Cues you have both judged, with 10 or more of
each. It reads _not enough to say yet_, then _clears the bar_ or _below the
bar_.

**What it is not.** Never a verdict: nothing is written to `cue_verdicts`, it
counts toward neither the trust target nor the records panel, and nothing in
the app, Grounding, the quality gate or the certification queue reads it.
Clearing the bar switches nothing on; letting the judge triage would be a
separate decision.

### Records behind wrong Cues

Opened from the sidebar link (`#records`). Every Coaching record that sat
behind at least one Cue you judged wrong, with the count by reason, how many
verdicts of any kind it sat behind, the Sessions (click to open), and its
review state today. Ordered so the records hurting most come first:

1. most `records_wrong` verdicts: you said a record behind the Cue was itself
   wrong, and one recurring there is the likeliest culprit;
2. then most wrong verdicts of any reason;
3. then fewest verdicts in all, since the same count from fewer appearances is a
   larger share;
4. then record id, so the order is stable.

It is computed from the verdicts alone, from the record ids each one kept, so a
Re-analyze never moves a verdict onto other records. The page also says how
many wrong verdicts could be traced to records at all. Upstream reasons
(`transcript_misheard`, `extraction_wrong`) still count, but they are shown by
name so a record behind a misheard transcript is not mistaken for a bad record.

### What a verdict is not

- **Not the athlete's feedback.** `thumbs_up` and `feedback_*` are the
  athlete's claim, from a seat that cannot see the records. The verdict is
  yours. The page shows them side by side as separate facts and never combines
  them. Nothing reads verdicts into `record_feedback_signal` (018), and nothing
  writes to the athlete's columns.
- **Not a gate.** Nothing in Grounding, the quality gate, the certification
  queue (`src/utils/reviewQueue.ts`) or anything else the app reads looks at
  them. They change nothing about any athlete's Cue or Trend log.
- **Not a record vote.** Votes on records stay on the bench, where two
  reviewers must agree. A verdict is one operator judging an output.

**Follow-up, not built:** letting verdicts inform which records reach the
certification queue first (#132 story 12). The records panel is the input that
would feed it.

### Deploying it

Apply migration `026_cue_verdicts.sql` after 024 and 025, and
`027_ai_second_opinion.sql` after 026: `supabase db push` refuses a migration
that sorts below one already applied (docs/ROADMAP.md). Nothing else is
deployed; the tool and `opine.sh` run locally. Until 026 is applied the page
says so in place of the verdict controls, and everything else works as before.
Until 027 is, verdicts still save, without the better-Cue box, and the Cue
trust page says the second opinion needs it.

## Why local, and why it writes only one thing

It shows every athlete's private voice dump. The reviewer bench
(`docs/REVIEW_BENCH.md`) lives inside the deployed web build because it only
shows distilled records to invited reviewers. This page shows athlete data to
one operator, which is a different risk:

- **Local only.** It binds to `127.0.0.1` and reads Supabase with the service
  role key already in `.env`. No new client-reachable function over
  `sessions`, nothing about athletes reachable from the internet. Its one
  table, `cue_verdicts`, is locked down like `session_prompts`: RLS on, client
  grants revoked, no policy. So is `cue_ai_opinions`, which the tool only reads
  and `scripts/judge/opine.sh` writes, on the same machine with the same key. Moving the tool to a deployed `/admin` later is
  cheap; un-exposing data is not.
- **Basic auth plus a loopback Host check.** Binding keeps other machines out.
  The credentials and the Host check keep out other pages in your own browser,
  including DNS-rebinding ones.
- **One write route, guarded against forgery.** Every route answers `GET`
  only, except `POST /api/verdict`, which answers `POST` only. Any other method
  on any path is refused with 405. Basic auth alone does not stop cross-site
  request forgery: a browser re-sends cached credentials to `127.0.0.1` with a
  form another site submits. So a write is also refused unless:
  - it is `Content-Type: application/json` (415 otherwise). A form cannot send
    that, and a cross-origin fetch that tries must first pass a CORS preflight,
    which this server never approves: it answers no `OPTIONS`;
  - its `Origin`, when present, is the tool's own origin, so not another site,
    not `null`, and not the other loopback name (403 otherwise);
  - its `Sec-Fetch-Site`, when present, is `same-origin` (403 otherwise).

  The body then goes through the same validation the tests run
  (`parseVerdictRequest` in `review.ts`). Judging records stays on the bench,
  where the two-reviewer rule applies.

## How it is built

- `scripts/admin/server.ts`: Node's built-in type stripping, no framework, no
  build step.
- `scripts/admin/review.ts`: the trust, filter, detail and verdict logic.
  Import-free, so the server imports it, `tests/unit/adminReview.test.ts` and
  `tests/unit/adminVerdicts.test.ts` test it, and the page runs the same file
  (served type-stripped at `/review.js`).
- `scripts/admin/auth.ts`: the request gates (credentials, Host, method, the
  write guard).
- `scripts/admin/app.js`, `index.html`, `app.css`: the page. Database text is
  only ever inserted as text nodes, never as HTML.
- `tests/unit/adminServer.test.ts` runs the real server against a stub
  Supabase on loopback: the write route, its refusals, the method gate, and
  that an opinion never reaches the page before its Cue is judged.
- `tests/unit/adminSecondOpinion.test.ts`: the better Cue, the blind-first
  reveal, the agreement report and migration 027.
- `scripts/judge/opine.ts` (pure half in `opinion.ts`, tested in
  `tests/unit/judgeOpinions.test.ts`) and `scripts/judge/services.ts`, the
  model calls and serving-store reads it shares with the validation run.
