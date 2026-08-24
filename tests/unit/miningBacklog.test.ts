import {
  rankBacklog,
  type SessionOutcomeRow,
} from '../../scripts/backlog/rank';

const row = (o: Partial<SessionOutcomeRow>): SessionOutcomeRow => ({
  grounding: null,
  grounding_candidates: null,
  target_position_id: null,
  positions_visited: null,
  user_id: 'u1',
  ...o,
});

describe('mining backlog (#58)', () => {
  it('files an empty corpus as a position to mine', () => {
    const b = rankBacklog([
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'k-guard-bottom',
      }),
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'k-guard-bottom',
      }),
    ]);
    expect(b.mine).toEqual([
      { position: 'k-guard-bottom', sessions: 2, users: 1 },
    ]);
  });

  it('does NOT file a filtered-out position as a mining gap', () => {
    // Records existed and the gi filter or relevance gate removed them all.
    // Mining more would not change the outcome — filing it here is the exact
    // conflation this ticket exists to prevent, one layer down.
    const b = rankBacklog([
      row({
        grounding: 'no_records',
        grounding_candidates: 46,
        target_position_id: 'butterfly-guard-bottom',
      }),
    ]);
    expect(b.mine).toEqual([]);
    expect(b.filteredOut).toEqual([
      {
        position: 'butterfly-guard-bottom',
        sessions: 1,
        users: 1,
        mostAvailable: 46,
      },
    ]);
  });

  it('excludes rows predating the candidates column rather than guessing', () => {
    const b = rankBacklog([
      row({
        grounding: 'no_records',
        grounding_candidates: null,
        target_position_id: 'mount-bottom',
      }),
    ]);
    expect(b.mine).toEqual([]);
    expect(b.filteredOut).toEqual([]);
  });

  it('keeps taxonomy gaps separate — they have a different fix', () => {
    // Adding "Octopus Guard" to the taxonomy would only move this row to
    // no_records; mining and taxonomy are not substitutes for each other.
    const b = rankBacklog([
      row({
        grounding: 'no_position',
        positions_visited: ['Octopus Guard', 'Truck'],
      }),
      row({ grounding: 'no_position', positions_visited: ['octopus guard '] }),
    ]);
    expect(b.mine).toEqual([]);
    expect(b.unresolved[0]).toEqual({
      position: 'octopus guard',
      sessions: 2,
      users: 1,
    });
  });

  it('ranks by sessions, then by how many users are affected', () => {
    const b = rankBacklog([
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'a',
        user_id: 'u1',
      }),
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'a',
        user_id: 'u1',
      }),
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'b',
        user_id: 'u1',
      }),
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'b',
        user_id: 'u2',
      }),
      row({
        grounding: 'no_records',
        grounding_candidates: 0,
        target_position_id: 'c',
        user_id: 'u3',
      }),
    ]);
    expect(b.mine.map((e) => e.position)).toEqual(['b', 'a', 'c']);
    expect(b.mine[0]?.users).toBe(2);
  });

  it('never counts a declined session as a gap', () => {
    // Nothing coachable was said, so grounding never ran. Counting it would
    // inflate the backlog with sessions that had no content to ground.
    const b = rankBacklog([row({ grounding: 'declined' })]);
    expect(b.mine).toEqual([]);
    expect(b.unresolved).toEqual([]);
    expect(b.outcomes.declined).toBe(1);
  });

  it('counts every outcome, including sessions predating the logging', () => {
    const b = rankBacklog([
      row({ grounding: 'grounded' }),
      row({ grounding: 'withheld' }),
      row({ grounding: null }),
    ]);
    expect(b.outcomes).toEqual({ grounded: 1, withheld: 1, 'not recorded': 1 });
  });
});
