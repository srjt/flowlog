---
name: flowlog-mine
description: Mine a transcribed BJJ instructional into coaching records and publish them to the serving store. Use when the user says "mine <instructional/folder>", asks to extract records from a title, or wants to improve cue coverage from an instructional. Wraps scripts/mining — costs money, so it checks before spending.
---

# Mining an instructional

Turns timestamped transcripts into structured coaching records, then publishes
the distilled half to Supabase where grounding can use it.

**This one costs money.** It calls Gemini per volume. Check before spending, and
never re-mine what is already mined.

## Records must never be committed

`~/flowlog-records` is outside the repo, deliberately. It holds **verbatim
instructional text** and this repository is **public**.

Only the distilled half is published, and `publish.sh` refuses to run if any
source marker survives the scrub. Never move records into the repo, never paste
transcript text into a commit message, a PR body, or an issue.

## 1. Dry run first — always

```bash
scripts/mining/mine-series.sh ~/Documents/"BJJ Instructionals"/"<Instructor>"/"<Title>" \
  --instructor "<Instructor>" --dry-run
```

Read the per-series line before spending anything:

```
8 volume(s) to mine across 1 series
   <Title>: 8 volume(s) found, 8 queued
```

- **`0 volume(s) found`** means the filenames carry no volume number the batcher
  can see, or the transcripts lack timestamps. Fix that first — a real run would
  quietly do nothing. See issue #75.
- **`N found, 0 queued`** means it is already mined. Stop; say so.
- A warning naming a file that "reads as a transcript" but was skipped is the
  batcher telling you a volume is about to be missed. Do not ignore it.

## 2. Mine

```bash
scripts/mining/mine-series.sh "<folder>" --instructor "<Instructor>"
```

- **Idempotent**: already-mined volumes are skipped, so a re-run after a failure
  costs only the failures.
- Volumes run sequentially and each in its own process, so one bad volume cannot
  take the series down. Failures are listed at the end — re-run the same command
  to retry just those.
- Slow. Use `run_in_background: true` and poll:
  `ls ~/flowlog-records/*.records.json | wc -l`

### Two failures that look alike and are not

| error | meaning | what to do |
| --- | --- | --- |
| `RESOURCE_EXHAUSTED` | the Gemini monthly **spend cap** is hit | **Stop.** Retrying fails identically. Tell the user; re-run after they lift it. |
| `503 UNAVAILABLE` | the model is under **load**, transient | Retry — but not immediately. An instant retry usually fails the same way. |

Both leave the batcher idempotent, so a later re-run costs only the volumes that
failed. Never switch `--model` to dodge a 503 mid-series: the rest of the series
was mined on one model, and mixing them makes the records less comparable for
the sake of a few volumes.

## 3. Publish

Use the **flowlog-publish** skill. It covers the leak scan, the two-store split,
and verifying live counts — all of which matter more than the mining step and
are easy to do carelessly.

## 4. Report what it actually bought

Do not report volume and record counts alone. The question is whether coverage
of positions the athletes **actually train** improved.

```bash
scripts/backlog/backlog.sh          # what sessions wanted and could not get
```

Compare record counts per position before and after. Two failure modes worth
naming honestly when they happen:

- **Deepening what is already deep.** Most titles add to `half-guard-*` and
  `open-guard-top`, which are already the strongest positions. That is not the
  same as closing a gap.
- **Perspective.** A title full of "de la riva" mentions taught from the
  passer's side produces `de-la-riva-top` records. It does nothing for
  `de-la-riva-bottom`. Mention counts do not carry perspective — the miner's own
  position output is the only reliable signal, so read it rather than the title.

## Choosing what to mine

The library has more unmined material than is worth mining. Before starting a
new title, check the miner's position output from a single probe volume against
real demand. Known dead ends: `k-guard-bottom` and `headquarters-bottom` appear
**zero times** in the entire unmined library, and `closed-guard-bottom` is
barely taught anywhere — those gaps need a different purchase, not more mining.

## Related

- `flowlog-transcribe` — produces the input this needs
- `docs/REVIEW_BENCH.md` — how records get certified once published
