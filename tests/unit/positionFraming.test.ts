import { BJJ_POSITIONS } from '@/sports/bjj/bjjPositions';
import {
  frameApplicability,
  framePosition,
  FRAMED_BASES,
} from '@/utils/positionFraming';

describe('framePosition', () => {
  it('says plainly that someone has your back', () => {
    // The card that prompted this: a reviewer had to decode `back-mount-bottom`
    // before they could judge anything.
    const f = framePosition('back-mount-bottom');
    // The taxonomy's own label — 'Back control', not the slug's 'back-mount'.
    expect(f.title).toBe('Back control');
    expect(f.side).toBe('You are underneath');
    expect(f.situation).toMatch(/they have your back/i);
    expect(f.situation).toMatch(/escaping/i);
  });

  it('does NOT call a guard player "pinned" — bottom means the opposite there', () => {
    // The trap this module exists for: same suffix, opposite situations.
    const guard = framePosition('closed-guard-bottom');
    expect(guard.side).toBe('You are playing guard');
    expect(guard.situation).not.toMatch(/pinned/i);

    const pin = framePosition('side-control-bottom');
    expect(pin.side).toBe('You are underneath');
    expect(pin.situation).toMatch(/pinned/i);
  });

  it('frames the passer side of a guard as passing, not as being on top', () => {
    expect(framePosition('closed-guard-top').side).toBe('You are passing');
    expect(framePosition('closed-guard-top').situation).toMatch(
      /playing guard/i,
    );
  });

  it('strips the perspective parenthetical from the title', () => {
    expect(framePosition('half-guard-top').title).toBe('Half guard');
  });

  it('handles a neutral position without inventing a side', () => {
    const f = framePosition('standing');
    expect(f.side).toBe('');
  });

  it('falls back to the raw id rather than describing the wrong side', () => {
    // A reviewer seeing an unfamiliar slug is a far smaller problem than one
    // confidently told they are on top when they are underneath.
    const f = framePosition('not-a-real-position');
    expect(f.title).toBe('not-a-real-position');
    expect(f.situation).toBe('');
  });

  it('covers every base in the taxonomy, so a new one cannot arrive unlabelled', () => {
    const bases = [...new Set(BJJ_POSITIONS.map((p) => p.base))];
    const missing = bases.filter((b) => !FRAMED_BASES.includes(b));
    expect(missing).toEqual([]);
  });

  it('gives every real position a non-empty situation', () => {
    const unframed = BJJ_POSITIONS.filter(
      (p) => framePosition(p.id).situation.trim() === '',
    );
    expect(unframed.map((p) => p.id)).toEqual([]);
  });
});

describe('frameApplicability', () => {
  it('translates the gi enum into words a reviewer reads', () => {
    // "Applies when: either" is a database value leaking into a human's face.
    expect(
      frameApplicability({ gi: 'either', level: 'any', opponent: null }),
    ).toEqual(['Gi and no-gi']);
    expect(
      frameApplicability({ gi: 'gi', level: 'any', opponent: null }),
    ).toEqual(['Gi only']);
    expect(
      frameApplicability({ gi: 'no-gi', level: 'any', opponent: null }),
    ).toEqual(['No-gi only']);
  });

  it('mentions level only when it narrows anything', () => {
    expect(
      frameApplicability({ gi: 'either', level: 'beginner', opponent: null }),
    ).toEqual(['Gi and no-gi', 'beginner level']);
  });
});
