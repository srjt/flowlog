import {
  BJJ_POSITIONS,
  normalizePosition,
  positionById,
} from '@/sports/bjj/bjjPositions';

describe('BJJ position taxonomy', () => {
  it('gives every sided position two distinct ids', () => {
    const mountTop = positionById('mount-top');
    const mountBottom = positionById('mount-bottom');
    expect(mountTop).not.toBeNull();
    expect(mountBottom).not.toBeNull();
    expect(mountTop!.base).toBe(mountBottom!.base);
    expect(mountTop!.id).not.toBe(mountBottom!.id);
  });

  it('reuses the cue-image effort’s seeded base ids', () => {
    // Both efforts must share one vocabulary rather than maintaining two.
    for (const base of [
      'back-mount',
      'closed-guard',
      'de-la-riva',
      'butterfly-guard',
    ]) {
      expect(BJJ_POSITIONS.some((p) => p.base === base)).toBe(true);
    }
  });

  it('has unique ids throughout', () => {
    const ids = BJJ_POSITIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not split positions that have no meaningful sides', () => {
    expect(positionById('standing')?.perspective).toBe('neutral');
    expect(positionById('standing-top')).toBeNull();
  });
});

describe('normalizePosition — recognising the position', () => {
  it('matches the canonical name', () => {
    expect(normalizePosition('Side Control', 'he was on top of me').id).toBe(
      'side-control-bottom',
    );
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizePosition('  DE LA RIVA GUARD  ', 'i was passing').id).toBe(
      'de-la-riva-top',
    );
  });

  it('prefers the longest matching alias', () => {
    // "deep half guard" must not be swallowed by "half guard".
    expect(normalizePosition('Deep Half Guard (bottom)').base).toBe(
      'deep-half-guard',
    );
    // ...nor "knee shield half guard" by "half guard".
    expect(normalizePosition('Knee Shield Half Guard (bottom)').base).toBe(
      'knee-shield-half-guard',
    );
  });

  it('reads the parenthetical form the extractor already emits', () => {
    // A real baseline session produced exactly this, unprompted.
    expect(normalizePosition('Side Control (bottom)').id).toBe(
      'side-control-bottom',
    );
    expect(normalizePosition('Half Guard (Bottom)').id).toBe(
      'half-guard-bottom',
    );
  });
});

describe('normalizePosition — reading which side you were on', () => {
  it('reads bottom from natural phrasing', () => {
    expect(
      normalizePosition('Mount', 'he mounted me and I could not bridge').id,
    ).toBe('mount-bottom');
    expect(
      normalizePosition('Side Control', 'I was stuck under side control').id,
    ).toBe('side-control-bottom');
    expect(
      normalizePosition('Back Control', 'they took my back from turtle').id,
    ).toBe('back-mount-bottom');
  });

  it('reads top from natural phrasing', () => {
    expect(normalizePosition('Mount', 'I mounted him and held it').id).toBe(
      'mount-top',
    );
    expect(
      normalizePosition('Half Guard', 'I was passing his half guard').id,
    ).toBe('half-guard-top');
    expect(
      normalizePosition('Closed Guard', 'I took the back from there').id,
    ).toBe('closed-guard-top');
  });

  it('prefers a side stated in the position phrase over the context', () => {
    // The explicit label wins; context is only a fallback.
    expect(
      normalizePosition('Side Control (top)', 'I was underneath the whole time')
        .id,
    ).toBe('side-control-top');
  });

  it('prefers the longest cue so a specific phrase beats a generic one', () => {
    // "took my back" (bottom) contains "back"; it must not be read as top
    // just because "i took the back" is also a cue.
    expect(
      normalizePosition('Back Control', 'he took my back').perspective,
    ).toBe('bottom');
  });
});

describe('normalizePosition — forms seen in real sessions', () => {
  it('resolves a technique phrase down to the position it happens in', () => {
    // "Half Guard Passing" names the passer's side outright.
    expect(normalizePosition('Half Guard Passing').id).toBe('half-guard-top');
  });

  it('reads defending a position as being the one in it', () => {
    expect(normalizePosition('Loop Choke Defense from Knee on Belly').id).toBe(
      'knee-on-belly-bottom',
    );
  });

  it('covers guards that turned up in the baseline', () => {
    expect(normalizePosition('Matrix', 'I was playing guard').base).toBe(
      'matrix-guard',
    );
    expect(normalizePosition('Tarantula Guard', 'my guard').base).toBe(
      'tarantula-guard',
    );
  });
});

describe('normalizePosition — refusing to guess', () => {
  it('returns no id when the side is never stated', () => {
    const out = normalizePosition('Closed Guard');
    expect(out.id).toBeNull();
    expect(out.perspective).toBe('unknown');
    // The base is still reported — for diagnostics, not for guessing.
    expect(out.base).toBe('closed-guard');
  });

  it('returns nothing at all for an unrecognised position', () => {
    expect(
      normalizePosition('Flying Space Guard', 'I was on top').id,
    ).toBeNull();
    expect(normalizePosition('Flying Space Guard').base).toBeNull();
  });

  it('rejects submissions and concepts, which really do arrive here', () => {
    // Every one of these is a real `target_position` from the frozen baseline.
    for (const notAPosition of [
      'Armbar Setup',
      'Triangle Choke',
      'Kimura submission',
      'Base Fundamentals',
      'Belly Down Armbar',
      'Arm-in Guillotine',
    ]) {
      const out = normalizePosition(notAPosition, 'I was on top of him');
      expect(out.id).toBeNull();
      expect(out.base).toBeNull();
    }
  });

  it('handles empty and missing input', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(normalizePosition(empty).id).toBeNull();
    }
  });
});
