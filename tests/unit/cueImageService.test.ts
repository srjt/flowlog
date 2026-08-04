import type { IImageProvider } from '@/providers/image';
import type {
  CueImageRecord,
  ICueImageStore,
} from '@/providers/storage/ICueImageStore';
import { cueImageStoragePath } from '@/providers/storage/ICueImageStore';
import { CueImageService } from '@/services/CueImageService';
import { bjjContext } from '@/sports/bjj/bjjContext';
import { deriveCueImageKey } from '@/utils/cueImageKey';

const INPUT = {
  cue: 'Frame early and shrimp to recover guard.',
  targetPosition: 'closed guard',
  sportContext: bjjContext,
};

const EXPECTED_KEY = deriveCueImageKey({
  sportKey: bjjContext.sportKey,
  targetPosition: INPUT.targetPosition,
  cue: INPUT.cue,
});

function mockProvider(overrides: Partial<IImageProvider> = {}): IImageProvider {
  return {
    id: 'mock',
    isAvailable: jest.fn(async () => true),
    generate: jest.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    })),
    ...overrides,
  };
}

function mockStore(overrides: Partial<ICueImageStore> = {}): ICueImageStore {
  return {
    findCueImage: jest.fn(async () => null),
    saveCueImage: jest.fn(async (input) => ({
      reuseKey: input.reuseKey,
      sportKey: input.sportKey,
      targetPosition: input.targetPosition,
      prompt: input.prompt,
      storagePath: cueImageStoragePath(input.reuseKey),
      provider: input.provider,
    })),
    ...overrides,
  };
}

describe('CueImageService.ensureCueImage', () => {
  it('reuses a cached image without generating (cache hit)', async () => {
    const record: CueImageRecord = {
      reuseKey: EXPECTED_KEY,
      sportKey: 'bjj',
      targetPosition: 'closed guard',
      prompt: 'x',
      storagePath: cueImageStoragePath(EXPECTED_KEY),
      provider: 'gemini',
    };
    const provider = mockProvider();
    const store = mockStore({ findCueImage: jest.fn(async () => record) });
    const service = new CueImageService(provider, store);

    const result = await service.ensureCueImage(INPUT);

    expect(result).toEqual({
      reuseKey: EXPECTED_KEY,
      storagePath: cueImageStoragePath(EXPECTED_KEY),
      cached: true,
    });
    expect(store.findCueImage).toHaveBeenCalledWith(EXPECTED_KEY);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.saveCueImage).not.toHaveBeenCalled();
  });

  it('generates, stores, and indexes on a cache miss', async () => {
    const provider = mockProvider();
    const store = mockStore();
    const service = new CueImageService(provider, store);

    const result = await service.ensureCueImage(INPUT);

    expect(result).toEqual({
      reuseKey: EXPECTED_KEY,
      storagePath: cueImageStoragePath(EXPECTED_KEY),
      cached: false,
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(store.saveCueImage).toHaveBeenCalledWith(
      expect.objectContaining({
        reuseKey: EXPECTED_KEY,
        sportKey: 'bjj',
        provider: 'mock',
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
      }),
    );
  });

  it('skips (returns null) when the provider is unavailable', async () => {
    const provider = mockProvider({ isAvailable: jest.fn(async () => false) });
    const store = mockStore();
    const service = new CueImageService(provider, store);

    expect(await service.ensureCueImage(INPUT)).toBeNull();
    expect(store.findCueImage).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('propagates a generation failure (caller handles best-effort)', async () => {
    const provider = mockProvider({
      generate: jest.fn(async () => {
        throw new Error('imagen 500');
      }),
    });
    const store = mockStore();
    const service = new CueImageService(provider, store);

    await expect(service.ensureCueImage(INPUT)).rejects.toThrow('imagen 500');
    expect(store.saveCueImage).not.toHaveBeenCalled();
  });

  it('returns null for an empty cue without touching provider/store', async () => {
    const provider = mockProvider();
    const store = mockStore();
    const service = new CueImageService(provider, store);

    expect(await service.ensureCueImage({ ...INPUT, cue: '   ' })).toBeNull();
    expect(provider.isAvailable).not.toHaveBeenCalled();
    expect(store.findCueImage).not.toHaveBeenCalled();
  });
});
