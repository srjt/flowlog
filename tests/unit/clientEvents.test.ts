/**
 * logger → client_events reporting. The logger lazy-requires the supabase
 * client and reads the compile-time __DEV__ flag at call time, so each test
 * loads a fresh logger module with controlled globals.
 */

jest.mock('@/config/featureFlags', () => ({
  isDemoMode: false,
  isLocalPipeline: false,
}));

const mockInsert = jest.fn().mockResolvedValue({ error: null });
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ insert: mockInsert })) },
}));

type LoggerModule = typeof import('@/utils/logger');

function freshLogger(): LoggerModule {
  let mod: LoggerModule;
  jest.isolateModules(() => {
    mod = require('@/utils/logger') as LoggerModule;
  });
  return mod!;
}

const g = globalThis as { __DEV__?: boolean };
const originalDev = g.__DEV__;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('logger → client_events reporting', () => {
  beforeEach(() => {
    mockInsert.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    g.__DEV__ = originalDev;
    jest.restoreAllMocks();
  });

  it('reports logger.error once, with the event capped and detail serialized', async () => {
    g.__DEV__ = false;
    const { logger } = freshLogger();
    logger.error('pipeline run failed', new Error('boom'));
    await flush();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockInsert.mock.calls[0][0];
    expect(row.level).toBe('error');
    expect(row.event).toBe('pipeline run failed');
    expect(row.detail).toContain('boom');
  });

  it('does not report in dev builds', async () => {
    g.__DEV__ = true;
    const { logger } = freshLogger();
    logger.error('dev-only failure', new Error('x'));
    await flush();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('swallows insert failures without throwing or recursing', async () => {
    g.__DEV__ = false;
    mockInsert.mockRejectedValueOnce(new Error('rls denied'));
    const { logger } = freshLogger();
    expect(() => logger.error('will fail to report', 'ctx')).not.toThrow();
    await flush();
    expect(mockInsert).toHaveBeenCalledTimes(1); // no retry loop
  });

  it('caps reports per launch', async () => {
    g.__DEV__ = false;
    const { logger } = freshLogger();
    for (let i = 0; i < 30; i++) {
      logger.error(`err ${i}`);
      // eslint-disable-next-line no-await-in-loop
      await flush(); // sequential: the recursion guard skips overlapping sends
    }
    expect(mockInsert.mock.calls.length).toBeLessThanOrEqual(20);
    expect(mockInsert.mock.calls.length).toBeGreaterThan(0);
  });

  it('reportToMonitoring reports exactly once (no double-send via logger.error)', async () => {
    g.__DEV__ = false;
    const { reportToMonitoring } = freshLogger();
    reportToMonitoring('quality_gate_exhausted', { attempts: 3 });
    await flush();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].event).toBe(
      'monitoring:quality_gate_exhausted',
    );
  });
});
