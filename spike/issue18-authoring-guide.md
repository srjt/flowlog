# Authoring correct BJJ base poses — a guide for the panel

**What this is.** Flowlog turns a coaching cue into a *force diagram* — a clean figure
of the position with arrows/pressure/base drawn on top. The **figure** is not
generated; it's drawn from **keypoints you place** (a skeleton for both players).
This tool is how you place those keypoints correctly. **You are the ground truth** —
if the pose is wrong, every diagram built on it is wrong.

The tool is a single file: **`spike/issue18-authoring-tool.html`** — open it in any
browser (double-click, or serve the folder). Nothing is uploaded; it all runs locally.

## The mental model (2 layers)

1. **Skeleton** — for each person (`you` and `opp`), a set of **named joints**
   (`head`, `neck`, `shoulder`, `hip`, `knee`, `foot`, arm joints…) connected by
   **bones**. This is the body.
2. **Role map** — **named anchor points the cues reference** (`hook_heel`,
   `opp_hamstring`, `posting_forearm`…). A role is either a joint, the **midpoint**
   of two joints, or a **contact point** you click. Arrows attach to *roles*, not
   raw joints, so name them the way a coach talks.

The **reference image is a tracing backdrop only** — it is never exported.

## Workflow

1. **Load a reference.** *Reference backdrop → Choose File.* Use a clean photo or
   diagram of the position from a **side view**, both players visible. Adjust opacity.
2. **(Fixing an existing pose?)** *Load / import → Choose File* (or paste the seed
   JSON) → **Load JSON**. The pose appears on the canvas to adjust.
3. **Name the position.** Fill `id` (e.g. `de-la-riva`), `label`, `view` (`side`).
4. **Place joints.** Pick the person tab (**you** / **opp**). Type a joint name,
   click **Place ▶**, then click on the reference where that joint is. Tick **head**
   for the head joint. **Drag** any dot to fine-tune. Name joints meaningfully.
5. **Wire bones.** Connect adjacent joints (neck–hip, hip–knee, knee–foot, …).
6. **Feet / toe direction.** Place a **toe point** for each foot — **toe/heel
   direction is load-bearing in BJJ** (a de la riva heel vs a flat foot), so authored,
   not guessed.
7. **Flip to `Fleshed (real)`.** This is the *actual* figure users see. **Adjust the
   joints until it reads as unmistakably this position** — this is the bar (below).
8. **Add roles.** Under *Roles*, add every anchor the cues need — `joint`,
   `midpoint` of two joints, or a clicked `point` (e.g. a heel-on-hamstring contact).
   Convention: **`your_*` / `opp_*`**, natural nouns.
9. **Check the overlay.** Under *Overlay preview*, paste a cue's spec (or build one
   annotation at a time) and **Render** — confirm the **arrows land on the right
   roles**. Move roles/joints until they do.
10. **Export.** *Export → Download.* Send the `.json` back to be dropped into
    `scripts/issue18/seed/` and rendered in the gallery.

## The bar (what "certified" means)

- **Floor — never misleading:** a training partner glancing at it must recognize the
  position correctly. A top player drawn *standing* in closed guard, or a bottom
  player *lying flat* in de la riva, **fails** — that's below the floor and ships
  nothing.
- **Head positions — expert-correct:** for the common positions, it should read right
  to a black belt: limb angles, who's on top, the defining detail (the DLR hook, the
  closed-guard ankle-lock, butterfly hooks under the thighs).

## Tips

- One clean **side-view** reference per position beats a busy action shot.
- Place **both** players fully — a missing or vertical opponent is the usual "looks
  wrong" cause.
- Use **Fleshed** while placing, not just stickman — a pose that looks OK as sticks
  can render wrong with volume.
- Keep roles minimal but complete: every arrow a cue might draw needs an anchor.
