# Cue force diagrams (`src/visualization/`)

Sport-agnostic machinery for the cue force-diagram (#135, map #10): a coaching
cue becomes a small structured **spec**, which a **deterministic renderer** draws
as an annotation overlay on a **keypoint base**. Ported by hand from the #18
prototype (`scripts/issue18/` on `feat/cue-image-generation`). That branch is
never merged: it also carries the retired generative-image path.

**Phase a: pure, unit-tested modules only. Nothing here ships in the UI yet,
and it adds no dependency. Phase b (done): the best-effort pipeline stage that
uses them, inert until phase c supplies certified bases.**

| Module            | What it owns                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `grammar.ts`      | The 9 closed primitives, the annotation envelope, `GRAMMAR_VERSION`, `SPEC_VERSION`, `MAX_ANNOTATIONS`        |
| `keypoints.ts`    | The base model (joints + bones + role map), `parseBase` (structural gate), `resolveRole`                       |
| `validateSpec.ts` | The never-misleading floor: `validateSpec(unknown, base)` returns a `ValidatedSpec` or errors, and never throws |
| `svg.ts`          | A plain JSON SVG element tree and its deterministic string serializer                                          |
| `renderer.ts`     | `renderForceDiagram(base, spec)` returns tree + SVG string, or `ok: false` (show the cue as text)              |
| `specStage.ts`    | Spec-stage helpers: `buildSpecSchema`, `buildSpecPrompt`, `parseSpecResponse`, `SPEC_PROMPT_VERSION`           |
| `diagramStage.ts` | The stage itself (phase b): `runDiagramStage` decides whether to call, calls under `SPEC_STAGE_TIMEOUT_MS`, and returns the `DiagramRecord` a Session stores (`DIAGRAM_OUTCOMES`, `NOT_ATTEMPTED`) |

## Rules these files keep

- **Dependency-free, edge-importable.** Relative `./x.ts` imports only. No `@/`,
  node, React, React Native or packages, and plain erasable TypeScript (no
  enums or namespaces). This matches `src/sports/grounding.ts`, so the Deno edge
  function can import them directly
  (`../../../src/visualization/specStage.ts`). A test enforces it.
- **Never throws to a caller.** An empty, malformed or invalid spec, or a broken
  base, means "no diagram". The cue is then shown as text alone.
- **Sport-agnostic.** The base supplies the roles, and the caller supplies the
  sport's expert persona to `buildSpecPrompt`. Sport content belongs in
  `src/sports/{sport}/` (rule 3).

## Output format

The renderer returns both a plain element tree and its serialized SVG string.
The string is the canonical static artifact: tests compare it byte-for-byte,
and the re-render A/B (#15) diffs it. The tree is what a React component maps
onto `react-native-svg` elements without parsing XML on device. The static frame
is complete on its own: concrete palette colours, no `<style>`, no `<marker>`,
no `var()`. Animation is additive data only (`data-fd-anim` / `data-fd-dir`),
which a component may layer on and which reduced motion ignores.

## Phase b: the pipeline stage (done)

A best-effort cue→spec stage after the quality gate, in `FlowlogPipeline`
(through `DiagramSpecService`) and the `process-session` edge function
(`cueDiagram`). Both call `runDiagramStage`, so the decisions are
single-sourced; only the model call differs (`IAIProvider.generateDiagramSpec`
on the client, `generateDiagramSpec` in `supabase/functions/_shared/ai.ts`).

- It calls the model only when the gate passed with a real Cue and the sport's
  library (`sportContext.diagram`, `src/sports/bjj/bjjDiagramBases.ts` for BJJ)
  has a base for the Session's `target_position_id`. That library is empty, so
  today every Session records `no_base` and nothing is called.
- Migration 026 stores the spec, `diagram_outcome`, and `grammar_version`,
  `base_library_version` and `spec_prompt_version` on `sessions`, on all four
  Session writes. NULL means not recorded.
- The schema from `buildSpecSchema` is built but not sent natively: the
  providers use JSON mode, and `parseSpecResponse` is the floor.
- The BJJ persona for `buildSpecPrompt` lives with the library, and a change
  to it bumps the library version.

## Not here yet

- **`CueDiagram` component.** This is deferred until a planned native build adds
  `react-native-svg`. A new native module cannot ship over the air, and adding
  it now would strand every open JS-only change.
- **Phase c: the base library.** This is blocked on posing (the 3D position
  builder, #136). Certified bases will be authored as TS modules (not JSON, so
  Deno needs no import attributes) into `src/sports/bjj/bjjDiagramBases.ts`,
  whose test already checks that each passes `parseBase`. They key on canonical
  **sided** position ids (`de-la-riva-bottom`), with `id` equal to the key,
  because `you` must be the practitioner's side. The four #18 seeds are
  **uncertified** and live only in `tests/fixtures/forceDiagram/`. Nothing that
  ships may import them, and a test checks that too.

## Known grammar gap

v1 `rotation` names what turns and its pivot, but not which way it turns. The
renderer therefore draws a double-headed arc rather than invent a direction.
Expressing the direction needs a grammar bump (and `GRAMMAR_VERSION` with it).
