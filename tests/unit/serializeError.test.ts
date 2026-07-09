import { serializeThrown } from '@/utils/errorReporter';

describe('serializeThrown', () => {
  it('serializes a plain Error with name, message, and stack', () => {
    const err = new Error('boom');
    const out = serializeThrown(err);
    expect(out).toContain('Error: boom');
    expect(out).toContain('stack:');
  });

  it('serializes an Error subclass with its custom name and extra props', () => {
    class EnvError extends Error {
      code = 'ENV_MISSING';
      constructor(message: string) {
        super(message);
        this.name = 'EnvError';
      }
    }
    const out = serializeThrown(new EnvError('missing SUPABASE_URL'));
    expect(out).toContain('EnvError: missing SUPABASE_URL');
    expect(out).toContain('ENV_MISSING');
  });

  it('makes a thrown plain object readable (the "[object Object]" case)', () => {
    const out = serializeThrown({ status: 500, reason: 'ui runtime failed' });
    expect(out).toContain('non-Error object');
    expect(out).toContain('"status":500');
    expect(out).toContain('ui runtime failed');
    expect(out).not.toBe('[object Object]');
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { label: 'outer' };
    a.self = a;
    const out = serializeThrown(a);
    expect(out).toContain('outer');
    expect(out).toContain('[Circular]');
  });

  it('handles properties whose getters throw', () => {
    const obj = {};
    Object.defineProperty(obj, 'bad', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });
    const out = serializeThrown(obj);
    expect(out).toContain('[threw on read]');
  });

  it('serializes primitives with their type', () => {
    expect(serializeThrown('plain string')).toBe('string: plain string');
    expect(serializeThrown(42)).toBe('number: 42');
    expect(serializeThrown(undefined)).toBe('undefined: undefined');
    expect(serializeThrown(null)).toBe('object: null');
  });

  it('serializes functions and bigints inside objects', () => {
    const out = serializeThrown({ fn: function named() {}, big: 10n });
    expect(out).toContain('[Function: named]');
    expect(out).toContain('10n');
  });
});
