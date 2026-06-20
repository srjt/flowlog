/**
 * env.ts validates at import time. We use isolateModules + a saved/restored
 * process.env so each case re-evaluates the module against a fresh env.
 */
describe('config/env', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.resetModules();
  });

  it('builds a valid typed env from well-formed variables', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { env } = require('@/config/env');
      expect(env.APP_NAME).toBe('Flowlog');
      expect(env.TRANSCRIPTION_PROVIDER).toBe('whisper');
      expect(env.AI_PROVIDER).toBe('claude');
      expect(env.COACHING_CUE_MAX_WORDS).toBe(25);
      expect(env.QUALITY_GATE_RETRY_LIMIT).toBe(2);
      expect(env.FEATURE_GOLF_SPORT).toBe(false);
    });
  });

  it('throws a descriptive error when a required var is missing', () => {
    // Set to '' rather than delete: jest-expo's @expo/env loader repopulates
    // deleted keys from .env.local, but does not overwrite an already-set
    // (empty) value. env.ts treats '' as missing.
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@/config/env');
      });
    }).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('rejects an out-of-range enum value', () => {
    process.env.AI_PROVIDER = 'not-a-provider';
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@/config/env');
      });
    }).toThrow(/AI_PROVIDER/);
  });

  it('rejects a non-integer numeric var', () => {
    process.env.QUALITY_GATE_RETRY_LIMIT = 'abc';
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@/config/env');
      });
    }).toThrow(/QUALITY_GATE_RETRY_LIMIT/);
  });

  it('enforces MIN < MAX recording seconds', () => {
    process.env.MIN_RECORDING_SECONDS = '90';
    process.env.MAX_RECORDING_SECONDS = '20';
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@/config/env');
      });
    }).toThrow(/MIN_RECORDING_SECONDS/);
  });
});
