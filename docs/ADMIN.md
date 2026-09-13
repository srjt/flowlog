# The cue review tool

A local, read-only web page for reading what the pipeline actually did: every
Session's transcript, its Extraction, the Coaching records that grounded it, and
the Cue that came out.

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
trail, athlete.

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
5. **Not recorded at generation time.** Skill level, recent mistakes, dominant
   weakness, strict retry and provider were in the prompt but never saved.
   They are listed as unknown rather than rebuilt from today's values. Logging
   them is #121.
6. **Cue.** With quality gate result and the athlete's feedback.

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
the quality gate's strict-retry wording is left out, records are injected as in
the grounded arm, and **perspective was never stored**. Without a side,
positions like "De La Riva Guard" resolve to nothing and the rebuild loses all
of its grounding, so the side is inferred, most direct evidence first:

1. **The positions of the records the Session was grounded in**, when they
   agree. The pipeline selected them with the perspective it had.
2. **The stored target position.** Often missing: a Cue that targets
   "Berimbolo" never resolves to a canonical position.
3. Otherwise **unknown**, never guessed.

When the Session stored its record ids, the page compares them with today's
selection. Replaying a Session that targeted "Berimbolo" with the side taken
from its records reproduced its 18 stored records in the same order.

`scripts/admin/prompt.ts` reuses the edge function's sport registry and the
single-sourced grounding selection. The template fill is the one copied piece,
so `tests/unit/promptPlaceholders.test.ts` holds it to the same placeholder
contract as production, and `tests/unit/adminPrompt.test.ts` fails if its
mirrored constants drift from `process-session`.

## Why local, and why read-only

It shows every athlete's private voice dump. The reviewer bench
(`docs/REVIEW_BENCH.md`) lives inside the deployed web build because it only
shows distilled records to invited reviewers. This page shows athlete data to
one operator, which is a different risk:

- **Local only.** It binds to `127.0.0.1` and reads Supabase with the service
  role key already in `.env`. No migration, no new client-reachable function
  over `sessions`, nothing about athletes reachable from the internet. Moving
  it to a deployed `/admin` later is cheap; un-exposing data is not.
- **Basic auth plus a loopback Host check.** Binding keeps other machines out.
  The credentials and the Host check keep out other pages in your own browser,
  including DNS-rebinding ones.
- **Read-only.** The server answers `GET` only. Verdicts on Cues were
  deliberately left out until reading real sessions shows what shape they
  should take. Judging records stays on the bench, where the two-reviewer rule
  applies.

## How it is built

- `scripts/admin/server.ts`: Node's built-in type stripping, no framework, no
  build step.
- `scripts/admin/review.ts`: the trust, filter and detail logic. Import-free,
  so the server imports it, `tests/unit/adminReview.test.ts` tests it, and the
  page runs the same file (served type-stripped at `/review.js`).
- `scripts/admin/app.js`, `index.html`, `app.css`: the page. Database text is
  only ever inserted as text nodes, never as HTML.
