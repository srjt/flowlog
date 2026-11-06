import { FlowlogPipeline } from '@/pipeline/FlowlogPipeline';
import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import { QualityGateService } from '@/services/QualityGateService';
import { TranscriptionService } from '@/services/TranscriptionService';
import { COST_ESTIMATES } from '@/constants/pipelineConfig';
import type { IStorageProvider } from '@/providers/storage/IStorageProvider';
import { LocalTestStorageProvider } from '@/providers/storage/LocalTestStorageProvider';
import type {
  CoachingOutput,
  ExtractionOutput,
  ExtractionPerspective,
  PipelineInput,
} from '@/types/pipeline';
import { DiagramSpecService } from '@/services/DiagramSpecService';
import { BJJ_BASE_LIBRARY_VERSION } from '@/sports/bjj/bjjDiagramBases';
import type { DiagramLibrary } from '@/visualization/diagramStage';
import { GRAMMAR_VERSION } from '@/visualization/grammar';
import { SPEC_PROMPT_VERSION } from '@/visualization/specStage';
import {
  MockAIProvider,
  MockStorageProvider,
  MockTranscriptionProvider,
} from '../mocks';
// UNCERTIFIED #18 seeds: test data only, never imported by anything that ships.
import { referenceSpec, seedBase } from '../fixtures/forceDiagram/seeds';

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
      rejected: false,
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
      rejected: false,
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

describe('FlowlogPipeline — gi/no-gi (#59)', () => {
  it('persists the attire captured on the take', async () => {
    const storage = new MockStorageProvider();
    const { pipeline } = buildPipeline(
      new MockAIProvider(undefined, [goodCue()]),
      storage,
    );

    await pipeline.run({ ...input, gi: 'no-gi' });

    expect(storage.saved[0]?.gi).toBe('no-gi');
  });

  it('stores null rather than guessing when the take carries no attire', async () => {
    const storage = new MockStorageProvider();
    const { pipeline } = buildPipeline(
      new MockAIProvider(undefined, [goodCue()]),
      storage,
    );

    await pipeline.run(input);

    // 78% of baseline transcripts never say which it was — inferring would be
    // a guess, and a wrong guess is worse than an absent one (#43).
    expect(storage.saved[0]?.gi).toBeNull();
  });
});

