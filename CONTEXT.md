# Flowlog

Flowlog is a voice-reflection tool for serious hobbyist athletes. After a
practice, the user records a short voice dump; an AI pipeline turns it into one
mechanical coaching cue and a row in a growing trend log. This file is the
project's glossary — the shared language every issue, test name, and refactor
proposal should use. It is not a spec or an architecture doc (those live in
`docs/`); it defines what our words mean.

## Language

### Practice & recording

**Session**:
One recorded reflection on a single bout of practice, once it has been analysed
and saved. The core persisted entity — transcript, extracted data, cue, and
feedback all hang off it.
_Avoid_: entry, log, note, recording (a recording is the audio, not the Session)

**Take**:
A single recording attempt the user captures and can re-record before accepting.
A Take becomes a Session only once accepted and processed; discarded Takes never
do.
_Avoid_: attempt, clip

**Session unit**:
What one bout of practice is called in a given sport — a "roll" in BJJ, a
"round", a "game". Sport-defined, user-facing.
_Avoid_: workout, exercise

**Voice dump**:
The 20–90 second unstructured spoken reflection the user records as a Take.
_Avoid_: recording, memo, note

### Sport model

**Sport context**:
The self-contained bundle of everything sport-specific — vocabulary, prompts,
sentiment labels, skill levels, recording bounds. The pipeline is sport-agnostic
and reads only from the active Sport context; no sport logic lives anywhere else.
_Avoid_: sport config, sport module, sport pack

**Sport key**:
The stable identifier for a sport (`bjj`, `golf`, `tennis`…). The contract the
rest of the app passes around instead of a concrete sport.
_Avoid_: sport id, sport name (the name is the human-readable display name)

**Skill level**:
A sport-relative measure of the user's standing — a belt in BJJ, a handicap tier
in golf, an Elo band in chess. Free text; each Sport context interprets its own.
_Avoid_: rank, belt, tier (these are sport-specific instances of Skill level)

**Vocabulary priming**:
Supplying a sport's domain terms to the transcription step so it spells
specialist words correctly (e.g. "berimbolo", "kimura").
_Avoid_: hinting, biasing, prompt seeding

### The pipeline & its outputs

**Pipeline**:
The two-stage AI flow that turns a Take into a saved Session: transcribe →
extract → coach → quality gate → persist. Deliberately two AI stages, not one.
_Avoid_: flow, processor, analyzer

**Extraction**:
The stage that reads the transcript and pulls out structured facts — positions
visited, key mistake, opponent action, sentiment. It never produces coaching;
that separation is load-bearing.
_Avoid_: analysis, parsing, summarization

**Coaching cue** (or **Cue**):
The single, mechanical, ≤25-word instruction that is the product's headline
output. Hard-capped at 25 words. Exactly one per Session.
_Avoid_: tip, advice, feedback, suggestion, insight

**Quality gate**:
The check every Cue must pass before it can reach the user — word count, generic
phrasing, model confidence. On failure it retries with a stricter prompt, then
falls back to a safe capped Cue rather than showing an error.
_Avoid_: validation, filter, guardrail

### What a Session records

**Positions visited**:
The named positions or situations the user mentioned in a Session (e.g. "closed
guard", "mount").
_Avoid_: states, scenarios

**Key mistake**:
The one main error Extraction identifies in a Session. Singular by design.
_Avoid_: error, fault, problem, issue

**Target position**:
The specific position the Cue is aimed at improving.
_Avoid_: focus (reserve "focus" for Focus area)

**Sentiment**:
The emotional-tone label for a Session, chosen from the Sport context's allowed
labels (e.g. "frustrated", "confident"). This is the canonical term everywhere a
Session's tone is stored or extracted.
_Avoid_: mood, emotion, feeling, vibe

### Trends & the trend log

**Trend log**:
The accumulation of Sessions over time, read back as patterns. The product's
retention promise: the log surfaces what recurs across many Sessions.
_Avoid_: history, timeline, journal

**Streak**:
Consecutive calendar days on which the user logged at least one Session, counting
back from the most recent.
_Avoid_: run, chain

**Focus area**:
The position the user logs **most often**. A measure of where their attention
currently goes — not, on its own, a judgment that they are weak there.
_Avoid_: strength, main position, weakness (Focus area is not a Weakness)

**Weakness** (or **Dominant weakness**):
A position or pattern the user recurrently *struggles* with — the thing the trend
log is meant to surface and coaching should target. Distinct from Focus area:
most-logged is not the same as most-troublesome.
_Avoid_: leak (see below), problem area, flaw

**Leak**:
Borrowed from grappling slang for a recurring, exploitable Weakness. Used in the
weekly digest's user-facing copy.
_Avoid_: gap, hole (as domain terms)
