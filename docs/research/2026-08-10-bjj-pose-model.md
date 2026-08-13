# Research: what would it take to train our own BJJ model?

*Covers both readings of the question: a **cue→image generative** model (§0) and a
**pose/keypoint** model (§1 onward). The answer is "don't train" in both cases, but for
completely different reasons — and §0 is the one that validates the current architecture.*

**Date:** 2026-08-10 · **Status:** research only, no build · **Context:** handoff
`/tmp/flowlog-bjj-model-training-handoff.md`; map [#10], framework [#17], spike [#12],
skin [#24], view model [#25].

> Every factual claim below links to a primary source. Anything that is my own
> arithmetic or judgement is labelled **(estimate)** or **(judgement)**.

---

## Bottom line

**Don't train a model for v1. There is nothing to train it for yet.**

Three findings drive that, in order of weight:

1. **A trained pose model cannot produce what the authoring bottleneck actually
   consumes.** [#17]'s keypoint model is two layers — a geometric skeleton *and* a
   per-position **semantic role map**. A pose model outputs layer 1 only. Worse, our
   authored skeletons are not anatomical: they are *drawing* skeletons, 10–13 joints,
   position-specific joint names, one arm where the second is occluded
   (`scripts/issue18/seed/*.json`, compared below). No detector emits that vocabulary,
   and no authored file could serve as a training label — **there is no image paired
   with any of them.** The authored coordinates were drawn, not traced from a photo.
2. **Off-the-shelf, Apache-licensed models are good enough for the assisted-authoring
   job**, because the human stays in the loop and only needs a head start. The
   published interactive-annotation result is a **>10× annotation-cost reduction**
   with a human correcting model output ([Click-Pose](https://arxiv.org/abs/2308.10174)).
   That is the cheap 80% of the upside, with zero training.
3. **The genuine payoff — pose on the user's own roll footage — is the video horizon,
   and when it arrives the recipe is already published.** Someone has already
   fine-tuned ViTPose on grappling data and reported the numbers
   ([Patel](https://www.kevinbpatel.com/work/jiu-jitsu)). The dataset they used is
   MIT-licensed and free.

So: **buy (off-the-shelf, assisted authoring) now; fine-tune (not train) later, gated
on video.** The decision gates are at the end.

---

## 0. Scope correction — the generative question (added after review)

The handoff scoped this research to a **pose/keypoint** model and put a generative model
out of scope. The actual question being asked is broader:

> *Should Flowlog train its own model that takes a cue and generates an image depicting
> it — emphasising the hidden elements: where to put pressure, where the base is, which
> direction to push or pull?*

That is **not** the same question [#12] answered. #12 proved that **off-the-shelf**
generation (Gemini) fails. "Would a model *we trained* fix it?" is a separate question,
and it was unanswered. Answering it below.

**Short answer: no — and the research literature has independently converged on the
architecture Flowlog already pivoted to.**

### 0.1 The training data is the deliverable (the fatal circularity)

To train a cue→diagram generator you need thousands of pairs: *this cue* → *this
correct force diagram*. Nobody on earth has that dataset. Making it means the panel
authoring thousands of correct diagrams by hand — at which point **you already have the
library and no longer need the model.** The input to the model is the thing the model was
supposed to produce.

This is qualitatively worse than the pose case. For pose, the data exists and is free
(Harmony4D, MIT). For cue→diagram, the data cannot be bought, scraped, or licensed at any
price, because it has never existed.

### 0.2 Image models are structurally bad at exactly this, and fine-tuning barely helps

This isn't a prompt-quality problem or a model-generation problem. It is the known,
measured weak spot of the entire diffusion approach:

- **Spatial reasoning is the bottleneck, not a detail.** *Everything in Its Place*
  (2026) evaluated **21 state-of-the-art models** across 1,230 spatially-dense prompts and
  found "higher-order spatial reasoning remains a primary bottleneck"
  ([arXiv:2601.20354](https://arxiv.org/abs/2601.20354)). On GenEval's compositional
  dimensions — which include spatial positioning — the best models scored **0.61 overall**.
- **Fine-tuning moves it a few percent.** The same work reports fine-tuning gains on
  SDXL / UniWorld-V1 / OmniGen2 of **+4.2%, +5.7%, +4.4%**. **(judgement)** Against a
  *never-misleading* floor, a single-digit improvement on a ~0.6 baseline is not a
  different product — it is the same product failing slightly less often. This is the
  direct answer to "would training our own fix it": measurably, no.
- **Arrows and labels are the specific failure.** DiagrammerGPT (COLM 2024) states
  plainly that SOTA text-to-image models "fail at diagram generation because they lack
  fine-grained object layout control when many objects are densely connected via complex
  relations such as **arrows/lines**" and "fail to render comprehensible text labels"
  ([paper](https://arxiv.org/pdf/2310.12128), [project](https://diagrammergpt.github.io/)).
  Arrows-with-meaning *is* Flowlog's entire grammar. CAGE (2026) puts it more bluntly:
  open-source diffusion models "catastrophically garble text labels"
  ([arXiv:2604.09691](https://arxiv.org/html/2604.09691v1)).
- **A generator has no notion of correctness. (judgement)** It optimises for *plausible*,
  not *true*. There is no threshold at which a stochastic pixel generator can be trusted
  to place a pressure arrow on the correct hip unattended — and correctness is exactly
  what the (b) floor demands.

### 0.3 The literature's answer is the pivot Flowlog already made

This is the finding worth the most. Asked to generate accurate diagrams, the research
field's answer is **not** "train a better image model" — it is *split the problem*:

| Paper | Their architecture |
|---|---|
| **DiagrammerGPT** | An LLM plans a structured **"diagram plan"** — entities and their relationships — then a **renderer + label module** draws it |
| **CAGE** | **Code-anchored** generation: LLM emits code, which "guarantees label correctness"; pure diffusion is visually rich but garbles content |

That is, line for line, [#10] decision #5–#8 and the [#18] prototype: **LLM emits a
closed keypoint×grammar spec → deterministic SVG renderer draws it.** Two independent
research groups arrived at Flowlog's architecture from the opposite direction. CAGE also
names the residual cost honestly — code-based output is *accurate but visually flat* —
which is precisely what [#24]'s skin question is about.

**(judgement)** So the pivot wasn't a retreat from generation; it was arriving early at
where the field ended up. The cue *does* generate the image — the AI just does the
**semantic** work (which cue → which annotations, where) while the renderer guarantees
the **geometry**. That split is why it can clear a correctness floor at all.

### 0.35 "Use BJJ instructionals — the narration is the cue, the footage is the image"

A proposed fix for §0.1's missing dataset: instructionals already pair *spoken cue* with
*demonstrated move*, at scale, for free. **The instinct is right** — narrated instructional
video is exactly how large video-language models are built ([HowTo100M](https://www.emergentmind.com/topics/howto100m-dataset):
136M clips / 1.22M narrated videos, captions from ASR). We already run Whisper, so
transcription is solved. It genuinely defeats the "the data doesn't exist" objection.

It still fails, for three reasons — the first fatal, the third disqualifying.

**1. The thing we need to predict is not in the pixels. (judgement — but it is the
product thesis restated.)**

An instructional frame shows **the position**. It does not show pressure, base, or
push/pull direction — those are *invisible*, which is the entire premise of Flowlog's
white space ([#12]: "nobody visualizes the hidden mechanics"). A model can only learn what
is present in its target. Train on (narration → frame) and you get a model that produces
**a picture of two people in a position** — no arrows, no forces, because it never saw
one. That is not a hypothesis: it is precisely what [#12] measured when reference-
conditioning "faithfully COPIES the reference and ignores the cue."

*If the mechanics were visible in instructional footage, the footage would already be the
product.* The dataset is enormous and free and **still missing the label**, exactly as in
§0.1 — the arrows have to come from a human either way.

**2. The pairing is far weaker than it looks.** Measured on HowTo100M by
[Temporal Alignment Networks](https://arxiv.org/abs/2204.02968) (CVPR 2022, Oxford VGG):
**only 30% of narration sentences are visually alignable at all, and only 15% are
naturally well-aligned** — i.e. the demonstrator describes what they are doing, as they
do it, about **one time in seven**. Up to 70% of subtitle lines don't describe a visible
action. BJJ instructionals are a *worse* case than cooking videos: coaches narrate
retrospectively ("what I did there was…"), prospectively ("what you're going to feel
is…"), and — critically — spend much of the time describing **mistakes and what *not* to
do**, while demonstrating the correct version. A naive pairing would train the model that
the error position matches the error description as a thing to depict. Plus ASR noise on
heavy Portuguese-influenced grappling vocabulary.

**3. Legal — this is the worst possible corpus to pick. (judgement, on §6's law.)**
Instructionals are the most aggressively protected content in BJJ and a primary income
source for the sport's athletes (premium instructionals sell for hundreds of dollars).
Scraping them breaches YouTube's ToS (§6); a purchased instructional's licence grants
viewing, not training rights, and *Bartz* treated **acquisition** separately from
training; and a pose/diagram model is **non-generative**, the *Ross* side of the fair-use
line. On top of the legal exposure: BJJ is a small community, these instructors are
Flowlog's natural **partners and customers**, and "trained on instructionals without
asking" is a reputational event, not just a legal one.

**What is worth salvaging (judgement — and it's real):** use the **transcripts as text**,
not the video as pixels. Mining instructional narration for *language* — which cues are
actually taught, how often, for which position — is a cheap text problem that feeds
things Flowlog already needs:

- **[#10] decision #3** (data-driven, head-first position seeding) — narration frequency
  tells you which ~20 positions and which cues per position genuinely earn a base.
- **The canonical position taxonomy + free-text→canonical-id normaliser** (noted in the
  cue-image-quality memory) — instructional language is the vocabulary users will use.
- **Sport vocabulary priming** for transcription, which `src/sports/bjj/` already does.

That is text mining for *product direction*, not training a model on someone's footage —
far lower risk, and it does not need a single frame of video.

### 0.4 Where a trained model *does* pay off under this framing

Reframing the question doesn't kill the model idea — it **relocates** it:

1. **Fine-tune the spec generator (the LLM stage), not a pixel generator.** ✅ **Cheapest
   real win on the table.** The task is cue-text → small JSON, so training pairs are
   compact and — unlike diagrams — you can actually accumulate them: [#10] decision #10
   already stores `grammar_version` / `base_library_version` / `spec_prompt_version` per
   session, and [#18] flagged **sparse/incomplete specs** as the measured failure. Every
   panel-corrected spec is a training pair. This is the model worth training first, and it
   is text-sized, not image-sized.
2. **Pose-conditioned generation for the *skin*, not the mechanics** — already scoped in
   the [#24] comment. The human locks the pose; generation only makes the figure look
   good. Addresses CAGE's "visually flat" problem without touching correctness.
3. **The pose model** — everything in §1 onward. Still gated on video.

**Ranked by value per unit of effort (judgement):** spec-generator fine-tune ≫ skin
generation > pose model ≫ cue→image generative model (which is not on the ladder at all).

The handoff names both. They have almost nothing in common technically.

| | **A. Assisted authoring** | **B. Video (user footage)** |
|---|---|---|
| Input | ~150 reference images *we choose* | arbitrary phone video of a real roll |
| Volume | ~150 poses, once | per user, per session, forever |
| Accuracy bar | "close enough that correcting beats drawing" | must clear the **(b) never-misleading floor** unattended |
| Human in loop | yes, always (panel certifies — [#24]) | no |
| Needs a custom model? | **No** | **Probably yes, eventually** |
| Also needs | role assignment (semantic, not detectable) | tracking, identity assignment, view/angle handling ([#25] C) |

Job A is a **tooling** problem. Job B is a **model** problem. Only B justifies training,
and B is post-v1 by the map's own framing.

---

## 2. Prior art: this has already been done for BJJ, twice

**This is the single most useful finding — we are not first, and both attempts are public.**

- **Hudovernik & Skočaj, MMSports 2022** — [*Video-Based Detection of Combat Positions
  and Automatic Scoring in Jiu-jitsu*](https://dl.acm.org/doi/10.1145/3552437.3555707).
  Tracks athlete poses in heavily occluded scenes by combining positional, structural
  and visual cues, then classifies combat position. Their
  [**Brazilian Jiu-Jitsu Positions Dataset**](https://vicos.si/resources/jiujitsu/) is
  downloadable: **120,279 labelled images**, 6 sparring sequences, 3 smartphone cameras,
  10 positions / 18 classes, poses in **MS-COCO 17-keypoint** format.
  - **Two catches.** Licence is **CC BY-NC-SA 4.0** — *non-commercial*, so it cannot
    train a model that ships in Flowlog. And the poses were **detected automatically**
    then manually *selected*, with "pose correctness not guaranteed" — the manual
    labels are the *position* classes, not the keypoints. It is a position-classifier
    dataset that happens to carry keypoints, not a pose ground-truth dataset.
- **Patel (independent)** — [*Jiu-Jitsu Match Auto Scoring with Computer
  Vision*](https://www.kevinbpatel.com/work/jiu-jitsu). Deformable DETR for person
  detection + **ViTPose fine-tuned on a subset of Harmony4D**, reaching
  **0.649 AP / 0.702 AR**. Reports exactly our documented failure mode: "the constant
  intertwining of athletes made standard pose tracking models struggle with identity
  swaps and missing keypoints," and concludes **dataset quality over quantity** —
  Harmony4D's close-interaction focus mattered more than volume.

**Read of those numbers (judgement):** 0.649 AP is a *research* result, not a product
one. It is a solid starting point for a human-corrected tool and nowhere near the (b)
floor for unattended rendering. It also confirms the ceiling isn't the keypoint
regressor — it's **person detection and identity assignment** when two bodies occupy one
bounding box. Any Flowlog effort would inherit that as the hard part, not joint
localisation.

Also relevant as competitor context: [TechniqueView](https://www.techniqueview.com/brazilian-jiu-jitsu-analysis)
ships a BJJ "AI pose analysis" skeleton overlay today — consistent with the [#12]
competitor review (generic pose overlay; nobody visualises the hidden mechanics).

---

## 3. Base models — fine-tune, never train from scratch

Licence is the deciding axis, not accuracy. All verified from the licence file itself.

| Model | Licence | Commercial? | Notes |
|---|---|---|---|
| **ViTPose / ViTPose++** | Apache-2.0 ([repo](https://github.com/ViTAE-Transformer/ViTPose)); HF port `usyd-community/vitpose-plus-base` is `apache-2.0`, 1.65M downloads (HF API) | ✅ | **The default choice.** Reported 75.8 / 78.3 / 79.1 AP (B/L/H) on COCO val, **88.0–90.9 AP on OCHuman** (occlusion benchmark). Native in HF `transformers`. The model both public BJJ efforts landed on. |
| **RTMPose / RTMO** (MMPose) | Apache-2.0 (verified `open-mmlab/mmpose/LICENSE`) | ✅ | The *deployment* answer: RTMPose-s **72.2 AP on COCO at 70+ FPS on a Snapdragon 865**, with ONNX/ncnn/TensorRT export ([paper](https://arxiv.org/abs/2303.07399), [project](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)). If pose ever runs on-device for video, this is the family. |
| **DWPose** | Apache-2.0 (verified `IDEA-Research/DWPose/LICENSE`) | ✅ | Whole-body. Already known to fail on our occlusion case ([#24] comment). |
| **Sapiens (v1)** | **CC-BY-NC 4.0** ([`facebook/sapiens-pose-1b`](https://huggingface.co/facebook/sapiens-pose-1b)) | ❌ | 308 keypoints, pretrained on 300M human images. **Non-commercial — disqualified for shipping.** Usable for internal reference-image prep only, and even that is arguable. |
| **Sapiens2** (Apr 2026) | Custom [Sapiens2 License](https://github.com/facebookresearch/sapiens2/blob/main/LICENSE.md) | ⚠️ **needs counsel** | Not NC — a Meta community-style licence granting commercial rights. **But** §1.b.vi expressly forbids use "(ii) for biometric processing" and "(i) for purposes of surveillance", and §1.c grants Meta **audit rights** over your use. Pretrained on 1B human images, 0.1B–5B params, native 1K (4K variant). |

**On Sapiens2 (judgement):** whether "run a pose estimator over a user's own training
video, with their consent, to teach them" counts as *biometric processing* is genuinely
unsettled — pose keypoints aren't identifiers, but the clause is broad and Meta reserves
the audit. It is the strongest model on the table and the one I would not adopt without
a lawyer reading that clause against our exact use. **ViTPose+ under Apache-2.0 has no
such question**, which is worth more than a few AP.

---

## 4. Data

### 4.1 What exists and is actually usable

| Dataset | Content | Licence | Verdict for Flowlog |
|---|---|---|---|
| **[Harmony4D](https://arxiv.org/abs/2410.20294)** (NeurIPS 2024, CMU) | **1.66M images, 3.32M human instances, 208 sequences, 24 subjects, 20+ synced cameras.** Activities include **wrestling, MMA, karate, grappling**. Annotations: detection, tracking, **2D/3D pose**, mesh. Markerless multi-view algorithm derives 3D pose *through* severe occlusion with minimal manual work. | **MIT** — verified on both the [code repo](https://github.com/jyuntins/harmony4d/blob/main/LICENSE) and the [HF dataset](https://huggingface.co/datasets/Jyun-Ting/Harmony4D) (`license: mit`, **ungated**, ~421 GB) | ✅ **The one to use.** Grapple-adjacent subsets are `02_grappling`, `03_grappling2`, `12–16_mma*`, `09–11_karate*`. Permissive licence + close-contact ground truth is a rare combination. |
| **[ViCoS BJJ Positions](https://vicos.si/resources/jiujitsu/)** | 120,279 images, real BJJ sparring, COCO-17 | **CC BY-NC-SA 4.0** | ❌ for training a shipped model. Possibly ⚠️ even for internal eval (NC covers commercially-motivated use). Its keypoints are machine-generated anyway. |
| **[Hi4D](https://yifeiyin04.github.io/Hi4D/)** | 20 subject pairs, 100 sequences, 11K+ frames, 4D scans of *prolonged contact* | Application form / approval required | ⚠️ Gated, small, lab-captured. Useful as an eval set for contact cases if approved. |
| **COCO / CrowdPose / OCHuman** | 118K / ~20K / 4K images; OCHuman is 8,110 heavily-occluded instances (32% at maxIOU ≥ 0.75) ([ViTPose++](https://arxiv.org/html/2212.04246v3)) | mixed, generally research-permissive | Pretraining is already baked into the checkpoints; OCHuman is the standard **occlusion eval**. |
| **Our own gym recordings** | — | ours, with consent | ✅ **The cleanest legal path and the one that matches our real distribution** (phone camera, gi, mats, our angles). |

**The key asymmetry:** Harmony4D is *wrestling and MMA*, mostly standing/scrambling,
captured by 20 studio-grade cameras. BJJ is *ground* grappling, gi, filmed from one phone
on a gym floor. Patel's 0.649 AP is a fine-tuned-on-Harmony4D number, and the residual
gap to our footage is exactly the domain gap [AthletePose3D](https://arxiv.org/html/2503.07499v1)
documents for sport in general — models trained only on conventional datasets went from
**213.64 mm MPJPE to 65.07 mm (−69.5%) after sport-specific fine-tuning**. That is the
argument for collecting our own data, and the reason a Harmony4D-only model won't be
enough on its own.

### 4.2 The authored library is **not** seed labels

The handoff hopes the authoring tool's exported JSON can bootstrap labels. It can't, for
two independent reasons — both verified against `scripts/issue18/seed/` on
`origin/feat/cue-image-generation`:

**(a) No images.** The coordinates were *drawn* on a normalised 820×520 canvas
(`keypoints.ts`), not traced from photographs. A keypoint label with no image is not a
training example. You would have to *render* the pose to pair it — and a rendered
stickman/fleshed SVG ([#24]) is a catastrophic domain gap from a real photo. (BEDLAM
shows synthetic-only training *can* reach SOTA — but with **clothing physics simulation,
varied lighting, skin tones and camera motion**, i.e. photorealistic rendering, not vector
skins: [BEDLAM](https://arxiv.org/html/2306.16940).)

**(b) The skeletons aren't anatomical.** Joint vocabularies differ per position *and* per
person:

```
back-mount      opp 10 joints, you 13 (u_shoulder/u_elbow/u_hand, o_shoulder/o_elbow/o_hand)
butterfly-guard opp 10,          you 10 (arm_*, l_/r_ legs)
closed-guard    opp 10,          you 10 (arm_*)
de-la-riva      opp 10,          you 10 (hook_knee, hook_foot, base_knee, base_foot)
```

Every `opp` figure has **one arm**. `de-la-riva` names legs by *function* (`hook_`,
`base_`) rather than side. There is no fixed left/right, no consistent joint count, and
occluded limbs are simply omitted. A COCO-17 detector cannot emit this, and this cannot
be normalised to COCO-17 without inventing the missing joints.

**Consequence (judgement):** even a perfect pose model automates **layer 1 of two**. The
role map (`hook_heel`, `posting_hand`, `heel_on_hamstring`) is *semantic* — it is the
part that carries the teaching, and it is not detectable. The bottleneck [#17] describes
is only partly a geometry bottleneck.

### 4.3 Labelling cost, if we did collect data

Vendor rates are **$0.01–$0.05 per keypoint**, with sports-analytics skeletons at the
high end ([BasicAI](https://www.basic.ai/blog-post/image-annotation-services-cost),
[Label Your Data](https://labelyourdata.com/articles/data-annotation/pose-estimation)).

**(estimate)** 17 keypoints × 2 people = 34 per frame → **$0.34–$1.70 per frame** before
QA:

| Frames | Vendor cost (est.) |
|---|---|
| 5,000 | $1.7k – $8.5k |
| 20,000 | $6.8k – $34k |
| 100,000 | $34k – $170k |

**Treat those as a floor, and probably a fiction (judgement).** Those rates assume a
labeller can *see* the joint. In grappling the load-bearing joints are occluded by
definition — a labeller must *infer* where an unseen hip is, and two competent labellers
will disagree. That is a **black-belt-panel adjudication** problem, not a $0.02/keypoint
problem, and it is precisely why Harmony4D solved it with **20 synchronised cameras and a
markerless multi-view algorithm** rather than with annotators. Any serious Flowlog data
collection should copy that: **multi-view capture derives the labels; humans only audit.**

### 4.4 The cheap bootstrap that actually works

Not synthetic renders — **interactive annotation**. Click-Pose has the model propose,
the human click only the wrong joints, and the model update in-loop: **31.4% fewer clicks
than manual annotation with ViTPose on COCO, 36.3% on Human-Art, >10× total annotation
cost reduction** ([Click-Pose](https://arxiv.org/abs/2308.10174)). This is the same
mechanism as "assisted authoring" in the handoff, and it doubles as the data-collection
engine if we ever go to video: **every pose the panel corrects in the authoring tool is a
labelled training example** — provided the tool captures the *source image* alongside the
corrected skeleton, which today it does not. That is the one cheap change worth making
now (see gates).

---

## 5. Compute, cost, timeline

**Compute is a rounding error. Do not let it into the decision.**

H100 rental has collapsed to **$1.49–$3.99/GPU-hr** at Lambda/RunPod/Vast, vs $3–4 at
AWS/GCP; A100 80GB runs **$1.19–$1.99/hr**
([IntuitionLabs](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison),
[CloudZero](https://www.cloudzero.com/blog/h100-gpu-cost/)) — down 64–75% since Q4 2024.

**(estimate)** Fine-tuning ViTPose-B (86M params) on 10–50k images is a **single-GPU,
hours-to-a-day job: well under $100**. Even an 8×H100 multi-day full run is $1–3k. Patel
hit *memory* limits, not cost limits — a rented 80GB card removes that entirely.
Harmony4D's 421 GB adds a one-off storage/egress cost, not a meaningful one.

**Where the time actually goes (estimate):**

| Phase | Realistic effort |
|---|---|
| Harmony4D download, subset, convert to MMPose format | 1–2 weeks |
| Baseline: off-the-shelf ViTPose+ vs fine-tuned, on a held-out BJJ eval set | 1–2 weeks |
| Build the eval set (this is the real work — see §7) | 2–4 weeks |
| Own-footage capture + multi-view rig + consent | 4–8 weeks |
| Iterate detection/identity-assignment (the actual hard part) | open-ended |

**So: ~2 months to a defensible answer, ~6 months to a shippable video model, and ~$0 of
that is GPU.** The cost is a person's attention — which is the scarce resource, and is
currently pointed at a v1 that doesn't need this.

---

## 6. Legal

- **Instructional footage / YouTube.** YouTube's ToS prohibit unauthorised scraping and
  downloading; since Dec 2024 creators **opt in** to third-party AI training, off by
  default ([YouTube Help](https://support.google.com/youtube/answer/15509945),
  [TechCrunch](https://techcrunch.com/2024/12/16/youtube-will-let-creators-opt-out-into-third-party-ai-training/)).
  Scraping instructionals is a ToS breach independent of any copyright question.
- **Copyright / fair use is unsettled.** *Bartz v. Anthropic* (N.D. Cal., Jun 2025) found
  training itself "exceedingly transformative" and fair use — while treating the
  **acquisition** of pirated copies separately. *Thomson Reuters v. Ross* went the other
  way for a non-generative tool, distinguishing it precisely *because* it wasn't
  generative ([Skadden](https://www.skadden.com/insights/publications/2025/07/fair-use-and-ai-training),
  [Akin](https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/district-court-rules-ai-training-can-be-fair-use-in-bartz-v-anthropic)).
  **A pose estimator is non-generative** — i.e. it sits on the *Ross* side of that line,
  the worse side. **(judgement)** Do not build a training corpus from copyrighted
  instructionals.
- **Likeness and biometrics.** Illinois **BIPA** carries a private right of action and
  requires notice + consent; Illinois also amended its Right of Publicity Act in 2024 for
  digital replicas, and there is active litigation over AI training on broadcast footage
  ([Nat'l Law Review](https://natlawreview.com/article/2025-year-review-biometric-privacy-litigation),
  [Jackson Lewis](https://www.workplaceprivacyreport.com/2024/08/articles/artificial-intelligence/new-illinois-laws-address-use-of-generative-ai-and-digital-likeness-publicity-rights/)).
  Competition footage of identifiable athletes is the highest-risk corpus available.
- **The clean path** is therefore also the technically best one: **our own recordings,
  with written consent, of consenting training partners.** It is the only corpus with no
  ToS, no copyright, and no publicity exposure — and it matches our deployment
  distribution better than anything we could scrape.

---

## 7. Evaluation

Standard metrics are necessary but **not** our bar.

- **Standard:** OKS-based **AP/AR** (Patel's 0.649/0.702 is the number to beat);
  **PCK**; **OCHuman AP** as the occlusion sanity check (ViTPose-B baseline: 88.0).
- **What actually matters for Flowlog (judgement):**
  1. **Per-joint PCK on occluded joints only.** Aggregate AP is dominated by heads and
     shoulders, which are visible and useless to us. The teaching lives in feet, hips,
     and hands — often hidden. Report those separately or the metric lies.
  2. **Identity-assignment accuracy** — % of frames where every joint is attributed to
     the right person. This is the failure mode both prior efforts hit, and a single
     swap makes a diagram *misleading*, which is a (b)-floor violation, not a small error.
  3. **Foot/toe orientation**, which `keypoints.ts` treats as authored and independent of
     the shin — and which **no COCO-17 detector predicts at all**. A whole-body model
     (DWPose/Sapiens-class) would be required, re-opening the licence question.
  4. **Time-to-correct**, for the authoring job. If a panel member fixes a suggested pose
     faster than drawing it, the model has paid for itself regardless of AP.
- **Ground truth** should come from **multi-view capture** (Harmony4D's method), with the
  **black-belt panel adjudicating** contested occluded joints — the panel is the
  correctness authority under map decision #2, and that extends to pose ground truth.

---

## 8. Build vs buy vs partner

| Option | Verdict |
|---|---|
| **Buy / adopt off-the-shelf** (ViTPose+, Apache-2.0) as a *suggestion* in the authoring tool, human-corrected | ✅ **Do this, if and when authoring volume justifies tooling at all.** Zero training, zero licence risk, published >10× annotation saving. |
| **Fine-tune** ViTPose/RTMPose on Harmony4D (MIT) + own footage | ⏸ **Correct approach, wrong time.** Recipe is published; cost is a person's months, not GPUs. Gate on video. |
| **Train from scratch** | ❌ Never. No credible argument; the pretrained backbones encode 300M–1B human images. |
| **Partner** — CMU Harmony4D authors, or Hudovernik/Skočaj (Ljubljana) | 💡 **The underrated option.** Both groups have solved the exact sub-problem, published, and released under permissive terms. A dataset collaboration (we bring gi/ground BJJ footage + a black-belt panel; they bring the multi-view rig and the tracking algorithm) is cheaper than either building or buying. Worth an email long before it's worth a GPU. |
| **Licence a vendor API** | ❌ No grappling-specific pose vendor found. TechniqueView is a *competitor product*, not a supplier. |

---

## 9. Recommendation and decision gates

**Now (v1): train nothing.** The map's own reuse economics hold — a bounded ~150-position
library, authored once, does not amortise a model. Confirmed, not just asserted: the
authored library couldn't train a model even if we wanted one (§4.2).

**One cheap thing worth doing now (judgement):** make the authoring tool store the
**source reference image** alongside each authored skeleton, and keep every correction.
It costs almost nothing today, it is the *only* way the base library ever becomes a
training corpus, and it is unrecoverable later — you cannot retrofit images onto poses
already drawn. Treat it as optionality, not as a model project.

**Gates that would flip this to a real effort — any one of:**

| Gate | Why it flips the answer |
|---|---|
| The base library needs to exceed **~300–400 positions**, or the panel is the throughput limit | Assisted authoring stops being a nice-to-have; adopt off-the-shelf ViTPose+ first, fine-tune only if its suggestions are too poor to correct |
| **Video input ships or is charted** ([#25] C / [#10] "not yet specified") | This is the real trigger. Unattended pose on user footage at the (b) floor is not reachable off-the-shelf — 0.649 AP is the published grappling state of the art |
| Someone releases a **grappling-fine-tuned, permissively-licensed** checkpoint | Buy instantly; re-run this analysis |
| We accumulate consented gym footage as a by-product of the product | The expensive input arrives free; the calculus changes |

**If a gate opens, the first two weeks are fixed and cheap:** download Harmony4D
(MIT, free), evaluate off-the-shelf ViTPose+ against a fine-tune on its
grappling/MMA subsets, on a small hand-labelled BJJ eval set of *our* footage. That
single experiment reproduces the only published grappling baseline and tells us the
domain gap in real numbers, for roughly the cost of a GPU afternoon. **Everything else in
this document is downstream of that measurement.**

---

## Sources

Primary sources, grouped.

**Prior art (BJJ):**
[Hudovernik & Skočaj, MMSports 2022](https://dl.acm.org/doi/10.1145/3552437.3555707) ·
[ViCoS BJJ Positions Dataset](https://vicos.si/resources/jiujitsu/) ·
[Patel, Jiu-Jitsu auto-scoring](https://www.kevinbpatel.com/work/jiu-jitsu) ·
[TechniqueView](https://www.techniqueview.com/brazilian-jiu-jitsu-analysis)

**Models:**
[ViTPose repo](https://github.com/ViTAE-Transformer/ViTPose) ·
[ViTPose++ paper](https://arxiv.org/html/2212.04246v3) ·
[vitpose-plus-base on HF](https://huggingface.co/usyd-community/vitpose-plus-base) ·
[RTMPose paper](https://arxiv.org/abs/2303.07399) ·
[RTMPose project](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose) ·
[MMPose](https://github.com/open-mmlab/mmpose) ·
[DWPose](https://github.com/IDEA-Research/DWPose) ·
[sapiens-pose-1b (CC-BY-NC)](https://huggingface.co/facebook/sapiens-pose-1b) ·
[Sapiens2 repo](https://github.com/facebookresearch/sapiens2) ·
[Sapiens2 License](https://github.com/facebookresearch/sapiens2/blob/main/LICENSE.md)

**Datasets:**
[Harmony4D paper](https://arxiv.org/abs/2410.20294) ·
[Harmony4D code (MIT)](https://github.com/jyuntins/harmony4d) ·
[Harmony4D data (HF, MIT)](https://huggingface.co/datasets/Jyun-Ting/Harmony4D) ·
[Hi4D](https://yifeiyin04.github.io/Hi4D/) ·
[AthletePose3D](https://arxiv.org/html/2503.07499v1) ·
[BEDLAM](https://arxiv.org/html/2306.16940)

**Generative diagrams (§0):**
[Everything in Its Place — spatial benchmark, 21 models](https://arxiv.org/abs/2601.20354) ·
[DiagrammerGPT paper](https://arxiv.org/pdf/2310.12128) ·
[DiagrammerGPT project](https://diagrammergpt.github.io/) ·
[CAGE — accuracy/aesthetics gap in educational diagrams](https://arxiv.org/html/2604.09691v1) ·
[T2I-CompBench++](https://ieeexplore.ieee.org/iel8/34/10958761/10847875.pdf) ·
[HowTo100M](https://www.emergentmind.com/topics/howto100m-dataset) ·
[Temporal Alignment Networks (30%/15% alignment figures)](https://arxiv.org/abs/2204.02968)

**Annotation & cost:**
[Click-Pose](https://arxiv.org/abs/2308.10174) ·
[BasicAI annotation pricing](https://www.basic.ai/blog-post/image-annotation-services-cost) ·
[Label Your Data — pose estimation](https://labelyourdata.com/articles/data-annotation/pose-estimation) ·
[IntuitionLabs H100 rental comparison](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison) ·
[CloudZero H100 cost](https://www.cloudzero.com/blog/h100-gpu-cost/)

**Legal:**
[YouTube — your content & third-party training](https://support.google.com/youtube/answer/15509945) ·
[TechCrunch on YouTube AI-training opt-in](https://techcrunch.com/2024/12/16/youtube-will-let-creators-opt-out-into-third-party-ai-training/) ·
[Skadden — fair use & AI training](https://www.skadden.com/insights/publications/2025/07/fair-use-and-ai-training) ·
[Akin — Bartz v. Anthropic](https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/district-court-rules-ai-training-can-be-fair-use-in-bartz-v-anthropic) ·
[Nat'l Law Review — 2025 biometric privacy litigation](https://natlawreview.com/article/2025-year-review-biometric-privacy-litigation) ·
[Jackson Lewis — Illinois digital likeness laws](https://www.workplaceprivacyreport.com/2024/08/articles/artificial-intelligence/new-illinois-laws-address-use-of-generative-ai-and-digital-likeness-publicity-rights/)

[#10]: https://github.com/srjt/flowlog/issues/10
[#12]: https://github.com/srjt/flowlog/issues/12
[#17]: https://github.com/srjt/flowlog/issues/17
[#24]: https://github.com/srjt/flowlog/issues/24
[#25]: https://github.com/srjt/flowlog/issues/25
