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
  sentiment: 'neutral',
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

  it('passes the edited transcript through to analysis', async () => {
    await new PipelineClient().run({
      ...baseInput,
      clientSessionId: 'key-1',
      uploadedAudioPath: 'u1/take.m4a',
      editedTranscript: 'corrected words',
    });

    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({
        editedTranscript: 'corrected words',
        clientSessionId: 'key-1',
      }),
    });
  });
});

describe('PipelineClient.transcribeAudio (phase 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadAudio.mockResolvedValue('u1/123.m4a');
    mockInvoke.mockResolvedValue({
      data: { transcript: 'hello world' },
      error: null,
    });
  });

  it('uploads once, invokes transcribe-only, and returns the transcript', async () => {
    const onAudioUploaded = jest.fn();
    const { transcript } = await new PipelineClient().transcribeAudio(
      { ...baseInput, uploadedAudioPath: null },
      onAudioUploaded,
    );

    expect(mockUploadAudio).toHaveBeenCalledTimes(1);
    expect(onAudioUploaded).toHaveBeenCalledWith('u1/123.m4a');
    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({
        audioStoragePath: 'u1/123.m4a',
        stopAfterTranscription: true,
      }),
    });
    expect(transcript).toBe('hello world');
  });

  it('reuses an already-uploaded path instead of re-uploading', async () => {
    await new PipelineClient().transcribeAudio({
      ...baseInput,
      uploadedAudioPath: 'u1/earlier.m4a',
    });

    expect(mockUploadAudio).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('process-session', {
      body: expect.objectContaining({
        audioStoragePath: 'u1/earlier.m4a',
        stopAfterTranscription: true,
      }),
    });
  });

  it('surfaces the friendly too-short error from the server', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'non-2xx',
        context: {
          json: async () => ({ error: 'Recording too short (5s, min 20s).' }),
        },
      },
    });

    await expect(
      new PipelineClient().transcribeAudio({ ...baseInput }),
    ).rejects.toThrow(/too short/i);
  });
});
