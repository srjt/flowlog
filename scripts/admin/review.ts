/**
 * The model behind the local cue review tool (docs/ADMIN.md).
 *
 * Import-free and erasable-syntax-only on purpose: server.ts imports it, jest
 * tests it, and the browser runs it — the server hands this same file to the
 * page with its types stripped. The filters that are tested are the filters
 * that get clicked; there is no second copy to drift.
 *
 * Nothing here decides anything about a Cue. It says what the stored columns
 * can and cannot vouch for, and it shapes and reads the operator's own
 * verdicts (#132, migration 026), which are an observation, never a gate.
 */

/** A Session or record id, as Postgres prints a uuid. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GroundingOutcome =
  | 'grounded'
  | 'withheld'
  | 'no_position'
  | 'no_records'
  | 'declined';

export const GROUNDING_OUTCOMES: GroundingOutcome[] = [
  'grounded',
  'withheld',
  'no_position',
  'no_records',
  'declined',
];

/** The `sessions` columns the tool reads. */
export interface SessionRow {
  id: string;
  user_id: string;
  session_date: string;
  audio_storage_path: string | null;
  raw_transcript: string | null;
  positions_visited: string[] | null;
  key_mistake: string | null;
  opponent_action: string | null;
  sentiment: string | null;
  coaching_cue: string | null;
  target_position: string | null;
  target_position_id: string | null;
  quality_gate_passed: boolean | null;
  thumbs_up: boolean | null;
  feedback_reason: string | null;
  feedback_note: string | null;
  pipeline_version: string | null;
  gi: string | null;
  /**
   * Migration 024: the side Extraction reported. NULL means not recorded (a
   * Session from before 024), never "Extraction could not tell"; that is
   * 'unknown'. Optional: absent until that migration is applied.
   */
  perspective?: 'top' | 'bottom' | 'unknown' | null;
  grounding: GroundingOutcome | null;
  grounding_candidates: number | null;
  /** Migration 022. Optional: absent until that migration is applied. */
  grounding_gate_passed?: number | null;
  grounding_available: number | null;
  grounding_records: number | null;
  grounding_record_ids: string[] | null;
  reanalyzed_at: string | null;
}

// ── What a pipeline version can vouch for ───────────────────────────────────

/**
 * Answers from the database's own predicates, fetched per distinct version:
 * `grounding_reached_model` (019) and `grounding_candidates_is_exact` (020).
 * Those boundaries are deliberately NOT re-typed here — the migrations say to
 * read them, not copy them.
 */
export interface VersionFacts {
  reachedModel: boolean;
  candidatesExact: boolean;
}

/** Unknown must never read as "it worked". */
export const UNKNOWN_VERSION_FACTS: VersionFacts = {
  reachedModel: false,
  candidatesExact: false,
};

export const versionKey = (version: string | null): string => version ?? '';

/**
 * Re-analysis started writing its own grounding provenance in this version
 * (migration 021). Unlike 019 and 020 there is no SQL predicate for it: 021
 * states the rule only in a column comment, so it is encoded once, here.
 */
export const REANALYSIS_PROVENANCE_SINCE = '1.3.0';

/** Negative, zero or positive like a comparator; null if either is unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const parts = v.split('.').map(Number);
    return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Unknown or unparseable versions count as before the boundary. */
function isBefore(version: string | null, boundary: string): boolean {
  if (version === null) return true;
  const cmp = compareVersions(version, boundary);
  return cmp === null || cmp < 0;
}

// ── Can the record list be trusted? ─────────────────────────────────────────

/**
 * Whether `grounding_record_ids` names the records behind the Cue this row
 * holds now.
 *
 *   trusted             these records went into this Cue's prompt
 *   none_selected       known: no records went in
 *   not_recorded        NULL ids — the row predates 018
 *   never_reached_model selected, but the 1.0.0 prompt never carried them (019)
 *   unverified          pre-1.3.0 with no re-analysis marker: if the session
 *                       was re-analysed, the ids describe an earlier Cue (021)
 */
export type RecordTrail =
  | 'trusted'
  | 'none_selected'
  | 'not_recorded'
  | 'never_reached_model'
  | 'unverified';

/** Every trail, in the order above. Migration 026 stores one per verdict. */
export const RECORD_TRAILS: RecordTrail[] = [
  'trusted',
  'none_selected',
  'not_recorded',
  'never_reached_model',
  'unverified',
];

export function recordTrail(row: SessionRow, facts: VersionFacts): RecordTrail {
  const ids = row.grounding_record_ids;
  if (ids === null) return 'not_recorded';
  if (ids.length > 0 && !facts.reachedModel) return 'never_reached_model';
  if (
    row.reanalyzed_at === null &&
    isBefore(row.pipeline_version, REANALYSIS_PROVENANCE_SINCE)
  ) {
    return 'unverified';
  }
  return ids.length === 0 ? 'none_selected' : 'trusted';
}

export const isTrustworthy = (trail: RecordTrail): boolean =>
  trail === 'trusted' || trail === 'none_selected';

