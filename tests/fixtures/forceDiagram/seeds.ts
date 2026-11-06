/**
 * Test fixtures for the force-diagram modules (#135 phase a): the #18
 * prototype's four seed bases and its hand-authored golden specs, copied
 * byte-for-byte from `scripts/issue18/seed/`.
 *
 * UNCERTIFIED — TEST DATA ONLY. These poses are below the never-misleading
 * floor (no panel certification; the authoring needs the 3D posing tool, see
 * #136), so they must never be imported by anything that ships. Certified
 * bases are authored into `src/sports/{sport}/` in phase c.
 */

import backMount from './back-mount.json';
import butterflyGuard from './butterfly-guard.json';
import closedGuard from './closed-guard.json';
import deLaRiva from './de-la-riva.json';
import referenceSpecs from './reference-specs.json';
import { parseBase, type DiagramBase } from '@/visualization/keypoints';

export const SEED_JSON: Record<string, unknown> = {
  'back-mount': backMount,
  'butterfly-guard': butterflyGuard,
  'closed-guard': closedGuard,
  'de-la-riva': deLaRiva,
};

export const SEED_IDS = Object.keys(SEED_JSON);

/** A seed parsed through the production gate. Throws only if a fixture rots. */
export function seedBase(id: string): DiagramBase {
  const parsed = parseBase(SEED_JSON[id]);
  if (!parsed.ok)
    throw new Error(`fixture ${id} is invalid: ${parsed.errors.join('; ')}`);
  return parsed.base;
}

/** A seed's own cues (fixture-only; real cues come from the pipeline). */
export function seedCues(id: string): { id: string; text: string }[] {
  return (SEED_JSON[id] as { cues: { id: string; text: string }[] }).cues;
}

const GOLDEN = referenceSpecs as unknown as Record<
  string,
  Record<string, unknown[]>
>;

/** The golden spec for (base, cue), in the full spec envelope. */
export function referenceSpec(baseId: string, cueId: string) {
  const annotations = GOLDEN[baseId]?.[cueId];
  if (!annotations) throw new Error(`no golden spec for ${baseId}/${cueId}`);
  return { specVersion: 1, base: baseId, annotations };
}

/** Every golden (base, cue) pair. */
export const REFERENCE_CASES: { baseId: string; cueId: string }[] =
  Object.entries(GOLDEN)
    .filter(([key]) => key !== 'note')
    .flatMap(([baseId, cues]) =>
      Object.keys(cues).map((cueId) => ({ baseId, cueId })),
    );
