# BJJ 3D Position Builder — Prototype Context & Engineering Brief

> Authored by the user (2026). The upstream base-pose enabler for the cue
> force-diagram visualization (wayfinder map #10 / spec #135). Tracked as #136.
> It is a **separate** React + TS + Vite + Three.js prototype, not the Flowlog
> Expo app; this doc is kept here so it survives (it was lost when `/tmp` cleared).
> Companion: `bjj-3d-position-builder-handoff.md` (Flowlog context + review).

## 1. Project Vision
Build a browser-based 3D tool inspired by PoseMy.Art, but specifically for Brazilian
Jiu-Jitsu. The user should eventually construct, manipulate, save, and visualize
two-person BJJ positions involving highly intertwined limbs. Long-term concept: **a 3D
CAD system for BJJ**. The app should understand BJJ relationships — grip, hook, frame,
underhook, overhook, knee shield, leg entanglement, hip connection, chest connection,
head position, leg position, body orientation — not be a generic humanoid poser.
Fundamental abstraction:

    BJJ Position = 2 articulated humanoid skeletons + contacts + constraints
                   + semantic BJJ relationships + camera

## 2. Critical Prototype Objective
Do NOT build the full product. Validate ONE hypothesis: *can we build a useful
two-person BJJ positioning system on top of standard rigged humanoids, where
BJJ-specific constraints control the characters rather than requiring the user to
manually rotate individual bones?* Succeeds if we can demonstrate: (1) two humanoids
coexist in one scene; (2) skeletons manipulate reliably; (3) a foot/hand/knee/hip can
be an IK target; (4) one character maintains a relationship with the other; (5) at
least one convincing BJJ position; (6) moving one body does not immediately destroy
the important relationships; (7) the architecture can reasonably evolve into a larger
BJJ position engine. Do not spend time on visual polish before this is proven.

## 3. What We Already Have
A Mixamo FBX character (`character.fbx`) is supplied — a humanoid with skeleton/rig.
The initial prototype showed: Three.js loads it via `FBXLoader`, it renders, the
Mixamo skeleton is discoverable, a second character can be instantiated, individual
bones can be identified. **Known bug:** the bone rotation sliders do not visibly change
the character. Do NOT assume the FBX is defective — the likely issue is how existing
Mixamo bone transforms are modified. Fix skeleton manipulation rather than replacing
the character.

## 4. Recommended Technology
Browser stack: React + TypeScript + Vite + Three.js (React Three Fiber if useful;
plain Three.js acceptable for faster iteration). Character format: prototype uses the
FBX directly via `FBXLoader`. Later, consider GLB/GLTF (better web runtime asset), but
don't convert without a concrete technical reason.

## 5. Do Not Build a Character System
The Mixamo character is a replaceable asset, NOT the core IP. Do not build custom
anatomy, mesh topology, facial animation, realistic skin, hair, cloth simulation,
detailed fingers, or photorealistic rendering. The character only needs: skeleton,
joint hierarchy, joint rotations, hip/shoulder/knee/ankle/spine articulation, and
reasonable skin deformation. Keep the character asset replaceable.

## 6. Core Architecture
React UI → Position Editor → BJJ Position Model → Constraint Engine → IK Solver →
Character Rig → Three.js → Web Browser. Separate the responsibilities:
- **Rendering layer** (Three.js / R3F): scene, camera, lighting, mesh, skeleton viz, interaction.
- **Character layer**: load character, identify bones, bone hierarchy, apply transforms, reset pose, character instances.
- **IK layer**: foot/hand/knee/elbow/head targets; solve articulated chains.
- **Constraint layer**: relationships (foot→opponent hip, hand→opponent wrist, knee shield→opponent torso, chest→chest, hip relative to opponent pelvis).
- **BJJ semantic layer**: Closed Guard, Half Guard, Knee Shield, Mount, Side Control, Back Control, K Guard, DLR.
Do NOT hard-code BJJ logic directly into Three.js rendering code.

## 7. Important Architectural Principle
Do NOT represent a BJJ position purely as raw bone rotations (fragile, not reasonable
semantically). Positions should be semantic — position name + each player's
orientation + a list of typed constraints, e.g. `{ "type": "leg_wrap", "player":
"bottom", "target": "top.torso" }`. Raw solved bone transforms can be stored as the
final state, but are NOT the primary representation.

## 8. Prototype UI
Extremely simple: left = positions list; center = 3D scene; right = per-player
controls (hip / knee / foot / hand); bottom bar = camera / zoom / skeleton /
transparency. No beauty.

## 9. Milestone 1 — One Character
Prove: character + skeleton load, bones identifiable, a selected bone rotates, original
pose restorable. Provide a bone dropdown, X/Y/Z controls, reset bone, reset all,
skeleton visualization. **When changing a bone, preserve the original Mixamo
transform** — store the original quaternion and apply a delta
(`original ⊗ user-delta = current`); do NOT blindly set `bone.rotation.x`.

## 10. Milestone 2 — Two Characters
Two independent copies (Player A / Player B), each with independent skeleton,
transforms, and pose state; movable independently; simple labels. No networking or
persistence yet.

## 11. Milestone 3 — IK (first major technical milestone)
Do not make the user manipulate individual bones. Introduce IK targets; dragging a foot
target solves hip→thigh→knee→shin→ankle→foot. Use a suitable existing IK
implementation/library — candidates: Three.js IK solutions, CCD, FABRIK, analytic
two-bone IK, existing humanoid IK libs. First goal is reliability, not sophistication;
don't build a sophisticated solver from scratch without a strong reason.

## 12. Milestone 4 — Contact Constraints
Explicit contact targets, e.g. `A.rightFoot → B.leftHip` (and hand→wrist, knee→chest,
head→chest). The foot stays approximately attached when the target body moves. The
constraint engine is SEPARATE from the IK solver: constraint (`A.foot = B.hip +
offset`) → IK target → IK solver → A leg bones.

## 13. Milestone 5 — First BJJ Position: Closed Guard (NOT K Guard)
A convincing approximation, not biomechanical perfection. Bottom player: supine, legs
wrapped around top player's torso, feet approximately crossed/connected behind
opponent, knees approximately toward opponent's sides, torso toward opponent. Top
player: kneeling or appropriate starting posture, torso above bottom, reasonable hip
and head relationship.

## 14. Closed Guard Semantic Model
e.g. bottom orientation = supine; top orientation = kneeling; constraints:
bottom.left_thigh → top.right_hip; bottom.right_thigh → top.left_hip; bottom.left_foot
→ top.back; bottom.right_foot → top.back; bottom.pelvis relative to top.pelvis;
bottom.chest toward top.chest. Establish a semantic model rather than a pile of Euler
rotations.

## 15. Critical Interaction Test (more important than adding positions)
- A: move the top player backward → bottom's legs preserve their relationship.
- B: move the top player's hips → bottom's hooks/legs follow within reasonable limits.
- C: move bottom's pelvis → the relationship remains coherent.
- D: move a foot target → the leg solves naturally (no manual knee/hip rotation).
- E: break a constraint intentionally → the system releases it.

## 16. Collision Detection
No sophisticated physics initially. Eventually prevent obvious clipping (arm/leg
through torso, head inside chest) via bounding spheres / capsules / simplified segments
/ distance constraints. No soft-body.

## 17. Do Not Build Full Physics
Not a physics simulator (no gravity/friction/weight/impact/muscle/tissue/cloth). The
purpose is to construct and visualize a position via kinematic constraints.

## 18. Camera
Orbit / pan / zoom / reset. Presets (Top / Front / Back / Side / 45° / Player A POV /
Player B POV) later — secondary to the positioning engine.

## 19. Skeleton Visualization
At least Normal / Skeleton; eventually Normal / Transparent / Skeleton — important for
seeing where hidden limbs actually are.

## 20–23. Position Library / Editor / Modes / Sequences (LATER — not the prototype)
A semantic library (Guard / Passing / Pins / Turtle families); a high-level position
editor (per-player hip/knee/foot/hand/head, plus BJJ controls like knee-shield height/
angle, underhook depth, hook inside/outside); two editing modes — **BJJ Mode**
(high-level: move hip / knee shield / hook / grip / head, adjust posture) and **Anatomy
Mode** (low-level bones); position sequences / timeline. Only build **Closed Guard** in
the prototype.

## 24. AI Integration — Future Architecture
AI must NOT manipulate Three.js bones directly. Flow: user natural language → LLM →
semantic BJJ constraints (JSON) → constraint engine → IK solver → skeleton → Three.js.
The deterministic geometry engine solves the actual pose. This separation is important.

## 25. Future Video-to-Position (NOT the prototype)
Upload an instructional video → detect approximate positions over time → reconstruct
approximate 3D positions. The semantic representation should not make this impossible
later.

## 26. What NOT to Build Yet
No auth, payments, database, cloud storage, user accounts, social sharing, marketplace,
mobile app, cloth sim, advanced character customization, facial animation, mocap,
video-to-3D, AI generation, hundreds of positions, animation timeline, export formats,
multiplayer, advanced lighting, photoreal rendering — all distractions until the core
positioning engine works.

## 27. Success Criteria
Open the browser and: see two humanoids → select either → manipulate → select an IK
target → drag a foot → see the leg solve naturally → attach the foot to the other
player's body → move the other player → relationship stays approximately intact →
select "Closed Guard" → two players auto-enter a recognizable closed guard → adjust
without manually manipulating individual bones. If this works, the hypothesis is
validated.

## 28. Development Philosophy
Move aggressively; prefer a working ugly prototype over beautiful architecture with no
working BJJ position — but avoid shortcuts that would block eventual semantic
constraints. Good shortcut: use the Mixamo character (replaceable). Bad shortcut:
hard-code 200 bone rotations for Closed Guard and call it a position engine.

## 29. First Development Session (only this)
Load Mixamo FBX → display character → display skeleton → enumerate bones → correctly
manipulate a bone → add second character → verify independent skeleton state →
implement one simple IK chain → add a draggable foot target → demonstrate the foot
moving through IK. Do NOT proceed to Closed Guard until #10 works reliably.

## 30. Second Session
Two-character coordinate system; Player A / B transforms; IK target viz; contact point
viz; foot-to-target constraint; body-to-body relative positioning; basic collision/
proximity checking. Then begin Closed Guard.

## 31. Third Session
Closed Guard: bottom + top players, leg/foot constraints, pelvis relationship, basic
posture, move the top player, adjust the bottom player, reset. Then STOP and evaluate.
Don't immediately add more positions.

## 32. Most Important Product Principle
The app should answer **"What BJJ relationship am I trying to create?"** rather than
**"Which bone do I rotate?"** PoseMy.Art is a generic human poser; this becomes a BJJ
relationship / position system rendered in 3D. The 3D characters are the visualization
layer; the real product is the BJJ constraint/position engine.

## 33. Expected Long-Term Architecture
BJJ Application → (Position Library, Position Editor) → Semantic Position → Constraint
Engine → Multi-body IK → (Player A skeleton, Player B skeleton) → Three.js → Browser.
Preserve this direction without building the full system now.

## 34. Final Instruction to Coding Agent
Not a request to build the whole product. Build the smallest working technical
experiment that proves the central hypothesis. First demo: two Mixamo humanoids in
Three.js with a working IK-controlled limb and a simple relationship between that limb
and the other player's body. Then: two humanoids automatically entering and maintaining
a recognizable Closed Guard. Only after that: more positions, polished UI, persistence,
AI, animation, commercial infrastructure.
