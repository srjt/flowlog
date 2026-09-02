# Mining locally — what a local model can and cannot do

Whether the Gemini mining step (`flowlog-mine`) can be replaced by a model
running on this Mac, and at what cost to quality.

**Answer: no. Stay on Gemini.**

A human read 20 blind pairs — same moment, same video, sides hidden — and
preferred Gemini on **14, local on 3**, with 3 where neither card was usable.
Every mechanical metric in this document said the opposite. That result is the
one that counts, and the rest of this document should be read as a record of
how confidently the measurements got it wrong.

**What the metrics missed.** Local records are systematically THINNER and more
FRAGMENTED, and nothing here was measuring either:

| mean words | Gemini | local |
| --- | --- | --- |
| prescription | 25 | **16** |
| why | 29 | **24** |
| quote | 46 | **33** |
| applies-when | 7 | **5** |
| records per occupied minute | 1.06 | **1.30** (max 7 vs 3) |

The 2.35x record count was the tell, read backwards. It is not that local found
more than twice as much teaching; it is that local split the same teaching into
more, smaller pieces and stated each one more briefly. **The `yield` metric in
`record-quality.sh` actively rewarded that**, and every field-fill metric
counted a field as good when it was merely non-empty.

**A cost this document under-reported.** The splice trim removes an average of
**27 words per repaired quote** — roughly half of it. It buys verifiability and
it is still right to run, but "100% verifiable" was reported here as a clean win
when it is a trade: 261 Gemini quotes and 750 local ones are now shorter, and a
shorter quote is weaker evidence even when it is a real one.

**Three of twenty pairs were BOTH BAD.** Neither model produced a usable card
for 15% of the sampled moments. That is a prompt-level ceiling and it is
independent of which model runs.

## What was worth keeping

The experiment answered "no", and produced things that outlive the answer:

- **`repair-quotes.sh`** — 14.1% of the Gemini corpus cited a sentence never
  spoken. Now 0%. Nothing had ever checked.
- **`volumeNumbersForDirectory`** — 13 transcripts were invisible to every
  mining run, corpus-wide, for as long as the corpus has existed.
- **`enrich.sh`** — lifts `counter` on ANY provider. Gemini's own corpus is the
  obvious next place to run it.
- **Chapter indexes for all 8 GFF series** — 62 transcripts that had none, and
  the completeness check that comes with them.
- **`record-quality.sh` / `record-agreement.sh` / `blind-compare.sh`** — the
  measurement, including the demonstration that the mechanical half of it is
  not sufficient on its own.

## The measurement

`scripts/experiments/record-quality.sh` scores records against the transcript
they came from. Costs nothing, runs no model.

It exists because the pipeline never checked its own load-bearing claim.
`prompt.ts` demands the quote appear verbatim and `records.ts` calls it "the
only thing that makes a record checkable in ten seconds" — and nothing verified
it. It is also the first thing a weaker model gives up, because quoting exactly
out of 25k tokens is retrieval, not writing.

The scorer separates three failures a plain substring test lumps together:

| verdict | meaning |
| --- | --- |
| `exact` / `tidied` | copied; findable as one contiguous span |
| `spliced` | real words, joined from two or more moments |
| `fabricated` | not in the transcript. The record cites nothing. |

## What the existing corpus scores

88 volumes, 1,835 records, all mined by `gemini-3.1-pro-preview`:

```
exact        81.7%     tidied  4.1%     spliced 14.1%
partial       0.2%     FABRICATED 0.0%
timestamp within 30s of the quote   98.8%
why 99.5%   detail 90.8%   opponent 78.5%   counter 33.7%
```

**14.1% are spliced.** The prompt forbids merging moments and they merge
moments anyway, sometimes marking the seam with "…" and sometimes not. That is
one record in seven whose quote a reviewer cannot find by searching — the
ten-second check fails on it, and nothing in the pipeline flagged that before
`record-quality.sh` existed. `repairQuote` now fixes these deterministically;
running it over the existing corpus would lift it to ~100% verifiable, exactly
as it did for the local run.

**Fabrication is 0%, but an earlier draft of this document said 1.4% (24
records).** That was wrong, and how it was wrong is worth keeping. Two series
name their files `... Vol.3 - 1` through `- 8`, where the marker is the SERIES
and the trailing number is the file. `volumeNumber` preferred the marker, so
eight transcripts collapsed onto one slug and the scorer compared records
against a sibling transcript — the mismatch read as invented quotes. Fixed by
`volumeNumbersForDirectory`, which numbers a directory as a set; see
`volumes.ts`. The same collision had been silently dropping **13 transcripts**
from every mining run.

