import { CANVAS_H, CANVAS_W } from '@/visualization/keypoints';
import { PRIMITIVE_NAMES, SPEC_VERSION } from '@/visualization/grammar';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  renderForceDiagram,
  type RenderOptions,
} from '@/visualization/renderer';
import { serializeSvg, type SvgElement } from '@/visualization/svg';
import {
  REFERENCE_CASES,
  SEED_IDS,
  referenceSpec,
  seedBase,
} from '../fixtures/forceDiagram/seeds';

const dlr = seedBase('de-la-riva');

function render(baseId: string, spec: unknown, opts?: RenderOptions) {
  const r = renderForceDiagram(seedBase(baseId), spec, opts);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r;
}

const golden = (baseId: string, cueId: string, opts?: RenderOptions) =>
  render(baseId, referenceSpec(baseId, cueId), opts);

/** The annotation groups, in drawing order. */
function marks(tree: SvgElement): SvgElement[] {
  const overlay = tree.children.find(
    (c): c is SvgElement =>
      typeof c !== 'string' && 'data-fd-overlay' in c.attrs,
  );
  return (overlay?.children ?? []) as SvgElement[];
}

const markTypes = (tree: SvgElement) =>
  marks(tree).map((g) => g.attrs['data-fd-type']);

/** Every number in an SVG fragment's geometry attributes. */
function coordinates(node: SvgElement): number[] {
  const out: number[] = [];
  for (const [k, v] of Object.entries(node.attrs))
    if (['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'points', 'd'].includes(k))
      out.push(...(v.match(/-?\d+(\.\d+)?/g) ?? []).map(Number));
  for (const c of node.children)
    if (typeof c !== 'string') out.push(...coordinates(c));
  return out;
}

describe('renderForceDiagram — determinism', () => {
  it.each(REFERENCE_CASES)(
    '$baseId / $cueId renders byte-identically every time',
    ({ baseId, cueId }) => {
      const a = golden(baseId, cueId).svg;
      const b = golden(baseId, cueId).svg;
      // Fresh copies of the same data, not the same objects.
      const c = renderForceDiagram(
        JSON.parse(JSON.stringify(seedBase(baseId))),
        JSON.parse(JSON.stringify(referenceSpec(baseId, cueId))),
      );
      expect(b).toBe(a);
      expect(c.ok && c.svg).toBe(a);
    },
  );

  it('is deterministic per skin and per palette too', () => {
    for (const opts of [
      { skin: 'fleshed' as const },
      { palette: DARK_PALETTE },
    ])
      expect(golden('de-la-riva', 'heel-hamstring', opts).svg).toBe(
        golden('de-la-riva', 'heel-hamstring', opts).svg,
      );
  });

  it('the string is exactly the serialized tree, and the tree survives JSON', () => {
    const r = golden('back-mount', 'seatbelt');
    expect(serializeSvg(r.tree)).toBe(r.svg);
    expect(serializeSvg(JSON.parse(JSON.stringify(r.tree)))).toBe(r.svg);
  });
});

describe('renderForceDiagram — every annotation appears in the static output', () => {
  it.each(REFERENCE_CASES)(
    '$baseId / $cueId: one non-empty mark per annotation, in spec order',
    ({ baseId, cueId }) => {
      const spec = referenceSpec(baseId, cueId);
      const r = golden(baseId, cueId);
      const groups = marks(r.tree);
      expect(groups.map((g) => g.attrs['data-fd-annotation'])).toEqual(
        spec.annotations.map((_, i) => String(i)),
      );
      expect(markTypes(r.tree)).toEqual(
        spec.annotations.map((a) => (a as { type: string }).type),
      );
      for (const g of groups) expect(g.children.length).toBeGreaterThan(0);
      // ...and each has its label.
      for (let i = 0; i < spec.annotations.length; i++)
        expect(r.svg).toContain(`data-fd-label="${i}"`);
    },
  );

  it.each([...PRIMITIVE_NAMES])('draws the %s primitive', (type) => {
    const annotation: Record<string, unknown> = {
      force: {
        type,
        anchor: 'hook_heel',
        relation: { toward: 'opp_hamstring' },
      },
      rotation: {
        type,
        anchor: 'your_shoulder',
        relation: { around: 'hook_heel' },
      },
      pressure: { type, anchor: 'heel_on_hamstring' },
      frame: {
        type,
        anchor: 'second_foot',
        relation: { away_from: 'opp_hip' },
      },
      base: { type, anchor: 'posting_forearm' },
      counter: {
        type,
        anchor: 'heel_on_hamstring',
        relation: { toward: 'your_hip' },
      },
      grip: { type, anchor: ['posting_hand', 'opp_lead_knee'] },
      'weight-distribution': { type, anchor: 'your_hip' },
      'movement-path': {
        type,
        anchor: 'second_foot',
        relation: { toward: 'opp_lead_knee' },
      },
    };
    const r = render('de-la-riva', {
      specVersion: SPEC_VERSION,
      base: 'de-la-riva',
      annotations: [annotation[type]],
    });
    expect(markTypes(r.tree)).toEqual([type]);
    expect(r.svg).toContain(LIGHT_PALETTE.marks[type]);
  });

  it('is static-complete: concrete colours, no stylesheet, no markers, no external references', () => {
    for (const { baseId, cueId } of REFERENCE_CASES) {
      const { svg } = golden(baseId, cueId);
      expect(svg).not.toMatch(/var\(|<style|class=|<marker|url\(/);
      // Every paint is a literal colour or "none".
      for (const [, paint] of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g))
        expect(paint).toMatch(/^(#[0-9a-f]{6}|none)$/);
    }
  });

  it('gives pressure a translucent static frame, not the solid disc the prototype showed without its keyframes', () => {
    const g = marks(golden('de-la-riva', 'heel-hamstring').tree)[1]!;
    expect(g.attrs['data-fd-type']).toBe('pressure');
    for (const c of g.children as SvgElement[])
      expect(Number(c.attrs.opacity)).toBeLessThan(1);
  });

  it('keeps rotation arcs on the canvas', () => {
    // The prototype swept the golden "drop your shoulder" arc to y = -126.
    for (const [baseId, cueId] of [
      ['de-la-riva', 'load-the-hook'],
      ['butterfly-guard', 'off-hip-turn'],
    ] as const) {
      const rot = marks(golden(baseId, cueId).tree).find(
        (g) => g.attrs['data-fd-type'] === 'rotation',
      )!;
      const arc = (rot.children as SvgElement[]).find((c) => c.tag === 'path')!;
      const m = arc.attrs.d!.match(
        /^M (\S+) (\S+) A \S+ \S+ 0 0 1 (\S+) (\S+)$/,
      )!;
      const heads = (rot.children as SvgElement[])
        .filter((c) => c.tag === 'polygon')
        .flatMap((p) =>
          p.attrs.points!.split(' ').map((xy) => xy.split(',').map(Number)),
        );
      const points = [
        [m[1], m[2]].map(Number),
        [m[3], m[4]].map(Number),
        ...heads,
      ];
      expect(heads).toHaveLength(8); // two arrowheads: no invented sense of rotation
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CANVAS_W);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(CANVAS_H);
      }
    }
  });

  it('labels a force that pushes away as pushing away', () => {
    const r = render('de-la-riva', {
      specVersion: 1,
      base: 'de-la-riva',
      annotations: [
        {
          type: 'force',
          anchor: 'second_foot',
          relation: { away_from: 'opp_hip' },
        },
      ],
    });
    expect(r.svg).toContain("push away from opponent's hip");
    expect(r.svg).not.toContain('drive into');
  });

  it('shows intensity in weight distribution', () => {
    const chevrons = (intensity: string) =>
      render('de-la-riva', {
        specVersion: 1,
        base: 'de-la-riva',
        annotations: [
          { type: 'weight-distribution', anchor: 'your_hip', intensity },
        ],
      }).svg.match(/<polyline/g)!.length;
    expect(new Set(['low', 'medium', 'high'].map(chevrons)).size).toBe(3);
  });
});

describe('renderForceDiagram — the cue changes the diagram', () => {
  it('different golden cues on the same base draw different mark sets', () => {
    const heel = markTypes(golden('de-la-riva', 'heel-hamstring').tree);
    const load = markTypes(golden('de-la-riva', 'load-the-hook').tree);
    expect(heel).toEqual(['force', 'pressure', 'counter', 'base']);
    expect(load).toEqual(['rotation', 'weight-distribution', 'base']);
  });

  it.each(SEED_IDS)(
    'every golden cue on %s yields a distinct diagram',
    (baseId) => {
      const svgs = REFERENCE_CASES.filter((c) => c.baseId === baseId).map(
        ({ cueId }) => golden(baseId, cueId).svg,
      );
      expect(svgs.length).toBeGreaterThan(1);
      expect(new Set(svgs).size).toBe(svgs.length);
    },
  );

  it('moving one anchor moves its mark and nothing else', () => {
    const at = (anchor: string) =>
      render('de-la-riva', {
        specVersion: 1,
        base: 'de-la-riva',
        annotations: [{ type: 'base', anchor }],
      });
    const a = at('posting_forearm');
    const b = at('posting_hand');
    expect(serializeSvg(marks(a.tree)[0]!)).not.toBe(
      serializeSvg(marks(b.tree)[0]!),
    );
    // The figures underneath are the same base, drawn the same way.
    const figures = (t: SvgElement) =>
      t.children
        .filter((c) => typeof c !== 'string' && 'data-fd-figure' in c.attrs)
        .map((c) => serializeSvg(c));
    expect(figures(a.tree)).toEqual(figures(b.tree));
  });
});

describe('renderForceDiagram — skins, palette, title, animation hooks', () => {
  it('both skins draw the same overlay over different figures', () => {
    const stick = golden('de-la-riva', 'heel-hamstring');
    const flesh = golden('de-la-riva', 'heel-hamstring', { skin: 'fleshed' });
    expect(flesh.svg).not.toBe(stick.svg);
    expect(marks(flesh.tree).map((g) => serializeSvg(g))).toEqual(
      marks(stick.tree).map((g) => serializeSvg(g)),
    );
    expect(flesh.svg).toContain('<ellipse'); // fleshed head
  });

  it('the palette changes colour, not geometry', () => {
    const light = golden('closed-guard', 'break-posture');
    const dark = golden('closed-guard', 'break-posture', {
      palette: DARK_PALETTE,
    });
    expect(dark.svg).toContain(DARK_PALETTE.surface);
    expect(dark.svg).not.toContain(LIGHT_PALETTE.surface);
    expect(coordinates(dark.tree)).toEqual(coordinates(light.tree));
  });

  it('takes the accessible name from the caller (the cue), escaped', () => {
    const r = golden('de-la-riva', 'heel-hamstring', {
      title: 'Dig the heel <in> & hold',
    });
    expect(r.svg).toContain(
      '<title>Dig the heel &lt;in&gt; &amp; hold</title>',
    );
    expect(golden('de-la-riva', 'heel-hamstring').svg).toContain(
      '<title>De La Riva guard force diagram</title>',
    );
  });

  it('carries animation as data the static frame ignores, pointed the way the force goes', () => {
    // break-posture pulls the opponent's shoulders DOWN toward your hips. The
    // prototype's keyframes shoved every force up-and-right regardless.
    const force = marks(golden('closed-guard', 'break-posture').tree)[1]!;
    expect(force.attrs['data-fd-anim']).toBe('drive');
    const [dx, dy] = force.attrs['data-fd-dir']!.split(',').map(Number);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeGreaterThan(0);
  });
});

describe('renderForceDiagram — no diagram, never a throw', () => {
  it.each([
    ['an empty spec', { specVersion: 1, base: 'de-la-riva', annotations: [] }],
    [
      'an invalid spec',
      {
        specVersion: 1,
        base: 'de-la-riva',
        annotations: [{ type: 'base', anchor: 'nowhere' }],
      },
    ],
    ['a spec for another base', referenceSpec('closed-guard', 'break-posture')],
    ['no spec at all', null],
  ])('%s', (_label, spec) => {
    expect(() => renderForceDiagram(dlr, spec)).not.toThrow();
    const r = renderForceDiagram(dlr, spec);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors).not.toHaveLength(0);
  });

  it('a broken base', () => {
    const broken = {
      ...dlr,
      people: { ...dlr.people, you: { ...dlr.people.you, head: 'nose' } },
    };
    const r = renderForceDiagram(
      broken,
      referenceSpec('de-la-riva', 'heel-hamstring'),
    );
    expect(r.ok).toBe(false);
  });
});
