import { PIPELINE_CONFIG, PIPELINE_VERSION } from '@/constants/pipelineConfig';
import { STEP_LABELS } from '@/constants/pipelineSteps';
import { storageProvider } from '@/providers/storage';
import type { IStorageProvider } from '@/providers/storage';
import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import { QualityGateService } from '@/services/QualityGateService';
import { TranscriptionService } from '@/services/TranscriptionService';
import { getSportContext } from '@/sports';
import type { ISportContext } from '@/sports/ISportContext';
import type {
  CoachingInput,
  PipelineInput,
  PipelineOutput,
  ProcessingStep,
  ProcessingStepName,
  ReanalyzeInput,
} from '@/types/pipeline';
import { logger, reportToMonitoring } from '@/utils/logger';

export type { PipelineInput, PipelineOutput, ReanalyzeInput };

/**
 * Optional progress callback so the processing screen can render live step
 * state. Receives the full step list on every transition.
 */
export type PipelineProgress = (steps: ProcessingStep[]) => void;

interface PipelineDeps {
  transcription?: TranscriptionService;
  extraction?: ExtractionService;
  coaching?: CoachingService;
  qualityGate?: QualityGateService;
  storage?: IStorageProvider;
}

/**
 * THE single orchestrator. No screen or component calls a provider directly —
 * everything funnels through `run`. Sport context is injected once at the top
 * (Stage 0) and threaded through every stage; the pipeline contains zero
 * sport-specific branching.
 */
export class FlowlogPipeline {
  private readonly transcription: TranscriptionService;
  private readonly extraction: ExtractionService;
  private readonly coaching: CoachingService;
  private readonly qualityGate: QualityGateService;
  private readonly storage: IStorageProvider;

  constructor(deps: PipelineDeps = {}) {
    this.transcription = deps.transcription ?? new TranscriptionService();
    this.extraction = deps.extraction ?? new ExtractionService();
    this.coaching = deps.coaching ?? new CoachingService();
    this.qualityGate = deps.qualityGate ?? new QualityGateService();
    this.storage = deps.storage ?? storageProvider;
  }

