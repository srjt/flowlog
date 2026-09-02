import { PIPELINE_CONFIG, PIPELINE_VERSION } from '@/constants/pipelineConfig';
import { STEP_LABELS } from '@/constants/pipelineSteps';
import { storageProvider } from '@/providers/storage';
import type { IStorageProvider } from '@/providers/storage';
import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import { candidatePositions, rankRecords } from '@/services/GroundingService';
import { assignGrounding, type GroundingAssignment } from '@/sports/experiment';
import {
  filterByGiContext,
  resolveGiContext,
  type GiContext,
} from '@/sports/giContext';
import { QualityGateService } from '@/services/QualityGateService';
import { TranscriptionService } from '@/services/TranscriptionService';
import { getSportContext } from '@/sports';
import type { ISportContext } from '@/sports/ISportContext';
import type { Perspective } from '@/sports/positionTypes';
import type {
  CoachingInput,
  CoachingRecord,
  ExtractionOutput,
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
  /** Override the experiment rollout. Tests pin an arm; production uses config. */
  groundingRollout?: number;
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
  private readonly groundingRollout: number;

  constructor(deps: PipelineDeps = {}) {
    this.transcription = deps.transcription ?? new TranscriptionService();
    this.extraction = deps.extraction ?? new ExtractionService();
    this.coaching = deps.coaching ?? new CoachingService();
    this.qualityGate = deps.qualityGate ?? new QualityGateService();
    this.storage = deps.storage ?? storageProvider;
    this.groundingRollout =
      deps.groundingRollout ?? PIPELINE_CONFIG.groundingRollout;
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

      // Settle gi/no-gi before grounding: it decides which records apply, and
      // an explicit statement in the recording outranks a stale toggle (#60).
      const giResolution = resolveGiContext({
        toggle: input.gi ?? null,
        stated: extraction.statedGi === 'unknown' ? null : extraction.statedGi,
        transcript: extraction.rawTranscript,
      });
      if (giResolution.overrode) {
        logger.info('gi context overridden by the recording', {
          toggle: input.gi,
          resolved: giResolution.gi,
        });
      }

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
          targetPositionId: null,
          qualityGatePassed: false,
          pipelineVersion: PIPELINE_VERSION,
          gi: giResolution.gi,
          giSource: giResolution.source,
          grounding: 'declined',
          groundingRecords: 0,
          groundingAvailable: 0,
        });
        done('persistence');

        return {
          sessionId: declinedSession.id,
          structuredSummary: this.buildSummary(extraction, sportContext),
          coachingCue: null,
          targetPosition: null,
          targetPositionId: null,
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

      // Grounding runs BEFORE coaching, from the extraction — the coaching
      // stage's own targetPosition arrives too late to inform the cue it is
      // part of. Best-effort: an ungrounded cue is a supported outcome.
      // The session key must be stable across retries, or a timeout could flip
      // a session between experiment arms.
      const {
        records: groundingRecords,
        assignment,
        candidates: groundingCandidates,
      } = await this.loadGrounding(
        input.sportKey,
        extraction,
        input.clientSessionId ??
          `${input.userId}:${input.sessionDate.toISOString()}`,
        giResolution.gi,
        sportContext.vocabulary,
      );

      // ── Stage 2b: coaching ──────────────────────────────────────────────
      begin('coaching');
      const coachingInput: CoachingInput = {
        extraction,
        sportContext,
        recentMistakes,
        skillLevel: input.skillLevel,
        dominantWeakness,
        groundingRecords,
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

      // Resolve the cue's target position onto the canonical vocabulary so
      // later grounding has a stable key to join on, not a free-text label.
      const resolved = this.resolvePositionId(
        sportContext,
        gate.coaching.targetPosition,
        extraction,
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
        // Canonical label ("Side control (bottom)") when the position
        // resolved; otherwise keep what the model wrote.
        targetPosition: resolved.label ?? gate.coaching.targetPosition,
        targetPositionId: resolved.id,
        qualityGatePassed: gate.passed,
        pipelineVersion: PIPELINE_VERSION,
        gi: giResolution.gi,
        giSource: giResolution.source,
        grounding: assignment.outcome,
        groundingRecords: assignment.inject,
        groundingCandidates:
          groundingCandidates < 0 ? null : groundingCandidates,
        groundingAvailable: assignment.available,
      });
      done('persistence');

      return {
        sessionId: session.id,
        structuredSummary: this.buildSummary(extraction, sportContext),
        coachingCue: gate.coaching.cue,
        targetPosition: resolved.label ?? gate.coaching.targetPosition,
        targetPositionId: resolved.id,
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
          targetPositionId: null,
          qualityGatePassed: false,
          pipelineVersion: PIPELINE_VERSION,
        },
      );
      return {
        sessionId: declined.id,
        structuredSummary: this.buildSummary(extraction, sportContext),
        coachingCue: null,
        targetPosition: null,
        targetPositionId: null,
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

    const resolved = this.resolvePositionId(
      sportContext,
      gate.coaching.targetPosition,
      extraction,
    );

    const session = await this.storage.updateSessionAnalysis(input.sessionId, {
      rawTranscript: transcript,
      positionsVisited: extraction.positionsVisited,
      keyMistake: extraction.keyMistake,
      opponentAction: extraction.opponentAction,
      sentiment: extraction.sentiment,
      coachingCue: gate.coaching.cue,
      targetPosition: resolved.label ?? gate.coaching.targetPosition,
      targetPositionId: resolved.id,
      qualityGatePassed: gate.passed,
      pipelineVersion: PIPELINE_VERSION,
    });

    return {
      sessionId: session.id,
      structuredSummary: this.buildSummary(extraction, sportContext),
      coachingCue: gate.coaching.cue,
      targetPosition: resolved.label ?? gate.coaching.targetPosition,
      targetPositionId: resolved.id,
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

  /**
   * Records to ground this cue in, or none.
   *
   * Never throws: grounding is enrichment. A lookup failure degrades to the
   * ungrounded cue the pipeline produced before this existed, which the user
   * cannot distinguish — the alternative would be failing a whole session over
   * reference data.
   */
  private async loadGrounding(
    sportKey: string,
    extraction: ExtractionOutput,
    sessionKey: string,
    gi: GiContext | null,
    /** The sport's vocabulary, so ranking can weight domain terms (#—). */
    vocabulary: readonly string[],
  ): Promise<{
    records: CoachingRecord[];
    assignment: GroundingAssignment;
    /** Records for the position BEFORE gi + relevance filtering (#58). */
    candidates: number;
  }> {
    try {
      const positionIds = candidatePositions(extraction);
      const records =
        positionIds.length === 0
          ? []
          : await this.storage.getCoachingRecords(sportKey, positionIds);
      // Before ranking, not after: a gi-only record must not occupy one of the
      // 20 slots and crowd out a mechanic that actually applies.
      const applicable = filterByGiContext(records, gi);
      const relevant = rankRecords(
        applicable,
        extraction.keyMistake,
        undefined,
        undefined,
        vocabulary,
      );
      const assignment = assignGrounding(sessionKey, relevant.length, {
        hasPosition: positionIds.length > 0,
        rollout: this.groundingRollout,
      });
      logger.debug('grounding', {
        positions: positionIds.length,
        found: records.length,
        applicable: applicable.length,
        relevant: relevant.length,
        gi: gi ?? 'unknown',
        outcome: assignment.outcome,
      });
      return {
        records: assignment.outcome === 'grounded' ? relevant : [],
        assignment,
        candidates: records.length,
      };
    } catch (err) {
      // Grounding is enrichment; a lookup failure must not cost a session.
      logger.warn('grounding lookup failed; cue will be ungrounded', err);
      return {
        records: [],
        assignment: { outcome: 'no_records', inject: 0, available: 0 },
        // A lookup failure is not a corpus gap. Null keeps it out of the
        // mining backlog rather than filing it as a position to mine.
        candidates: -1,
      };
    }
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

  /**
   * Resolve the coaching stage's free-text target position onto the sport's
   * canonical vocabulary (issue #47/#48).
   *
   * The extraction's reported side is passed as a hint rather than as the
   * answer: a side written into the position label itself ("Side Control
   * (bottom)") is more specific and wins. Returns null whenever the position or
   * the side is undetermined — there is no nearest-match fallback, because a
   * wrong id makes every later lookup confidently wrong.
   */
  private resolvePositionId(
    sportContext: ISportContext,
    targetPosition: string | null,
    extraction: {
      keyMistake: string;
      opponentAction: string;
      rawTranscript: string;
      perspective: Perspective | 'unknown';
    },
  ): { id: string | null; label: string | null } {
    const context = [
      extraction.keyMistake,
      extraction.opponentAction,
      extraction.rawTranscript,
    ]
      .filter(Boolean)
      .join(' ');

    const match = sportContext.normalizePosition(
      targetPosition,
      context,
      extraction.perspective,
    );
    // Only adopt the canonical label when the position FULLY resolved. A
    // canonical-looking label must imply a canonical id, or the display and the
    // stored key disagree — "Side control" shown while nothing was keyed.
    return { id: match.id, label: match.id ? match.label : null };
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