// ── The list ────────────────────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  userId: string;
  athlete: string;
  sessionDate: string;
  cue: string | null;
  keyMistake: string | null;
  transcript: string | null;
  targetPositionId: string | null;
  targetPositionLabel: string | null;
  grounding: GroundingOutcome | null;
  gatePassed: boolean | null;
  thumbsUp: boolean | null;
  feedbackReason: string | null;
  trail: RecordTrail;
  reanalyzed: boolean;
  /**
   * The operator's verdict on the Cue this row holds NOW (#132). Null is
   * unjudged, never "fine". Kept apart from `thumbsUp`, the athlete's claim.
   */
  verdict: CueVerdict | null;
  verdictReason: WrongReason | null;
  /** Verdicts about a Cue this row no longer holds. Never shown as current. */
  earlierVerdicts: number;
  /**
   * Who wrote the Cue this row holds now (see `cueWriter`): a model name,
   * `GATE_FALLBACK`, or null when the Session predates the prompt log.
   */
  cueWriter: string | null;
  /**
   * AI second opinions on the Cue this row holds now (migration 027), one per
   * judge. Empty until the operator has judged that Cue: blind first.
   */
  ai: AiCall[];
  /** Opinions on the current Cue waiting behind the operator's verdict. */
  aiHidden: number;
}

export function toSummary(
  row: SessionRow,
  ctx: {
    athlete: string | null;
    positionLabel: string | null;
    facts: VersionFacts;
    /** This Session's rows from `cue_verdicts`, about any of its Cues. */
    verdicts: VerdictRow[];
    /** This Session's prompt-log attempts; absent when the log is unreadable. */
    promptAttempts?: PromptAttempt[];
    /** This Session's AI opinions, about any of its Cues; absent before 027. */
    opinions?: AiOpinionRow[];
  },
): SessionSummary {
  const summary: SessionSummary = {
    id: row.id,
    userId: row.user_id,
    athlete: ctx.athlete?.trim() || 'Unnamed athlete',
    sessionDate: row.session_date,
    cue: row.coaching_cue,
    keyMistake: row.key_mistake,
    transcript: row.raw_transcript,
    targetPositionId: row.target_position_id,
    targetPositionLabel: ctx.positionLabel ?? row.target_position,
    grounding: row.grounding,
    gatePassed: row.quality_gate_passed,
    thumbsUp: row.thumbs_up,
    feedbackReason: row.feedback_reason,
    trail: recordTrail(row, ctx.facts),
    reanalyzed: row.reanalyzed_at !== null,
    verdict: null,
    verdictReason: null,
    earlierVerdicts: 0,
    cueWriter: cueWriter(ctx.promptAttempts ?? []),
    ai: [],
    aiHidden: 0,
  };
  const judged = withVerdicts(summary, ctx.verdicts);
  return withOpinions(
    judged,
    revealOpinions(row.coaching_cue, judged.verdict !== null, ctx.opinions),
  );
}

/**
 * The summary with its verdict fields recomputed from this Session's verdicts.
 * The page calls it after recording one, so the list never needs a reload.
 */
export function withVerdicts(
  s: SessionSummary,
  verdicts: VerdictRow[],
): SessionSummary {
  const { current, earlier } = verdictsFor(s.cue, verdicts);
  return {
    ...s,
    verdict: current?.verdict ?? null,
    verdictReason: current?.reason ?? null,
    earlierVerdicts: earlier.length,
  };
}

export interface Filters {
  /** Case-insensitive; matches transcript, Cue or key mistake. */
  query: string;
  feedback: 'any' | 'up' | 'down' | 'none';
  /** Exact `feedback_reason`, or '' for any. */
  reason: string;
  /** 'coachable' is everything except declined takes, which have no Cue. */
  grounding: 'coachable' | 'all' | GroundingOutcome;
  /** Canonical target position id, or '' for any. */
  position: string;
  gate: 'any' | 'passed' | 'fell_back';
  /** Inclusive UTC calendar dates, 'YYYY-MM-DD', or '' for open-ended. */
  from: string;
  to: string;
  trail: 'any' | 'trustworthy' | 'untrustworthy';
  /** User id, or '' for any. */
  athlete: string;
  /**
   * The operator's verdict on the current Cue (#132). 'unjudged' is a Session
   * with a Cue and no verdict on it; 'earlier' has a verdict about a Cue it no
   * longer holds.
   */
  verdict: 'any' | 'unjudged' | 'judged' | CueVerdict | 'earlier';
  /** Exact reason of a wrong verdict, or '' for any. */
  verdictReason: WrongReason | '';
}

export const DEFAULT_FILTERS: Filters = {
  query: '',
  feedback: 'any',
  reason: '',
  grounding: 'coachable',
  position: '',
  gate: 'any',
  from: '',
  to: '',
  trail: 'any',
  athlete: '',
  verdict: 'any',
  verdictReason: '',
};

