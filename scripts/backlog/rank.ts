/**
 * Ranking grounding outcomes into a backlog (#58).
 *
 * Pure, so the classification that decides where engineering effort goes is
 * testable without a database.
 */

export interface SessionOutcomeRow {
  grounding: string | null;
  grounding_candidates: number | null;
  target_position_id: string | null;
  positions_visited: string[] | null;
  user_id: string | null;
}

export interface BacklogEntry {
  position: string;
  sessions: number;
  users: number;
}

export interface FilteredEntry extends BacklogEntry {
  mostAvailable: number;
}

export interface Backlog {
  outcomes: Record<string, number>;
  /** Corpus gaps: the position resolved, nothing was there. Mine these. */
  mine: BacklogEntry[];
  /** Records existed but were filtered out. Mining will NOT help. */
  filteredOut: FilteredEntry[];
  /** Free text that never resolved. A taxonomy/extraction problem. */
  unresolved: BacklogEntry[];
}

function tally<T>(
  rows: T[],
  keyOf: (r: T) => string | null,
  userOf: (r: T) => string | null,
): Map<string, { sessions: number; users: Set<string> }> {
  const out = new Map<string, { sessions: number; users: Set<string> }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const e = out.get(k) ?? { sessions: 0, users: new Set<string>() };
    e.sessions++;
    const u = userOf(r);
    if (u) e.users.add(u);
    out.set(k, e);
  }
  return out;
}

const byDemand = (a: BacklogEntry, b: BacklogEntry) =>
  b.sessions - a.sessions ||
  b.users - a.users ||
  a.position.localeCompare(b.position);

export function rankBacklog(rows: SessionOutcomeRow[]): Backlog {
  const outcomes: Record<string, number> = {};
  for (const r of rows) {
    const k = r.grounding ?? 'not recorded';
    outcomes[k] = (outcomes[k] ?? 0) + 1;
  }

  const noRecords = rows.filter((r) => r.grounding === 'no_records');

  // A corpus gap, and the only thing mining fixes. `grounding_candidates` is
  // null on rows predating the column — excluded rather than guessed at, since
  // filing a filtered-out position as a gap is the error #58 exists to prevent.
  const gaps = tally(
    noRecords.filter((r) => r.grounding_candidates === 0),
    (r) => r.target_position_id,
    (r) => r.user_id,
  );

  const filtered = noRecords.filter((r) => (r.grounding_candidates ?? 0) > 0);
  const filteredTally = tally(
    filtered,
    (r) => r.target_position_id,
    (r) => r.user_id,
  );

  // When grounding is `no_position`, NOTHING in positions_visited resolved —
  // so the whole array is exactly the set of free-text terms that failed.
  const unresolvedRows: { pos: string; user: string | null }[] = [];
  for (const r of rows.filter((x) => x.grounding === 'no_position')) {
    for (const p of r.positions_visited ?? []) {
      const t = p.trim().toLowerCase();
      if (t) unresolvedRows.push({ pos: t, user: r.user_id });
    }
  }
  const unresolved = tally(
    unresolvedRows,
    (r) => r.pos,
    (r) => r.user,
  );

  const toEntries = (
    m: Map<string, { sessions: number; users: Set<string> }>,
  ) =>
    [...m.entries()]
      .map(([position, v]) => ({
        position,
        sessions: v.sessions,
        users: v.users.size,
      }))
      .sort(byDemand);

  return {
    outcomes,
    mine: toEntries(gaps),
    filteredOut: toEntries(filteredTally).map((e) => ({
      ...e,
      mostAvailable: Math.max(
        ...filtered
          .filter((r) => r.target_position_id === e.position)
          .map((r) => r.grounding_candidates ?? 0),
      ),
    })),
    unresolved: toEntries(unresolved),
  };
}
