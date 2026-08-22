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
