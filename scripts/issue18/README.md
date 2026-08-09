# #18 harness — cue → spec → render

Standalone prototype that proves the **annotation-over-generation** loop for
Flowlog's force diagrams: a coaching cue becomes a small **structured spec**,
which a **deterministic renderer** draws as an overlay on a hand-authored
keypoint skeleton. This is the annotation analog of the (retired) generation
spike (`scripts/spikeRefConditioning.ts`), for the black-belt panel to rate.

Wayfinder ticket [#18](https://github.com/srjt/flowlog/issues/18); implements the
#17 domain-model framework; part of map [#10](https://github.com/srjt/flowlog/issues/10).
**Throwaway harness** — not wired into the app or the edge function.

## Run

```bash
# Offline: render the hand-authored golden specs (no API key). Exercises
# validation + renderer deterministically. Good for iterating on the renderer.
node scripts/issue18Harness.ts --offline

# Real loop: the actual post-quality-gate LLM spec stage. Needs a Gemini key
# EXPORTED IN THE SHELL (secrets are NOT in .env — the real pipeline runs
# Gemini server-side; see CLAUDE.md "Pipeline Runtime").
GEMINI_API_KEY=... node scripts/issue18Harness.ts

# Options
node scripts/issue18Harness.ts --offline --position de-la-riva
GEMINI_API_KEY=... node scripts/issue18Harness.ts --model gemini-2.5-flash --out spike/run.html
```

Output: an HTML gallery at `spike/issue18-force-diagrams.html` — one card per
(position × cue) with the rendered diagram, the spec JSON, and validation status.
Open it and rate each against the bar: **(b) never-misleading floor**,
**(a) expert-correct head**. Runs on **Node 24** (type-stripping); auto-loads
`.env`.

## The three thin pieces

1. **Seed authoring** — `seed/*.json`. Each position = a geometric **skeleton**
   (both people's joints + bones, normalized `[0,1]` on an 820×520 landscape) and
   a **semantic role map** aliasing role names → a joint, a derived point
   (`midpoint` / `lerp`), or an explicit **contact point**. `de-la-riva.json` is
   ported from `spike/dlr-force-diagram-mockup.html` (the golden). Eventually
   these move to `src/sports/bjj/`, single-sourced to the edge; a visual
   authoring tool is deferred (#10).
2. **Spec stage** — `specStage.ts`. The real LLM call: `(cue + role list +
   grammar)` → a validated `Spec` via a Gemini **text** model with structured
   output (`responseSchema`), mirroring `src/providers/ai/GeminiProvider.ts`.
   `grammar.ts` then validates against the position's roles (rejects unknown
   roles, wrong arity, missing/illegal relations). `--offline` swaps in the
   hand-authored golden specs from `seed/reference-specs.json`.
3. **Renderer** — `renderer.ts`. Resolves each annotation's semantic roles to
   coordinates and runs a fixed per-primitive draw routine. Grey = base skin;
   colour = overlay. **Static-complete, animation-additive**
   (`prefers-reduced-motion` → static). Target: the DLR mockup, reproduced
   deterministically from the spec.

## Authoring a new base (`spike/issue18-authoring-tool.html`)

A standalone, self-contained click-to-place tool for producing seed JSON — the
deferred "visual authoring tool" from #17 / map decision #4. Open it in a browser
(`open spike/issue18-authoring-tool.html`; for clipboard-copy use a localhost
server, e.g. `python3 -m http.server` in `spike/`):

1. Drop a reference diagram/photo in as a **tracing backdrop** (never exported).
2. Pick the active person (you / opp), type a joint name, **Place ▶**, click on
   the figure. Drag placed joints to adjust. Mark one joint as the head.
3. Wire **bones** (joint→joint), **feet** (a joint → its toe point, for foot
   direction), and **roles** (semantic map: joint / midpoint / clicked point).
4. Set the position `id`, `label`, and **`view`** (e.g. `side`, `top`) — the
   view field makes today's single-angle bases forward-compatible with multiple
   angles per position (a base is really `(position, view)`).
5. **Generate JSON** → drop the file into `seed/` and run the harness.

Click-to-place is WYSIWYG and undistorted (a uniform screen→canvas mapping), so
what you trace is what renders. Toe direction is **authored here**, not inferred
by a model — pose estimation is unreliable on occluded grappling tangles, so the
panel-placed points are the ground truth.

## The grammar (`grammar.ts`)

Nine primitives, one uniform envelope
`{ type, anchor: role(s), relation?: {toward|away_from|around: role}, intensity? }`.
**Direction is always role-relative** — never raw angles; the renderer owns
geometry. Spec is minimal (`{ specVersion, base, annotations[] }`, soft cap 4);
**provenance** (`grammarVersion` / `baseLibraryVersion` / `specPromptVersion`) is
recorded alongside on the harness run, never inside the spec (keeps it
re-renderable). Below the floor (invalid spec / no authored base) → **text-only
cue**, never a generated image.

## Layout

```
scripts/issue18Harness.ts   orchestrator (this is the entry point)
scripts/issue18/
  grammar.ts                primitives, envelope, versions, validateSpec
  keypoints.ts              skeleton + role map types, resolveRole
  specStage.ts              Gemini text call + prompt + offline fallback
  renderer.ts               deterministic SVG + page shell
  seed/*.json               4 positions + reference-specs.json (golden)
```

## What this proves / next

The loop holds end to end; the cue **changes** the diagram (the failure mode of
the generation approach — see the differing primitive sets cue-to-cue in the
gallery). After the panel rates the output, resolve **#18** on map #10, which
unblocks **#15** (correctness ratings + deterministic re-render A/B).
Productionization (supersede ADR 0012, retire generative code, authoring tool,
base library, provenance columns, client render) is deferred to a later
`/to-tickets` pass — see map #10.
