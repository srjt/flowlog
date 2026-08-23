import { FlowlogPipeline } from '@/pipeline/FlowlogPipeline';
import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import { QualityGateService } from '@/services/QualityGateService';
import { TranscriptionService } from '@/services/TranscriptionService';
import { COST_ESTIMATES } from '@/constants/pipelineConfig';
import type { CoachingOutput, PipelineInput } from '@/types/pipeline';
import {
  MockAIProvider,
  MockStorageProvider,
  MockTranscriptionProvider,
} from '../mocks';

function buildPipeline(ai: MockAIProvider, storage: MockStorageProvider) {
  const transcriptionMock = new MockTranscriptionProvider();
  return {
    transcriptionMock,
    pipeline: new FlowlogPipeline({
      transcription: new TranscriptionService(transcriptionMock),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
    }),
  };
}

const input: PipelineInput = {
  audioUri: 'file://session.m4a',
  userId: 'user-1',
  sportKey: 'bjj',
  skillLevel: 'Blue Belt',
  sessionDate: new Date('2026-06-14T10:00:00.000Z'),
};

function goodCue(): CoachingOutput {
  return {
    cue: 'From turtle, trap a wrist and drive your shoulder into their hip before standing up.',
    targetPosition: 'Turtle',
    confidenceScore: 0.85,
    isGeneric: false,
  };
}

function badCue(): CoachingOutput {
  return {
    cue: 'just keep training and stay calm',
    targetPosition: 'general',
    confidenceScore: 0.3,
    isGeneric: true,
  };
}

/** Estimate per-session cost for the cost-regression guard. */
function estimateSessionCost(durationSeconds: number, coachingCalls: number) {
  return (
    (durationSeconds / 60) * COST_ESTIMATES.whisperPerMinute +
    COST_ESTIMATES.claudeExtractionPerCall +
    COST_ESTIMATES.claudeCoachingPerCall * coachingCalls
  );
}

describe('FlowlogPipeline — happy path', () => {
  it('runs all stages, persists the session, and returns structured output', async () => {
    const ai = new MockAIProvider(undefined, [goodCue()]);
    const storage = new MockStorageProvider();
    const { pipeline, transcriptionMock } = buildPipeline(ai, storage);

    const steps: number[] = [];
    const result = await pipeline.run(input, (s) =>
      steps.push(s.filter((x) => x.status === 'done').length),
    );

    expect(result.sessionId).toBe('session-1');
    expect(result.coachingCue).toBe(goodCue().cue);
    expect(result.qualityGatePassed).toBe(true);
    expect(result.sentiment).toBe('flat');
    expect(result.structuredSummary).toMatch(/roll/);

    // All six steps reported done.
    expect(result.processingSteps).toHaveLength(6);
    expect(result.processingSteps.every((s) => s.status === 'done')).toBe(true);
    // Progress was streamed.
    expect(steps.length).toBeGreaterThan(0);

    // Persisted exactly once with the right fields.
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0]?.qualityGatePassed).toBe(true);
    expect(storage.uploadedAudio).toHaveLength(1);

    // Cost guard.
    const cost = estimateSessionCost(
      transcriptionMock.result.durationSeconds,
      ai.coachingCalls,
    );
    expect(cost).toBeLessThan(COST_ESTIMATES.perSessionAlertThreshold);
  });
});

describe('FlowlogPipeline — quality gate', () => {
  it('retries on a bad cue and persists the fixed, passing cue', async () => {
    // First coaching call bad, strict retry good.
    const ai = new MockAIProvider(undefined, [badCue(), goodCue()]);
    const storage = new MockStorageProvider();
    const { pipeline } = buildPipeline(ai, storage);

    const result = await pipeline.run(input);

    expect(result.qualityGatePassed).toBe(true);
    expect(result.coachingCue).toBe(goodCue().cue);
    expect(ai.strictCallCount).toBeGreaterThanOrEqual(1);
    expect(storage.saved[0]?.coachingCue).toBe(goodCue().cue);
  });

  it('returns a safe fallback when every attempt fails — never crashes', async () => {
    const ai = new MockAIProvider(undefined, [], badCue());
    const storage = new MockStorageProvider();
    const { pipeline } = buildPipeline(ai, storage);

    const result = await pipeline.run(input);

    expect(result.qualityGatePassed).toBe(false);
    expect(result.declined).toBe(false);
    const cue = result.coachingCue ?? '';
    expect(cue.length).toBeGreaterThan(0);
    expect(cue.trim().split(/\s+/).length).toBeLessThanOrEqual(25);
    // Session still persisted, flagged as not passing the gate.
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0]?.qualityGatePassed).toBe(false);
  });
});

