import { assignGrounding, GROUNDING_ROLLOUT } from '@/sports/experiment';

describe('assignGrounding', () => {
  it('is deterministic — a retry cannot flip a session between arms', () => {
    // A timeout-then-retry that reassigned the arm would silently corrupt the
    // experiment, and nothing downstream would notice.
    const a = assignGrounding('session-abc', 12);
    const b = assignGrounding('session-abc', 12);
    expect(a).toEqual(b);
  });

  it('keeps sessions with nothing to inject OUT of the experiment', () => {
    // Both arms would produce an identical cue, so including them would dilute
    // the comparison with non-events.
    expect(assignGrounding('x', 0).outcome).toBe('no_records');
    expect(assignGrounding('x', 12, { hasPosition: false }).outcome).toBe(
      'no_position',
    );
  });

  it('records what COULD have been injected in the control arm', () => {
    // Without this the two arms are not comparable — you could not tell a
    // withheld session from one that never had records.
    const withheld = assignGrounding('withheld-me', 12, {
      hasPosition: true,
      rollout: 0,
    });
    expect(withheld.outcome).toBe('withheld');
    expect(withheld.inject).toBe(0);
    expect(withheld.available).toBe(12);
  });

  it('injects only in the grounded arm', () => {
    const on = assignGrounding('s', 7, { hasPosition: true, rollout: 1 });
    expect(on.outcome).toBe('grounded');
    expect(on.inject).toBe(7);
  });

  it('splits roughly evenly at the default rollout', () => {
    const arms = Array.from(
      { length: 2000 },
      (_, i) => assignGrounding(`session-${i}`, 5).outcome,
    );
    const grounded = arms.filter((a) => a === 'grounded').length;
    const share = grounded / arms.length;
    expect(share).toBeGreaterThan(GROUNDING_ROLLOUT - 0.06);
    expect(share).toBeLessThan(GROUNDING_ROLLOUT + 0.06);
  });

  it('honours a rollout of 0 and 1 exactly', () => {
    expect(
      assignGrounding('s', 5, { hasPosition: true, rollout: 0 }).outcome,
    ).toBe('withheld');
    expect(
      assignGrounding('s', 5, { hasPosition: true, rollout: 1 }).outcome,
    ).toBe('grounded');
  });

  it('splits sessions across arms when a holdout is configured', () => {
    // Explicit rollout, not the production constant. The property under test
    // is that the hash DISTRIBUTES — that stays true and stays worth guarding
    // even though the experiment concluded at a rollout of 1, because a future
    // holdout (0.9, say) depends on it.
    const arms = new Set(
      Array.from(
        { length: 50 },
        (_, i) =>
          assignGrounding(`s${i}`, 3, { hasPosition: true, rollout: 0.5 })
            .outcome,
      ),
    );
    expect(arms.size).toBeGreaterThan(1);
  });

  it('grounds every eligible session at the concluded rollout', () => {
    // The experiment is over: no eligible session should be withheld now.
    const outcomes = Array.from(
      { length: 50 },
      (_, i) => assignGrounding(`s${i}`, 3).outcome,
    );
    expect(new Set(outcomes)).toEqual(new Set(['grounded']));
  });
});