function matches(s: SessionSummary, f: Filters): boolean {
  const q = f.query.trim().toLowerCase();
  if (q) {
    const haystack = [s.transcript, s.cue, s.keyMistake]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (f.feedback === 'up' && s.thumbsUp !== true) return false;
  if (f.feedback === 'down' && s.thumbsUp !== false) return false;
  if (f.feedback === 'none' && s.thumbsUp !== null) return false;
  if (f.reason && s.feedbackReason !== f.reason) return false;

  if (f.grounding === 'coachable') {
    if (s.grounding === 'declined') return false;
  } else if (f.grounding !== 'all' && s.grounding !== f.grounding) {
    return false;
  }

  if (f.position && s.targetPositionId !== f.position) return false;

  if (f.gate === 'passed' && s.gatePassed !== true) return false;
  if (f.gate === 'fell_back' && s.gatePassed !== false) return false;

  const day = s.sessionDate.slice(0, 10);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;

  if (f.trail === 'trustworthy' && !isTrustworthy(s.trail)) return false;
  if (f.trail === 'untrustworthy' && isTrustworthy(s.trail)) return false;

  if (f.athlete && s.userId !== f.athlete) return false;

  if (f.verdict === 'unjudged' && (s.cue === null || s.verdict !== null)) {
    return false;
  }
  if (f.verdict === 'judged' && s.verdict === null) return false;
  if (f.verdict === 'earlier' && s.earlierVerdicts === 0) return false;
  if (isCueVerdict(f.verdict) && s.verdict !== f.verdict) return false;
  if (f.verdictReason && s.verdictReason !== f.verdictReason) return false;
  return true;
}

/** Matching sessions, newest first. */
export function filterSessions(
  sessions: SessionSummary[],
  filters: Filters,
): SessionSummary[] {
  return sessions
    .filter((s) => matches(s, filters))
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
}

// ── The detail ──────────────────────────────────────────────────────────────

/** The `coaching_records` columns the tool reads — never the source. */
export interface RecordRow {
  id: string;
  position: string;
  prescription: string;
  why: string | null;
  detail: string | null;
  counter: string | null;
  gi: string;
  level: string;
  opponent: string | null;
  certified: boolean;
  contested: boolean;
  rejected: boolean;
}

export interface VoteRow {
  record_id: string;
  verdict: string;
}

export type RecordStatus = 'rejected' | 'contested' | 'certified' | 'unsettled';

/** Same precedence the bench's notes script uses. */
export function recordStatus(r: RecordRow): RecordStatus {
  if (r.rejected) return 'rejected';
  if (r.contested) return 'contested';
  if (r.certified) return 'certified';
  return 'unsettled';
}

export interface InjectedRecord {
  /** 1-based, in the order the pipeline ranked them. */
  rank: number;
  id: string;
  /** Null when the id no longer exists in `coaching_records`. */
  record: RecordRow | null;
  status: RecordStatus | null;
  certifyVotes: number;
  rejectVotes: number;
}

export function injectedRecords(
  ids: string[] | null,
  records: RecordRow[],
  votes: VoteRow[],
): InjectedRecord[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return (ids ?? []).map((id, i) => {
    const record = byId.get(id) ?? null;
    const mine = votes.filter((v) => v.record_id === id);
    return {
      rank: i + 1,
      id,
      record,
      status: record ? recordStatus(record) : null,
      certifyVotes: mine.filter((v) => v.verdict === 'certify').length,
      rejectVotes: mine.filter((v) => v.verdict === 'reject').length,
    };
  });
}

export interface Funnel {
  /** Pre-filter pool. `atLeast` on versions whose fetch was capped (020). */
  candidates: { value: number | null; atLeast: boolean };
  /** Cleared the relevance gate, before the rank cap. Null: not recorded (022). */
  gatePassed: number | null;
  injected: number | null;
}

export function groundingFunnel(row: SessionRow, facts: VersionFacts): Funnel {
  return {
    candidates: {
      value: row.grounding_candidates,
      atLeast: row.grounding_candidates !== null && !facts.candidatesExact,
    },
    gatePassed: row.grounding_gate_passed ?? null,
    injected: row.grounding_records,
  };
}

// ── The prompt the model received (#121) ────────────────────────────────────

/** A `session_prompts` row as the tool reads it. */
export interface SessionPromptRecord {
  run_id: string;
  run: 'insert' | 'reanalysis';
  attempt: number;
  strict: boolean;
  produced_cue: boolean;
  provider: string;
  model: string;
  prompt: string;
  created_at: string;
}

export interface RecordedRun {
  /** The run's `run_id`: the handle a verdict keeps on it (migration 026). */
  runId: string;
  run: 'insert' | 'reanalysis';
  /** Every attempt of the run, first to last. */
  attempts: SessionPromptRecord[];
  /** The attempt whose Cue the row holds; null when the gate fell back. */
  produced: SessionPromptRecord | null;
  /** How many runs this session has had in total. */
  runs: number;
}

/**
 * The run behind the Cue the row holds now: the most recent one. Re-analysis
 * adds a run and overwrites the Cue, so an earlier run describes a Cue that no
 * longer exists.
 */
export function latestRun(rows: SessionPromptRecord[]): RecordedRun | null {
  const attempts = newestRunOf(rows);
  const first = attempts[0];
  if (!first) return null;
  return {
    runId: first.run_id,
    run: first.run,
    attempts,
    produced: attempts.find((a) => a.produced_cue) ?? null,
    runs: new Set(rows.map((r) => r.run_id)).size,
  };
}

/** A `session_prompts` row as the session list reads it: no prompt text. */
export type PromptAttempt = Pick<
  SessionPromptRecord,
  'run_id' | 'run' | 'attempt' | 'produced_cue' | 'model' | 'created_at'
>;

/** The attempts of the most recent run, first to last. */
function newestRunOf<T extends PromptAttempt>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  const newest = rows.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  return rows
    .filter((r) => r.run_id === newest.run_id)
    .sort((a, b) => a.attempt - b.attempt);
}

/** The Cue is the quality gate's fixed fallback: no model's attempt passed. */
export const GATE_FALLBACK = 'quality-gate fallback';

/**
 * Who wrote the Cue a row holds now, from its latest prompt-log run (#121):
 * the model of the attempt that produced it, or `GATE_FALLBACK` when every
 * attempt failed the gate. Null when the Session predates the prompt log.
 *
 * #137 asks exactly this: a Cue from the coaching model's transient-failure
 * fallback shows up here under that fallback's model name.
 */
export function cueWriter(attempts: PromptAttempt[]): string | null {
  const run = newestRunOf(attempts);
  if (run.length === 0) return null;
  return run.find((a) => a.produced_cue)?.model ?? GATE_FALLBACK;
}