describe('FlowlogPipeline — resilience', () => {
  it('still saves the session when audio upload fails', async () => {
    const ai = new MockAIProvider(undefined, [goodCue()]);
    const storage = new MockStorageProvider();
    storage.failUpload = true;
    const { pipeline } = buildPipeline(ai, storage);

    const result = await pipeline.run(input);

    expect(result.sessionId).toBe('session-1');
    expect(storage.saved[0]?.audioStoragePath).toBeNull();
  });

  it('feeds recent mistakes and dominant weakness into coaching', async () => {
    const ai = new MockAIProvider(undefined, [goodCue()]);
    const storage = new MockStorageProvider();
    storage.recentMistakes = ['Passed guard too upright'];
    storage.trends = {
      userId: 'user-1',
      sportKey: 'bjj',
      dominantWeakness: 'Back exposure from turtle',
      positionsStruggled: {},
      sessionCount: 12,
      streakDays: 3,
      lastSessionAt: null,
      updatedAt: new Date().toISOString(),
    };
    const { pipeline } = buildPipeline(ai, storage);

    const result = await pipeline.run(input);
    expect(result.qualityGatePassed).toBe(true);
    expect(ai.coachingCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('FlowlogPipeline — reanalyze', () => {
  it('regenerates the cue from edited text and updates the session in place', async () => {
    const ai = new MockAIProvider(undefined, [goodCue()]);
    const storage = new MockStorageProvider();
    const { pipeline, transcriptionMock } = buildPipeline(ai, storage);

    const result = await pipeline.reanalyze({
      sessionId: 'existing-1',
      userId: 'user-1',
      sportKey: 'bjj',
      skillLevel: 'Blue Belt',
      editedTranscript: 'I kept getting stuck in turtle and gave up my back.',
    });

    // No transcription (edited text is analyzed directly) and no NEW session:
    // the existing row is updated in place.
    expect(transcriptionMock.calls).toHaveLength(0);
    expect(storage.saved).toHaveLength(0);
    expect(storage.updated).toHaveLength(1);
    expect(storage.updated[0]?.sessionId).toBe('existing-1');
    expect(storage.updated[0]?.update.rawTranscript).toContain('turtle');
    expect(result.sessionId).toBe('existing-1');
    expect(result.coachingCue).toBe(goodCue().cue);
  });

  it('rejects an empty edited transcript', async () => {
    const ai = new MockAIProvider(undefined, [goodCue()]);
    const storage = new MockStorageProvider();
    const { pipeline } = buildPipeline(ai, storage);

    await expect(
      pipeline.reanalyze({
        sessionId: 'existing-1',
        userId: 'user-1',
        sportKey: 'bjj',
        skillLevel: 'Blue Belt',
        editedTranscript: '   ',
      }),
    ).rejects.toThrow(/empty/i);
    expect(storage.updated).toHaveLength(0);
  });
});

// ── Decline path (issue #44) ─────────────────────────────────────────────────
// A transcript with nothing coachable in it must NOT produce a cue. Before this,
// coaching invented one from empty inputs and the quality gate passed it — 7 of
// 41 real baseline sessions were fabricated that way.
describe('FlowlogPipeline — declines an empty take', () => {
  function declinedPipeline(transcript: string, modelSaysCoachable = false) {
    const ai = new MockAIProvider(
      {
        positionsVisited: [],
        keyMistake: '',
        opponentAction: '',
        sentiment: 'neutral',
        hasCoachableContent: modelSaysCoachable,
        insufficientReason: modelSaysCoachable
          ? ''
          : 'no training was described',
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    const transcriptionMock = new MockTranscriptionProvider();
    transcriptionMock.result = {
      ...transcriptionMock.result,
      transcript,
    };
    return {
      ai,
      storage,
      pipeline: new FlowlogPipeline({
        transcription: new TranscriptionService(transcriptionMock),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
      }),
    };
  }

  it('never calls coaching when there is nothing to coach', async () => {
    const { ai, pipeline } = declinedPipeline(
      'I trained today and it was fine, felt pretty good about everything overall.',
    );

    const result = await pipeline.run(input);

    // The whole point: no cue was generated, so none could be invented.
    expect(ai.coachingCalls).toBe(0);
    expect(result.declined).toBe(true);
    expect(result.coachingCue).toBeNull();
    expect(result.targetPosition).toBeNull();
    expect(result.qualityGatePassed).toBe(false);
    expect(result.declinedReason).toBe('no training was described');
  });

  it('still saves the Session so the reflection and streak survive', async () => {
    const { storage, pipeline } = declinedPipeline(
      'Nothing much to report really, it was an alright sort of session today.',
    );

    const result = await pipeline.run(input);

    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0]?.coachingCue).toBeNull();
    expect(storage.saved[0]?.targetPosition).toBeNull();
    // The transcript is preserved — the reflection is not thrown away.
    expect(storage.saved[0]?.rawTranscript).toContain('Nothing much to report');
    expect(result.sessionId).toBeTruthy();
  });

  it('declines on the word-count backstop even when the model says otherwise', async () => {
    // The model's judgement can be fooled; the floor cannot be talked out of it.
    const { ai, pipeline } = declinedPipeline('Yeah', true);

    const result = await pipeline.run(input);

    expect(result.declined).toBe(true);
    expect(ai.coachingCalls).toBe(0);
    expect(result.declinedReason).toMatch(/too short/i);
  });

  it('does NOT decline a short but concrete reflection', async () => {
    // The failure mode a high word floor would cause: 11 words, clearly coachable.
    const { ai, pipeline } = declinedPipeline(
      'I kept getting stuck in turtle and gave up my back.',
      true,
    );

    const result = await pipeline.run(input);

    expect(result.declined).toBe(false);
    expect(ai.coachingCalls).toBeGreaterThan(0);
    expect(result.coachingCue).toBe(goodCue().cue);
  });

  it('declines on re-analysis too, clearing the old cue in place', async () => {
    const { ai, storage, pipeline } = declinedPipeline('unused');

    const result = await pipeline.reanalyze({
      sessionId: 'existing-1',
      userId: 'user-1',
      sportKey: 'bjj',
      skillLevel: 'Blue Belt',
      editedTranscript:
        'Actually I did not really train at all today, just watched.',
    });

    expect(ai.coachingCalls).toBe(0);
    expect(result.declined).toBe(true);
    expect(result.coachingCue).toBeNull();
    expect(storage.updated[0]?.update.coachingCue).toBeNull();
    expect(storage.updated[0]?.update.targetPosition).toBeNull();
  });
});

// ── Perspective and canonical position (issue #48) ──────────────────────────
// A cue is only groundable against instructional material if we know WHICH SIDE
// of the position it targets. Extraction reports it; the pipeline resolves the
// coaching stage's free-text label onto the canonical vocabulary.
describe('FlowlogPipeline — canonical target position', () => {
  function pipelineFor(
    perspective: 'top' | 'bottom' | 'unknown',
    targetPosition: string,
    transcript = 'He passed my guard and settled into side control on me for ages.',
  ) {
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Let him settle his chest before framing.',
        opponentAction: 'Held a strong crossface.',
        sentiment: 'frustrated',
        perspective,
      },
      [
        {
          cue: 'Frame on the far hip and shrimp before he consolidates the crossface.',
          targetPosition,
          confidenceScore: 0.85,
          isGeneric: false,
        },
      ],
    );
    const storage = new MockStorageProvider();
    const transcriptionMock = new MockTranscriptionProvider();
    transcriptionMock.result = { ...transcriptionMock.result, transcript };
    return {
      ai,
      storage,
      pipeline: new FlowlogPipeline({
        transcription: new TranscriptionService(transcriptionMock),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
      }),
    };
  }

  it('resolves a canonical id using the side extraction reported', async () => {
    const { storage, pipeline } = pipelineFor('bottom', 'Side Control');

    const result = await pipeline.run(input);

    expect(result.targetPositionId).toBe('side-control-bottom');
    expect(storage.saved[0]?.targetPositionId).toBe('side-control-bottom');
  });

  it('shows the user which side, not just the position', async () => {
    const { result } = {
      result: await pipelineFor('bottom', 'Side Control').pipeline.run(input),
    };
    expect(result.targetPosition).toBe('Side control (bottom)');
  });

  it('produces a different id for the same position on the other side', async () => {
    const { result } = {
      result: await pipelineFor(
        'top',
        'Side Control',
        'I held side control for most of the round and kept the crossface tight throughout.',
      ).pipeline.run(input),
    };
    expect(result.targetPositionId).toBe('side-control-top');
  });

  it('abstains rather than guessing when the side is unknown', async () => {
    // Transcript deliberately free of any positional cue.
    const { result } = {
      result: await pipelineFor(
        'unknown',
        'Side Control',
        'We drilled for a while and then did some situational rounds afterwards.',
      ).pipeline.run(input),
    };
    // No id — but the free-text label survives for display.
    expect(result.targetPositionId).toBeNull();
    expect(result.targetPosition).toBe('Side Control');
  });

  it('lets a side written into the label beat the reported one', async () => {
    // The label is the more specific signal; the hint must not override it.
    const { result } = {
      result: await pipelineFor('top', 'Side Control (bottom)').pipeline.run(
        input,
      ),
    };
    expect(result.targetPositionId).toBe('side-control-bottom');
  });

  it('stores no position id for a submission the model put in the field', async () => {
    // Real baseline sessions produced target_position values like this.
    const { result } = {
      result: await pipelineFor('bottom', 'Kimura submission').pipeline.run(
        input,
      ),
    };
    expect(result.targetPositionId).toBeNull();
    expect(result.targetPosition).toBe('Kimura submission');
  });

  it('clears the position id on a declined take', async () => {
    const { storage, pipeline } = pipelineFor('bottom', 'Side Control', 'Yeah');
    const result = await pipeline.run(input);
    expect(result.declined).toBe(true);
    expect(result.targetPositionId).toBeNull();
    expect(storage.saved[0]?.targetPositionId).toBeNull();
  });
});

// ── Grounding (issue #57) ───────────────────────────────────────────────────
// The repair: instructional records go in front of the model as it writes the
// cue, rather than the cue being written from the model's own recall.
describe('FlowlogPipeline — grounded coaching', () => {
  function record(position: string, prescription: string) {
    return {
      id: `rec-${position}-${prescription.slice(0, 6)}`,
      position,
      prescription,
      why: 'Because the frame has nowhere to go once the crossface lands.',
      detail: 'Forearm across the hip.',
      counter: '',
      gi: 'either',
      level: 'any',
      opponent: '',
      certified: false,
      contested: false,
    };
  }

  function build(
    records: ReturnType<typeof record>[],
    perspective: 'top' | 'bottom' | 'unknown' = 'bottom',
  ) {
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        sentiment: 'frustrated',
        perspective,
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = records;
    const transcriptionMock = new MockTranscriptionProvider();
    transcriptionMock.result = {
      ...transcriptionMock.result,
      transcript:
        'He passed and settled into side control on me, and I could not get my frame in before the crossface.',
    };
    return {
      ai,
      storage,
      pipeline: new FlowlogPipeline({
        transcription: new TranscriptionService(transcriptionMock),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
        // Pin the grounded arm — this suite tests injection, not the experiment.
        groundingRollout: 1,
      }),
    };
  }

  it('puts records for the session position in front of the model', async () => {
    const { ai, storage, pipeline } = build([
      record('side-control-bottom', 'Frame on the far hip before he settles.'),
    ]);

    await pipeline.run(input);

    expect(storage.coachingRecordQueries[0]?.positionIds).toEqual([
      'side-control-bottom',
    ]);
    // The records reached the coaching call, not just the lookup.
    expect(ai.lastCoachingInput?.groundingRecords).toHaveLength(1);
  });

  it('never sends top-side records to a bottom-side session', async () => {
    const { storage, pipeline } = build([
      record('side-control-bottom', 'Frame early.'),
      record('side-control-top', 'Keep your chest heavy.'),
    ]);

    await pipeline.run(input);

    const asked = storage.coachingRecordQueries[0]?.positionIds ?? [];
    expect(asked).toContain('side-control-bottom');
    expect(asked).not.toContain('side-control-top');
  });

  it('produces a cue exactly as before when nothing can be grounded', async () => {
    // Out-of-corpus degradation must be invisible: no error, no difference.
    const { ai, pipeline } = build([]);

    const result = await pipeline.run(input);

    expect(result.coachingCue).toBe(goodCue().cue);
    expect(result.declined).toBe(false);
    expect(ai.lastCoachingInput?.groundingRecords).toEqual([]);
  });

  it('still produces a cue when the record lookup fails outright', async () => {
    // Grounding is enrichment. Failing a whole session over reference data
    // would be a far worse outcome than an ungrounded cue.
    const { ai, storage, pipeline } = build([
      record('side-control-bottom', 'Frame early.'),
    ]);
    storage.getCoachingRecords = async () => {
      throw new Error('serving store unreachable');
    };

    const result = await pipeline.run(input);

    expect(result.coachingCue).toBe(goodCue().cue);
    expect(ai.lastCoachingInput?.groundingRecords).toEqual([]);
  });

  it('does not look up records when the side is unknown', async () => {
    const { storage, pipeline } = build(
      [record('side-control-bottom', 'Frame early.')],
      'unknown',
    );

    await pipeline.run(input);

    // No canonical id means nothing to ask for — and no guessing.
    expect(storage.coachingRecordQueries).toHaveLength(0);
  });

  it('grounds the strict retry too, not just the first attempt', async () => {
    // A retry on an ungrounded prompt is the "wrong cue -> different wrong cue"
    // loop the whole repair exists to break.
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        perspective: 'bottom',
      },
      [badCue(), goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = [
      record('side-control-bottom', 'Frame on the far hip before he settles.'),
    ];
    const pipeline = new FlowlogPipeline({
      transcription: new TranscriptionService(new MockTranscriptionProvider()),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
      groundingRollout: 1,
    });

    await pipeline.run(input);

    expect(ai.strictCallCount).toBeGreaterThan(0);
    expect(ai.lastCoachingInput?.groundingRecords).toHaveLength(1);
  });
});

// ── Grounding experiment (per-session A/B) ──────────────────────────────────
describe('FlowlogPipeline — grounded/withheld experiment', () => {
  function rec(position: string) {
    return {
      id: `r-${position}`,
      position,
      prescription: 'Frame against the crossface before he settles his chest.',
      why: 'Once the crossface lands the frame has nowhere to go.',
      detail: 'Forearm across the hip.',
      counter: '',
      gi: 'either',
      level: 'any',
      opponent: '',
      certified: false,
      contested: false,
    };
  }
  function build(records: ReturnType<typeof rec>[]) {
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame against the crossface before he settled.',
        opponentAction: 'Held a strong crossface.',
        perspective: 'bottom',
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = records;
    const t = new MockTranscriptionProvider();
    t.result = {
      ...t.result,
      transcript:
        'He settled into side control on me and I could not frame against the crossface.',
    };
    return {
      ai,
      storage,
      pipeline: new FlowlogPipeline({
        transcription: new TranscriptionService(t),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
      }),
    };
  }

  it('records an outcome on every saved session', async () => {
    const { storage, pipeline } = build([rec('side-control-bottom')]);
    await pipeline.run({ ...input, clientSessionId: 'fixed-key-1' });
    const saved = storage.saved[0];
    expect(['grounded', 'withheld']).toContain(saved?.grounding);
    expect(saved?.groundingAvailable).toBe(1);
  });

  it('puts the same session in the same arm across retries', async () => {
    // A timeout-then-retry that reassigned the arm would corrupt the result
    // and nothing downstream would notice.
    const a = build([rec('side-control-bottom')]);
    await a.pipeline.run({ ...input, clientSessionId: 'stable-key' });
    const b = build([rec('side-control-bottom')]);
    await b.pipeline.run({ ...input, clientSessionId: 'stable-key' });
    expect(a.storage.saved[0]?.grounding).toBe(b.storage.saved[0]?.grounding);
  });

  it('withholds records without injecting them, but remembers it could have', async () => {
    // The control arm has to be distinguishable from "never had records", or
    // the two arms are not comparable.
    const { ai, storage, pipeline } = build([rec('side-control-bottom')]);
    await pipeline.run({ ...input, clientSessionId: 'k' });
    const saved = storage.saved[0];
    if (saved?.grounding === 'withheld') {
      expect(saved.groundingRecords).toBe(0);
      expect(saved.groundingAvailable).toBeGreaterThan(0);
      expect(ai.lastCoachingInput?.groundingRecords).toEqual([]);
    } else {
      expect(saved?.groundingRecords).toBeGreaterThan(0);
      expect(ai.lastCoachingInput?.groundingRecords?.length).toBeGreaterThan(0);
    }
  });

  it('keeps sessions with no records out of the experiment', async () => {
    const { storage, pipeline } = build([]);
    await pipeline.run({ ...input, clientSessionId: 'no-records' });
    expect(storage.saved[0]?.grounding).toBe('no_records');
    expect(storage.saved[0]?.groundingAvailable).toBe(0);
  });

  it('marks a declined take as declined, not as an experiment arm', async () => {
    const ai = new MockAIProvider(
      {
        positionsVisited: [],
        keyMistake: '',
        opponentAction: '',
        hasCoachableContent: false,
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    const t = new MockTranscriptionProvider();
    t.result = { ...t.result, transcript: 'Yeah' };
    const pipeline = new FlowlogPipeline({
      transcription: new TranscriptionService(t),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
    });
    await pipeline.run(input);
    expect(storage.saved[0]?.grounding).toBe('declined');
  });
});
