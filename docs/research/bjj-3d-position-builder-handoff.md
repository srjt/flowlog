# BJJ 3D Position Builder — Handoff (Flowlog context + review)

> Companion to `bjj-3d-position-builder-brief.md` (the user's full engineering
> brief). This doc adds the Flowlog context, the bridge back to the pipeline, and
> the sharp risks from review. Tracked as #136; it is the upstream enabler for the
> cue force-diagram feature (wayfinder map #10 / spec #135).

**Type:** direction / prototype — a *separate* React + TypeScript + Vite + Three.js
project, **not** the Flowlog Expo app. Tracked here because it is the upstream enabler
for the cue force-diagram feature (#135, map #10): it produces the **correct base
poses** that the deterministic renderer draws on.

## Why

Flowlog's force-diagram visualization (#135) is gated on authoring anatomically correct
**two-person BJJ base poses**. 2D authoring failed: a static skeleton template lacked
kinematics, and a 2D FK rig still can't resolve **occlusion** (hidden limbs, gi fabric,
who-is-behind-what) — because posing two intertwined bodies is fundamentally a **3D**
problem. Generic 3D posers (PoseMy.Art) work but are hard to build BJJ positions in.
So: a BJJ-specific 3D position builder where **semantic constraints** (hook / frame /
contact), not manual bone rotation, drive two rigged humanoids.

## The hypothesis to validate (prototype only)

Can we build a useful two-person BJJ positioning system on standard rigged humanoids
where **BJJ constraints control the characters**? First demo: two Mixamo humanoids in
Three.js with an IK-controlled limb and a maintained relationship between that limb and
the other body → then an auto-entered, adjustable **Closed Guard**.

## The bridge back to Flowlog (important)

- The builder's **semantic constraints ≈ Flowlog's `roles` + contact points** (#135 /
  the #17 domain model).
- Its **export** should ultimately project the posed 3D skeleton → 2D keypoints in
  Flowlog's schema (COCO-style joints + per-foot toe) so it drops into the existing
  role-map → grammar → deterministic renderer. The 3D tool becomes the **posing
  front-end**; the rest of the Flowlog pipeline is unchanged.
- Architecturally consistent: the builder's "NL → LLM → semantic constraints →
  deterministic solver" mirrors Flowlog's cue → spec → render.

## Sharp risks (from review)

- The crux is multi-body IK + contact constraints (keep `A.foot` on `B.hip` as B
  moves), **not** loading an FBX or single-chain IK — get there fast.
- Mixamo bone bug: apply rotation **deltas** off the bind quaternion in the right
  space; check FBX **scale (often 100×)** + up-axis.
- Prefer **analytic two-bone IK** for limbs (stable) over generic CCD/FABRIK.
- Coupled constraints will conflict → make them **soft / best-effort**; expect
  "approximately intact," support releasing a constraint.
- Guard scope: Milestones 1–5 + interaction tests only; defer library / sequences /
  AI / video / persistence.

## ROI note

The bounded base library (~150 positions, authored once) could be produced without this
tool. The 3D builder earns its cost only as a **compounding asset** — the video horizon
(brief §25) and synthetic training data for the BJJ pose-model research. Keep that in
view as the prototype proves or kills the hypothesis.
