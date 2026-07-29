import { Platform } from 'react-native';

import { env } from '@/config/env';
import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { supabase } from '@/lib/supabase';
import { STEP_LABELS } from '@/constants/pipelineSteps';
import { buildDemoOutput } from '@/pipeline/demoData';
import { FlowlogPipeline } from '@/pipeline/FlowlogPipeline';
import { ClaudeProvider } from '@/providers/ai/ClaudeProvider';
import { GeminiProvider } from '@/providers/ai/GeminiProvider';
import type { IAIProvider } from '@/providers/ai/IAIProvider';
import { storageProvider } from '@/providers/storage';
import { localTestStorage } from '@/providers/storage/LocalTestStorageProvider';
import { recordingToWavBlob } from '@/utils/audioTranscode';
import { GeminiTranscriptionProvider } from '@/providers/transcription/GeminiTranscriptionProvider';
import type { ITranscriptionProvider } from '@/providers/transcription/ITranscriptionProvider';
import { WhisperProvider } from '@/providers/transcription/WhisperProvider';
import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import { QualityGateService } from '@/services/QualityGateService';
import { TranscriptionService } from '@/services/TranscriptionService';
import type {
  PipelineInput,
  PipelineOutput,
  ProcessingStep,
  ProcessingStepName,
  ReanalyzeInput,
} from '@/types/pipeline';
import { logger } from '@/utils/logger';

/**
 * Client-side entry to the pipeline. The heavy lifting (transcription, AI,
 * quality gate, persistence) runs server-side in the `process-session`
 * Supabase edge function so API secrets never reach the client. This class:
 *
 *   1. uploads the recorded audio to Supabase Storage, then
 *   2. invokes the edge function with the storage path, then
 *   3. returns the structured PipelineOutput the function produced.
 *
 * It replaces the in-app `FlowlogPipeline` on the client. `FlowlogPipeline` and
 * the `src/services` + `src/providers` it uses remain the unit-tested reference
 * implementation that the edge function mirrors (see docs/PIPELINE.md).
 */
export type PipelineProgress = (steps: ProcessingStep[]) => void;

export class PipelineClient {
  private localPipeline?: FlowlogPipeline;

  /**
   * Re-analyze a saved session from a user-corrected transcript. Regenerates
   * the cue on the edited text and updates the SAME session in place (no new
   * session, no transcription, no audio). Demo returns canned output; local
   * runs the reference pipeline; production invokes the edge function's
   * reprocess branch.
   */
  async reanalyze(input: ReanalyzeInput): Promise<PipelineOutput> {
    if (isDemoMode) {
      return { ...buildDemoOutput(input.sportKey), sessionId: input.sessionId };
    }
    if (isLocalPipeline) {
      return this.getLocalPipeline().reanalyze(input);
    }
    const { data, error } = await supabase.functions.invoke<PipelineOutput>(
      'process-session',
      {
        body: {
          reanalyzeSessionId: input.sessionId,
          editedTranscript: input.editedTranscript,
          sportKey: input.sportKey,
          skillLevel: input.skillLevel,
        },
      },
    );
    if (error) {
      const detail = await readFunctionError(error);
      logger.error('re-analyze failed', detail);
      throw new Error(detail);
    }
    if (!data) {
      throw new Error('Re-analyze returned no data.');
    }
    return data;
  }

  async run(
    input: PipelineInput,
    onProgress?: PipelineProgress,
    onAudioUploaded?: (path: string) => void,
  ): Promise<PipelineOutput> {
    // DEMO_MODE: fully offline. Animate the steps and return canned output —
    // no audio upload, no edge function, no API keys. Prototyping only.
    if (isDemoMode) {
      return this.runDemo(input, onProgress);
    }

    // LOCAL TEST pipeline: run the real Whisper + Claude pipeline directly in
    // the client (keys from EXPO_PUBLIC), no Supabase / edge function.
    if (isLocalPipeline) {
      return this.getLocalPipeline().run(input, onProgress);
    }

    // The edge function runs every stage in one opaque server call, so we can't
    // get real per-step progress. Advance the steps on a timer while the call is
    // in flight (holding on the last stage) so the UI reflects progress, then
    // complete when the server responds.
    const progress = new StagedProgress(onProgress);
    progress.start();
    try {
      // 1. Upload audio to Storage (server downloads it for transcription) —
      //    unless a retry already uploaded this exact take, in which case reuse
      //    the existing object instead of orphaning it with a duplicate.
      //    On web the recording is WebM, which the server-side transcriber
      //    can't read — transcode to WAV first so the format is supported.
      let audioStoragePath = input.uploadedAudioPath ?? null;
      if (!audioStoragePath) {
        const uploadUri = await prepareUploadUri(input.audioUri);
        audioStoragePath = await storageProvider.uploadAudio(
          input.userId,
          uploadUri,
        );
        onAudioUploaded?.(audioStoragePath);
      }

      // 2. Invoke the edge function. supabase-js attaches the user's auth token,
      //    so the function derives the userId from the JWT (not trusted input).
      //    clientSessionId makes the call idempotent server-side: retrying
      //    after a timeout returns the already-created session, never a second.
      const { data, error } = await supabase.functions.invoke<PipelineOutput>(
        'process-session',
        {
          body: {
            audioStoragePath,
            sportKey: input.sportKey,
            skillLevel: input.skillLevel,
            sessionDate: input.sessionDate.toISOString(),
            clientSessionId: input.clientSessionId ?? null,
          },
        },
      );

      if (error) {
        const detail = await readFunctionError(error);
        logger.error('process-session failed', detail);
        throw new Error(detail);
      }
      if (!data) {
        throw new Error('process-session returned no data.');
      }

      progress.complete();
      return data;
    } catch (err) {
      progress.stop();
      throw err;
    }
  }

