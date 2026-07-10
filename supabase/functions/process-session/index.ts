// Flowlog pipeline — server-side runtime (Supabase Edge Function, Deno).
//
// This is the production home of the pipeline. The client uploads audio to
// Storage and calls this function; all secrets (GEMINI_API_KEY, or
// OPENAI/ANTHROPIC) live here in the function environment and never reach the
// client bundle. Mirrors the orchestration in `src/pipeline/FlowlogPipeline.ts`.
//
// Deliberately uses raw `fetch` (via `_shared/supabaseRest.ts`) instead of
// `@supabase/supabase-js` so the function has ZERO remote imports and bundles
// with no network access — `supabase functions deploy` then works even behind a
// proxy that TLS-intercepts esm.sh / deno.land.
//
// Deploy:   supabase functions deploy process-session
// Secrets:  supabase secrets set GEMINI_API_KEY=... TRANSCRIPTION_PROVIDER=gemini AI_PROVIDER=gemini
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
//  automatically by the platform.)

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getSportContext } from '../_shared/sports.ts';
import { extract, generateCoaching, transcribe } from '../_shared/ai.ts';
import { enforce } from '../_shared/quality-gate.ts';
import {
  dbInsert,
  dbSelect,
  dbUpsert,
  downloadAudio,
  getUserFromJwt,
} from '../_shared/supabaseRest.ts';
import { computeTrendUpdate } from '../_shared/trends.ts';
import type {
  PipelineOutput,
  ProcessingStep,
  ProcessRequest,
} from '../_shared/types.ts';

const PIPELINE_VERSION = '1.0.0';
const COACHING_CUE_MAX_WORDS = 25;
const QUALITY_GATE_RETRY_LIMIT = 2;
const RECENT_MISTAKES_WINDOW = 5;
const AUDIO_BUCKET = 'session-audio';

const STEPS: ProcessingStep[] = [
  { name: 'context', label: 'Getting set up', status: 'done' },
  { name: 'transcription', label: 'Transcribing your reflection', status: 'done' },
  { name: 'extraction', label: 'Reviewing what happened', status: 'done' },
  { name: 'coaching', label: 'Finding your cue', status: 'done' },
  { name: 'quality_gate', label: 'Polishing the cue', status: 'done' },
  { name: 'persistence', label: 'Saving your session', status: 'done' },
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── Auth: derive the user from their JWT; never trust a client userId. ──
    const jwt = (req.headers.get('Authorization') ?? '').replace(
      /^Bearer\s+/i,
      '',
    );
    const user = jwt ? await getUserFromJwt(jwt) : null;
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = (await req.json()) as ProcessRequest;
    const { audioStoragePath, sportKey, skillLevel, sessionDate } = body;
    if (!audioStoragePath || !sportKey) {
      return jsonResponse(
        { error: 'audioStoragePath and sportKey are required' },
        400,
      );
    }
    // The path is `{userId}/...`; ensure the caller owns it.
    if (!audioStoragePath.startsWith(`${user.id}/`)) {
      return jsonResponse({ error: 'Forbidden audio path' }, 403);
    }

    // ── Stage 0: sport context ──────────────────────────────────────────────
    const sport = getSportContext(sportKey);

    // ── Stage 1: transcription (download audio, then provider) ──────────────
    const audioBlob = await downloadAudio(AUDIO_BUCKET, audioStoragePath);
    if (!audioBlob) {
      return jsonResponse(
        { error: 'Could not download audio (bucket/policy missing?)' },
        400,
      );
    }
    if (audioBlob.size === 0) {
      // Historically caused by the React Native blob-upload pitfall (0-byte
      // uploads that look successful). Fail with a clear message instead of
      // letting an LLM "transcribe" silence into fabricated text.
      return jsonResponse(
        { error: 'Uploaded audio was empty (0 bytes) — the recording upload from the device failed. Please try recording again.' },
        422,
      );
    }
    const transcription = await transcribe(audioBlob, sport.vocabulary);
    if (
      transcription.durationSeconds > 0 &&
      transcription.durationSeconds < sport.minRecordingSeconds
    ) {
      return jsonResponse(
        {
          error: `Recording too short (${transcription.durationSeconds.toFixed(
            0,
          )}s, min ${sport.minRecordingSeconds}s).`,
        },
        422,
      );
    }

    // ── Stage 2a: extraction ────────────────────────────────────────────────
    const extraction = await extract(
      transcription.transcript,
      sport,
      skillLevel,
    );

    // History for coaching (best-effort).
    const { recentMistakes, dominantWeakness } = await loadHistory(
      user.id,
      sportKey,
    );

    // ── Stage 2b: coaching ──────────────────────────────────────────────────
    const initialCoaching = await generateCoaching(
      extraction,
      sport,
      recentMistakes,
      skillLevel,
      dominantWeakness,
      COACHING_CUE_MAX_WORDS,
      false,
    );

    // ── Stage 3: quality gate (stricter retries, safe fallback) ─────────────
    const gate = await enforce(
      initialCoaching,
      sport,
      COACHING_CUE_MAX_WORDS,
      QUALITY_GATE_RETRY_LIMIT,
      (strict) =>
        generateCoaching(
          extraction,
          sport,
          recentMistakes,
          skillLevel,
          dominantWeakness,
          COACHING_CUE_MAX_WORDS,
          strict,
        ),
    );

    // ── Stage 4: persistence ────────────────────────────────────────────────
    const session = await dbInsert('sessions', {
      user_id: user.id,
      sport_key: sportKey,
      session_date: sessionDate ?? new Date().toISOString(),
      audio_storage_path: audioStoragePath,
      raw_transcript: transcription.transcript,
      positions_visited: extraction.positionsVisited,
      key_mistake: extraction.keyMistake,
      opponent_action: extraction.opponentAction,
      sentiment: extraction.sentiment,
      coaching_cue: gate.coaching.cue,
      target_position: gate.coaching.targetPosition,
      quality_gate_passed: gate.passed,
      pipeline_version: PIPELINE_VERSION,
    });

    // Recompute trends so the NEXT session's coaching is trend-aware
    // (best-effort — never fail the request over this).
    await updateUserTrends(user.id, sportKey);

    const output: PipelineOutput = {
      sessionId: session.id,
      structuredSummary: buildSummary(extraction, sport.sessionUnit),
      coachingCue: gate.coaching.cue,
      targetPosition: gate.coaching.targetPosition,
      sentiment: extraction.sentiment,
      qualityGatePassed: gate.passed,
      processingSteps: STEPS,
    };
    return jsonResponse(output, 200);
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message ?? 'Pipeline failed' },
      500,
    );
  }
});