// ── Operator verdicts on Cues (#132, migration 026) ─────────────────────────
//
// A verdict judges a Cue, not a Session: Re-analysis replaces a Session's Cue
// in place, so each verdict keeps the exact text it judged and the records
// that were behind it. No row means unjudged. Verdicts are kept apart from the
// athlete's thumbs and never decide anything: an observation, not a gate.

/** The labels of the frozen #36 baseline, so the two stay comparable. */
export type CueVerdict = 'sound' | 'shallow' | 'wrong';

export const CUE_VERDICTS: CueVerdict[] = ['sound', 'shallow', 'wrong'];

/**
 * Why a Cue is wrong, ordered upstream to downstream, so a fix lands where the
 * fault is:
 *
 *   transcript_misheard  a vocabulary-priming problem, not a coaching one
 *   extraction_wrong     the wrong mistake, position or side was extracted
 *   records_wrong        an injected record is itself wrong
 *   records_misapplied   the records were right and the model misused them
 *   off_target           sound jiu-jitsu aimed at the wrong problem
 *   model_wrong          no relevant records, and the model's own jiu-jitsu
 *                        was wrong
 */
export type WrongReason =
  | 'transcript_misheard'
  | 'extraction_wrong'
  | 'records_wrong'
  | 'records_misapplied'
  | 'off_target'
  | 'model_wrong';

export const WRONG_REASONS: WrongReason[] = [
  'transcript_misheard',
  'extraction_wrong',
  'records_wrong',
  'records_misapplied',
  'off_target',
  'model_wrong',
];

export const isCueVerdict = (v: unknown): v is CueVerdict =>
  CUE_VERDICTS.includes(v as CueVerdict);

export const isWrongReason = (v: unknown): v is WrongReason =>
  WRONG_REASONS.includes(v as WrongReason);

/** A `cue_verdicts` row as the tool reads it. */
export interface VerdictRow {
  id: string;
  session_id: string;
  /** The prompt-log run behind the judged Cue; null before migration 023. */
  run_id: string | null;
  /** The exact Cue text judged. */
  cue: string;
  verdict: CueVerdict;
  /** Set exactly when `verdict` is 'wrong'. */
  reason: WrongReason | null;
  note: string | null;
  /**
   * What the Cue should have said, in the operator's words. Only on a shallow
   * or wrong verdict, and capped like a Cue. Each one, paired with the Cue it
   * replaces, is a preference pair: the seed of any future training or
   * evaluation set.
   */
  better_cue: string | null;
  /** The records behind the judged Cue; only ever non-empty when trusted. */
  record_ids: string[];
  /** What the record trail said when the verdict was recorded. */
  record_trail: RecordTrail;
  created_at: string;
  updated_at: string;
}

export const VERDICT_COLUMNS =
  'id,session_id,run_id,cue,verdict,reason,note,better_cue,record_ids,record_trail,' +
  'created_at,updated_at';

/**
 * The columns before migration 027 added `better_cue`. The server falls back
 * to them so the tool keeps working, better Cue aside, until 027 is applied.
 */
export const VERDICT_COLUMNS_BEFORE_027 = VERDICT_COLUMNS.replace(
  'better_cue,',
  '',
);

/** A note, not an essay. The bound also keeps request bodies small. */
export const NOTE_MAX_LENGTH = 2000;

/** Record or change the verdict on the Cue the page is showing. */
export interface SetVerdictRequest {
  sessionId: string;
  /** The Cue text the operator read, exactly as the page showed it. */
  cue: string;
  verdict: CueVerdict;
  reason: WrongReason | null;
  note: string | null;
  /** Shallow or wrong only; at most `CUE_WORD_CAP` words. */
  betterCue: string | null;
}

/** A suggested Cue is a Cue: short. The character bound keeps bodies small. */
export const BETTER_CUE_MAX_LENGTH = 300;

/** Clear a verdict back to unjudged. Works on an earlier Cue's verdict too. */
export interface ClearVerdictRequest {
  sessionId: string;
  cue: string;
  verdict: null;
}

export type VerdictRequest = SetVerdictRequest | ClearVerdictRequest;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const refuse = <T>(error: string): Checked<T> => ({ ok: false, error });

const REQUEST_FIELDS = [
  'sessionId',
  'cue',
  'verdict',
  'reason',
  'note',
  'betterCue',
];

/**
 * The body of `POST /api/verdict`, validated. The server runs exactly this, so
 * what the tests refuse is what the route refuses.
 */
