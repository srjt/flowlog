import { aiProvider } from '@/providers/ai';
import type { IAIProvider } from '@/providers/ai';
import {
  STAGE_FAILED,
  runDiagramStage,
  type DiagramLibrary,
  type DiagramRecord,
} from '@/visualization/diagramStage';
import { logger } from '@/utils/logger';

/** One Session's inputs to the stage, as the pipeline knows them. */
export interface DiagramSpecArgs {
  /** The sport's library, or the one a test injects. */
  library: DiagramLibrary | undefined;
  /** The Cue the Session will hold. */
  cue: string | null;
  /** The quality gate passed without its fallback. */
  coachable: boolean;
  /** The Session's canonical position id. */
  positionId: string | null;
}

/**
 * Stage 3b, cue -> force-diagram spec (#135). Best-effort and additive: it
 * runs after the quality gate on the Cue the Session will hold, and can only
 * describe that Cue, never change it.
 *
 * The decisions (whether to call at all, the deadline, the outcome and the
 * versions recorded) live in `src/visualization/diagramStage.ts`, which the
 * `process-session` edge function shares. This service supplies the provider
 * and the logging. Provider is injected for testability, like the other
 * stages.
 */
export class DiagramSpecService {
  constructor(
    private readonly provider: IAIProvider = aiProvider,
    /** Override the deadline. Tests shorten it; production uses the default. */
    private readonly timeoutMs?: number,
  ) {}

  /** Never throws. */
  async run(args: DiagramSpecArgs): Promise<DiagramRecord> {
    try {
      const { record, detail } = await runDiagramStage({
        ...args,
        call: (request) => this.provider.generateDiagramSpec(request),
        timeoutMs: this.timeoutMs,
      });
      logger.debug('diagram spec', {
        outcome: record.diagramOutcome,
        detail,
      });
      return record;
    } catch (err) {
      // Unreachable by construction; the Session is written either way.
      logger.warn('diagram stage failed; the cue shows as text', err);
      return { ...STAGE_FAILED };
    }
  }
}