## The full corpus: 88 volumes, re-mined locally

Every volume Gemini had mined, re-mined with `qwen3:32b` at `--chunk 480`.
41 hours of machine time, **zero failures, zero cost**.

| | Gemini | `qwen3:32b` |
| --- | --- | --- |
| records | 1,835 | **4,311** (2.35x) |
| yield per 1000 words | 1.46 | **3.44** |
| **verifiable as one contiguous quote** | 85.8% | **100.0%** |
| spliced | 14.1% | **0.0%** |
| **fabricated** | **0%** | **0%** |
| exact quotes | 81.7% | **84.4%** |
| `why` filled | 99.5% | **100%** |
| `detail` filled | 90.8% | **97.1%** |
| timestamp within 30s | **98.8%** | 97.6% |
| `counter` filled | **33.7%** | 21.4% |
| `opponent` filled | **78.5%** | 61.7% |
| unscoped absolutes | **3.1%** | 6.9% |

Agreement with the Gemini corpus: moment recall 51.3%, same teaching point
44.7%, **F1 26.8%**, position mix similarity 73.3%.

**What local wins.** Twice the records. Every quote verifiable as one
contiguous span — the splice trim doing exactly its job, against Gemini's
untreated 14.1% splice rate. More exact copying, better `detail`, and no
invented quote anywhere in 4,311 records from two instructors.

**What local loses, and it never moved.** `counter`, `opponent` and unscoped
absolutes were the only metrics where Gemini led at 44 volumes, again at 67,
and again at 88. ~300 local records state an absolute with no stated scope —
that is the #102 collision, at scale. This is the settled result of the whole
investigation.

**They are not the same corpus.** F1 26.8% means local reproduces roughly a
fifth of Gemini's records and adds a great deal Gemini never found. Whether
that is acceptable depends on whether you want coverage of the library or
consistency with what is already published; a title half-mined by each is the
case to avoid.

### After the two post-passes

Neither pass calls a model on the transcript again and neither costs anything
on a local setup. Both are now steps 3 and 4 of the `flowlog-mine` skill.

| | Gemini | local, raw | **local, repaired + enriched** |
| --- | --- | --- | --- |
| records | 1,835 | 4,311 | 4,311 |
| contiguous quotes | 85.8% -> 100%* | 100% | **100%** |
| fabricated | 0% | 0% | **0%** |
| `why` filled | 99.5% | 100% | **100%** |
| **`counter` filled** | 33.7% | 21.6% | **46.3%** |
| **`applies-when` filled** | 78.5% | 61.7% | **76.4%** |
| unscoped absolutes | 3.1% | 6.9% | **4.2%** |

\* the Gemini corpus was 85.8% before `repair-quotes.sh` was run over it; both
stores are now at 100%.

**The enrichment added 1,063 counters and 634 scopes, and discarded 150.**

| | |
| --- | --- |
| additions proposed | 3,085 |
| discarded — evidence not in the transcript | 26 |
| discarded — scope field was a pasted excerpt | 124 |
| kept | 1,697 |

Only about half of the proposals became additions; the rest were the model
correctly reporting that the instructor does not say. That is why the 46.3% is
worth trusting rather than being an inflated fill rate.

**The paste guard earned its place.** The model kept putting its own evidence
into the scope field — `"arms are on the outside just like so do you remember
the phrase that we always use from bottom position everything inside okay"` is
a transcript excerpt, not a condition, and a scope full of raw transcript is
useless to the collision check it exists for. Prompt wording did not stop it.
The mechanical rule does: a condition written in the model's own words is NOT
verbatim in the transcript, so a scope that IS verbatim was pasted. It caught
124.

**What this changes about the verdict.** The conditions gap was the one finding
that held at 44, 67 and 88 volumes, and it was the reason to keep paying. It
was closable for free, without re-mining anything, in about twelve hours of
machine time. Local mining now leads or ties on every measured axis except
`exact quotes`, where Gemini's 95.9% is itself a product of the same repair
applied to its corpus.

### Two caveats on this table

- **It conflates model with prompt.** The Gemini corpus was mined with the old
  prompt; this run used the strengthened one. The only clean model-vs-model
  numbers are the matched-prompt pair below.
- **Every number here is mechanical.** No human has read a local record and
  judged whether it teaches the right thing. See "Gaining confidence".

### What the run cost, and what it taught about throughput

| | |
| --- | --- |
| volumes | 88, zero failures |
| machine time | 40.5 h |
| median per volume | 1,271s |
| slowest | 4,948s |

