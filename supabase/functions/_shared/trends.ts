// Server-side trend aggregation for `user_trends`. Mirrors the client
// `src/services/TrendsService.ts` (kept simple + in sync). Computes the fields
// that feed back into coaching (dominant_weakness) and the trends UI.

interface SessionRow {
  positions_visited: string[] | null;
  key_mistake: string | null;
  session_date: string;
}

export interface TrendUpdate {
  dominant_weakness: string | null;
  positions_struggled: Record<string, number>;
  session_count: number;
  streak_days: number;
  last_session_at: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeTrendUpdate(rows: SessionRow[]): TrendUpdate {
  const positions: Record<string, number> = {};
  for (const r of rows) {
    for (const p of r.positions_visited ?? []) {
      const key = p.trim();
      if (key) positions[key] = (positions[key] ?? 0) + 1;
    }
  }

  const top = Object.entries(positions).sort((a, b) => b[1] - a[1])[0];

  const days = Array.from(
    new Set(rows.map((r) => r.session_date.slice(0, 10))),
  ).sort((a, b) => (a < b ? 1 : -1)); // newest first

  let streak = days.length > 0 ? 1 : 0;
  for (let i = 1; i < days.length; i++) {
    const prev = Date.parse(`${days[i - 1]}T00:00:00Z`);
    const curr = Date.parse(`${days[i]}T00:00:00Z`);
    if (prev - curr === DAY_MS) streak += 1;
    else break;
  }

  const lastSessionAt = rows.reduce<string | null>(
    (max, r) => (max === null || r.session_date > max ? r.session_date : max),
    null,
  );

  return {
    dominant_weakness: top ? top[0] : null,
    positions_struggled: positions,
    session_count: rows.length,
    streak_days: streak,
    last_session_at: lastSessionAt,
  };
}