describe('FlowlogPipeline — gi filtering and override (#60)', () => {
  function giRecord(gi: string, prescription: string) {
    return {
      id: `rec-${gi}-${prescription.slice(0, 6)}`,
      position: 'side-control-bottom',
      prescription,
      why: 'Because the frame has nowhere to go once the crossface lands.',
      detail: 'Forearm across the hip.',
      counter: '',
      gi,
      level: 'any',
      opponent: '',
      certified: false,
      contested: false,
      rejected: false,
    };
  }

  function build(
    records: ReturnType<typeof giRecord>[],
    transcript: string,
    statedGi: 'gi' | 'no-gi' | 'unknown' = 'unknown',
  ) {
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        sentiment: 'frustrated',
        perspective: 'bottom',
        statedGi,
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = records;
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
        groundingRollout: 1,
      }),
    };
  }

  const NEUTRAL =
    'He passed and settled into side control on me, and I could not get my frame in before the crossface.';

  it('keeps a gi record out of a no-gi session', async () => {
    const { ai, pipeline } = build(
      [
        giRecord('gi', 'Grip the collar and frame off it before he settles.'),
        giRecord('either', 'Frame on the far hip before he settles.'),
      ],
      NEUTRAL,
    );

    await pipeline.run({ ...input, gi: 'no-gi' });

    const sent = ai.lastCoachingInput?.groundingRecords ?? [];
    expect(sent.map((r) => r.gi)).toEqual(['either']);
  });

  it('lets a gi record through for a gi session', async () => {
    const { ai, pipeline } = build(
      [giRecord('gi', 'Grip the collar and frame off it before he settles.')],
      NEUTRAL,
    );

    await pipeline.run({ ...input, gi: 'gi' });

    expect(ai.lastCoachingInput?.groundingRecords).toHaveLength(1);
  });

  it('excludes gi-specific records when nothing states the context', async () => {
    const { ai, pipeline } = build(
      [giRecord('gi', 'Grip the collar and frame off it before he settles.')],
      NEUTRAL,
    );

    await pipeline.run(input); // no toggle, no statement

    expect(ai.lastCoachingInput?.groundingRecords).toEqual([]);
  });

  it('an explicit statement overrides a stale toggle and is recorded as such', async () => {
    const { ai, storage, pipeline } = build(
      [
        giRecord('gi', 'Grip the collar and frame off it before he settles.'),
        giRecord('either', 'Frame on the far hip before he settles.'),
      ],
      `No-gi class today. ${NEUTRAL}`,
      'no-gi',
    );

    await pipeline.run({ ...input, gi: 'gi' });

    expect(ai.lastCoachingInput?.groundingRecords?.map((r) => r.gi)).toEqual([
      'either',
    ]);
    expect(storage.saved[0]?.gi).toBe('no-gi');
    expect(storage.saved[0]?.giSource).toBe('transcript');
  });

  it('an incidental grip word does not flip the context', async () => {
    // The model over-reports; the transcript never states the context. The
    // toggle must stand.
    const { ai, storage, pipeline } = build(
      [giRecord('gi', 'Grip the collar and frame off it before he settles.')],
      'He got a deep collar grip on me and I could not frame before the crossface.',
      'no-gi',
    );

    await pipeline.run({ ...input, gi: 'gi' });

    expect(ai.lastCoachingInput?.groundingRecords).toHaveLength(1);
    expect(storage.saved[0]?.gi).toBe('gi');
    expect(storage.saved[0]?.giSource).toBe('toggle');
  });

  it('records that there was no signal at all', async () => {
    const { storage, pipeline } = build([], NEUTRAL);

    await pipeline.run(input);

    expect(storage.saved[0]?.gi).toBeNull();
    expect(storage.saved[0]?.giSource).toBe('none');
  });
});

describe('FlowlogPipeline — mining backlog signal (#58)', () => {
  function build(records: { gi: string; prescription: string }[]) {
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        sentiment: 'frustrated',
        perspective: 'bottom',
        statedGi: 'unknown',
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = records.map((r, i) => ({
      id: `r${i}`,
      position: 'side-control-bottom',
      prescription: r.prescription,
      why: '',
      detail: '',
      counter: '',
      gi: r.gi,
      level: 'any',
      opponent: '',
      certified: false,
      contested: false,
      rejected: false,
    }));
    const t = new MockTranscriptionProvider();
    t.result = {
      ...t.result,
      transcript:
        'He passed and settled into side control on me, and I could not get my frame in before the crossface.',
    };
    return {
      storage,
      pipeline: new FlowlogPipeline({
        transcription: new TranscriptionService(t),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
        groundingRollout: 1,
      }),
    };
  }

  it('records zero candidates when the corpus is empty — a real mining gap', async () => {
    const { storage, pipeline } = build([]);
    await pipeline.run(input);
    expect(storage.saved[0]?.grounding).toBe('no_records');
    expect(storage.saved[0]?.groundingCandidates).toBe(0);
  });

  it('records the pre-filter count when records existed but were filtered out', async () => {
    // Two gi-only records, a no-gi session: nothing survives, but the corpus
    // is NOT empty. Filing this as a mining gap would send someone mining a
    // position that already has records.
    const { storage, pipeline } = build([
      {
        gi: 'gi',
        prescription: 'Grip the collar and frame before the crossface.',
      },
      {
        gi: 'gi',
        prescription: 'Use the lapel to frame before the crossface lands.',
      },
    ]);

    await pipeline.run({ ...input, gi: 'no-gi' });

    expect(storage.saved[0]?.grounding).toBe('no_records');
    expect(storage.saved[0]?.groundingCandidates).toBe(2);
  });
});

