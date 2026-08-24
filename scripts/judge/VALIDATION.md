# Cue judge — validation result

Run against the frozen human verdicts (`~/flowlog-baseline/cue-verdicts.json`,
36 labelled cues: 17 wrong, 11 sound, 8 shallow, 2 skipped).

Reproduce with `scripts/judge/judge.sh`. Results are cached, so a re-run is free.

> No cue text, key mistakes, or session ids appear in this file. They are the
> user's own training data and this repository is public. The labelled set and
> the judge cache both live outside the repo, under `~/flowlog-baseline/`.

## Result: **FAIL**, on both judges

Two models were run against the same 36 cues. Both fail, on the same criterion.

| metric               | gemini-3.1-pro | claude-sonnet-4-6 | bar  |
| -------------------- | -------------- | ----------------- | ---- |
| defects caught       | **13/17**      | **12/17**         | ≥ 12 |
| sound cues condemned | **4/11**       | **6/11**          | ≤ 2  |
| shallow flagged      | 4/8            | 5/8               | —    |
| verdict              | FAIL           | FAIL              |      |

Judged grounded: 6. Judged ungrounded: 30. Identical split for both.

The sections below analyse the first (gemini) run in detail; the cross-family
comparison and the correction it forced are further down.

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

Without records the judge contradicted sound cues four times, and confidently —
disputing De La Riva hook mechanics and knee-on-belly leverage in flat,
technical language that reads exactly like its grounded calls.

> **Read the grounded row with care.** Only ONE sound cue in the whole set was
> judged with evidence, so "grounded never condemned a sound cue" is a fact
> about a single cue and establishes nothing. See the correction below.

What this shows is that _ungrounded assertion of contradiction_ is unreliable
and drives the failure. It does NOT show that grounded judging is better: 10 of
the 11 sound cues were judged ungrounded, so concentrating the false positives
there is very nearly forced by the sample.

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

**Run 2026-08-24. Cross-family scored worse, not better.**

|                      | gemini-3.1-pro-preview   | claude-sonnet-4-6 |
| -------------------- | ------------------------ | ----------------- |
|                      | same family as generator | cross-family      |
| defects caught       | 13/17                    | 12/17             |
| sound cues condemned | 4/11                     | **6/11**          |
| shallow flagged      | 4/8                      | 5/8               |
| verdict              | FAIL                     | FAIL              |

Model family was the leading suspect for the false positives. It is not the
cause: the cross-family judge caught one fewer defect and condemned two more
sound cues. The same-family reading was the more flattering of the two.

Each judge model writes its own cache file, so neither run can overwrite the
results it exists to be compared against.

```bash
JUDGE_MODEL=claude-sonnet-4-6 scripts/judge/judge.sh
```

## Correction: the grounded-precision claim rests on one cue

An earlier version of this document, and a comment on #62, stated that with
records to check against the judge "never once condemned a sound cue", and used
that to argue the fix is corpus coverage. **That is arithmetically true and
close to meaningless.**

The grounded sample, identical for both judges:

| cues judged | had records | of those, wrong | of those, **sound** | of those, shallow |
| ----------- | ----------- | --------------- | ------------------- | ----------------- |
| 36          | 6           | 4               | **1**               | 1                 |

Exactly one sound cue in the entire set was judged with evidence. A judge that
condemns nothing and a judge that condemns everything are indistinguishable on
a sample that size. **Whether grounded judging is more precise is untested, not
confirmed.**

The corpus-coverage conclusion survives, but the reasoning changes and gets
weaker. More corpus is not "a plausible improvement to a judge we know is
precise when grounded". It is the **precondition for finding out whether
grounding helps at all** — with 6 grounded cues the experiment cannot run.

## What the cross-family run does establish

**Claude asserts contradictions far more aggressively.** Claim-level
`contradicted` verdicts:

|                               | gemini | claude |
| ----------------------------- | ------ | ------ |
| grounded, on defective cues   | 6      | 5      |
| ungrounded, on defective cues | 15     | 18     |
| **ungrounded, on sound cues** | **4**  | **15** |
| ungrounded, on shallow cues   | 5      | 12     |

Nearly four times as many contradiction claims against cues the practitioner
considered sound, each in confident, mechanically specific language.

**Recall barely moves with evidence.** Defects caught by mode — gemini 3/4
grounded and 10/13 ungrounded; claude 3/4 and 9/13. On this sample grounding
cannot be shown to buy anything, which is a statement about the sample rather
than a finding about grounding.

**The two judges agree on 26 of 36 cues (72%).** They disagree outright on ten.
Neither reading is as solid as its own number implies, and averaging them would
manufacture a confidence neither earned.

**The `off_target` path is still effectively dead.** Across both judges and 72
cue-judgements it drove exactly one defective call, for what is the most common
defect type in the set.

```bash
JUDGE_MODEL=claude-sonnet-4-6 scripts/judge/judge.sh --fresh
```

## What this means for #62

**The judge is not ready to be a release gate.** Gating on it today would block
releases on false accusations at a rate of better than one sound cue in three.

An obvious repair is to stop the judge asserting contradictions it has no
evidence for — restricting `contradicted` to grounded mode. On the gemini run
that removes 3 of the 4 false positives **and 7 of the 13 catches**, landing
near 6/17: honest, and far too blind to gate on.

The real blocker is that the question cannot currently be asked. Only 6 of 36
cues resolve to records, and only one of those was a sound cue, so there is no
sample on which to test whether grounded judging is more precise. **Corpus
coverage is the precondition for the experiment, not merely a way to improve
the result** — which makes #67 (mine the remaining instructionals) a dependency
of #62 rather than a parallel nicety.