async function updateUserTrends(
  userId: string,
  sportKey: string,
): Promise<void> {
  try {
    const rows = await dbSelect(
      `sessions?select=positions_visited,key_mistake,session_date` +
        `&user_id=eq.${userId}&sport_key=eq.${sportKey}` +
        `&order=session_date.desc&limit=200`,
    );
    const trend = computeTrendUpdate(rows);
    await dbUpsert('user_trends', {
      user_id: userId,
      sport_key: sportKey,
      dominant_weakness: trend.dominant_weakness,
      positions_struggled: trend.positions_struggled,
      session_count: trend.session_count,
      streak_days: trend.streak_days,
      last_session_at: trend.last_session_at,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('updateUserTrends failed (non-fatal):', err);
  }
}

async function loadHistory(userId: string, sportKey: string) {
  try {
    const [mistakes, trends] = await Promise.all([
      dbSelect(
        `sessions?select=key_mistake&user_id=eq.${userId}` +
          `&key_mistake=not.is.null&order=session_date.desc&limit=${RECENT_MISTAKES_WINDOW}`,
      ),
      dbSelect(
        `user_trends?select=dominant_weakness&user_id=eq.${userId}` +
          `&sport_key=eq.${sportKey}&limit=1`,
      ),
    ]);
    const recentMistakes = (mistakes ?? [])
      .map((r: { key_mistake: string | null }) => r.key_mistake)
      .filter((m: string | null): m is string => Boolean(m));
    return {
      recentMistakes,
      dominantWeakness: trends?.[0]?.dominant_weakness ?? null,
    };
  } catch {
    return { recentMistakes: [], dominantWeakness: null };
  }
}

function buildSummary(
  extraction: {
    positionsVisited: string[];
    keyMistake: string;
    opponentAction: string;
    sentiment: string;
  },
  sessionUnit: string,
): string {
  const positions =
    extraction.positionsVisited.length > 0
      ? extraction.positionsVisited.join(', ')
      : 'none noted';
  return [
    `Positions this ${sessionUnit}: ${positions}.`,
    `Key mistake: ${extraction.keyMistake || 'none identified'}.`,
    `Opponent/challenge: ${extraction.opponentAction || 'n/a'}.`,
    `Mood: ${extraction.sentiment}.`,
  ].join(' ');
}