// ── Re-analysis grounds, and tells the truth about it (#117) ─────────────────
//
// This path used to skip grounding entirely: no records, no arm, nothing in the
// coaching prompt, and not one grounding column written — while the edge
// function's re-analysis DID ground. Two implementations building different
// prompts for the same session is the one thing `src/sports/grounding.ts` opens
// by forbidding, and `reanalyze`'s own docstring claimed it mirrored the server.
describe('FlowlogPipeline — reanalyze grounding provenance (#117)', () => {
  function rec(position: string, prescription: string) {
    return {
      id: `rec-${position}`,
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
      rejected: false,
    };
  }

  function groundedPipeline(rollout = 1) {
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        perspective: 'bottom',
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = [
      rec('side-control-bottom', 'Frame on the far hip before he settles.'),
    ];
    return {
      ai,
      storage,
      pipeline: new FlowlogPipeline({
        transcription: new TranscriptionService(
          new MockTranscriptionProvider(),
        ),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
        groundingRollout: rollout,
      }),
    };
  }

  const reanalyzeArgs = {
    sessionId: 'existing-1',
    userId: 'user-1',
    sportKey: 'bjj' as const,
    skillLevel: 'Blue Belt' as const,
    editedTranscript:
      'He passed to side control and I could not frame before the crossface landed.',
  };

  it('grounds the re-analysed cue instead of skipping grounding', async () => {
    const { ai, pipeline } = groundedPipeline();

    await pipeline.reanalyze({
      ...reanalyzeArgs,
      existingGrounding: 'grounded',
    });

    expect(ai.lastCoachingInput?.groundingRecords).toHaveLength(1);
  });

  it('writes the provenance for the records it actually used', async () => {
    const { storage, pipeline } = groundedPipeline();

    await pipeline.reanalyze({
      ...reanalyzeArgs,
      existingGrounding: 'grounded',
    });

    const { update } = storage.updated[0]!;
    expect(update.grounding).toBe('grounded');
    expect(update.groundingRecords).toBe(1);
    expect(update.groundingAvailable).toBe(1);
    // The ids of THIS run's records. Leaving the previous run's is what made
    // 018's `record_feedback_signal` credit a rating of the new cue to the
    // records behind the old one.
    expect(update.groundingRecordIds).toEqual(['rec-side-control-bottom']);
    expect(update.groundingCandidates).toBe(1);
  });

  // The arm is a fact on the row, not a new draw. Re-drawing could move a
  // session between arms — and the original key cannot be reconstructed.
  it('honours an inherited withheld arm and injects nothing', async () => {
    const { ai, storage, pipeline } = groundedPipeline(1);

    await pipeline.reanalyze({
      ...reanalyzeArgs,
      existingGrounding: 'withheld',
    });

    expect(ai.lastCoachingInput?.groundingRecords ?? []).toHaveLength(0);
    const { update } = storage.updated[0]!;
    expect(update.grounding).toBe('withheld');
    expect(update.groundingRecords).toBe(0);
    // Still recorded: without it the control arm is indistinguishable from a
    // session that never had records.
    expect(update.groundingAvailable).toBe(1);
    expect(update.groundingRecordIds).toEqual([]);
  });

  it('marks the row as re-analysed', async () => {
    const { storage, pipeline } = groundedPipeline();

    await pipeline.reanalyze({
      ...reanalyzeArgs,
      existingGrounding: 'grounded',
    });

    // The only marker that identifies a re-analysed row: pipelineVersion is
    // rewritten to whatever is current, so it cannot distinguish one.
    expect(storage.updated[0]?.update.reanalyzedAt).toEqual(expect.any(String));
  });
});

