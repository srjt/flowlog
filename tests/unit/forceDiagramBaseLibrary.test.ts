/**
 * The BJJ force-diagram base library (#135), and what registering it means.
 *
 * EMPTY in phase b, so most of this passes vacuously today. It is written for
 * phase c: the moment a certified base is added, every check below applies to
 * it, and the production-default assertions say what to revisit.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getSportContext } from '@/sports';
import {
  BJJ_BASE_LIBRARY_VERSION,
  BJJ_DIAGRAM_BASES,
  BJJ_DIAGRAM_LIBRARY,
  BJJ_SPEC_PERSONA,
} from '@/sports/bjj/bjjDiagramBases';
import { positionById } from '@/sports/bjj/bjjPositions';
import { parseBase } from '@/visualization/keypoints';

const ENTRIES = Object.entries(BJJ_DIAGRAM_BASES);
const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('every registered base', () => {
  // `it.each` refuses an empty table, and the library is empty until phase c.
  it('passes the structural gate', () => {
    for (const [key, base] of ENTRIES) {
      const parsed = parseBase(base);
      expect({ key, errors: parsed.ok ? [] : parsed.errors }).toEqual({
        key,
        errors: [],
      });
    }
  });

  // A canonical id is SIDED wherever the position has sides, so this also
  // rejects a bare "de-la-riva": `you` must be the practitioner's side, and
  // the guard player and the passer get opposite diagrams.
  it('is keyed by a canonical position id, and carries that id', () => {
    // The spec names its base by id, and a re-render looks the base up by it.
    for (const [key, base] of ENTRIES) {
      expect(positionById(key)?.id).toBe(key);
      expect(base.id).toBe(key);
    }
  });

  it('would reject an unsided key', () => {
    // The check above, shown to bite on the mistake it exists for.
    expect(positionById('de-la-riva')).toBeNull();
    expect(positionById('de-la-riva-bottom')?.perspective).toBe('bottom');
  });
});

describe('the library itself', () => {
  it('is what both sport registries expose', () => {
    expect(getSportContext('bjj').diagram).toBe(BJJ_DIAGRAM_LIBRARY);
    expect(BJJ_DIAGRAM_LIBRARY).toEqual({
      bases: BJJ_DIAGRAM_BASES,
      baseLibraryVersion: BJJ_BASE_LIBRARY_VERSION,
      specPersona: BJJ_SPEC_PERSONA,
    });
    // The edge function registers the same object, not a copy.
    const server = read('supabase/functions/_shared/sports.ts');
    expect(server).toMatch(
      /import \{ BJJ_DIAGRAM_LIBRARY \} from '\.\.\/\.\.\/\.\.\/src\/sports\/bjj\/bjjDiagramBases\.ts';/,
    );
    expect(server).toMatch(/diagram: BJJ_DIAGRAM_LIBRARY,/);
  });

  it('has a persona for the spec prompt', () => {
    expect(BJJ_SPEC_PERSONA.trim().length).toBeGreaterThan(0);
  });

  it('carries a version, and an empty library says so', () => {
    expect(BJJ_BASE_LIBRARY_VERSION).toMatch(/^\d+\.\d+\.\d+(-[a-z]+)?$/);
    // Adding the first base without bumping the version would file real
    // diagrams under the empty library's name.
    expect(BJJ_BASE_LIBRARY_VERSION.endsWith('-empty')).toBe(
      ENTRIES.length === 0,
    );
  });

  // Phase b's whole cost claim: no base, so no Session ever reaches the model.
  // Phase c changes this on purpose, and should restate what replaces it.
  it('is empty until certified bases exist (phase c, #136)', () => {
    expect(ENTRIES).toEqual([]);
  });
});

describe('the library file stays edge-importable', () => {
  const source = read('src/sports/bjj/bjjDiagramBases.ts');
  const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map(
    (m) => m[1],
  );

  it('imports only relative .ts modules, and only types', () => {
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s).toMatch(/^\.\.\/[./A-Za-z]+\.ts$/);
    const imports = source.match(/^import .*$/gm) ?? [];
    for (const line of imports) expect(line).toMatch(/^import type /);
    expect(source).not.toMatch(/\brequire\(|process\.env|import\(/);
  });
});

describe('nothing that ships imports the uncertified seeds', () => {
  // The four #18 seeds are below the never-misleading floor (README).
  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : /\.(ts|tsx|js)$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );
  const shipped = ['src', 'app', 'supabase'].flatMap(walk);

  it('finds the shipped sources', () => {
    expect(shipped).toContain(
      join('src', 'sports', 'bjj', 'bjjDiagramBases.ts'),
    );
  });

  it('none of them imports from tests/fixtures', () => {
    const offenders = shipped.filter((file) =>
      [
        ...read(file).matchAll(/(?:\bfrom|\bimport|\brequire\()\s*'([^']+)'/g),
      ].some((m) => /fixtures/.test(m[1] ?? '')),
    );
    expect(offenders).toEqual([]);
  });
});
