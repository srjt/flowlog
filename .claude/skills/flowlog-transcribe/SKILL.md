---
name: flowlog-transcribe
description: Transcribe a BJJ instructional folder to timestamped .txt files, ready for mining. Use when the user says "transcribe <instructional/folder>", adds a new instructional to the library, or asks to prepare a title for mining. Wraps scripts/transcribe.py — local, GPU, idempotent.
---

# Transcribing an instructional

Turns the video files of one instructional into timestamped `.txt` transcripts
sitting beside them, which is the input `flowlog-mine` needs.

Everything runs on this machine. No audio leaves it, and there is no API cost.

## The one flag that matters

**Always pass `--timestamps`.**

The miner identifies a volume by looking for `[h:mm:ss -> ...]` lines
(`looksLikeTranscript` in `scripts/mining/mine-series.ts`). A transcript
written without timestamps is not recognised as a volume at all — it is
skipped silently, and the series appears to mine successfully while producing
nothing. That failure mode has already cost this project 415k words once
(issue #75).

## Run it

```bash
scripts/transcribe.sh ~/Documents/"BJJ Instructionals"/"<Instructor>"/"<Title>" --timestamps
```

- Takes a directory (recursive) or a single file.
- **Idempotent**: a media file whose `.txt` already exists is skipped. Re-running
  after an interruption resumes rather than redoing.
- `--overwrite` forces a redo. Only use it when a transcript is known bad —
  re-transcribing costs GPU hours and changes nothing otherwise.

**It is slow.** Roughly 20 hours of video takes a couple of hours. Start it with
`run_in_background: true` and poll the `.txt` count rather than blocking:

```bash
ls "<folder>"/*.txt | wc -l
```

## Before starting

1. **Check the tools exist**: `which whisper-cli ffmpeg`. Both come from
   Homebrew (`brew install whisper-cpp ffmpeg`).
2. **Check what is already done** — count media files vs `.txt` files. If they
   match, there is nothing to do; say so rather than starting a two-hour job.
3. **Look at the filenames.** The miner needs a volume number it can find:
   an explicit `Vol N` marker anywhere, or a leading/trailing number. `Vol.1`,
   `Vol 1`, `... Retention 4`, `1 Ageless ...` all work. If a title uses some
   other convention, say so before transcribing — the transcripts would be fine
   and the mining step would silently skip them.

## After it finishes — verify, do not assume

```bash
# every media file has a transcript
ls "<folder>" | grep -cE '\.(mp4|mkv|mov|m4v|webm)$'
ls "<folder>"/*.txt | wc -l

# and every transcript actually carries timestamps
head -c 60 "<folder>"/*.txt
```

Each transcript should begin with `[00:00:0X -> ...]`. One that does not will be
skipped by the miner without complaint.

## Files that are not transcripts

Some folders ship a **chapter index** — a `.txt` of `HH:MM:SS Title` lines. Do
not overwrite or delete it. The miner finds it automatically and uses it to tag
records and report coverage; a title with an index produces noticeably better
records than one without.

It has no volume number in its name, so it is correctly ignored as a volume.

## What not to transcribe

Non-technique material. *The Sport of Kings High Performance Mindset* is a
mindset course — there are no positions or mechanics in it to mine. Transcribing
it costs GPU time and produces nothing the pipeline can use.

## Next step

Once transcripts exist, mining is a separate skill: **flowlog-mine**.