// ── The client records the gate count too (#119) ─────────────────────────────
describe('FlowlogPipeline — the relevance gate is measurable (#119)', () => {
  it('persists gate-passers before the cap, not the capped set', async () => {
    // 30 records all match the mistake; only GROUNDING_RECORD_LIMIT reach the
    // prompt. `groundingAvailable` therefore reads 20 and says nothing about
    // how selective the gate was — which is the whole bug.
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        perspective: 'bottom',
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.coachingRecords = Array.from({ length: 30 }, (_, i) => ({
      id: `r-${i}`,
      position: 'side-control-bottom',
      prescription: `Frame on the far hip before the crossface, variation ${i}`,
      why: 'Because the frame has nowhere to go once the crossface lands.',
      detail: 'Forearm across the hip.',
      counter: '',
      gi: 'either',
      level: 'any',
      opponent: '',
      certified: false,
      contested: false,
      rejected: false,
    }));
    const pipeline = new FlowlogPipeline({
      transcription: new TranscriptionService(new MockTranscriptionProvider()),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
      groundingRollout: 1,
    });

    await pipeline.run(input);

    const saved = storage.saved[0];
    expect(saved?.groundingCandidates).toBe(30);
    // Saturated at the limit — true, and useless for measuring the gate.
    expect(saved?.groundingAvailable).toBe(20);
    // The number that actually cleared the gate.
    expect(saved?.groundingGatePassed).toBe(30);
  });

  it('records unknown, not zero, when a lookup fails', async () => {
    // 0 would read as "the gate rejected everything", a finding about the
    // corpus. A lookup failure is not that.
    const ai = new MockAIProvider(
      {
        positionsVisited: ['Side Control'],
        keyMistake: 'Could not frame before the crossface landed.',
        opponentAction: 'Held a strong crossface.',
        perspective: 'bottom',
      },
      [goodCue()],
    );
    const storage = new MockStorageProvider();
    storage.getCoachingRecords = async () => {
      throw new Error('lookup exploded');
    };
    const pipeline = new FlowlogPipeline({
      transcription: new TranscriptionService(new MockTranscriptionProvider()),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
      groundingRollout: 1,
    });

    await pipeline.run(input);

    expect(storage.saved[0]?.groundingCandidates).toBeNull();
    expect(storage.saved[0]?.groundingGatePassed).toBeNull();
  });
});

// ── The Session keeps the side Extraction reported (#130) ───────────────────
// Without it a Session's Grounding cannot be replayed: side-dependent free text
// ("half guard") resolves to no canonical position. These assert what ends up
// on the row, on all four paths that write an Extraction.
describe('FlowlogPipeline — the Session records its perspective (#130)', () => {
  function sidePipeline(
    perspective: ExtractionPerspective,
    storage: IStorageProvider,
    coachable = true,
  ) {
    const ai = new MockAIProvider(
      {
        perspective,
        hasCoachableContent: coachable,
        insufficientReason: coachable ? '' : 'no training was described',
      },
      [goodCue()],
    );
    return new FlowlogPipeline({
      transcription: new TranscriptionService(new MockTranscriptionProvider()),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
    });
  }

  const edited = {
    sportKey: 'bjj' as const,
    skillLevel: 'Blue Belt' as const,
    editedTranscript:
      'He passed to side control and I could not frame before the crossface landed.',
  };

  // 'unknown' included: Extraction abstained on purpose, and that abstention
  // is a recorded finding, not a missing value.
  it.each<ExtractionPerspective>(['top', 'bottom', 'unknown'])(
    'saves the side Extraction reported: %s',
    async (side) => {
      const storage = new MockStorageProvider();
      await sidePipeline(side, storage).run(input);
      expect(storage.saved[0]?.perspective).toBe(side);
    },
  );

  it('saves it on a declined take too', async () => {
    const storage = new MockStorageProvider();
    const result = await sidePipeline('top', storage, false).run(input);
    expect(result.declined).toBe(true);
    expect(storage.saved[0]?.coachingCue).toBeNull();
    // No Cue, but still an Extraction — and it still says what side it read.
    expect(storage.saved[0]?.perspective).toBe('top');
  });

  it('never saves a side the column would reject', async () => {
    // A provider that reports 'neutral' (a property of a position, never of an
    // Extraction). The column's constraint rejects it, which would fail the
    // whole insert and lose the Session.
    const storage = new MockStorageProvider();
    await sidePipeline(
      'neutral' as unknown as ExtractionOutput['perspective'],
      storage,
    ).run(input);
    expect(storage.saved[0]?.perspective).toBe('unknown');
  });

  // Against a real store, so the assertion is on the row the second run left
  // behind rather than on what was sent.
  it('re-analysis overwrites it with the side of the edited transcript', async () => {
    const storage = new LocalTestStorageProvider();
    const userId = 'user-130-reanalysis';
    const first = await sidePipeline('bottom', storage).run({
      ...input,
      userId,
    });

    await sidePipeline('top', storage).reanalyze({
      ...edited,
      sessionId: first.sessionId,
      userId,
    });

    const [row] = await storage.listSessions(userId);
    expect(row?.id).toBe(first.sessionId);
    expect(row?.perspective).toBe('top');
  });

  it('a declined re-analysis overwrites it too', async () => {
    const storage = new LocalTestStorageProvider();
    const userId = 'user-130-declined-reanalysis';
    const first = await sidePipeline('bottom', storage).run({
      ...input,
      userId,
    });

    const result = await sidePipeline('unknown', storage, false).reanalyze({
      ...edited,
      sessionId: first.sessionId,
      userId,
    });

    expect(result.declined).toBe(true);
    const [row] = await storage.listSessions(userId);
    expect(row?.coachingCue).toBeNull();
    // The edited transcript's abstention, not the superseded 'bottom'.
    expect(row?.perspective).toBe('unknown');
  });
});