  /**
   * Build (once) a FlowlogPipeline wired for local testing: real providers
   * keyed from EXPO_PUBLIC vars, browser-friendly, with in-memory storage so no
   * Supabase is needed. This reuses the unit-tested reference pipeline directly.
   */
  private getLocalPipeline(): FlowlogPipeline {
    if (!this.localPipeline) {
      const transcriber: ITranscriptionProvider =
        env.LOCAL_TRANSCRIPTION_PROVIDER === 'gemini'
          ? new GeminiTranscriptionProvider(env.LOCAL_GEMINI_API_KEY)
          : new WhisperProvider(env.LOCAL_OPENAI_API_KEY);
      const ai: IAIProvider =
        env.LOCAL_AI_PROVIDER === 'gemini'
          ? new GeminiProvider(env.LOCAL_GEMINI_API_KEY)
          : new ClaudeProvider(env.LOCAL_ANTHROPIC_API_KEY);
      this.localPipeline = new FlowlogPipeline({
        transcription: new TranscriptionService(transcriber),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage: localTestStorage,
      });
    }
    return this.localPipeline;
  }

  /** Offline demo run: walk the steps with a short delay, then return canned output. */
  private async runDemo(
    input: PipelineInput,
    onProgress?: PipelineProgress,
  ): Promise<PipelineOutput> {
    logger.info('pipeline running in DEMO_MODE (canned result)');
    const names = Object.keys(STEP_LABELS) as ProcessingStepName[];
    const status = new Map<ProcessingStepName, ProcessingStep['status']>(
      names.map((name) => [name, 'pending']),
    );
    const snapshot = (): ProcessingStep[] =>
      names.map((name) => ({
        name,
        label: STEP_LABELS[name],
        status: status.get(name) ?? 'pending',
      }));

    for (const name of names) {
      status.set(name, 'running');
      onProgress?.(snapshot());
      await delay(380);
      status.set(name, 'done');
      onProgress?.(snapshot());
    }

    return buildDemoOutput(input.sportKey);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * On web, transcode the WebM recording to WAV (a Gemini-supported format) and
 * return an object URL to upload. On native the recorded m4a/aac is already
 * supported, so upload as-is. Falls back to the original on any failure.
 */
async function prepareUploadUri(audioUri: string): Promise<string> {
  if (Platform.OS !== 'web') return audioUri;
  try {
    const wav = await recordingToWavBlob(audioUri);
    const createObjectURL = (
      globalThis as unknown as {
        URL?: { createObjectURL(blob: Blob): string };
      }
    ).URL?.createObjectURL;
    return createObjectURL ? createObjectURL(wav) : audioUri;
  } catch (err) {
    logger.warn('audio transcode failed; uploading original recording', err);
    return audioUri;
  }
}

/**
 * Drives client-side step progress for the opaque edge-function call: ticks
 * through the stages on a timer, holds on the last analysis stage so it doesn't
 * "finish" before the server does, then marks everything done on completion.
 */
class StagedProgress {
  private readonly order: ProcessingStepName[] = [
    'context',
    'transcription',
    'extraction',
    'coaching',
    'quality_gate',
    'persistence',
  ];
  private readonly status = new Map<
    ProcessingStepName,
    ProcessingStep['status']
  >();
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onProgress?: PipelineProgress) {
    this.order.forEach((name) => this.status.set(name, 'pending'));
  }

  start(): void {
    this.status.set(this.order[0]!, 'running');
    this.emit();
    this.timer = setInterval(() => this.tick(), 1600);
  }

  private tick(): void {
    // Hold at the second-to-last stage (quality_gate) until the real response.
    if (this.index >= this.order.length - 2) return;
    this.status.set(this.order[this.index]!, 'done');
    this.index += 1;
    this.status.set(this.order[this.index]!, 'running');
    this.emit();
  }

  complete(): void {
    this.stop();
    this.order.forEach((name) => this.status.set(name, 'done'));
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    this.onProgress?.(
      this.order.map((name) => ({
        name,
        label: STEP_LABELS[name],
        status: this.status.get(name) ?? 'pending',
      })),
    );
  }
}

/** Pull a useful message out of a Supabase FunctionsError. */
async function readFunctionError(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: Response };
  try {
    if (e.context && typeof e.context.json === 'function') {
      const body = await e.context.json();
      if (body?.error) return String(body.error);
    }
  } catch {
    // fall through to the generic message
  }
  return e.message ?? 'Edge function error';
}

/** Default singleton for app use. */
export const pipelineClient = new PipelineClient();
