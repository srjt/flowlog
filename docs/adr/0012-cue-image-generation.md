# 0012. Cue-image generation: provider, visual style, and cross-user reuse key

**Status:** accepted · **Date:** 2026-08-03

A coaching cue is ≤25 words of terse, mechanical text that many users find hard
to parse at a glance. We will generate a small instructional image per cue to
convey it visually. Because the same underlying mechanic recurs across users, a
generated image is stored in a **shared** catalog and reused rather than
regenerated per user. This ADR fixes three things the downstream tickets build
on: the **image provider**, the **visual style + prompt recipe**, and the
**reuse key** that decides when two users share one image.

This is a decision record only — no production code. It directs the
`cue_images` catalog (schema), the `IImageProvider` + `CueImageService` engine,
the `process-session` wiring, and the client render.

## Decision

### Provider — Google **Imagen 4 Fast** via the Gemini API, behind `IImageProvider`

The production pipeline already runs on Gemini (`GEMINI_API_KEY`,
`AI_PROVIDER=gemini`, see `supabase/SETUP.md`), calling a plain HTTPS REST
endpoint with raw `fetch` — exactly the constraint the `process-session` edge
function imposes (Deno, **zero remote imports**, ADR 0010). Choosing Imagen via
the same API means **no new vendor, no new secret, no new auth pattern**, and
the same edge-function-friendly transport. Imagen 4 Fast is the cheapest
first-party option at **$0.02/image** ($0.01 with the Batch API), carries full
commercial-use rights on generated images, and its Fast tier suits a
best-effort, cache-fronted stage where latency isn't on the critical path.

We still wrap it in an `IImageProvider` interface selected by env
(`IMAGE_PROVIDER`, default `gemini`), mirroring `IAIProvider` and the project's
swap-by-env philosophy (ADR 0008). The Gemini provider reuses `GEMINI_API_KEY`;
an alternate provider supplies its own key via `src/config/env.ts` (never
`process.env`, ADR 0007). This keeps a second provider a config change, not a
rewrite — important because OpenAI's `gpt-image-1` (our quality benchmark) is
**deprecating 2026-10-23** in favour of GPT Image 1.5.

### Visual style — flat, minimal instructional diagram; **no baked-in text**

One fixed house style, applied via a constant style suffix on every prompt plus
a fixed seed where the model supports it, so the catalog reads as one coherent
set: a clean, flat, single-subject instructional line diagram on a neutral
background — think a coaching whiteboard sketch, not a photoreal or illustrative
render. Deliberately **no text rendered inside the image**: model text rendering
is unreliable, and the cue is already shown as text beside the image (ticket
#6), so the image carries the *spatial/mechanical* idea only. This also keeps
the image language-agnostic, so the reuse key never has to encode locale.

### Prompt recipe — cue + sport context → templated image prompt

The image prompt is built from the cue, its `targetPosition`, and a sport-aware
style hint. The sport-specific portion (what a "position" looks like, framing
vocabulary) lives in `src/sports/{sportKey}/` as a new field on
`ISportContext` — no sport logic leaks into the provider or the service (ADR
0001, rule 3). The provider stays sport-agnostic and receives a finished prompt.

### Reuse key — canonicalized `{sport, targetPosition, cue}` hash (v1), concept-tag later (v2)

The key must make two users who received the *same mechanical guidance* resolve
to the same image, without keying on noisy raw text.

- **v1 (this project):** `sha256` over a canonicalized descriptor —
  `sportKey` + normalized `targetPosition` + normalized cue text, where
  normalize = lowercase, strip punctuation, collapse whitespace. Deterministic,
  needs no extra model call, and is trivially implementable as the pure,
  unit-tested function ticket #2 ships. Reuse is exact-after-normalization:
  identical cues share an image; near-paraphrases do not (acceptable — a cache
  miss just generates one more image, and the catalog still bounds total spend).
- **v2 (deferred, documented path):** replace the cue portion with an
  LLM-produced **concept tag** drawn from a small controlled vocabulary per
  sport, so paraphrases collapse to one image and hit-rate climbs. Deferred
  because it adds a model call and a per-sport vocabulary to maintain; v1's key
  shape is forward-compatible (swap the cue component for the tag component).

The key is content-addressed and **not** user-scoped — that's the whole point:
the `cue_images` catalog and its storage bucket are shared (all-authenticated
read, server-only write), unlike every existing user-owned table.

## Consequences

- Adds an image-generation cost per **cache miss** (~$0.02, or ~$0.01 batched),
  not per session — the shared catalog amortizes it across users. A miss never
  fails the session: the image stage is best-effort, same posture as audio
  upload (ticket #5).
- A new `ISportContext` field (image style hint) must be filled per sport; BJJ
  gets a real value, Golf inherits the stub-sport pattern.
- v1 keys on normalized wording, so semantically-equal paraphrases can generate
  duplicate images. Accepted for v1; v2 concept-tagging is the escape hatch if
  duplication proves wasteful in practice.
- Provider logic lives in two places once wired (the `src/` reference and the
  `_shared` edge mirror), same sync burden as the rest of the pipeline
  (ADR 0010); the reuse-key function is single-sourced to limit drift.

## Considered options

- **OpenAI `gpt-image-1` / GPT Image 1.5** — strongest prompt adherence and our
  quality benchmark, full commercial rights, but a *new* vendor + secret + auth
  surface for the edge function, higher cost at usable quality
  (~$0.07–0.19/image medium–high), and `gpt-image-1` is deprecating 2026-10-23.
  Kept as a swap-in via `IImageProvider`, not the default.
- **Stability / Replicate-hosted models (SDXL, Flux)** — cheap and flexible, but
  weaker instruction adherence for a diagrammatic style and more operational
  surface (Replicate's async prediction polling fits poorly in a short-lived
  best-effort edge stage). Rejected as the default.
- **Key on the raw cue text** — rejected: near-zero cross-user reuse because
  LLM-authored cues vary in wording; defeats the shared-catalog goal.
- **Key on a concept tag now (v2 immediately)** — rejected for v1: adds a model
  call and a per-sport controlled vocabulary before we have evidence the
  duplication from v1 is costly. Documented as the planned upgrade.
- **Bake the cue text into the image** — rejected: unreliable model text
  rendering, and it would make the reuse key locale-dependent for no benefit,
  since the cue already renders as real text beside the image.