// ── The cue -> force-diagram spec stage (#135 phase b) ──────────────────────
// Best-effort, after the quality gate. These assert what ends up on the row,
// on all four Session writes, with an injected fixture base: the real BJJ
// library is empty until phase c, which the last block pins down.
describe('FlowlogPipeline — the cue diagram spec (#135)', () => {
  const DLR = 'de-la-riva-bottom';
  const FIXTURE: DiagramLibrary = {
    // Re-keyed by the canonical sided id, as phase c keys certified bases.
    bases: { [DLR]: { ...seedBase('de-la-riva'), id: DLR } },
    baseLibraryVersion: 'fixture-uncertified',
    specPersona: 'a test instructor',
  };
  const HOOK_CUE =
    'Drive your hooking heel into his hamstring before he steps forward.';
  const FOOT_CUE =
    'Plant your second foot on his hip and keep that leg long as he stands.';
  const dlrCue = (cue = HOOK_CUE): CoachingOutput => ({
    cue,
    targetPosition: 'De La Riva',
    confidenceScore: 0.85,
    isGeneric: false,
  });
  const specFor = (cueId: string) => ({
    specVersion: 1,
    base: DLR,
    annotations: referenceSpec('de-la-riva', cueId).annotations,
  });
  const PROVENANCE = {
    grammarVersion: GRAMMAR_VERSION,
    baseLibraryVersion: 'fixture-uncertified',
    specPromptVersion: SPEC_PROMPT_VERSION,
  };

  function diagramPipeline<S extends IStorageProvider = MockStorageProvider>(
    opts: {
      storage?: S;
      coachable?: boolean;
      coaching?: CoachingOutput[];
      fallback?: CoachingOutput;
      /** `null` uses the real sport context, as production does. */
      library?: DiagramLibrary | null;
    } = {},
  ) {
    const coachable = opts.coachable ?? true;
    const ai = new MockAIProvider(
      {
        positionsVisited: ['De La Riva'],
        keyMistake: 'My hook went slack and he stepped forward.',
        opponentAction: 'Stepped forward to pass.',
        perspective: 'bottom',
        hasCoachableContent: coachable,
        insufficientReason: coachable ? '' : 'no training was described',
      },
      opts.coaching ?? [dlrCue()],
      opts.fallback,
    );
    const storage = (opts.storage ?? new MockStorageProvider()) as S;
    const t = new MockTranscriptionProvider();
    t.result = {
      ...t.result,
      transcript:
        'I played De La Riva guard all round but my hook kept going slack and he stepped forward.',
    };
    const pipeline = new FlowlogPipeline({
      transcription: new TranscriptionService(t),
      extraction: new ExtractionService(ai),
      coaching: new CoachingService(ai),
      qualityGate: new QualityGateService(),
      storage,
      diagramSpec: new DiagramSpecService(ai),
      ...(opts.library !== null && { diagramLibrary: opts.library ?? FIXTURE }),
    });
    return { ai, storage, pipeline };
  }

  const edited = {
    sportKey: 'bjj' as const,
    skillLevel: 'Blue Belt' as const,
    editedTranscript:
      'I played De La Riva guard but my second foot came off his hip and he stood up.',
  };

  describe('the one-shot insert', () => {
    it('stores a valid spec with its versions and outcome spec', async () => {
      const { ai, storage, pipeline } = diagramPipeline();
      ai.diagramSpecResponse = JSON.stringify(specFor('heel-hamstring'));

      const result = await pipeline.run(input);

      const saved = storage.saved[0];
      expect(saved?.targetPositionId).toBe(DLR);
      expect(saved).toMatchObject({
        diagramOutcome: 'spec',
        diagramSpec: specFor('heel-hamstring'),
        ...PROVENANCE,
      });
      expect(ai.diagramSpecCalls).toBe(1);
      // About the Cue being saved, in the sport's voice.
      expect(ai.lastDiagramSpecInput?.prompt).toContain(
        `CUE: ${JSON.stringify(HOOK_CUE)}`,
      );
      expect(ai.lastDiagramSpecInput?.prompt).toMatch(
        /^You are a test instructor /,
      );
      expect(result.coachingCue).toBe(HOOK_CUE);
    });

    it('describes the Cue that passed the gate, not a rejected attempt', async () => {
      const { ai, storage, pipeline } = diagramPipeline({
        coaching: [badCue(), dlrCue()],
      });
      ai.diagramSpecResponse = specFor('heel-hamstring');

      await pipeline.run(input);

      expect(ai.strictCallCount).toBeGreaterThan(0);
      expect(ai.diagramSpecCalls).toBe(1);
      expect(ai.lastDiagramSpecInput?.prompt).toContain(HOOK_CUE);
      expect(ai.lastDiagramSpecInput?.prompt).not.toContain(badCue().cue);
      expect(storage.saved[0]?.diagramOutcome).toBe('spec');
    });

    it('records no_base and never calls the model when the position has no base', async () => {
      const { ai, storage, pipeline } = diagramPipeline({
        library: { ...FIXTURE, bases: {} },
      });
      ai.diagramSpecResponse = specFor('heel-hamstring');

      await pipeline.run(input);

      expect(ai.diagramSpecCalls).toBe(0);
      expect(storage.saved[0]).toMatchObject({
        targetPositionId: DLR,
        diagramOutcome: 'no_base',
        diagramSpec: null,
        grammarVersion: null,
        // Which library lacked it: the authoring backlog's key.
        baseLibraryVersion: 'fixture-uncertified',
        specPromptVersion: null,
      });
    });

    it('records no_base, and no call, when the position never resolved', async () => {
      // A submission in the position field: real sessions produced these.
      const { ai, storage, pipeline } = diagramPipeline({
        coaching: [{ ...dlrCue(), targetPosition: 'Kimura submission' }],
      });

      await pipeline.run(input);

      expect(storage.saved[0]?.targetPositionId).toBeNull();
      expect(storage.saved[0]?.diagramOutcome).toBe('no_base');
      expect(ai.diagramSpecCalls).toBe(0);
    });

    it('records invalid when the model answers garbage', async () => {
      const { ai, storage, pipeline } = diagramPipeline();
      ai.diagramSpecResponse = 'Sure! The heel pushes the leg.';

      const result = await pipeline.run(input);

      expect(storage.saved[0]).toMatchObject({
        diagramOutcome: 'invalid',
        diagramSpec: null,
        ...PROVENANCE,
      });
      expect(result.coachingCue).toBe(HOOK_CUE);
    });

    it('a provider that throws: unavailable, and the Session is saved with the same Cue', async () => {
      const { ai, storage, pipeline } = diagramPipeline();
      ai.diagramSpecError = new Error('spec service exploded');

      const result = await pipeline.run(input);

      expect(result.declined).toBe(false);
      expect(result.qualityGatePassed).toBe(true);
      expect(result.coachingCue).toBe(HOOK_CUE);
      expect(storage.saved).toHaveLength(1);
      expect(storage.saved[0]).toMatchObject({
        coachingCue: HOOK_CUE,
        qualityGatePassed: true,
        diagramOutcome: 'unavailable',
        diagramSpec: null,
        ...PROVENANCE,
      });
    });

    it('leaves the Cue exactly as it is without the stage', async () => {
      const withSpec = diagramPipeline();
      withSpec.ai.diagramSpecResponse = specFor('heel-hamstring');
      const without = diagramPipeline({ library: { ...FIXTURE, bases: {} } });

      const a = await withSpec.pipeline.run(input);
      const b = await without.pipeline.run(input);

      expect(withSpec.storage.saved[0]?.diagramOutcome).toBe('spec');
      expect(a.coachingCue).toBe(b.coachingCue);
      expect(a.targetPosition).toBe(b.targetPosition);
      expect(a.qualityGatePassed).toBe(b.qualityGatePassed);
      expect(withSpec.ai.coachingCalls).toBe(without.ai.coachingCalls);
      expect(withSpec.storage.saved[0]?.coachingCue).toBe(
        without.storage.saved[0]?.coachingCue,
      );
    });

    it('the gate fallback: not_attempted, no call', async () => {
      const { ai, storage, pipeline } = diagramPipeline({
        coaching: [],
        fallback: badCue(),
      });

      const result = await pipeline.run(input);

      expect(result.qualityGatePassed).toBe(false);
      expect(ai.diagramSpecCalls).toBe(0);
      expect(storage.saved[0]).toMatchObject({
        diagramOutcome: 'not_attempted',
        diagramSpec: null,
        grammarVersion: null,
        baseLibraryVersion: null,
        specPromptVersion: null,
      });
    });
  });

  it('the declined insert: not_attempted and a null spec, no call', async () => {
    const { ai, storage, pipeline } = diagramPipeline({ coachable: false });
    ai.diagramSpecResponse = specFor('heel-hamstring');

    const result = await pipeline.run(input);

    expect(result.declined).toBe(true);
    expect(ai.diagramSpecCalls).toBe(0);
    expect(storage.saved[0]).toMatchObject({
      coachingCue: null,
      diagramOutcome: 'not_attempted',
      diagramSpec: null,
      grammarVersion: null,
      baseLibraryVersion: null,
      specPromptVersion: null,
    });
  });

  // Against a real store, so the assertion is on the row the second run left
  // behind rather than on what was sent.
  describe('Re-analyze', () => {
    async function firstRun(userId: string) {
      const storage = new LocalTestStorageProvider();
      const first = diagramPipeline({ storage });
      first.ai.diagramSpecResponse = specFor('heel-hamstring');
      const { sessionId } = await first.pipeline.run({ ...input, userId });
      const [row] = await storage.listSessions(userId);
      expect(row?.diagramSpec).toEqual(specFor('heel-hamstring'));
      return { storage, sessionId };
    }

    it('regenerates the spec, because the Cue changed', async () => {
      const userId = 'user-135-reanalysis';
      const { storage, sessionId } = await firstRun(userId);
      const second = diagramPipeline({
        storage,
        coaching: [dlrCue(FOOT_CUE)],
      });
      second.ai.diagramSpecResponse = specFor('second-foot-hip');

      await second.pipeline.reanalyze({ ...edited, sessionId, userId });

      expect(second.ai.lastDiagramSpecInput?.prompt).toContain(FOOT_CUE);
      const [row] = await storage.listSessions(userId);
      expect(row).toMatchObject({
        id: sessionId,
        coachingCue: FOOT_CUE,
        diagramOutcome: 'spec',
        diagramSpec: specFor('second-foot-hip'),
        ...PROVENANCE,
      });
    });

    it('clears the old spec when the new Cue cannot be drawn', async () => {
      const userId = 'user-135-reanalysis-unavailable';
      const { storage, sessionId } = await firstRun(userId);
      const second = diagramPipeline({
        storage,
        coaching: [dlrCue(FOOT_CUE)],
      });
      second.ai.diagramSpecResponse = null;

      await second.pipeline.reanalyze({ ...edited, sessionId, userId });

      const [row] = await storage.listSessions(userId);
      expect(row?.diagramOutcome).toBe('unavailable');
      // Never the old Cue's spec beside the new Cue.
      expect(row?.diagramSpec).toBeNull();
    });

    it('a declined Re-analyze clears it to not_attempted', async () => {
      const userId = 'user-135-declined-reanalysis';
      const { storage, sessionId } = await firstRun(userId);
      const second = diagramPipeline({ storage, coachable: false });
      second.ai.diagramSpecResponse = specFor('heel-hamstring');

      const result = await second.pipeline.reanalyze({
        ...edited,
        sessionId,
        userId,
      });

      expect(result.declined).toBe(true);
      expect(second.ai.diagramSpecCalls).toBe(0);
      const [row] = await storage.listSessions(userId);
      expect(row).toMatchObject({
        coachingCue: null,
        diagramOutcome: 'not_attempted',
        diagramSpec: null,
        grammarVersion: null,
        baseLibraryVersion: null,
        specPromptVersion: null,
      });
    });
  });

  // Phase b's cost claim, on the real sport context: the BJJ library is empty,
  // so every Session records `no_base` and the model is never called. Phase c
  // changes this on purpose.
  describe('the production default', () => {
    it('records no_base and makes no call, even for a fully resolved Cue', async () => {
      const { ai, storage, pipeline } = diagramPipeline({ library: null });
      ai.diagramSpecResponse = specFor('heel-hamstring');

      await pipeline.run(input);

      expect(ai.diagramSpecCalls).toBe(0);
      expect(storage.saved[0]).toMatchObject({
        targetPositionId: DLR,
        diagramOutcome: 'no_base',
        diagramSpec: null,
        grammarVersion: null,
        baseLibraryVersion: BJJ_BASE_LIBRARY_VERSION,
        specPromptVersion: null,
      });
    });

    it('and the same on Re-analyze', async () => {
      const { ai, storage, pipeline } = diagramPipeline({ library: null });
      ai.diagramSpecResponse = specFor('heel-hamstring');

      await pipeline.reanalyze({
        ...edited,
        sessionId: 'existing-1',
        userId: 'user-1',
      });

      expect(ai.diagramSpecCalls).toBe(0);
      expect(storage.updated[0]?.update).toMatchObject({
        diagramOutcome: 'no_base',
        baseLibraryVersion: BJJ_BASE_LIBRARY_VERSION,
      });
    });

    it('a pipeline built with no diagram dependencies records it too', async () => {
      // How every existing suite, and the local test pipeline, construct it.
      const storage = new MockStorageProvider();
      const ai = new MockAIProvider({ perspective: 'bottom' }, [goodCue()]);
      const pipeline = new FlowlogPipeline({
        transcription: new TranscriptionService(
          new MockTranscriptionProvider(),
        ),
        extraction: new ExtractionService(ai),
        coaching: new CoachingService(ai),
        qualityGate: new QualityGateService(),
        storage,
      });

      await pipeline.run(input);

      expect(storage.saved[0]?.diagramOutcome).toBe('no_base');
      expect(ai.diagramSpecCalls).toBe(0);
    });
  });
});
