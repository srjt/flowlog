import {
  buildCueDescriptor,
  canonicalizeCueText,
  deriveCueImageKey,
  sha256Hex,
} from '@/utils/cueImageKey';

describe('sha256Hex', () => {
  // FIPS 180-4 known-answer vectors — guard the hand-rolled implementation.
  it('matches known SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes UTF-8 multibyte input', () => {
    // "é" is two UTF-8 bytes (0xC3 0xA9); a byte-correct impl produces this.
    expect(sha256Hex('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    );
  });

  it('is 64 lowercase hex chars', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonicalizeCueText', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(canonicalizeCueText('  Frame,  THEN   shrimp!! ')).toBe(
      'frame then shrimp',
    );
  });

  it('returns empty string for punctuation-only or empty input', () => {
    expect(canonicalizeCueText('')).toBe('');
    expect(canonicalizeCueText('...!!!')).toBe('');
  });
});

describe('deriveCueImageKey', () => {
  const base = {
    sportKey: 'bjj',
    targetPosition: 'closed guard',
    cue: 'Frame early and shrimp to recover guard.',
  };

  it('is deterministic for the same input', () => {
    expect(deriveCueImageKey(base)).toBe(deriveCueImageKey({ ...base }));
  });

  it('produces a 64-char hex reuse key', () => {
    expect(deriveCueImageKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('collapses paraphrase-adjacent cues (case/punct/spacing) to one key', () => {
    const noisy = {
      ...base,
      cue: '  frame EARLY, and shrimp — to recover guard!! ',
    };
    expect(deriveCueImageKey(noisy)).toBe(deriveCueImageKey(base));
  });

  it('normalizes sport key and target position too', () => {
    const variant = {
      ...base,
      sportKey: 'BJJ',
      targetPosition: 'Closed  Guard!',
    };
    expect(deriveCueImageKey(variant)).toBe(deriveCueImageKey(base));
  });

  it('separates different sports, positions, and cues', () => {
    const key = deriveCueImageKey(base);
    expect(deriveCueImageKey({ ...base, sportKey: 'golf' })).not.toBe(key);
    expect(deriveCueImageKey({ ...base, targetPosition: 'mount' })).not.toBe(
      key,
    );
    expect(
      deriveCueImageKey({ ...base, cue: 'Post on the far hand.' }),
    ).not.toBe(key);
  });

  it('treats null/undefined target position as an empty component', () => {
    const nullPos = deriveCueImageKey({ ...base, targetPosition: null });
    const emptyPos = deriveCueImageKey({ ...base, targetPosition: '' });
    expect(nullPos).toBe(emptyPos);
  });

  it('descriptor is version-namespaced so a shape change busts the catalog', () => {
    expect(buildCueDescriptor(base)).toMatch(/^v1\|bjj\|closed guard\|/);
  });
});
