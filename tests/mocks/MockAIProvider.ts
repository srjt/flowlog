import type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
  IAIProvider,
  SpecRequest,
} from '@/providers/ai/IAIProvider';

const DEFAULT_EXTRACTION: ExtractionOutput = {
  positionsVisited: ['Turtle', 'Back Control'],
  keyMistake: 'Exposed neck while turtled, conceding back control.',
  opponentAction: 'Attacked the back the moment I turned away.',
  sentiment: 'flat',
  rawTranscript: '',
  hasCoachableContent: true,
  insufficientReason: '',
  perspective: 'bottom',
  statedGi: 'unknown',
  // A positional mistake, so suites that predate #153 ground exactly as before.
  mistakeConcerns: 'position',
};

const DEFAULT_GOOD_COACHING: CoachingOutput = {
  cue: 'From turtle, glue your chin to your chest and trap one wrist before standing.',
  targetPosition: 'Turtle',
  confidenceScore: 0.82,
  isGeneric: false,
};

/**
 * Full-interface AI mock supporting quality-gate scenarios. Provide a queue of
 * coaching outputs to script retry behaviour (first bad, then good on strict).
 */
export class MockAIProvider implements IAIProvider {
  available = true;
  extractCalls = 0;
  coachingCalls = 0;
  lastStrict = false;
  lastCoachingInput: CoachingInput | null = null;
  strictCallCount = 0;

  // ── Cue -> spec (#135) ──
  diagramSpecCalls = 0;
  lastDiagramSpecInput: SpecRequest | null = null;
  /**
   * What `generateDiagramSpec` answers, in order; then `diagramSpecResponse`.
   * Defaults to null (no response). Existing suites never reach it, because
   * the real BJJ base library is empty and the stage makes no call.
   */
  diagramSpecQueue: unknown[] = [];
  diagramSpecResponse: unknown = null;
  /**
   * Reject instead of answering. The real providers never throw; this checks
   * that the stage survives one that does.
   */
  diagramSpecError: Error | null = null;

  public extraction: ExtractionOutput;

  constructor(
    extraction: Partial<ExtractionOutput> = {},
    public coachingQueue: CoachingOutput[] = [],
    public defaultCoaching: CoachingOutput = DEFAULT_GOOD_COACHING,
  ) {
    this.extraction = { ...DEFAULT_EXTRACTION, ...extraction };
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    this.extractCalls++;
    return { ...this.extraction, rawTranscript: input.transcript };
  }

  async generateCoachingCue(input: CoachingInput): Promise<CoachingOutput> {
    this.coachingCalls++;
    this.lastCoachingInput = input;
    this.lastStrict = input.strict === true;
    if (input.strict) this.strictCallCount++;
    const next = this.coachingQueue.shift();
    return next ?? this.defaultCoaching;
  }

  async generateDiagramSpec(input: SpecRequest): Promise<unknown> {
    this.diagramSpecCalls++;
    this.lastDiagramSpecInput = input;
    if (this.diagramSpecError) throw this.diagramSpecError;
    return this.diagramSpecQueue.length > 0
      ? this.diagramSpecQueue.shift()
      : this.diagramSpecResponse;
  }
}
