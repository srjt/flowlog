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

describe('assignGrounding — an inherited arm (#117)', () => {
  // Re-analysis regenerates a cue for a session that already has one, so its
  // arm is a fact on the row, not a new draw. Re-drawing it could move a
  // session between arms — the same corruption a retry would cause, which the
  // determinism test above exists to prevent.
  it('honours an inherited grounded arm regardless of the draw', () => {
    // rollout 0 would otherwise withhold from every session.
    const out = assignGrounding('any-key', 9, {
      hasPosition: true,
      rollout: 0,
      inheritedArm: 'grounded',
    });
    expect(out.outcome).toBe('grounded');
    expect(out.inject).toBe(9);
    expect(out.available).toBe(9);
  });

  it('honours an inherited withheld arm regardless of the draw', () => {
    // The bug: re-analysis grounded unconditionally, so a control-arm session
    // silently received a grounded cue while its row still read `withheld`.
    const out = assignGrounding('any-key', 9, {
      hasPosition: true,
      rollout: 1,
      inheritedArm: 'withheld',
    });
    expect(out.outcome).toBe('withheld');
    expect(out.inject).toBe(0);
    // Still recorded, or the two arms stop being comparable.
    expect(out.available).toBe(9);
  });

  it('inherits independently of the session key', () => {
    // The whole reason the arm is passed rather than re-derived: the original
    // key cannot be reconstructed for rows whose request omitted sessionDate.
    const a = assignGrounding('key-one', 4, {
      hasPosition: true,
      inheritedArm: 'withheld',
    });
    const b = assignGrounding('key-two', 4, {
      hasPosition: true,
      inheritedArm: 'withheld',
    });
    expect(a).toEqual(b);
  });

  // Eligibility is a function of the CURRENT extraction and must be
  // recomputed; only the coin flip is inherited. A corrected transcript can
  // resolve a position that previously did not, or stop resolving one.
  it('recomputes eligibility even with an arm to inherit', () => {
    expect(
      assignGrounding('k', 0, { hasPosition: true, inheritedArm: 'grounded' })
        .outcome,
    ).toBe('no_records');
    expect(
      assignGrounding('k', 9, { hasPosition: false, inheritedArm: 'grounded' })
        .outcome,
    ).toBe('no_position');
  });

  // `no_position`, `no_records` and `declined` are eligibility outcomes, not
  // arms. Treating one as an arm would freeze a stale eligibility decision
  // into a session that has since become eligible.
  it.each(['no_position', 'no_records', 'declined', '', null, undefined])(
    'falls through to a fresh draw for a non-arm value (%s)',
    (inherited) => {
      const fresh = assignGrounding('stable-key', 6, { hasPosition: true });
      const withNonArm = assignGrounding('stable-key', 6, {
        hasPosition: true,
        inheritedArm: inherited as string | null,
      });
      expect(withNonArm).toEqual(fresh);
    },
  );

  it('still assigns deterministically when nothing is inherited', () => {
    const a = assignGrounding('s', 5, { hasPosition: true });
    const b = assignGrounding('s', 5, {
      hasPosition: true,
      inheritedArm: null,
    });
    expect(a).toEqual(b);
  });
});
