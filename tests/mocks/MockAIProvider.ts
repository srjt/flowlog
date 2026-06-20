import type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
  IAIProvider,
} from '@/providers/ai/IAIProvider';

const DEFAULT_EXTRACTION: ExtractionOutput = {
  positionsVisited: ['Turtle', 'Back Control'],
  keyMistake: 'Exposed neck while turtled, conceding back control.',
  opponentAction: 'Attacked the back the moment I turned away.',
  sentiment: 'flat',
  rawTranscript: '',
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
  strictCallCount = 0;

  constructor(
    public extraction: ExtractionOutput = DEFAULT_EXTRACTION,
    public coachingQueue: CoachingOutput[] = [],
    public defaultCoaching: CoachingOutput = DEFAULT_GOOD_COACHING,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    this.extractCalls++;
    return { ...this.extraction, rawTranscript: input.transcript };
  }

  async generateCoachingCue(input: CoachingInput): Promise<CoachingOutput> {
    this.coachingCalls++;
    this.lastStrict = input.strict === true;
    if (input.strict) this.strictCallCount++;
    const next = this.coachingQueue.shift();
    return next ?? this.defaultCoaching;
  }
}
