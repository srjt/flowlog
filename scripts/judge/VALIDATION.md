# Cue judge — validation result

Run against the frozen human verdicts (`~/flowlog-baseline/cue-verdicts.json`,
36 labelled cues: 17 wrong, 11 sound, 8 shallow, 2 skipped).

Reproduce with `scripts/judge/judge.sh`. Results are cached, so a re-run is free.

> No cue text, key mistakes, or session ids appear in this file. They are the
> user's own training data and this repository is public. The labelled set and
> the judge cache both live outside the repo, under `~/flowlog-baseline/`.

## Result: **FAIL**

| metric          | result    | bar  |                      |
| --------------- | --------- | ---- | -------------------- |
| defects caught  | **13/17** | ≥ 12 | pass                 |
| false positives | **4/11**  | ≤ 2  | **fail**             |
| shallow flagged | 4/8       | —    | reported, not scored |

Judged grounded: 6. Judged ungrounded: 30.

**This is reported, not tuned away.** The judge was run once, at the settings it
was designed with, and the number is what it is. A judge adjusted until it
agrees with its own validation set has been fitted, not validated — and it
would then be incapable of telling us anything we did not already believe.

## Where the failure is concentrated

Every defective call the judge made, by the signal that drove it:

| human label | signal                  | mode           | n     |
| ----------- | ----------------------- | -------------- | ----- |
| wrong       | contradicted            | grounded       | 3     |
| wrong       | contradicted            | ungrounded     | 7     |
| wrong       | no claims extracted     | ungrounded     | 3     |
| **sound**   | **contradicted**        | **ungrounded** | **3** |
| **sound**   | **no claims extracted** | **ungrounded** | **1** |

Three findings, in order of how much they matter.

### 1. Ungrounded `contradicted` calls are the false positives

Claim-level `contradicted` verdicts, by mode:

| mode       | on wrong cues | on sound cues | on shallow cues |
| ---------- | ------------- | ------------- | --------------- |
| grounded   | 6             | 0             | 0               |
| ungrounded | 15            | 4             | 5               |

With records to check against, the judge did not once contradict a sound cue.
Without them it did so four times, and confidently — it disputed De La Riva
hook mechanics and knee-on-belly leverage in flat, technical language that
reads exactly like the grounded calls.

This is the prior-art warning arriving from the other direction. The research
said thin evidence makes grounded judging worse than ungrounded; what this run
shows is that _ungrounded assertion of contradiction_ is itself unreliable, and
it is the single thing driving the failure. n is small (3 grounded cues), so
the grounded column is suggestive rather than established.

### 2. The `off_target` path never fired — not once

Zero defective calls came from "correct jiu-jitsu, aimed at the wrong problem",
despite that being roughly half of what the practitioner marked wrong.

The judge is catching defects almost entirely by **disputing technique**, not by
noticing the cue answered a question nobody asked. Recall clears the bar, but it
clears it through a mechanism the design did not intend, and one that the table
above shows is the least trustworthy part of the judge. That combination should
be treated as a weaker 13/17 than the raw number suggests.

### 3. Empty decomposition is laundered into an accusation

`judgeFromClaims` treats "no checkable claim" as a defect. It drove 4 defective
calls — 3 correct, 1 false. That is a coin flip wearing a verdict's clothing.

It also contradicts a rule applied elsewhere in the same judge: `normaliseStatus`
deliberately turns an unparseable status into `unsupported`, never
`contradicted`, on the grounds that a judge converting its own parse failures
into accusations posts recall it has not earned. Empty decomposition is the same
failure and is handled the opposite way.

**This was left as-is.** Changing it after seeing which rows it got wrong is
tuning against the validation set, which is the thing this exercise must not do.
It is written down here instead, so a fix can be made deliberately and re-scored
as a stated change rather than folded in quietly.

## Caveat: judge and generator are the same family

The cues were written by `gemini-2.5-flash`. The judge runs
`gemini-3.1-pro-preview` — a different and stronger model, but the same family.

Per the prior-art research this is a cost decision rather than a correctness
one: cross-family buys roughly 2.18 effective independent votes, and
self-preference tracks perplexity rather than authorship. It is still a weaker
check than cross-family. The harness prints this caveat in its own output so it
cannot quietly go unmentioned.

A cross-family run needs `ANTHROPIC_API_KEY` in `.env` **with credit on the
account**. Attempted 2026-08-24: the key authenticated, but the Anthropic
balance was zero (`400 invalid_request_error: credit balance is too low`), so
the cross-family reading is still outstanding.

Each judge model writes its own cache file, so a cross-family run cannot
overwrite the same-family results it exists to be compared against.

```bash
JUDGE_MODEL=claude-sonnet-4-6 scripts/judge/judge.sh --fresh
```

## What this means for #62

**The judge is not ready to be a release gate.** Gating on it today would block
releases on false accusations at a rate of better than one sound cue in three.

The most promising repair, on this evidence, is to stop the judge asserting
contradictions it has no evidence for — restricting `contradicted` to grounded
mode, and letting ungrounded mode return only `supported` / `off_target` /
`unsupported`. On this run that would have removed 3 of the 4 false positives
and 7 of the 13 catches, landing at roughly 6/17 recall: a judge that is honest
but far too blind to be useful.

Which points at the real blocker. The judge cannot check what the corpus does
not cover, and only 5 of the 17 known defects name a position with records at
all. **Corpus coverage, not judge logic, is what stands between this and a
usable gate** — which makes #67 (mine the remaining instructionals) a
dependency of #62 rather than a parallel nicety.
