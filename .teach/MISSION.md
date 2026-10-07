# Mission: The Flowlog instructional pipeline, end to end

## Why
Surjit owns Flowlog and the whole video -> transcript -> record -> cue chain, but
has only ever seen it one stage at a time. The goal is to hold the entire path
in one head so that a bad cue can be traced back to the transcript line that
caused it, a change to grounding can be defended with a measurement rather than
a feeling, and the architecture can be explained to a hire or an investor
without opening the repo.

## Success looks like
- Given a disliked cue, walk backwards: session row -> `grounding_record_ids` ->
  the record -> the review store -> the timestamp in the video. Name the failing
  hop.
- Change one knob in grounding selection (the relevance gate, the IDF/domain
  weighting, the record limit) and say in advance which measurement would move.
- Explain, from memory and without notes, why there are two record stores and
  what may cross between them.
- Spot a stage that is silently doing nothing — the failure mode this pipeline
  keeps producing (issue #75, the `{{GROUNDING}}` gap).

## Constraints
- Learning by reading and reasoning over this repo, not by running long jobs.
  Mining costs money; transcription costs GPU hours. Lessons must be free to do.
- Time is short. Lessons should be ~10 minutes and end in a concrete win.
- The repo is public and the review store is not. Nothing in this workspace may
  quote verbatim instructional text.

## Out of scope
- Operating the pipeline as a runbook (Surjit did not pick this). The three
  skills — `flowlog-transcribe`, `flowlog-mine`, `flowlog-publish` — already
  cover the how-to-run; lessons cover the how-it-works.
- Expo / SDK 54 / EAS build mechanics.
- BJJ technique itself, beyond what is needed to read a record.
