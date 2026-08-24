import type { PipelineOutput } from '@/types/pipeline';

jest.mock('@/config/featureFlags', () => ({
  isDemoMode: false,
  isLocalPipeline: false,
}));
// Mocked members are created inside the factories (the module registry owns
// them) and re-grabbed via the imports below — a top-level const would still
// be in its temporal dead zone when the hoisted imports run the factories.
jest.mock('@/providers/storage', () => ({
  storageProvider: { uploadAudio: jest.fn() },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

// eslint-disable-next-line import/first
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line import/first
import { PipelineClient } from '@/pipeline/PipelineClient';
// eslint-disable-next-line import/first
import { storageProvider } from '@/providers/storage';

const mockUploadAudio = storageProvider.uploadAudio as jest.Mock;
const mockInvoke = supabase.functions.invoke as unknown as jest.Mock;

const OUTPUT: PipelineOutput = {
  sessionId: 's1',
  structuredSummary: 'summary',
  coachingCue: 'cue',
  targetPosition: 'Half Guard',
  targetPositionId: null,
  sentiment: 'neutral',
  declined: false,
  declinedReason: '',
  qualityGatePassed: true,
  processingSteps: [],
};

const baseInput = {
  audioUri: 'file:///tmp/take.m4a',
  userId: 'u1',
  sportKey: 'bjj' as const,
  skillLevel: 'Blue Belt',
  sessionDate: new Date('2026-07-12T10:00:00Z'),
};

describe('PipelineClient idempotent run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadAudio.mockResolvedValue('u1/123.m4a');
    mockInvoke.mockResolvedValue({ data: OUTPUT, error: null });
  });

  it('uploads once and reports the path for retry reuse', async () => {
    const onAudioUploaded = jest.fn();
    const out = await new PipelineClient().run(
      { ...baseInput, clientSessionId: 'key-1', uploadedAudioPath: null },
      undefined,
      onAudioUploaded,
    );

    expect(mockUploadAudio).toHaveBeenCalledTimes(1);
    expect(onAudioUploaded).toHaveBeenCalledWith('u1/123.m4a');
    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({
        audioStoragePath: 'u1/123.m4a',
        clientSessionId: 'key-1',
      }),
    });
    expect(out.sessionId).toBe('s1');
  });

  it('skips the upload entirely when a retry already has a path', async () => {
    await new PipelineClient().run({
      ...baseInput,
      clientSessionId: 'key-1',
      uploadedAudioPath: 'u1/earlier.m4a',
    });

    expect(mockUploadAudio).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({
        audioStoragePath: 'u1/earlier.m4a',
        clientSessionId: 'key-1',
      }),
    });
  });

  it('surfaces the server error body (e.g. the daily limit) as the thrown message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({
            error: 'Daily limit reached: up to 15 sessions per day.',
          }),
        },
      },
    });

    await expect(
      new PipelineClient().run({ ...baseInput, clientSessionId: 'key-1' }),
    ).rejects.toThrow(/daily limit reached/i);
  });

  it('does not upload audio again on a retry with an existing path', async () => {
    await new PipelineClient().run({
      ...baseInput,
      clientSessionId: 'key-1',
      uploadedAudioPath: 'u1/take.m4a',
    });

    expect(mockUploadAudio).not.toHaveBeenCalled();
  });
});

describe('PipelineClient.reanalyze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: OUTPUT, error: null });
  });

  it('invokes the reprocess branch with the session id + edited text, no upload', async () => {
    const out = await new PipelineClient().reanalyze({
      sessionId: 's1',
      userId: 'u1',
      sportKey: 'bjj',
      skillLevel: 'Blue Belt',
      editedTranscript: 'corrected words',
    });

    expect(mockUploadAudio).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({
        reanalyzeSessionId: 's1',
        editedTranscript: 'corrected words',
        sportKey: 'bjj',
      }),
    });
    expect(out.coachingCue).toBe('cue');
  });

  it('surfaces the server error body as the thrown message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'non-2xx',
        context: {
          json: async () => ({ error: 'Session not found' }),
        },
      },
    });

    await expect(
      new PipelineClient().reanalyze({
        sessionId: 's1',
        userId: 'u1',
        sportKey: 'bjj',
        skillLevel: 'Blue Belt',
        editedTranscript: 'corrected words',
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('PipelineClient — gi/no-gi (#59)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadAudio.mockResolvedValue('u1/123.m4a');
    mockInvoke.mockResolvedValue({ data: OUTPUT, error: null });
  });

  it('sends the take attire to the edge function', async () => {
    await new PipelineClient().run({ ...baseInput, gi: 'no-gi' });

    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({ gi: 'no-gi' }),
    });
  });

  it('sends null when the take carries no attire', async () => {
    await new PipelineClient().run(baseInput);

    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({ gi: null }),
    });
  });
});