Throughput held at ~11-12 tok/s for the first ~21 hours and then halved to
~5 tok/s, recovering partially later. Restarting Ollama before each volume
DELAYS the decay substantially — earlier batches without it collapsed within
the hour — but does not prevent it. Normalised for volume length the first 20
volumes ran at 80 s/1000 words and the last 20 at 71, so the decay is real but
smaller than raw wall-clock suggests: later volumes are simply twice as long.

**A runner flaw worth remembering.** `remine-local.sh` caches its work list, so
it survived a fix to the code that GENERATES that list and re-mined one volume
from the wrong transcript. Delete `worklist.tsv` after any change to volume
numbering.

## Head to head

Every arm below runs the same prompt through the same chunker over volumes
Gemini had already mined, so the corpus itself is the control. Models are run
through Ollama; `30b-a3b` is `qwen3:30b-a3b-instruct-2507-q4_K_M` (MoE, 3B
active), the rest are dense.

Model selection was done on one volume and the winner then re-measured on four.
That order matters — see "Which is closest to Gemini" for what did not survive
the wider sample.

### Model selection — one volume, identical prompt and chunks

| | Gemini | `30b-a3b` whole | `30b-a3b` chunked | **`qwen3:32b`** | `gemma3:27b` |
| --- | --- | --- | --- | --- | --- |
| records | 24 | 14 | 72 | 36 | 72 |
| contiguous quotes | 91.7% | 57.1% | 81.9% | 77.8% | 77.8% |
| **fabricated** | **0%** | **0%** | **0%** | **0%** | **0%** |
| `detail` filled | 90.8% | — | 98.6% | **100%** | **34.7%** |
| `counter` filled | 33.3% | 0% | 15.3% | **27.8%** | **0%** |
| `opponent` filled | 100% | 100% | 22.2% | **83.3%** | 54.2% |
| unscoped absolutes | 0% | 0% | 26.4% | **2.8%** | 5.6% |
| generate speed | — | 45 tok/s | 70 tok/s | 11 tok/s | 15 tok/s |

`gemma3:27b` is the wrong shape for this schema: it fills `why` on every record
and then leaves `detail` empty on two-thirds and `counter` empty on **all** of
them. `30b-a3b` cannot scope an absolute. `qwen3:32b` wins on the fields that
decide whether a record is safe to combine, and pays for it in speed.

### `qwen3:32b` over four volumes

Two instructors, gi and no-gi, top and bottom, one title shipping a chapter
index. This is the number to trust; the single-volume column above is not.

| | Gemini | `qwen3:32b` |
| --- | --- | --- |
| records | 105 | 166 (1.58x) |
| exact quotes | 77.1% | 63.9% |
| contiguous | 92.4% | 79.5% |
| spliced | 7.6% | 20.5% |
| **fabricated** | **0%** | **0%** |
| timestamp within 30s | 97.7% | **98.6%** |
| `why` filled | 100% | 100% |
| `counter` filled | 34.3% | 22.9% |
| `opponent` filled | 92.4% | 87.3% |
| unscoped absolutes | 1.0% | 2.4% |

**Structure holds; citation does not.** Across 166 records from two instructors
it never fabricated a quote, beat Gemini on timestamp accuracy, and came within
a few points on `opponent` and unscoped absolutes — the fields #102 is about.
What it gives up is quote fidelity: 20.5% spliced against Gemini's 7.6%, so
roughly one record in five cites a sentence assembled from two moments and a
reviewer searching for it verbatim will not find it.

## Which is closest to Gemini

Summary tables cannot answer this: two miners can post near-identical quality
numbers while extracting different teaching points from different minutes of
the same video. `scripts/experiments/record-agreement.sh` compares against
Gemini's own records — pairing them one-to-one on position and timestamp, then
asking whether the paired records say the same thing.

Ranked on one volume, then re-measured on four:

| | moment recall | precision | **F1** | position mix |
| --- | --- | --- | --- | --- |
| `qwen3:32b` — 1 volume | 62.5% | 36.1% | 43.3% | 85.1% |
| **`qwen3:32b` — 4 volumes** | **41.9%** | **21.1%** | **25.8%** | **57.5%** |
| `30b-a3b` — 1 volume | 41.7% | 9.7% | 14.6% | 65.1% |
| `gemma3:27b` — 1 volume | 33.3% | 9.7% | 14.6% | 36.2% |

**The single-volume figure did not survive.** `qwen3:32b` looked three times
closer to Gemini than the alternatives on one volume; over four it is a good
deal further away than that suggested, and the position mix fell from 85.1% to
57.5%. Model *ranking* was stable — `qwen3:32b` is still the closest of the
three — but the absolute closeness was an artifact of the volume that happened
to be tested first. Any conclusion here drawn from one volume should be assumed
wrong until it is four.