export function parseVerdictRequest(body: unknown): Checked<VerdictRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return refuse('Expected a JSON object');
  }
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !REQUEST_FIELDS.includes(k));
  if (extra.length > 0) return refuse(`Unknown field: ${extra.join(', ')}`);

  const { sessionId, cue, verdict, reason, note, betterCue } = b;
  if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) {
    return refuse('sessionId must be a session id');
  }
  if (typeof cue !== 'string' || cue.trim() === '') {
    return refuse('cue must be the text of the Cue judged');
  }
  if (!('verdict' in b)) return refuse('verdict is required; null clears it');

  if (verdict === null) {
    if (
      (reason ?? null) !== null ||
      (note ?? null) !== null ||
      (betterCue ?? null) !== null
    ) {
      return refuse('Clearing a verdict takes no reason, note or better Cue');
    }
    return { ok: true, value: { sessionId, cue, verdict: null } };
  }
  if (!isCueVerdict(verdict)) {
    return refuse(
      `verdict must be one of ${CUE_VERDICTS.join(', ')}, or null to clear`,
    );
  }

  let why: WrongReason | null = null;
  if (verdict === 'wrong') {
    if (!isWrongReason(reason)) {
      return refuse(
        `A wrong Cue needs a reason, one of ${WRONG_REASONS.join(', ')}`,
      );
    }
    why = reason;
  } else if ((reason ?? null) !== null) {
    return refuse('Only a wrong Cue takes a reason');
  }

  if ((note ?? null) !== null && typeof note !== 'string') {
    return refuse('note must be text');
  }
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > NOTE_MAX_LENGTH) {
    return refuse(`note must be at most ${NOTE_MAX_LENGTH} characters`);
  }

  if ((betterCue ?? null) !== null && typeof betterCue !== 'string') {
    return refuse('betterCue must be text');
  }
  const better = typeof betterCue === 'string' ? betterCue.trim() : '';
  if (better && verdict === 'sound') {
    return refuse('A sound Cue needs no better Cue');
  }
  if (better.length > BETTER_CUE_MAX_LENGTH) {
    return refuse(
      `betterCue must be at most ${BETTER_CUE_MAX_LENGTH} characters`,
    );
  }
  if (better && cueWords(better) > CUE_WORD_CAP) {
    return refuse(
      `betterCue must be at most ${CUE_WORD_CAP} words, like any Cue`,
    );
  }
  return {
    ok: true,
    value: {
      sessionId,
      cue,
      verdict,
      reason: why,
      note: text || null,
      betterCue: better || null,
    },
  };
}

/** The row `POST /api/verdict` upserts, keyed on (session_id, md5(cue)). */
export interface VerdictInsert {
  session_id: string;
  run_id: string | null;
  cue: string;
  verdict: CueVerdict;
  reason: WrongReason | null;
  note: string | null;
  better_cue: string | null;
  record_ids: string[];
  record_trail: RecordTrail;
}

/**
 * Shapes a verdict against the Session as stored NOW.
 *
 * Refused when the stored Cue is not the one the operator read: a Re-analyze
 * between loading the page and judging would otherwise file the judgement
 * under text nobody read. The record ids are copied only when the trail
 * vouches for them. A stale or unrecorded list would charge a wrong Cue to
 * records that were never behind it.
 */
export function verdictInsert(
  req: SetVerdictRequest,
  session: Pick<SessionRow, 'id' | 'coaching_cue' | 'grounding_record_ids'>,
  ctx: { trail: RecordTrail; runId: string | null },
): Checked<VerdictInsert> {
  if (req.sessionId !== session.id) return refuse('Wrong session');
  if (session.coaching_cue === null) {
    return refuse('This Session has no Cue to judge.');
  }
  if (session.coaching_cue !== req.cue) {
    return refuse(
      'This Session’s Cue changed after the page loaded it. Reload and read the new Cue before judging it.',
    );
  }
  return {
    ok: true,
    value: {
      session_id: session.id,
      run_id: ctx.runId,
      cue: session.coaching_cue,
      verdict: req.verdict,
      reason: req.reason,
      note: req.note,
      better_cue: req.betterCue,
      record_ids:
        ctx.trail === 'trusted'
          ? [...(session.grounding_record_ids ?? [])]
          : [],
      record_trail: ctx.trail,
    },
  };
}

/**
 * Whether a verdict judges the Cue the Session holds now. Exact text, because
 * the snapshot is the identity: any change, a Re-analyze that declined
 * included, makes it a verdict about an earlier Cue.
 */
export const isAboutCurrentCue = (
  verdict: Pick<VerdictRow, 'cue'>,
  coachingCue: string | null,
): boolean => coachingCue !== null && verdict.cue === coachingCue;

