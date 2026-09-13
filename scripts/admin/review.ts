/**
 * The model behind the local cue review tool (docs/ADMIN.md).
 *
 * Import-free and erasable-syntax-only on purpose: server.ts imports it, jest
 * tests it, and the browser runs it — the server hands this same file to the
 * page with its types stripped. The filters that are tested are the filters
 * that get clicked; there is no second copy to drift.
 *
 * Read-only. Nothing here decides anything about a Cue; it only says what the
 * stored columns can and cannot vouch for.
 */

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
}

export function toSummary(
  row: SessionRow,
  ctx: {
    athlete: string | null;
    positionLabel: string | null;
    facts: VersionFacts;
  },
): SessionSummary {
  return {
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