They disagree in both directions on what a volume is even about:

- Gemini found and `qwen3:32b` missed: `reverse-de-la-riva-top`, `s-mount-top`,
  `open-guard-bottom`
- `qwen3:32b` found and Gemini did not: `north-south-bottom`, `open-guard-top`,
  `mount-bottom`, `closed-guard-bottom`

**So local mining would not reproduce the corpus. It would build a different
one of comparable structural quality.** For certifying fresh records through
`docs/REVIEW_BENCH.md` that is fine. For anything that compares records across
mining runs, or assumes the corpus is homogeneous, it is not — and a corpus
half-mined by each is the case to avoid.

Two traps this measure had to avoid, both of which reversed the ranking before
they were fixed:

- **Jaccard punishes verbosity.** Two records any reader would call the same
  point scored 22% because one was wordier. Containment over the shorter
  record scores that pair 69%.
- **Nearest-neighbour rewards volume.** Asking "is anything near this Gemini
  record?" gives a run with three times the records three chances per moment —
  the MoE ranked *first* under that scoring. Matching is now greedy and
  one-to-one, and F1 is reported so neither emitting more nor emitting fewer
  can win it.

The agreement threshold is the observed break in the data, not a round number;
see `AGREE_AT` in `record-agreement.ts`.

Near-duplicate check (≥0.6 word overlap between prescriptions): **zero pairs on
both sides**. The 72 records are genuinely distinct, not padding.

### Read it this way

**Chunking is the whole story for yield and quotes.** Handed the volume whole, the local model
summarised it — 14 records against Gemini's 24 — and its quotes drifted to
28.6% exact. Handed 8-minute windows, the same model on the same prompt found
72 distinct teaching points at 77.8% exact. One hard question became six easy
ones.

**It does not fabricate.** Zero invented quotes in every arm, across every
model, over 166 records from two instructors. This is the single most reassuring
result here: whatever else a local run gets wrong, it does not make up the
instructor's words.

**Structured fields are a model question, not a chunking one.** The MoE
left `opponent` at 22.2% and 26.4% of its records stated an absolute with no
scope — exactly the collision #102 describes, where "always connect knee and
elbow" and "do not connect knee and elbow" both reach the same cue because
neither says which knee shield it meant. The dense `qwen3:32b` on the identical
prompt and identical chunks brought that to **83.3% and 2.8%**. Chunking did
nothing for it; the bigger model did almost all of it.

**Quote fidelity moves the other way.** The dense model is the better extractor
of *meaning* and the worse *copyist* — 63.9% exact over four volumes against
Gemini's 77.1%. Spliced quotes are the residual cost: 20.5% against Gemini's
7.6%, so about one record in five cites a sentence assembled from two moments
and a reviewer searching for it verbatim will not find it. Nothing in the
pipeline flags that today.

## Configuration findings (each one cost a run)

Local inference has failure modes the hosted APIs do not, and most of them are
silent.

1. **`num_ctx` defaults small and truncates without a word.** A 25k-token
   transcript arrives as its last few pages, gets mined, and looks like a
   normal thin volume. `callOllama` sizes the window per prompt and warns when
   the reported prompt-token count comes back far short.

2. **`format: 'json'` returned a single object** — one record for a 9,000-word
   volume, well-formed and wrong.

3. **A JSON-schema grammar is 42× slower, and an enum is 210× slower.**
   Measured on a real 4,340-token chunk prompt:

   | format | speed | output |
   | --- | --- | --- |
   | none | 25.2 tok/s | starts `[` — correct |
   | `format: json` | 20.2 tok/s | starts `{` — one object |
   | `format: <schema>` | 0.6 tok/s | starts `[` |

   Constraining `position` to the taxonomy's 43 ids costs a further 210×
   (92 → 0.4 tok/s): the ids share long prefixes and the sampler tracks a
   parallel stack per live alternative at every token. **The prompt alone
   already produces the array**, so no grammar is used; `validateRecords`
   catches a bad position one step later for free.

4. **Prefill collapses at large context — this is the real reason to chunk.**

   | | prefill | generate |
   | --- | --- | --- |
   | chunk prompt @ 12k ctx | 4,405 tok in 3.4s (1,295 tok/s) | 73 tok/s |
   | whole prompt @ 46k ctx | 16,981 tok in **995.7s** (17 tok/s) | 49 tok/s |

   A 76× prefill cliff. Whole-volume local mining is not slow, it is
   impractical.