/** A Session's verdicts, split by whether they judge its current Cue. */
export function verdictsFor(
  coachingCue: string | null,
  verdicts: VerdictRow[],
): { current: VerdictRow | null; earlier: VerdictRow[] } {
  return {
    current: verdicts.find((v) => isAboutCurrentCue(v, coachingCue)) ?? null,
    earlier: verdicts
      .filter((v) => !isAboutCurrentCue(v, coachingCue))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
}

// ── Review coverage (story 10) ──────────────────────────────────────────────

export interface ReviewCoverage {
  /** Sessions holding a Cue: the ones that can be judged. */
  cues: number;
  /** Of those, how many carry a verdict on the Cue they hold now. */
  judged: number;
  unjudged: number;
  sound: number;
  shallow: number;
  wrong: number;
  /** Verdicts about a Cue a Session no longer holds. Not in `judged`. */
  earlier: number;
}

/** How much of these Sessions the operator has judged. */
export function reviewCoverage(sessions: SessionSummary[]): ReviewCoverage {
  const out: ReviewCoverage = {
    cues: 0,
    judged: 0,
    unjudged: 0,
    sound: 0,
    shallow: 0,
    wrong: 0,
    earlier: 0,
  };
  for (const s of sessions) {
    out.earlier += s.earlierVerdicts;
    if (s.cue === null) continue;
    out.cues += 1;
    if (s.verdict === null) {
      out.unjudged += 1;
    } else {
      out.judged += 1;
      out[s.verdict] += 1;
    }
  }
  return out;
}

// ── Cue trust (the focus from 2026-11-10) ───────────────────────────────────
//
// The question the project is working on: "do I trust the cues it gives me?"
// It's answered by the operator's own verdicts on recent Cues, read against a
// target and against the #36 hand read that every claim is measured from. The
// reasons on the wrong ones say where the next fix belongs.

export interface TrustTarget {
  /** How many of the most recent judged Cues the target is read over. */
  window: number;
  /** The share of those that may be wrong for the target to count as met. */
  maxWrongShare: number;
}

/**
 * The working definition of "I trust the cues": at most 1 in 5 of the last 20
 * judged Cues wrong, against 47% wrong in the #36 baseline. It's the owner's
 * call; change it here.
 */
export const TRUST_TARGET: TrustTarget = { window: 20, maxWrongShare: 0.2 };

/**
 * The #36 hand read (Aug 2026): 36 cues judged against the instructional
 * corpus, written before the Pro coaching model (#124).
 */
export const FROZEN_BASELINE = {
  judged: 36,
  sound: 11,
  shallow: 8,
  wrong: 17,
} as const;

/** The hard cap on a Cue (CLAUDE.md rule 6). Kept here so this stays import-free. */
export const CUE_WORD_CAP = 25;

/**
 * Where each reason points: the part of the pipeline a fix belongs in, and the
 * parked issues that reason would unpark. It's the decision guide for "what
 * next" once verdicts accumulate.
 */
export const REASON_POINTS_AT: Record<WrongReason, string> = {
  transcript_misheard:
    'Transcription: vocabulary priming for the words it missed.',
  extraction_wrong:
    'Extraction: the prompt that picks the mistake, position and side.',
  records_wrong:
    'The corpus: re-mine or certify the records involved (#133, #77, #97, #100).',
  records_misapplied:
    'The coaching prompt, or how records are chosen for it (#116).',
  off_target:
    'Which records reach the prompt: right position, wrong problem (#153, #116).',
  model_wrong:
    'The coaching model itself, or a position with no records to ground it.',
};

export interface VerdictCounts {
  judged: number;
  sound: number;
  shallow: number;
  wrong: number;
}

export interface TrustReport {
  target: TrustTarget;
  /** `too_few` until `target.window` Cues have been judged. */
  status: 'met' | 'not_met' | 'too_few';
  /** The most recent judged Cues, up to `target.window` of them. */
  recent: VerdictCounts & {
    wrongShare: number | null;
    /** Session dates of the oldest and newest Cue in the window. */
    from: string | null;
    to: string | null;
  };
  /** Within the window: why the wrong ones are wrong, most common first. */
  reasons: { reason: WrongReason; count: number }[];
  /** Every judged Cue, grouped by who wrote it. Null writer: not logged. */
  byWriter: (VerdictCounts & { writer: string | null })[];
  /** Word counts within the window; null when nothing is judged. */
  length: { median: number; max: number; nearCap: number } | null;
  /** Sessions holding a Cue with no verdict on it yet. */
  unjudged: number;
}

export const cueWords = (cue: string): number =>
  cue.trim().split(/\s+/).filter(Boolean).length;

function counts(items: SessionSummary[]): VerdictCounts {
  const out: VerdictCounts = { judged: 0, sound: 0, shallow: 0, wrong: 0 };
  for (const s of items) {
    if (s.verdict === null) continue;
    out.judged += 1;
    out[s.verdict] += 1;
  }
  return out;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** How far the current Cues are from "I trust the cues it gives me". */
export function trustReport(
  sessions: SessionSummary[],
  target: TrustTarget = TRUST_TARGET,
): TrustReport {
  // Only verdicts on the Cue a row holds NOW count; one about an earlier Cue
  // judged text the athlete no longer sees.
  const judged = sessions
    .filter((s) => s.cue !== null && s.verdict !== null)
    .sort(
      (a, b) =>
        b.sessionDate.localeCompare(a.sessionDate) || a.id.localeCompare(b.id),
    );
  const window = judged.slice(0, target.window);
  const recent = counts(window);
  const wrongShare = recent.judged ? recent.wrong / recent.judged : null;

  const reasonCounts = new Map<WrongReason, number>();
  for (const s of window) {
    if (s.verdict === 'wrong' && s.verdictReason) {
      reasonCounts.set(
        s.verdictReason,
        (reasonCounts.get(s.verdictReason) ?? 0) + 1,
      );
    }
  }
  const reasons = WRONG_REASONS.filter((r) => reasonCounts.has(r))
    .map((reason) => ({ reason, count: reasonCounts.get(reason) as number }))
    .sort((a, b) => b.count - a.count);

  const writers = new Map<string | null, SessionSummary[]>();
  for (const s of judged) {
    writers.set(s.cueWriter, [...(writers.get(s.cueWriter) ?? []), s]);
  }
  // Most judged first; ties alphabetical, with "not logged" (null) last.
  const byWriter = [...writers]
    .map(([writer, items]) => ({ writer, ...counts(items) }))
    .sort(
      (a, b) =>
        b.judged - a.judged ||
        Number(a.writer === null) - Number(b.writer === null) ||
        (a.writer ?? '').localeCompare(b.writer ?? ''),
    );

  const words = window
    .map((s) => cueWords(s.cue as string))
    .sort((a, b) => a - b);

  return {
    target,
    status:
      recent.judged < target.window
        ? 'too_few'
        : (wrongShare as number) <= target.maxWrongShare
          ? 'met'
          : 'not_met',
    recent: {
      ...recent,
      wrongShare,
      from: window.at(-1)?.sessionDate ?? null,
      to: window[0]?.sessionDate ?? null,
    },
    reasons,
    byWriter,
    length: words.length
      ? {
          median: median(words),
          max: words.at(-1) as number,
          nearCap: words.filter((w) => w >= CUE_WORD_CAP - 3).length,
        }
      : null,
    unjudged: sessions.filter((s) => s.cue !== null && s.verdict === null)
      .length,
  };
}

// ── The AI second opinion (migration 027) ───────────────────────────────────
//
// The cue judge (scripts/judge) run over live Cues by `opine.sh`. It FAILED
// its validation on false alarms (4 of 11 sound Cues condemned, against a bar
// of 2), so it is a second opinion that has to earn trust, never a verdict:
//
//   * Blind first. An opinion reaches the page only once the operator has a
//     verdict on the same Cue, so it can never anchor that verdict. The server
//     applies `revealOpinions`; an unrevealed opinion is counted, not sent.
//   * Measured, not believed. `secondOpinionReport` compares it with the
//     operator over every Cue both have judged, against the bar it failed.

export type OpinionMode = 'grounded' | 'ungrounded';

export type ClaimStatus =
  | 'supported'
  | 'contradicted'
  | 'off_target'
  | 'unsupported';

export interface AiOpinionRow {
  session_id: string;
  /** The exact Cue text the judge read. */
  cue: string;
  defective: boolean;
  /** Whether records backed the check. Ungrounded is where false alarms live. */
  mode: OpinionMode;
  records_available: number;
  claims: { claim: string; status: ClaimStatus; reason: string }[];
  rationale: string;
  judge_model: string;
  judge_version: string;
  created_at: string;
}

export const AI_OPINION_COLUMNS =
  'session_id,cue,defective,mode,records_available,claims,rationale,' +
  'judge_model,judge_version,created_at';

/** One judge at one version: an instrument, measured on its own. */
export const instrumentOf = (
  o: Pick<AiOpinionRow, 'judge_model' | 'judge_version'>,
): string => `${o.judge_model} (judge v${o.judge_version})`;

/** What the list keeps of a revealed opinion. */
export interface AiCall {
  instrument: string;
  defective: boolean;
  mode: OpinionMode;
}

export interface OpinionView {
  /** Opinions on the current Cue, newest first. Empty until it is judged. */
  shown: AiOpinionRow[];
  /** How many opinions on the current Cue are held back until it is. */
  hidden: number;
}

/**
 * Blind first: the opinions on the Cue a Session holds NOW, revealed only when
 * the operator has judged that Cue. An opinion about an earlier Cue (a
 * Re-analyze replaced it) is never shown against the current one, nor counted.
 */
export function revealOpinions(
  coachingCue: string | null,
  judged: boolean,
  opinions: AiOpinionRow[] = [],
): OpinionView {
  const onCue = opinions
    .filter((o) => coachingCue !== null && o.cue === coachingCue)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return judged
    ? { shown: onCue, hidden: 0 }
    : { shown: [], hidden: onCue.length };
}

/** The summary with its AI fields set from a (revealed) view. */
export function withOpinions(
  s: SessionSummary,
  view: OpinionView,
): SessionSummary {
  return {
    ...s,
    ai: view.shown.map((o) => ({
      instrument: instrumentOf(o),
      defective: o.defective,
      mode: o.mode,
    })),
    aiHidden: view.hidden,
  };
}

/**
 * When the judge could be trusted to triage: the bar it failed in August
 * (scripts/judge/VALIDATION.md), read over many more Cues. At least 12 in 17
 * of the operator's wrong Cues flagged, at most 2 in 11 of the sound ones, over
 * at least 50 Cues both have judged with 10 or more of each. Clearing it
 * switches nothing on; it would justify deciding to let the judge triage.
 */
export interface HandOverBar {
  minPaired: number;
  /** At least this many of the operator's wrong, and of their sound, Cues. */
  minEach: number;
  minCatch: number;
  maxFalseAlarm: number;
}

export const HAND_OVER_BAR: HandOverBar = {
  minPaired: 50,
  minEach: 10,
  minCatch: 12 / 17,
  maxFalseAlarm: 2 / 11,
};

export interface Tally {
  /** How many it flagged as defective. */
  n: number;
  of: number;
}

export interface AgreementReport {
  instrument: string;
  status: 'not_enough' | 'cleared' | 'not_cleared';
  /** Cues the operator and this judge have both judged. */
  paired: number;
  /** Flagged, of the operator's wrong Cues. */
  caught: Tally;
  /**
   * Caught, split by whether records backed the check. A grounded check reads
   * the records that may have written the Cue (#62's caveat), so it leans
   * toward passing; misses there are that bias showing.
   */
  caughtByMode: Record<OpinionMode, Tally>;
  /** Flagged, of the operator's sound Cues. */
  falseAlarms: Tally;
  falseAlarmsByMode: Record<OpinionMode, Tally>;
  /** Flagged, of the operator's shallow Cues. Reported, never scored. */
  shallowFlagged: Tally;
  /** Sessions it disagreed on, newest first: worth reading. */
  missed: string[];
  falselyFlagged: string[];
}

export interface SecondOpinionReport {
  bar: HandOverBar;
  /** One report per judge, the most paired first. */
  instruments: AgreementReport[];
  /** Cues with an opinion waiting for the operator's verdict. */
  waiting: number;
  /** Judged Cues no judge has given an opinion on yet. */
  unopined: number;
}

const tally = (): Tally => ({ n: 0, of: 0 });

/** How far the AI second opinion agrees with the operator, per judge. */
export function secondOpinionReport(
  sessions: SessionSummary[],
  bar: HandOverBar = HAND_OVER_BAR,
): SecondOpinionReport {
  const judged = sessions
    .filter((s) => s.cue !== null && s.verdict !== null)
    .sort(
      (a, b) =>
        b.sessionDate.localeCompare(a.sessionDate) || a.id.localeCompare(b.id),
    );

  const reports = new Map<string, AgreementReport>();
  for (const s of judged) {
    for (const call of s.ai) {
      let r = reports.get(call.instrument);
      if (!r) {
        r = {
          instrument: call.instrument,
          status: 'not_enough',
          paired: 0,
          caught: tally(),
          caughtByMode: { grounded: tally(), ungrounded: tally() },
          falseAlarms: tally(),
          falseAlarmsByMode: { grounded: tally(), ungrounded: tally() },
          shallowFlagged: tally(),
          missed: [],
          falselyFlagged: [],
        };
        reports.set(call.instrument, r);
      }
      r.paired += 1;
      const flag = Number(call.defective);
      if (s.verdict === 'wrong') {
        r.caught.of += 1;
        r.caught.n += flag;
        r.caughtByMode[call.mode].of += 1;
        r.caughtByMode[call.mode].n += flag;
        if (!call.defective) r.missed.push(s.id);
      } else if (s.verdict === 'sound') {
        r.falseAlarms.of += 1;
        r.falseAlarms.n += flag;
        r.falseAlarmsByMode[call.mode].of += 1;
        r.falseAlarmsByMode[call.mode].n += flag;
        if (call.defective) r.falselyFlagged.push(s.id);
      } else {
        r.shallowFlagged.of += 1;
        r.shallowFlagged.n += flag;
      }
    }
  }

  for (const r of reports.values()) {
    const enough =
      r.paired >= bar.minPaired &&
      r.caught.of >= bar.minEach &&
      r.falseAlarms.of >= bar.minEach;
    r.status = !enough
      ? 'not_enough'
      : r.caught.n / r.caught.of >= bar.minCatch &&
          r.falseAlarms.n / r.falseAlarms.of <= bar.maxFalseAlarm
        ? 'cleared'
        : 'not_cleared';
  }

  return {
    bar,
    instruments: [...reports.values()].sort(
      (a, b) => b.paired - a.paired || a.instrument.localeCompare(b.instrument),
    ),
    waiting: sessions.filter(
      (s) => s.cue !== null && s.verdict === null && s.aiHidden > 0,
    ).length,
    unopined: judged.filter((s) => s.ai.length === 0).length,
  };
}

// ── Records behind wrong Cues (story 6) ─────────────────────────────────────

export interface RecordSignal {
  recordId: string;
  /** Wrong verdicts this record sat behind. */
  wrong: number;
  /** Those wrong verdicts by reason. */
  byReason: Record<WrongReason, number>;
  /** Every verdict it sat behind, sound and shallow included. */
  judged: number;
  /** Sessions whose wrong Cue it sat behind, most recently judged first. */
  sessionIds: string[];
}

export interface WrongCueSignal {
  /** Records behind at least one wrong Cue, the ones hurting most first. */
  records: RecordSignal[];
  wrong: {
    total: number;
    /** With a trusted record trail. These are what `records` counts. */
    traced: number;
    /** Known to have had no records behind them. */
    noRecords: number;
    /** The trail could not say which records were behind them. */
    untraced: number;
  };
}

const zeroReasons = (): Record<WrongReason, number> => ({
  transcript_misheard: 0,
  extraction_wrong: 0,
  records_wrong: 0,
  records_misapplied: 0,
  off_target: 0,
  model_wrong: 0,
});

/**
 * For each record, how many wrong Cues it sat behind, by reason.
 *
 * A function of verdicts alone. Each verdict carries the records behind the Cue
 * it judged, so a verdict about an earlier Cue still counts against the records
 * that were behind THAT Cue, and a Re-analyze cannot move it.
 *
 * Order, the records hurting most first:
 *   1. `records_wrong` verdicts: the operator said a record behind the Cue was
 *      itself wrong, and one that recurs there is the likeliest culprit.
 *   2. All wrong verdicts: it keeps appearing behind rejected Cues.
 *   3. Fewer verdicts in all: the same count from fewer appearances is a
 *      larger share.
 *   4. Record id, so the order is stable.
 */
export function recordsBehindWrongCues(verdicts: VerdictRow[]): WrongCueSignal {
  const byRecord = new Map<string, RecordSignal>();
  const wrong = { total: 0, traced: 0, noRecords: 0, untraced: 0 };
  const newestFirst = [...verdicts].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );

  for (const v of newestFirst) {
    if (v.verdict === 'wrong') {
      wrong.total += 1;
      if (v.record_trail === 'trusted') wrong.traced += 1;
      else if (v.record_trail === 'none_selected') wrong.noRecords += 1;
      else wrong.untraced += 1;
    }
    for (const id of new Set(v.record_ids)) {
      let signal = byRecord.get(id);
      if (!signal) {
        signal = {
          recordId: id,
          wrong: 0,
          byReason: zeroReasons(),
          judged: 0,
          sessionIds: [],
        };
        byRecord.set(id, signal);
      }
      signal.judged += 1;
      if (v.verdict !== 'wrong') continue;
      signal.wrong += 1;
      if (v.reason) signal.byReason[v.reason] += 1;
      if (!signal.sessionIds.includes(v.session_id)) {
        signal.sessionIds.push(v.session_id);
      }
    }
  }

  const records = [...byRecord.values()]
    .filter((r) => r.wrong > 0)
    .sort(
      (a, b) =>
        b.byReason.records_wrong - a.byReason.records_wrong ||
        b.wrong - a.wrong ||
        a.judged - b.judged ||
        a.recordId.localeCompare(b.recordId),
    );
  return { records, wrong };
}
