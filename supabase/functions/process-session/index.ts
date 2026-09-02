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
import {
  candidatePositions,
  rankRecords,
} from '../../../src/sports/grounding.ts';
import {
  filterByGiContext,
  resolveGiContext,
} from '../../../src/sports/giContext.ts';
import { assignGrounding } from '../../../src/sports/experiment.ts';
import { extract, generateCoaching, transcribe } from '../_shared/ai.ts';
import { enforce } from '../_shared/quality-gate.ts';
import {
  dbInsert,
  dbSelect,
  dbUpdate,
  dbUpsert,
  downloadAudio,
  getUserFromJwt,
} from '../_shared/supabaseRest.ts';
import { computeTrendUpdate } from '../_shared/trends.ts';
import type {
  CoachingRecord,
  PipelineOutput,
  ProcessRequest,
  ProcessingStep,
} from '../_shared/types.ts';

const PIPELINE_VERSION = '1.0.0';
const COACHING_CUE_MAX_WORDS = 25;
const QUALITY_GATE_RETRY_LIMIT = 2;
const RECENT_MISTAKES_WINDOW = 5;
const AUDIO_BUCKET = 'session-audio';
// Abuse cap (UTC day), not a UX quota — one runaway client must not drain
// the transcription/AI budget. Generous vs. real usage (~1-3 sessions/day).
const DAILY_SESSION_LIMIT = 15;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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

  // Breadcrumb for the catch block: which stage was in flight when it broke.
  let stage = 'auth';
  let userId: string | null = null;
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
    userId = user.id;

    stage = 'validate';
    const body = (await req.json()) as ProcessRequest;
    const { sportKey, skillLevel, sessionDate } = body;
    // Attire is asked, never inferred: 78% of baseline transcripts never say
    // which it was (#43).
    const gi = body.gi === 'gi' || body.gi === 'no-gi' ? body.gi : null;
    if (!sportKey) {
      return jsonResponse({ error: 'sportKey is required' }, 400);
    }

    // ── Re-analysis: regenerate an existing session's cue from a user-corrected
    //    transcript and UPDATE that row in place. No audio, no transcription,
    //    no new session — so it skips idempotency and the daily cap. ──
    const reanalyzeSessionId =
      typeof body.reanalyzeSessionId === 'string' &&
      UUID_RE.test(body.reanalyzeSessionId)
        ? body.reanalyzeSessionId.toLowerCase()
        : null;
    if (reanalyzeSessionId) {
      stage = 'reanalyze';
      const edited =
        typeof body.editedTranscript === 'string'
          ? body.editedTranscript.trim()
          : '';
      if (!edited) {
        return jsonResponse({ error: 'Transcript is empty.' }, 400);
      }
      const editedTranscript = edited.slice(0, 5000);

      // Ownership: the row must exist AND belong to the caller.
      const owned = await dbSelect(
        `sessions?select=*&id=eq.${reanalyzeSessionId}` +
          `&user_id=eq.${user.id}&limit=1`,
      );
      const existing = owned?.[0];
      if (!existing) {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      const sport = getSportContext(existing.sport_key);

      const extraction = await extract(editedTranscript, sport, skillLevel);

      // A corrected transcript can still have nothing coachable in it
      // (issue #44) — decline here too rather than inventing on re-analysis.
      if (!extraction.hasCoachableContent) {
        stage = 'reanalyze_persist';
        const declined = await dbUpdate(
          `sessions?id=eq.${reanalyzeSessionId}&user_id=eq.${user.id}`,
          {
            raw_transcript: editedTranscript,
            positions_visited: extraction.positionsVisited,
            key_mistake: extraction.keyMistake,
            opponent_action: extraction.opponentAction,
            sentiment: extraction.sentiment,
            coaching_cue: null,
            target_position: null,
            target_position_id: null,
            quality_gate_passed: false,
            pipeline_version: PIPELINE_VERSION,
          },
        );
        await updateUserTrends(user.id, existing.sport_key);
        return jsonResponse(
          {
            ...outputFromRow(declined ?? existing, sport),
            declined: true,
            declinedReason: extraction.insufficientReason,
          },
          200,
        );
      }

      const { recentMistakes, dominantWeakness } = await loadHistory(
        user.id,
        existing.sport_key,
      );
      // Re-analysis regenerates the cue, so it needs the same grounding the
      // original run had — otherwise correcting a transcript would quietly
      // downgrade the cue from grounded to not.
      const reGrounding = rankRecords(
        filterByGiContext(
          await loadGroundingRecords(
            existing.sport_key,
            candidatePositions(extraction),
          ),
          // The context settled at capture time; re-analysis must not
          // re-decide it, or correcting a typo could swap the record set.
          existing.gi === 'gi' || existing.gi === 'no-gi' ? existing.gi : null,
        ),
        extraction.keyMistake,
        undefined,
        undefined,
        // Same ranking as the original run, for the same reason: re-analysis
        // must not quietly change which records ground the cue.
        sport.vocabulary,
      );
      const initialCoaching = await generateCoaching(
        extraction,
        sport,
        recentMistakes,
        skillLevel,
        dominantWeakness,
        COACHING_CUE_MAX_WORDS,
        false,
        reGrounding,
      );
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
            reGrounding,
          ),
      );

      stage = 'reanalyze_persist';
      const reMatch = sport.normalizePosition(
        gate.coaching.targetPosition,
        [extraction.keyMistake, extraction.opponentAction, editedTranscript]
          .filter(Boolean)
          .join(' '),
        extraction.perspective,
      );
      const reResolved = { id: reMatch.id, label: reMatch.id ? reMatch.label : null };
      const updated = await dbUpdate(
        `sessions?id=eq.${reanalyzeSessionId}&user_id=eq.${user.id}`,
        {
          raw_transcript: editedTranscript,
          positions_visited: extraction.positionsVisited,
          key_mistake: extraction.keyMistake,
          opponent_action: extraction.opponentAction,
          sentiment: extraction.sentiment,
          coaching_cue: gate.coaching.cue,
          target_position: reResolved.label ?? gate.coaching.targetPosition,
          target_position_id: reResolved.id,
          quality_gate_passed: gate.passed,
          pipeline_version: PIPELINE_VERSION,
        },
      );
      await updateUserTrends(user.id, existing.sport_key);
      return jsonResponse(outputFromRow(updated ?? existing, sport), 200);
    }

    // ── One-shot record flow: transcribe audio → analyze → insert. ──
    const { audioStoragePath } = body;
    if (!audioStoragePath) {
      return jsonResponse({ error: 'audioStoragePath is required' }, 400);
    }
    // The path is `{userId}/...`; ensure the caller owns it.
    if (!audioStoragePath.startsWith(`${user.id}/`)) {
      return jsonResponse({ error: 'Forbidden audio path' }, 403);
    }
    // Shape-validate BEFORE this ever reaches a PostgREST query string.
    const clientSessionId =
      typeof body.clientSessionId === 'string' &&
      UUID_RE.test(body.clientSessionId)
        ? body.clientSessionId.toLowerCase()
        : null;

    // ── Stage 0: sport context ──────────────────────────────────────────────
    const sport = getSportContext(sportKey);

    // ── Idempotency replay: a retry of an already-processed take returns the
    //    existing session instead of creating a second one. MUST run before
    //    the rate limit so retries never 429. Fail open on lookup errors —
    //    the partial unique index converts any race into the insert-conflict
    //    path below. ──
    stage = 'idempotency';
    if (clientSessionId) {
      try {
        const existing = await dbSelect(
          `sessions?select=*&user_id=eq.${user.id}` +
            `&client_session_id=eq.${clientSessionId}&limit=1`,
        );
        if (existing?.[0]) {
          return jsonResponse(outputFromRow(existing[0], sport), 200);
        }
      } catch (err) {
        console.error('idempotency lookup failed (fail-open):', err);
      }
    }

    // ── Per-user daily cap. Fail OPEN on query error — a monitoring blip
    //    must not block real users. ──
    stage = 'rate_limit';
    try {
      const today = new Date().toISOString().slice(0, 10);
      const todays = await dbSelect(
        `sessions?select=id&user_id=eq.${user.id}` +
          `&created_at=gte.${today}&limit=${DAILY_SESSION_LIMIT}`,
      );
      if ((todays?.length ?? 0) >= DAILY_SESSION_LIMIT) {
        return jsonResponse(
          {
            error: `Daily limit reached: up to ${DAILY_SESSION_LIMIT} sessions per day. Try again tomorrow.`,
          },
          429,
        );
      }
    } catch (err) {
      console.error('rate-limit check failed (fail-open):', err);
    }

    // ── Stage 1: transcription (vocabulary-primed) ──────────────────────────
    stage = 'transcription';
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
    stage = 'extraction';
    const extraction = await extract(
      transcription.transcript,
      sport,
      skillLevel,
    );

    // Resolve the cue's free-text target position onto the canonical
    // vocabulary (issue #47/#48) so later grounding has a stable key to join
    // on. The extraction's reported side is a hint, not the answer — a side
    // written into the label itself is more specific and wins.
    // Only adopt the canonical label when the position FULLY resolved — a
    // canonical-looking label must imply a canonical id.
    const resolvePosition = (targetPosition: string | null) => {
      const m = sport.normalizePosition(
        targetPosition,
        [extraction.keyMistake, extraction.opponentAction, transcription.transcript]
          .filter(Boolean)
          .join(' '),
        extraction.perspective,
      );
      return { id: m.id, label: m.id ? m.label : null };
    };

    // Shared insert for both the normal and the declined path — the
    // idempotency/conflict handling must be identical for each.
    const insertSession = async (analysis: {
      cue: string | null;
      targetPosition: string | null;
      targetPositionId: string | null;
      qualityGatePassed: boolean;
      grounding: string;
      groundingRecords: number;
      groundingAvailable: number;
      /** Records for the position before gi + relevance filtering (#58). */
      groundingCandidates: number | null;
    }): Promise<{ row: any } | { conflictOutput: Response }> => {
      try {
        const row = await dbInsert('sessions', {
          user_id: user.id,
          sport_key: sportKey,
          session_date: sessionDate ?? new Date().toISOString(),
          audio_storage_path: audioStoragePath,
          raw_transcript: transcription.transcript,
          positions_visited: extraction.positionsVisited,
          key_mistake: extraction.keyMistake,
          opponent_action: extraction.opponentAction,
          sentiment: extraction.sentiment,
          coaching_cue: analysis.cue,
          target_position: analysis.targetPosition,
          target_position_id: analysis.targetPositionId,
          quality_gate_passed: analysis.qualityGatePassed,
          grounding: analysis.grounding,
          grounding_records: analysis.groundingRecords,
          grounding_available: analysis.groundingAvailable,
          grounding_candidates: analysis.groundingCandidates,
          gi: giResolution.gi,
          gi_source: giResolution.source,
          pipeline_version: PIPELINE_VERSION,
          client_session_id: clientSessionId,
        });
        return { row };
      } catch (err) {
        // Two in-flight retries can race past the replay check; the partial
        // unique index turns the loser into a conflict — return the winner.
        const msg = String((err as Error).message ?? '');
        if (clientSessionId && /409|23505|duplicate/i.test(msg)) {
          const rows = await dbSelect(
            `sessions?select=*&user_id=eq.${user.id}` +
              `&client_session_id=eq.${clientSessionId}&limit=1`,
          );
          if (rows?.[0]) {
            return {
              conflictOutput: jsonResponse(outputFromRow(rows[0], sport), 200),
            };
          }
        }
        throw err;
      }
    };

    // ── Decline path (issue #44) ────────────────────────────────────────────
    // Nothing coachable in the recording. Skip coaching entirely rather than let
    // the model invent a cue from empty inputs — it will, fluently, and the
    // quality gate cannot tell. The Session is still inserted (null cue) so the
    // reflection and the user's streak survive; the client offers re-record.
    if (!extraction.hasCoachableContent) {
      stage = 'persistence';
      const declinedRow = await insertSession({
        cue: null,
        targetPosition: null,
        targetPositionId: null,
        qualityGatePassed: false,
        grounding: 'declined',
        groundingRecords: 0,
        groundingAvailable: 0,
        // Nothing was looked up, so this is not a corpus gap.
        groundingCandidates: null,
      });
      if ('conflictOutput' in declinedRow) return declinedRow.conflictOutput;
      await updateUserTrends(user.id, sportKey);
      return jsonResponse(
        {
          ...outputFromRow(declinedRow.row, sport),
          declined: true,
          declinedReason: extraction.insufficientReason,
        },
        200,
      );
    }

    // History for coaching (best-effort).
    const { recentMistakes, dominantWeakness } = await loadHistory(
      user.id,
      sportKey,
    );

    // Grounding runs BEFORE coaching, from the extraction — the coaching
    // stage's own targetPosition arrives too late to inform the cue it is part
    // of. Extraction already reports both the positions and the side.
    const groundingIds = candidatePositions(extraction);
    // Settle gi/no-gi first — it decides which records can apply at all. An
    // explicit statement in the recording beats a stale toggle (#60).
    const giResolution = resolveGiContext({
      toggle: gi,
      stated: extraction.statedGi === 'unknown' ? null : extraction.statedGi,
      transcript: extraction.rawTranscript,
    });
    if (giResolution.overrode) {
      console.log(
        `[flowlog] gi overridden by recording: toggle=${gi} -> ${giResolution.gi}`,
      );
    }
    // Filtered BEFORE ranking, so a record that cannot apply never occupies
    // one of the 20 slots and crowds out one that can.
    // Held separately from the filtered set: `no_records` must distinguish an
    // empty corpus (mine it) from records that existed and were filtered out
    // by gi context or the relevance gate (mining will not help) — #58.
    const candidateRecords = await loadGroundingRecords(sportKey, groundingIds);
    const relevantRecords = rankRecords(
      filterByGiContext(candidateRecords, giResolution.gi),
      extraction.keyMistake,
      undefined,
      undefined,
      // Domain terms outrank generic ones of equal rarity. Without this a
      // record matching "allowing" ties one matching "kimura".
      sport.vocabulary,
    );
    // Assigned only when records are actually available, so the control arm
    // means "had records, withheld them" — the counterfactual the comparison
    // needs. Keyed on the idempotency id so a retry cannot flip the arm.
    const groundingArm = assignGrounding(
      clientSessionId ?? `${user.id}:${sessionDate ?? ''}`,
      relevantRecords.length,
      { hasPosition: groundingIds.length > 0 },
    );
    const groundingRecords =
      groundingArm.outcome === 'grounded' ? relevantRecords : [];

    // ── Stage 2b: coaching ──────────────────────────────────────────────────
    stage = 'coaching';
    const initialCoaching = await generateCoaching(
      extraction,
      sport,
      recentMistakes,
      skillLevel,
      dominantWeakness,
      COACHING_CUE_MAX_WORDS,
      false,
      groundingRecords,
    );

    // ── Stage 3: quality gate (stricter retries, safe fallback) ─────────────
    stage = 'quality_gate';
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
          groundingRecords,
        ),
    );

    // ── Stage 4: persistence ────────────────────────────────────────────────
    stage = 'persistence';
    const resolved = resolvePosition(gate.coaching.targetPosition);
    const inserted = await insertSession({
      cue: gate.coaching.cue,
      targetPosition: resolved.label ?? gate.coaching.targetPosition,
      targetPositionId: resolved.id,
      qualityGatePassed: gate.passed,
      grounding: groundingArm.outcome,
      groundingRecords: groundingArm.inject,
      groundingAvailable: groundingArm.available,
      groundingCandidates: candidateRecords.length,
    });
    if ('conflictOutput' in inserted) return inserted.conflictOutput;
    const session = inserted.row;

    // Recompute trends so the NEXT session's coaching is trend-aware
    // (best-effort — never fail the request over this).
    await updateUserTrends(user.id, sportKey);

    const output: PipelineOutput = {
      sessionId: session.id,
      structuredSummary: buildSummary(extraction, sport.sessionUnit),
      coachingCue: gate.coaching.cue,
      targetPosition: resolved.label ?? gate.coaching.targetPosition,
      targetPositionId: resolved.id,
      sentiment: extraction.sentiment,
      qualityGatePassed: gate.passed,
      processingSteps: STEPS,
      declined: false,
      declinedReason: '',
    };
    return jsonResponse(output, 200);
  } catch (err) {
    // Make production failures visible: Dashboard → Edge Functions → Logs.
    console.error(
      `process-session failed [stage=${stage}] [user=${userId ?? 'unauth'}]:`,
      (err as Error)?.message,
      (err as Error)?.stack,
    );
    return jsonResponse(
      { error: (err as Error).message ?? 'Pipeline failed' },
      500,
    );
  }
});