5. **An unbounded array grammar never terminates on its own.** With
   `repeat_penalty` off it padded to the 32k cap on every window — 12 minutes
   each. Output is now budgeted at three tokens per transcript word
   (~8× Gemini's observed yield) and `parseModelJson` salvages the complete
   records from a truncated response instead of losing the window.

6. **Throughput collapses after ~30-40 minutes of sustained mining, and
   restarting does not fix it.** This is the finding that decides whether a
   bulk run is practical, and it took three attempts to characterise honestly.

   A rested machine runs `qwen3:32b` at ~11 tok/s generate and ~190 tok/s
   prefill, and mines a volume in about 13 minutes. Volume 1 of the batch:
   806s. Volume 2: 1,181s. From there:

   | | wall clock | what it looked like |
   | --- | --- | --- |
   | volume 1 | 806s | 11 tok/s throughout |
   | volume 2 | 1,181s | 11 tok/s throughout |
   | volume 4 | **9,092s** | windows dropping to 1-2 tok/s |
   | volume 5 | abandoned | prefill itself fell to 7 tok/s, one window 1,970s |

   Two mitigations were tried and **both failed**:

   - *Restart Ollama between volumes.* Recovered speed once, then the next
     volume degraded within itself — the boundary is elapsed time, not volume
     boundaries.
   - *Kill Ollama entirely and start a fresh server.* Window 1 of the next
     volume still ran at 1 tok/s (1,024 tokens in 1,283s).

   Since a completely fresh server on an idle port reproduces it, the state is
   below Ollama — the machine, not the process. The symptom is low CPU with the
   model fully GPU-resident, which reads as thermal or power-state throttling
   after hours of sustained load rather than memory pressure (no swap, 35% free).

   **Practical consequence.** Do not plan a 99-volume run as one unattended
   job. Two of five volumes in this batch completed at full speed, one took
   seven times as long, and two never finished. Mine in short sessions on a
   rested machine and re-measure rather than extrapolating from the first
   volume — the first volume is always the fast one.

7. **Qwen3's dense line is a hybrid reasoning model** and emits `<think>`
   blocks by default — inside the response text, spending the output budget on
   deliberation for a copying task. `callOllama` sends `think: false` and
   retries without it on models that have no such mode.

8. **Reasoning models leak control tokens into records.** `qwen3:32b` put a
   literal `/no_think` inside a quote — 1 record in 166, in the one field the
   review model depends on being verbatim. Rare, but it lands in published
   text and scales linearly. `parseModelJson` now strips `<think>` tags and
   `/no_think` before parsing, for any provider.

9. **Restarting the server introduces its own failure.** A request arriving
   while `llama-server` is still loading returns
   `500 timed out waiting for llama-server to start`, which killed one volume
   nine windows from the end. `callOllama` now retries 5xx with backoff
   (15/30/45s) rather than losing the volume — the same reasoning as the 503
   advice in the `flowlog-mine` skill. A harness that bounces the server should
   also poll `/api/version` and warm the model before the first real request.

## What the four-volume batch actually cost

| volume | instructor | windows | result |
| --- | --- | --- | --- |
| `ageless-jiu-jitsu-bottom-game-no-gi-v2` | Danaher | 6 | mined |
| `pillars-of-defense-pin-escapes-by-gordon-ryan-v3` | Gordon Ryan | 7 | mined, 806s |
| `systematically-attacking-the-arm-bar-v3` | Gordon Ryan | 8 | mined, 1,181s |
| `gff-gi-fundamentals-strangles-turtle-breakdowns-v4` | Danaher | 11 | mined, 9,092s |
| `ageless-jiu-jitsu-top-game-no-gi-v7` | Danaher | 9 | **not finished** |
| `gff-pin-escapes-turtle-escapes-v6` | Danaher | 6 | **not finished** |

The two unfinished volumes are not a code failure — both were mining correctly
when the machine slowed to 1 tok/s. `scratchpad/batch2.sh` skips what is
already mined, so a re-run on a rested machine picks up exactly those two.

**Chapter-boundary chunking works and was exercised here.**
`gff-pin-escapes-turtle-escapes-v6` ships an index, and `chunkLines` split its
10 chapters into 6 windows on real boundaries (`0:00:00-0:11:12`,
`0:11:22-0:23:41`, ...) rather than fixed 8-minute cuts. Until this batch that
path had never run against a model.

## Running it

```bash
ollama serve
ollama pull qwen3:32b
```

```bash
scripts/mining/mine.sh "<volume.txt>" --provider ollama --model qwen3:32b --chunk 480 \
  --instructor "<Instructor>" --instructional "<Title>" --volume N \
  --out ~/flowlog-records-local
```

```bash
scripts/experiments/record-quality.sh --compare ~/flowlog-records-local
```

```bash
scripts/experiments/record-agreement.sh ~/flowlog-records-local
```

`--chunk <seconds>` works for any provider; 480 is what every result here used.
Without it a local model summarises the volume instead of exhausting it, and a
46k context window makes prefill 76x slower — chunking is not optional locally.

`ollama` is never auto-selected. A volume mined locally by accident looks
identical on disk to one mined by Gemini, and records carry no note of which
model made them — which, given how differently the two carve a volume, is the
mistake that would be hardest to unpick later.

## At 10x scale — can this replace Gemini without losing quality?

Different question from the one above, and it has a better answer. If the
volume of material grows to the point where cost is a real constraint, and
everything new is mined locally, the two objections change weight:

**"It diverges from Gemini" mostly dissolves.** That objection was about
MIXING — a corpus half-mined by each, where records are not comparable. If a
new body of material is mined entirely with `qwen3:32b` it is internally
consistent, and the 95 Gemini volumes are the legacy minority rather than a
standard to match. The disagreements were also examined rather than assumed:
sampling records where the two models covered the same moment and said
different things, the local model was not WRONG — it had extracted a different,
equally real teaching point from the same 60 seconds, and in one sampled case
the same point phrased differently enough to fall under the agreement
threshold. Divergence here is coverage, not error.

**The splice gap is mechanically repairable, for free.** This is the finding
that decides it. Every non-contiguous quote in the corpus — Gemini's 8 and
`qwen3:32b`'s 34 — contains a contiguous transcript span of at least 8 words:

| | non-contiguous quotes | repairable | trimmed quote keeps |
| --- | --- | --- | --- |
| Gemini | 8 | **100%** | 61% of original words |
| `qwen3:32b` | 34 | **100%** | 72% of original words |

Trimming a spliced quote to its longest real span turns an unverifiable record
into a verbatim one with no model call. `qwen3:32b`'s 20.5% splice rate is
therefore not a quality ceiling — it is an unimplemented post-processing step,
and applying it would put local quote fidelity at or above Gemini's untreated
7.6%.

**What genuinely remains.** `counter` at 22.9% against Gemini's 34.3% — the
local model notices less often when an instructor says how a technique gets
stopped. That is a missing field rather than a wrong one, so it degrades
gracefully, and it is the one thing a cheap second pass would buy back.

So: **yes, at 10x, with two things built first** — the splice trim, and the
control-token strip below. Neither needs a model.

## The three fixes, and what they bought

**1. Splice trim** (`repairQuote` in `records.ts`). Narrows a quote to the
longest run of it the transcript actually contains, sliced out of the real
transcript so it keeps the original punctuation. Deterministic, no model call.
A NARROWING and never a rewrite — it can only return a substring of what the
instructor said, which is why it is safe where `isUnscopedAbsolute`
deliberately refused to auto-repair. A quote with no span of 8+ words left is
dropped, for the same reason an empty quote already is.

**2. Strengthened COUNTER prompt.** The evidence said instruction-following
rather than chunk geometry: on identical chunks `gemma3:27b` scored 0% and
`qwen3:32b` 22.9%. The section now names the four shapes a counter takes in
speech, and the two rules that decide most cases — a counter is what the
OPPONENT does (not your next step), and it is often spoken BEFORE the technique
as the reason for it.

**3. Zero-record guard.** A volume that yields nothing now FAILS instead of
writing `[]` and exiting 0. That empty file was the dangerous outcome: the
batch runner skips volumes that already have a records file, so an empty one
made the volume permanently invisible — a re-run would never retry it and the
corpus kept a hole nobody could see. Same silent-skip class as #75.

### Measured, both providers on the current prompt

Two volumes mined end-to-end by each, splice trim applied to both:

| | Gemini | `qwen3:32b` |
| --- | --- | --- |
| records | 38 | 68 |
| **verifiable as one contiguous quote** | **100%** | **100%** |
| **fabricated** | **0%** | **0%** |
| `why` filled | 94.7% | **100%** |
| `detail` filled | 100% | 100% |
| `counter` filled | **86.8%** | 70.6% |
| `opponent` filled | 100% | 98.5% |
| unscoped absolutes | 0% | 1.5% |
| quotes needing a trim | 4 (11%) | 18 (26%) |

**The COUNTER prompt is the biggest single win in this whole investigation, and
it helps the paid model MORE than the local one.** On matched volumes Gemini's
counter fill went 34.3% -> 74.3% and `opponent` 92.4% -> 98.6%. The earlier
reading — "local beats Gemini on counter" — was an artifact of comparing a new
prompt against an old corpus, exactly the confound this section was written to
remove. Local still trails on counter (70.6% vs 86.8%); it is the one field
where the gap is real.

After the trim both providers sit at 100% verifiable quotes. The local model
simply needs the repair more often (26% of records vs 11%).

## Does a chapter index help?

Asked directly, and worth the answer being precise: **yes, but the index was
actively hurting results until a chunker bug was fixed, and two of its three
benefits are things no metric in this document measures.**

### The format

A pasted product-page index looks like this — title first, then a RANGE, under
a titled volume header:

```
Volume 01: Pin Escapes & Turtle Escapes 1
CHAPTER TITLE
START TIME
introduction	0:00 - 6:56
Escapes Overview	6:56 - 43:37
Bridging	1:25:21 - 1:33:00
```

`parseChapterIndex` read **zero** chapters from that. It only knew the
`MM:SS - Title` form — timestamp first, no end. It now reads both, plus titled
`Volume 01: ...` headers and the `CHAPTER TITLE` / `START TIME` column
headings, which must be skipped rather than become chapters. The two forms are
unambiguous because one puts the times at the start of the line and the other
at the end.

**Stated END times are strictly better than starts alone**, and are now used:

- they bound the LAST chapter, which otherwise runs to infinity and absorbs
  every late record — making the completeness check read as full coverage when
  the tail was never mined;
- they make gaps visible. A moment past a chapter's stated end belongs to no
  chapter, and `chapterAt` now returns null rather than mislabelling it with
  the previous one.

### What the index buys

1. **Every record gets a `chapter`.** 18 of 18 with an index, 0 of 33 without.
2. **The completeness check becomes possible at all.** With an index the run
   reports `9/10 chapters produced records` and names the empty one — the only
   detector for a model summarising rather than exhausting. Without one it
   prints `no chapter index — cannot check coverage`, and a thin volume is
   indistinguishable from a thorough one.
3. **Windows break where techniques do**, instead of mid-explanation.

Note that 1 and 2 are the reasons to want an index, and neither shows up in
record counts or quote fidelity. Judging an index by yield alone misses its
whole point.

### The bug it exposed, and the result after fixing it

Mining one volume three ways — same model, same 8-minute target,
`GFF Pin Escapes vol 4`, whose ten chapters are all "Knee Escapes From Side
Position":

| | index, old chunker | no index | **index, fixed chunker** |
| --- | --- | --- | --- |
| windows | 5 (9-12 min) | 7 (8 min) | 8 (5-7 min) |
| records | 18 | 33 | **35** |
| `counter` filled | 27.8% | 27.3% | **34.3%** |
| `opponent` filled | 55.6% | 72.7% | **82.9%** |
| chapter tagged | 18/18 | 0/33 | **35/35** |
| completeness check | 9/10 | unavailable | **10/10** |
| verifiable quotes | — | — | **100%** |

The first column is the bug: `chunkLines` broke at the first chapter boundary
at or AFTER the target, which overshoots. Five-minute chapters against an
eight-minute target produced 9-12 minute windows, and an over-long window is
the exact failure chunking exists to prevent — half the records were lost to
it. Fixed by taking the boundary CLOSEST to the target, before or after, and
cutting mid-chapter when none is near. A regression test asserts no window
exceeds 1.25x the target.

### The finding that actually matters: position accuracy

Distinct positions per volume looked like a point AGAINST the index — 1 with
it, 3 without. It is the opposite, and this is the strongest argument for
supplying indexes:

```
no index    side-control-bottom 19,  mount-bottom 9,  single-leg-x-bottom 5
with index  side-control-bottom 35
```

The volume is ten chapters of knee escapes from side control. It teaches ONE
position. Without the index **14 of 33 records — 42% — were filed under
positions the volume never covers**, and `records.ts` is explicit about what
that costs: a position outside the taxonomy is rejected, but a position inside
it and simply WRONG makes every later lookup confidently wrong, and nothing
downstream can detect it.

Chapter titles carry the position. Feeding them in stops the model drifting.

### So: should you supply indexes?

Yes, for everything, in either format. Measured on one volume the index buys
more records (35 vs 33), better `opponent` (82.9% vs 72.7%), better `counter`,
a completeness check that came back 10/10, and — the real prize — **42% fewer
misfiled positions**.

`Contents.txt` files for all eight Go Further Faster series are now in the
library, scraped from the bundle's product page and renumbered 1-8 to match the
transcript filenames. 638 chapters across 64 volumes; **62 of the 70
transcripts** in those folders now resolve to an index where none did before.
Two of the eight series list start times only rather than ranges, so they are
written in the timestamp-first form; `parseChapterIndex` reads both.

One of those folders already held a `Content.txt` that parsed to **zero**
chapters — a URL followed by `Vol 1:` headers the parser did not recognise. It
had been silently contributing nothing. `VOLUME_RE` now accepts `Vol`, `Vol.`
and `Volume`, bare or followed by a title.

## Two open problems

**A volume Gemini will not mine.** `systematically-attacking-the-arm-bar-v3`
returns a bare `[]` under the current prompt — three separate runs — while the
same transcript yields 13 records under the old COUNTER text and 32 in the
original corpus. Not length or phrasing: a tightened rewrite of the section
failed identically. The zero-record guard now stops this being recorded as
mined, but the cause is unexplained and it is a real hole in the prompt change.
Worth an A/B across more volumes before the COUNTER text is trusted everywhere.

**`--from-json` could not read chunked responses.** A chunked run saves the
windows as an array of raw strings, so reprocessing one produced 0 records and
6 rejections. Fixed (`parseSavedResponse`). This matters more than it looks:
reprocessing saved responses is how a fix to validation or to `repairQuote`
gets applied to work already paid for — it is the difference between re-running
the tokens and re-running the code, and it is what made the trim fix free to
apply to four Gemini volumes.

## Gaining confidence before committing

Every metric here is mechanical. They establish that records are well-formed,
verbatim and scoped. **They cannot establish that a record teaches the right
thing.** So read twenty pairs:

```bash
scripts/experiments/blind-compare.sh ~/flowlog-records-q32c \
  --reference ~/flowlog-records-gemfix --sample 18
# then, to reveal which side was which:
scripts/experiments/blind-compare.sh ~/flowlog-records-q32c \
  --reference ~/flowlog-records-gemfix --sample 18 --key
```

Both sides must be mined by the CURRENT prompt — comparing against the corpus
scores the prompt change rather than the model, which is the mistake that
produced the misleading counter result above.

Blind on purpose. Sides are shuffled per pair by a seed derived from the pair
itself, so the sheet and the key agree without either being random. Knowing
which side is the paid model decides the question before the reading starts,
and the answer is genuinely in doubt.

**The blinding is good but not perfect.** Two tells survive, both created by
the splice trim rather than by the models:

- Gemini quotes average 251 characters, local ones 167 — the trim shortens a
  spliced quote to its longest real span.
- 7.3% of Gemini quotes contain an ellipsis where two moments were joined,
  against 0.3% of local ones.

So a reader who knows this can often guess the side. That does not invalidate
the exercise — the question being asked is "which card teaches this moment
better", not "which model wrote it" — but do not treat a strong preference as
purely blind if you noticed the pattern while reading.

Judge in this order: does the card match its quote; is the mechanic correct and
specific enough to act on; does "applies when" actually scope it.

**A caution learned twice in this document.** The single-volume agreement
figure said `qwen3:32b` was three times closer to Gemini; four volumes halved
it. The single-volume counter figure said local beat Gemini; a matched-prompt
run reversed it. Do not act on one volume.

## Where this leaves the cost question

The corpus is ~99 unmined volumes at roughly 27k input and 5k output tokens
each. That is a one-off spend, not a running cost. What actually hurts is
hitting the monthly cap mid-series, and local mining sidesteps that entirely —
at the price of ~13 minutes per volume on a rested machine, and considerably
worse once it is not.

Three ways to spend the local model, in increasing order of what they ask of it:

- **Probe before paying.** `flowlog-mine` already says to check a title's
  position output against real demand before mining it. Doing that probe
  locally makes it free. Note the caveat this document earned: the local
  position mix agrees with Gemini's only 57.5% of the time, so a probe answers
  "is there material here at all", not "is it the same material Gemini would
  find".
- **Two-pass.** Local extraction is faithful; its weakest field is `counter`
  (22.9% against 34.3%). That is a short second call over the mined records
  rather than a re-read of the transcript, and it is the cheapest way to close
  the one gap that is genuinely a gap.
- **Mine whole titles locally.** Defensible now — zero fabrication, timestamps
  better than Gemini's, `opponent` and scoping within a few points. Accept two
  things first: the corpus will diverge from what Gemini built, and ~20% of
  records will carry a spliced quote that a reviewer cannot find verbatim.

None of the three is built. **The splice trim is the one to build first** —
`record-quality.sh` already locates the contiguous span per record, it repairs
100% of affected quotes with no model call, and it is what makes local mining
defensible at scale rather than merely cheap.
