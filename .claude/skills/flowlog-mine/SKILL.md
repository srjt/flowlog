---
name: flowlog-mine
description: Mine a transcribed BJJ instructional into coaching records and publish them to the serving store. Use when the user says "mine <instructional/folder>", asks to extract records from a title, or wants to improve cue coverage from an instructional. Wraps scripts/mining — mines with Gemini or a local model, repairs quotes, and fills counter/applies-when in a second pass.
---

# Mining an instructional

Turns timestamped transcripts into structured coaching records, then publishes
the distilled half to Supabase where grounding can use it.

**This one costs money on Gemini, nothing locally.** Check before spending, and
never re-mine what is already mined.

Mining is now THREE steps, and the last two are free. Skipping them leaves a
corpus measurably worse than one that ran them:

1. **mine** — transcript to records
2. **repair quotes** — narrow spliced quotes to a verbatim span
3. **enrich** — fill empty `counter` and `applies-when` from the transcript

See `docs/LOCAL_MINING.md` for the measurements behind all three.

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

### Read the UNSCOPED warning

The miner keeps records that state an absolute ("always", "never", "must") with
no "applies when", and reports them:

```
UNSCOPED 4  (kept — absolute with no "applies when")
```

They are kept because they teach something real. But an unconditional
instruction cannot be reconciled with one that says the opposite, and both can
reach the same cue — two records on `knee-shield-half-guard-bottom`, same
instructor, say "do not connect knee and elbow" and "always connect knee and
elbow", each without stating which knee shield they mean (#102).

A high count means the volume's qualifiers stayed in the prose instead of
reaching the `opponent` field. Worth a re-mine; not worth blocking on.

`scripts/experiments/unscoped-absolutes.sh` lists them across the whole corpus.

## 3. Repair the quotes — always, free

A spliced quote is two things the instructor said minutes apart, joined into a
sentence never spoken. Every word is genuine and a reviewer searching for it
finds nothing, so the ten-second check silently fails and a splice is
indistinguishable from an invention at that point.

**14.2% of the Gemini corpus was spliced.** All of it was repairable.

```bash
scripts/mining/repair-quotes.sh --records ~/flowlog-records          # dry run
scripts/mining/repair-quotes.sh --records ~/flowlog-records --write
```

Dry-run by default and keeps a `.bak`, because it rewrites the review store and
that store is the only copy of the verbatim text. It NARROWS and never
rewrites, so it cannot introduce words the instructor did not say.

## 4. Fill counter and applies-when — always, free

The two fields every model under-fills, and the entire quality gap between a
local run and a paid one. Raw mining leaves `counter` empty on two records in
three; the second pass roughly doubles it.

```bash
scripts/mining/enrich.sh ~/flowlog-records --dry-run     # how many are missing
scripts/mining/enrich.sh ~/flowlog-records
```

Measured over 88 volumes: `counter` 21.6% -> **46.3%** (Gemini's raw mining
manages 33.7%), `applies-when` 61.7% -> **76.4%**, unscoped absolutes 6.9% ->
4.2%.

It re-reads only a two-minute window around each record rather than the whole
transcript, so it is far cheaper than re-mining — and on Gemini it is the only
way to fix an already-mined title without churning record ids.

**Why it does not hallucinate, and what to check.** Every addition must return
verbatim EVIDENCE from the window, and an addition whose evidence is not in the
transcript is discarded. Read the two rejection counts at the end:

```
DISCARDED — evidence not in the transcript: 26
DISCARDED — scope field was a pasted excerpt:  124
```

The second guard exists because the model pastes its evidence into the scope
field instead of summarising it, and a scope full of raw transcript is useless
to the collision check it exists for. Prompt wording alone did not stop it. If
either count is a large share of the additions, the pass is guessing rather
than reading — stop and look at what it produced.

## 5. Publish

Use the **flowlog-publish** skill. It covers the leak scan, the two-store split,
and verifying live counts — all of which matter more than the mining step and
are easy to do carelessly.

## 6. Report what it actually bought

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

## Mining locally instead of on Gemini — tried, and the answer is no

`--provider ollama --model qwen3:32b --chunk 480` mines for free, and the whole
corpus was re-mined that way to find out whether it could replace Gemini.

**It cannot.** A blind read of 20 matched pairs preferred Gemini 14 to 3. Every
mechanical metric had said local was ahead — it produced 2.35x the records with
zero fabricated quotes — and every one of those metrics was measuring the wrong
thing. Local records are about a third shorter in `prescription` and `why`, and
more fragmented: it splits one teaching point into several thin ones rather
than finding more teaching. Record count read as a win when it was the symptom.

Do not re-run this expecting a different result, and do not mine half a title
each way: agreement with the Gemini corpus is F1 27%, so the two produce
different corpora, not two versions of one.

The local path stays in `mine.ts` because it is useful for free experiments —
probing a title's position distribution before paying to mine it, for one. It
is not a production path. See `docs/LOCAL_MINING.md`.

**The transferable lesson.** Mechanical metrics could not tell these two apart
correctly. Quote fidelity, fill rates and fabrication all measure FORM; none of
them measures whether a record teaches the right thing at a useful grain. Before
trusting any mining change, read twenty pairs:

```bash
scripts/experiments/blind-compare.sh <records-dir> --sample 20 --html
```

## Related

- `flowlog-transcribe` — produces the input this needs
- `docs/REVIEW_BENCH.md` — how records get certified once published