/**
 * Rebuild the exact PipelineOutput wire shape from a persisted row, for the
 * idempotent-replay path (retry of a take that already produced a session).
 */
// deno-lint-ignore no-explicit-any
/**
 * Instructional records for the positions a session touched (#57).
 *
 * Read through the service role — the table's grants are revoked for clients
 * by design (#37). Never throws: grounding is enrichment, and failing a whole
 * session over reference data would be a far worse outcome than an ungrounded
 * cue, which the user cannot distinguish anyway.
 */
async function loadGroundingRecords(
  sportKey: string,
  positionIds: string[],
): Promise<CoachingRecord[]> {
  if (positionIds.length === 0) return [];
  try {
    const list = positionIds.map((p) => `"${p}"`).join(',');
    const rows = await dbSelect(
      `coaching_records?select=*&sport_key=eq.${encodeURIComponent(sportKey)}` +
        `&position=in.(${encodeURIComponent(list)})&limit=200`,
    );
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      position: r.position,
      prescription: r.prescription ?? '',
      why: r.why ?? '',
      detail: r.detail ?? '',
      counter: r.counter ?? '',
      gi: r.gi ?? 'either',
      level: r.level ?? 'any',
      opponent: r.opponent ?? '',
      certified: r.certified === true,
      contested: r.contested === true,
      rejected: r.rejected === true,
    }));
  } catch (err) {
    console.error('[flowlog] grounding lookup failed', err);
    return [];
  }
}

function outputFromRow(
  row: any,
  sport: { sessionUnit: string },
): PipelineOutput {
  return {
    sessionId: row.id,
    structuredSummary: buildSummary(
      {
        positionsVisited: row.positions_visited ?? [],
        keyMistake: row.key_mistake ?? '',
        opponentAction: row.opponent_action ?? '',
        sentiment: row.sentiment ?? 'neutral',
      },
      sport.sessionUnit,
    ),
    // A row with no cue is a declined take (issue #44) — never coerce it to an
    // empty string, or the client renders a blank cue card instead of the
    // honest empty state.
    coachingCue: row.coaching_cue ?? null,
    targetPosition: row.target_position ?? null,
    targetPositionId: row.target_position_id ?? null,
    sentiment: row.sentiment ?? 'neutral',
    qualityGatePassed: row.quality_gate_passed ?? false,
    declined: row.coaching_cue == null,
    declinedReason: '',
    processingSteps: STEPS,
  };
}

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