  async run(
    input: PipelineInput,
    onProgress?: PipelineProgress,
  ): Promise<PipelineOutput> {
    const steps = this.initSteps();
    const emit = () => onProgress?.([...steps]);
    const begin = (name: ProcessingStepName) => {
      const step = steps.find((s) => s.name === name)!;
      step.status = 'running';
      step.startedAt = Date.now();
      emit();
    };
    const done = (name: ProcessingStepName, detail?: string) => {
      const step = steps.find((s) => s.name === name)!;
      step.status = 'done';
      step.finishedAt = Date.now();
      if (detail) step.detail = detail;
      emit();
    };
    const fail = (name: ProcessingStepName, detail: string) => {
      const step = steps.find((s) => s.name === name)!;
      step.status = 'failed';
      step.finishedAt = Date.now();
      step.detail = detail;
      emit();
    };

    try {
      // ── Stage 0: sport context ──────────────────────────────────────────
      begin('context');
      const sportContext: ISportContext = getSportContext(input.sportKey);
      done('context', sportContext.displayName);

      // ── Stage 1: transcription (vocabulary-primed) ──────────────────────
      begin('transcription');
      const transcription = await this.transcription.transcribe(
        input.audioUri,
        sportContext,
      );
      done('transcription', `${transcription.durationSeconds.toFixed(0)}s`);

      // ── Stage 2a: extraction ────────────────────────────────────────────
      begin('extraction');
      const extraction = await this.extraction.extract(
        transcription.transcript,
        sportContext,
        input.skillLevel,
      );
      done('extraction', `${extraction.positionsVisited.length} positions`);

      // ── Decline path (issue #44) ────────────────────────────────────────
      // Nothing coachable in the recording. Skip coaching entirely rather than
      // let the model invent a cue from empty inputs — it will, fluently, and
      // the quality gate cannot tell. The Session is still saved (with a null
      // cue) so the user's reflection and their streak survive; the UI offers
      // re-record or keep.
      if (!extraction.hasCoachableContent) {
        done('coaching', 'skipped — nothing to coach');
        done('quality_gate', 'skipped');

        begin('persistence');
        const declinedAudioPath = await this.safeUploadAudio(
          input.userId,
          input.audioUri,
        );
        const declinedSession = await this.storage.saveSession({
          userId: input.userId,
          sportKey: input.sportKey,
          sessionDate: input.sessionDate.toISOString(),
          audioStoragePath: declinedAudioPath,
          rawTranscript: transcription.transcript,
          positionsVisited: extraction.positionsVisited,
          keyMistake: extraction.keyMistake,
          opponentAction: extraction.opponentAction,
          sentiment: extraction.sentiment,
          coachingCue: null,
          targetPosition: null,
          qualityGatePassed: false,
          pipelineVersion: PIPELINE_VERSION,
        });
        done('persistence');

        return {
          sessionId: declinedSession.id,
          structuredSummary: this.buildSummary(extraction, sportContext),
          coachingCue: null,
          targetPosition: null,
          sentiment: extraction.sentiment,
          qualityGatePassed: false,
          processingSteps: steps,
          declined: true,
          declinedReason: extraction.insufficientReason,
        };
      }

      // History for coaching context (best-effort — never block on it).
      const { recentMistakes, dominantWeakness } = await this.loadHistory(
        input.userId,
        input.sportKey,
      );

      // ── Stage 2b: coaching ──────────────────────────────────────────────
      begin('coaching');
      const coachingInput: CoachingInput = {
        extraction,
        sportContext,
        recentMistakes,
        skillLevel: input.skillLevel,
        dominantWeakness,
      };
      const initialCoaching = await this.coaching.generate(coachingInput);
      done('coaching');

      // ── Stage 3: quality gate (retries with stricter prompt) ────────────
      begin('quality_gate');
      const gate = await this.qualityGate.enforce(
        initialCoaching,
        sportContext,
        (strict) => this.coaching.generate(coachingInput, strict),
      );
      done(
        'quality_gate',
        gate.passed
          ? `passed (${gate.attempts} attempt${gate.attempts > 1 ? 's' : ''})`
          : 'fallback used',
      );

      // ── Stage 4: persistence ────────────────────────────────────────────
      begin('persistence');
      const audioStoragePath = await this.safeUploadAudio(
        input.userId,
        input.audioUri,
      );
      const session = await this.storage.saveSession({
        userId: input.userId,
        sportKey: input.sportKey,
        sessionDate: input.sessionDate.toISOString(),
        audioStoragePath,
        rawTranscript: transcription.transcript,
        positionsVisited: extraction.positionsVisited,
        keyMistake: extraction.keyMistake,
        opponentAction: extraction.opponentAction,
        sentiment: extraction.sentiment,
        coachingCue: gate.coaching.cue,
        targetPosition: gate.coaching.targetPosition,
        qualityGatePassed: gate.passed,
        pipelineVersion: PIPELINE_VERSION,
      });
      done('persistence');

      return {
        sessionId: session.id,
        structuredSummary: this.buildSummary(extraction, sportContext),
        coachingCue: gate.coaching.cue,
        targetPosition: gate.coaching.targetPosition,
        sentiment: extraction.sentiment,
        qualityGatePassed: gate.passed,
        processingSteps: steps,
        declined: false,
        declinedReason: '',
      };
    } catch (err) {
      const running = steps.find((s) => s.status === 'running');
      if (running) fail(running.name, (err as Error).message);
      reportToMonitoring('pipeline_failed', {
        sport: input.sportKey,
        userId: input.userId,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  /**
   * Re-analyze a saved session from a user-corrected transcript: re-run
   * extraction → coaching → quality gate on the edited text and overwrite the
   * existing session's analysis fields IN PLACE (same row, no new session, no
   * transcription, no audio). Mirrors the edge function's reprocess branch.
   */
  async reanalyze(input: ReanalyzeInput): Promise<PipelineOutput> {
    const transcript = input.editedTranscript.trim();
    if (!transcript) throw new Error('Transcript is empty.');

    const sportContext: ISportContext = getSportContext(input.sportKey);
    const extraction = await this.extraction.extract(
      transcript,
      sportContext,
      input.skillLevel,
    );

    // A corrected transcript can still turn out to have nothing coachable in it
    // (issue #44) — decline here too rather than inventing on re-analysis.
    if (!extraction.hasCoachableContent) {
      const declined = await this.storage.updateSessionAnalysis(
        input.sessionId,
        {
          rawTranscript: transcript,
          positionsVisited: extraction.positionsVisited,
          keyMistake: extraction.keyMistake,
          opponentAction: extraction.opponentAction,
          sentiment: extraction.sentiment,
          coachingCue: null,
          targetPosition: null,
          qualityGatePassed: false,
          pipelineVersion: PIPELINE_VERSION,
        },
      );
      return {
        sessionId: declined.id,
        structuredSummary: this.buildSummary(extraction, sportContext),
        coachingCue: null,
        targetPosition: null,
        sentiment: extraction.sentiment,
        qualityGatePassed: false,
        processingSteps: this.reanalyzeSteps(),
        declined: true,
        declinedReason: extraction.insufficientReason,
      };
    }

    const { recentMistakes, dominantWeakness } = await this.loadHistory(
      input.userId,
      input.sportKey,
    );
    const coachingInput: CoachingInput = {
      extraction,
      sportContext,
      recentMistakes,
      skillLevel: input.skillLevel,
      dominantWeakness,
    };
    const initialCoaching = await this.coaching.generate(coachingInput);
    const gate = await this.qualityGate.enforce(
      initialCoaching,
      sportContext,
      (strict) => this.coaching.generate(coachingInput, strict),
    );

    const session = await this.storage.updateSessionAnalysis(input.sessionId, {
      rawTranscript: transcript,
      positionsVisited: extraction.positionsVisited,
      keyMistake: extraction.keyMistake,
      opponentAction: extraction.opponentAction,
      sentiment: extraction.sentiment,
      coachingCue: gate.coaching.cue,
      targetPosition: gate.coaching.targetPosition,
      qualityGatePassed: gate.passed,
      pipelineVersion: PIPELINE_VERSION,
    });

    return {
      sessionId: session.id,
      structuredSummary: this.buildSummary(extraction, sportContext),
      coachingCue: gate.coaching.cue,
      targetPosition: gate.coaching.targetPosition,
      sentiment: extraction.sentiment,
      qualityGatePassed: gate.passed,
      processingSteps: this.reanalyzeSteps(),
      declined: false,
      declinedReason: '',
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private initSteps(): ProcessingStep[] {
    const order: ProcessingStepName[] = [
      'context',
      'transcription',
      'extraction',
      'coaching',
      'quality_gate',
      'persistence',
    ];
    return order.map((name) => ({
      name,
      label: STEP_LABELS[name],
      status: 'pending',
    }));
  }

  /** Steps for a re-analysis (no context/transcription — those are unchanged). */
  private reanalyzeSteps(): ProcessingStep[] {
    const order: ProcessingStepName[] = [
      'extraction',
      'coaching',
      'quality_gate',
      'persistence',
    ];
    return order.map((name) => ({
      name,
      label: STEP_LABELS[name],
      status: 'done',
    }));
  }

  private async loadHistory(
    userId: string,
    sportKey: string,
  ): Promise<{ recentMistakes: string[]; dominantWeakness: string | null }> {
    try {
      const [recentMistakes, trends] = await Promise.all([
        this.storage.getRecentMistakes(
          userId,
          PIPELINE_CONFIG.recentMistakesWindow,
        ),
        this.storage.getUserTrends(userId, sportKey),
      ]);
      return {
        recentMistakes,
        dominantWeakness: trends?.dominantWeakness ?? null,
      };
    } catch (err) {
      // History is enrichment, not a hard dependency — degrade gracefully.
      logger.warn('history load failed; proceeding without it', err);
      return { recentMistakes: [], dominantWeakness: null };
    }
  }

  private async safeUploadAudio(
    userId: string,
    audioUri: string,
  ): Promise<string | null> {
    try {
      return await this.storage.uploadAudio(userId, audioUri);
    } catch (err) {
      // A failed upload shouldn't lose the analysed session.
      logger.warn('audio upload failed; saving session without audio', err);
      return null;
    }
  }

  private buildSummary(
    extraction: {
      positionsVisited: string[];
      keyMistake: string;
      opponentAction: string;
      sentiment: string;
    },
    sportContext: ISportContext,
  ): string {
    const positions =
      extraction.positionsVisited.length > 0
        ? extraction.positionsVisited.join(', ')
        : 'none noted';
    return [
      `Positions this ${sportContext.sessionUnit}: ${positions}.`,
      `Key mistake: ${extraction.keyMistake || 'none identified'}.`,
      `Opponent/challenge: ${extraction.opponentAction || 'n/a'}.`,
      `Mood: ${extraction.sentiment}.`,
    ].join(' ');
  }
}

/** Default singleton for app use. Tests construct their own with mocked deps. */
export const flowlogPipeline = new FlowlogPipeline();
