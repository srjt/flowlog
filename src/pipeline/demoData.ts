import { STEP_LABELS, STEP_ORDER } from '@/constants/pipelineSteps';
import type { PipelineOutput, ProcessingStep } from '@/types/pipeline';
import type { Session } from '@/types/session';
import type { SportKey } from '@/types/sport';

/**
 * Canned data for DEMO_MODE — lets the whole Record → Processing → Output → Log
 * flow run entirely offline (no audio upload, no edge function, no API keys).
 * Purely for prototyping the UX; never used when DEMO_MODE is off.
 */

interface DemoResult {
  coachingCue: string;
  targetPosition: string;
  sentiment: string;
  summary: string;
}

const DEMO_RESULTS: Record<SportKey, DemoResult[]> = {
  bjj: [
    {
      coachingCue:
        'From turtle, glue your chin to your chest and trap one wrist before standing — deny the seatbelt grip.',
      targetPosition: 'Turtle',
      sentiment: 'flat',
      summary:
        'Positions this roll: Turtle, Back Control. Key mistake: exposed neck while turtled, conceding back control. Opponent/challenge: attacked the back the moment you turned away. Mood: flat.',
    },
    {
      coachingCue:
        'In half guard, frame on the cross-face and recover your knee shield before they flatten your hips.',
      targetPosition: 'Half Guard',
      sentiment: 'encouraged',
      summary:
        'Positions this roll: Half Guard, Side Control. Key mistake: let your hips get flattened under cross-face pressure. Opponent/challenge: heavy top pressure and a strong under-hook. Mood: encouraged.',
    },
    {
      coachingCue:
        'Off the closed guard break, re-grip the collar and hip-escape to angle before they start the knee slice.',
      targetPosition: 'Closed Guard',
      sentiment: 'breakthrough',
      summary:
        'Positions this roll: Closed Guard, Knee Slice. Key mistake: stayed square as the pass started. Opponent/challenge: fast knee-slice pressure passing. Mood: breakthrough.',
    },
  ],
  golf: [
    {
      coachingCue:
        'On mid-irons, finish your weight onto the lead side — stop hanging back through impact.',
      targetPosition: 'Approach',
      sentiment: 'neutral',
      summary:
        'Situations this round: approach shots, mid-irons. Key mistake: weight hanging back at impact. Mood: neutral.',
    },
  ],
  tennis: [],
  climbing: [],
  chess: [],
};

let demoCounter = 0;

/** Build a canned PipelineOutput for the given sport (cycles through variants). */
export function buildDemoOutput(sportKey: SportKey): PipelineOutput {
  const variants = DEMO_RESULTS[sportKey] ?? DEMO_RESULTS.bjj;
  const pick = variants.length > 0 ? variants[demoCounter % variants.length] : null;
  demoCounter += 1;

  const result: DemoResult = pick ?? {
    coachingCue:
      'Pick one mechanical detail to drill next session and rep it slowly until it is automatic.',
    targetPosition: 'general',
    sentiment: 'neutral',
    summary: 'Demo session — canned result.',
  };

  return {
    sessionId: `demo-${Date.now()}`,
    structuredSummary: result.summary,
    coachingCue: result.coachingCue,
    targetPosition: result.targetPosition,
    sentiment: result.sentiment,
    qualityGatePassed: true,
    processingSteps: STEP_ORDER.map(
      (name): ProcessingStep => ({
        name,
        label: STEP_LABELS[name],
        status: 'done',
      }),
    ),
  };
}

/** Turn a freshly-produced demo PipelineOutput into a Session for the Log. */
export function demoSessionFromOutput(
  userId: string,
  sportKey: SportKey,
  output: PipelineOutput,
): Session {
  const nowIso = new Date().toISOString();
  return {
    id: output.sessionId,
    userId,
    sportKey,
    sessionDate: nowIso,
    audioStoragePath: null,
    rawTranscript: null,
    positionsVisited: [],
    keyMistake: null,
    opponentAction: null,
    sentiment: output.sentiment,
    coachingCue: output.coachingCue,
    targetPosition: output.targetPosition,
    qualityGatePassed: output.qualityGatePassed,
    thumbsUp: null,
    pipelineVersion: 'demo',
    createdAt: nowIso,
  };
}

/** A few realistic past sessions so the Log screen isn't empty in demo mode. */
export function buildDemoHistory(userId: string, sportKey: SportKey): Session[] {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const seed: Array<Partial<Session> & { coaching_cue?: string }> = [
    {
      keyMistake: 'Gave up the back from turtle by turning in.',
      coachingCue:
        'Stay chest-down in turtle; hide your far arm and wait for the re-pummel.',
      targetPosition: 'Turtle',
      sentiment: 'flat',
    },
    {
      keyMistake: 'Passed too upright and got swept.',
      coachingCue:
        'Keep your lead knee pinned to the mat during the knee slice; kill the hook first.',
      targetPosition: 'Knee Slice',
      sentiment: 'encouraged',
    },
    {
      keyMistake: 'Lost the under-hook battle in the scramble.',
      coachingCue:
        'Win the inside tie first — pummel to double-unders before you change levels.',
      targetPosition: 'Scramble',
      sentiment: 'neutral',
    },
  ];

  return seed.map((s, i) => ({
    id: `demo-history-${i}`,
    userId,
    sportKey,
    sessionDate: new Date(now - (i + 1) * day).toISOString(),
    audioStoragePath: null,
    rawTranscript: null,
    positionsVisited: [],
    keyMistake: s.keyMistake ?? null,
    opponentAction: null,
    sentiment: s.sentiment ?? null,
    coachingCue: s.coachingCue ?? null,
    targetPosition: s.targetPosition ?? null,
    qualityGatePassed: true,
    thumbsUp: null,
    pipelineVersion: 'demo',
    createdAt: new Date(now - (i + 1) * day).toISOString(),
  }));
}
