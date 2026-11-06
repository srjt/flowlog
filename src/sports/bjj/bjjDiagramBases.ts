/**
 * BJJ force-diagram BASE LIBRARY (#135). Deliberately EMPTY until phase c.
 *
 * A base is a certified two-person pose (keypoints + role map, see
 * `src/visualization/keypoints.ts`) that a cue's force diagram is drawn over.
 * Authoring correct poses is the unsolved part: occluded two-person positions
 * need the 3D position builder (#136). Until a base is certified it does not
 * belong here, because a wrong figure under a right arrow is exactly the
 * misleading picture the feature promises never to show.
 *
 * So while this is empty, every Session resolves to "no base" and the spec
 * stage makes no model call at all. It only records `no_base`, and those rows,
 * grouped by `target_position_id`, are the authoring backlog phase c works
 * from (most-hit positions first).
 *
 * Phase c, when a base is certified:
 *   - add it as a TS literal (not JSON, so Deno needs no import attributes),
 *     keyed by its canonical SIDED id (`de-la-riva-bottom`), with `id` equal
 *     to that key, since `you` must be the practitioner's side;
 *   - bump `BJJ_BASE_LIBRARY_VERSION`, which every outcome that consulted the
 *     library records;
 *   - never import the uncertified seeds in `tests/fixtures/forceDiagram/`.
 * `tests/unit/forceDiagramBaseLibrary.test.ts` checks every entry.
 *
 * Dependency-free on purpose: imported by BOTH the client sport context AND
 * the Supabase edge function (`supabase/functions/_shared/sports.ts`), like
 * `bjjPositions.ts`. Relative `.ts` type imports only.
 */

import type { DiagramLibrary } from '../../visualization/diagramStage.ts';
import type { DiagramBase } from '../../visualization/keypoints.ts';

/** Certified bases by canonical sided position id. None yet (phase c). */
export const BJJ_DIAGRAM_BASES: Readonly<Record<string, DiagramBase>> =
  Object.freeze({});

/**
 * Version of everything in `BJJ_DIAGRAM_LIBRARY`: which bases exist, how they
 * are posed, and the persona below. Bump it with every base added or re-posed
 * and with any persona change, so a diagram can always be traced to the poses
 * it was drawn over and the prompt it came from.
 */
export const BJJ_BASE_LIBRARY_VERSION = '0.0.0-empty';

/**
 * Who the spec model speaks as (`buildSpecPrompt`'s `expert`). It is part of
 * the prompt, and `SPEC_PROMPT_VERSION` versions only the sport-neutral
 * template, so a change here bumps `BJJ_BASE_LIBRARY_VERSION`.
 */
export const BJJ_SPEC_PERSONA = 'a Brazilian Jiu-Jitsu black belt and coach';

/** The library as the sport context exposes it, client and server alike. */
export const BJJ_DIAGRAM_LIBRARY: DiagramLibrary = {
  bases: BJJ_DIAGRAM_BASES,
  baseLibraryVersion: BJJ_BASE_LIBRARY_VERSION,
  specPersona: BJJ_SPEC_PERSONA,
};
