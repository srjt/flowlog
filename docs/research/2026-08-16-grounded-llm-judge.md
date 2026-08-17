# Research: how do you build a grounded LLM judge that doesn't flatter the generator?

*Prior art for map [#30] decision 4 — "a judge with a source, not a judge with an
opinion" — and for the judge-design ticket [#35]. Scope: judging **cue text** for
**correctness** against Danaher* Go Further Faster: Escapes *transcripts, with **no
expert panel** and a spot-check-sized human budget.*

**Date:** 2026-08-16 · **Status:** research only, no build · **Context:** ticket [#33],
map [#30]. Sibling map [#10] (cue images) is unaffected.

> Every factual claim below links to a primary source, with its **publication date** —
> this area moved a lot in 2025–2026 and several 2023-era rules of thumb are now wrong.
> Anything that is my own reasoning is labelled **(judgement)**. Anything I could not
> verify from the source itself is labelled **(unverified)** and should be re-checked
> before it is relied on.

---

## Bottom line

**The grounding bet is directionally right but the map states it in a form the evidence
does not support.** Three things need to change before [#35] is designed.

1. **"Give the judge the instructional" is not the intervention that works. "Decompose
   the cue into atomic claims and check each one against a retrieved passage" is.**
   The measured wins all come from *decomposition + per-claim verification*, not from
   putting source text in a judge's context window. RAGAS's faithfulness metric —
   split the answer into statements, verify each against the context — hit **95%**
   agreement with human annotators where the *same model* asked to score the same
   answers holistically on 0–10 hit **72%**, and asked to rank hit **54%**
   ([Ragas, Sep 2023](https://arxiv.org/abs/2309.15217)). That 23-point gap is the
   single most transferable number in this document, and it is a gap between two
   *grounded* judges. The architecture matters as much as the evidence.

2. **Grounding actively backfires on claims the corpus does not cover — and the map's
   corpus covers only escapes.** Google's *Sufficient Context* work found Gemma's
   hallucination rate went from **10.2% with no context at all to 66.1% when given
   insufficient context**, and that the strongest models "excel at answering queries
   when the context is sufficient, but often output incorrect answers instead of
   abstaining when the context is not"
   ([Google Research, ICLR 2025](https://research.google/blog/deeper-insights-into-retrieval-augmented-generation-the-role-of-sufficient-context/),
   [arXiv:2411.06037](https://arxiv.org/abs/2411.06037)). Abstention is therefore not a
   scoping nicety (map decision 7) — **it is load-bearing for the grounding claim
   itself.** A retrieval-hit gate must run *before* the judge, not as a fallback after it.

3. **A different judge family buys much less independence than the map assumes.**
   *Nine Judges, Two Effective Votes* ran 9 frontier judges from **7 model families**
   and measured **2.18 effective independent votes** (95% CI [2.07, 2.31]), mean
   pairwise error correlation **φ̄ = 0.391**; the panel beat its best single member by
   **+0.2pp** on MNLI and *lost* by **6.5pp** on SNLI and **2.5pp** on AlphaNLI
   ([arXiv:2605.29800](https://arxiv.org/html/2605.29800v1), 28 May 2026). And the
   self-preference mechanism is not authorship — it is *familiarity*: judges "assign
   significantly higher evaluations to outputs with lower perplexity than human
   evaluators … regardless of whether the outputs were self-generated"
   ([arXiv:2410.21819](https://arxiv.org/abs/2410.21819), Oct 2024 / rev Jun 2025).
   A Gemini judge scoring a Claude cue still rewards fluent, confident, well-formed
   prose — which is exactly what map decision 1 identified as the failure ("cues *read*
   fluent and mechanical, which is what makes bad ones hard to spot").

Plus one finding that reframes what the human spot-check budget is *for* (§5): **judge
agreement with humans is not the same as judge recall of real defects, and the gap is
enormous.** A production study found an LLM judge surfaced roughly **22%** of
human-confirmed systematic defects in one batch and **0%** in another, implying a
**3–6× undercount** of defect prevalence
([arXiv:2606.10315](https://arxiv.org/abs/2606.10315), 10 Jun 2026).

---

## 1. Self-preference / self-enhancement bias

### 1.1 The canonical numbers, and why they are half-obsolete

MT-Bench ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685), Jun 2023, v4 Dec 2023)
is still the reference point everyone cites, and it reported:

| Effect | Number |
|---|---|
| GPT-4 judge vs human expert agreement | **85%** (ties excluded) |
| Human vs human agreement | **81%** |
| Self-enhancement — GPT-4 favouring its own answers | **≈ +10 pp** win rate |
| Self-enhancement — Claude-v1 favouring its own | **≈ +25 pp** win rate |
| Position-bias consistency under answer swap | GPT-4 **65.0%**, GPT-3.5 **46.2%**, Claude-v1 **23.8%** |

**Two caveats the citation chain usually drops.** The MT-Bench authors themselves note
the self-enhancement analysis was not a controlled study — the judges also favoured
*other* models' answers, and there was not enough data to separate the effects. And the
position-bias numbers are 2023 numbers: a 2026 systematic study of debiasing found
**position bias is now ≤0.04 across modern judges while *style* bias runs 0.76–0.92** —
"style bias is the dominant bias … far exceeding position bias"
([arXiv:2604.23178](https://arxiv.org/html/2604.23178v1), 25 Apr 2026). Budgeting effort
against position bias in 2026 is fighting the last war.

### 1.2 The mechanism: self-recognition, or just familiarity?

Two papers disagree in a way that matters for the map.

- **Self-recognition.** Panickssery, Bowman & Feng
  ([arXiv:2404.13076](https://arxiv.org/abs/2404.13076), Apr 2024, NeurIPS 2024) found
  GPT-4 is **73.5% accurate** at picking its own text out of a lineup of other LLMs and
  humans (GPT-3.5 ≈ 53.5%, Llama 2 ≈ 51.4%), and that **self-preference strength is
  linearly correlated with self-recognition capability** — they moved one by fine-tuning
  and the other followed. Their recommendation: **"authorship obfuscation should be
  incorporated into standard prompting practice."**
- **Familiarity.** Wataoka et al. ([arXiv:2410.21819](https://arxiv.org/abs/2410.21819),
  Oct 2024, rev Jun 2025) found the bias tracks **perplexity**, not authorship: judges
  over-reward low-perplexity text relative to humans whether or not they wrote it.

**(judgement)** These are compatible — self-recognition is one route, low perplexity is
the broader one — but they have opposite implications for [#35]. If the bias were purely
authorship-driven, a cross-family judge would fix it. Because it is substantially
*fluency*-driven, a cross-family judge fixes only part of it, and the residual is
precisely the failure mode Flowlog has: a wrong cue that reads smooth.

### 1.3 What actually mitigates it

| Mitigation | Evidence | Verdict |
|---|---|---|
| **Different-family judge / panel** | PoLL: 3 disjoint families (Command R, Claude Haiku, GPT-3.5) raised Cohen's κ vs humans from GPT-4's 0.627 → **0.763** on NQ, 0.841 → 0.906 on TriviaQA, 0.817 → **0.917** Pearson on Chatbot Arena, at **7–8× lower cost**; spread of self-scores fell from sd 6.1 (GPT-3.5 alone) to **sd 2.2** ([arXiv:2404.18796](https://arxiv.org/html/2404.18796v1), Apr 2024) | ✅ **Helps, and is cheap** — but see the ceiling below |
| **…but the ceiling is low** | 9 judges / 7 families = **2.18 effective independent votes**; oracle-calibrated aggregation closes **at most ~11%** of the reliability gap ([arXiv:2605.29800](https://arxiv.org/html/2605.29800v1), May 2026). Authors' diagnostic: **if n_eff/k < 0.5, treat results with caution** | ⚠️ Do not model a panel as N independent opinions |
| **Structured multi-dimensional rubric** (decompose the judgement) | Reduced self-preference bias **31.5% on average** across 20 LLMs ([arXiv:2604.22891](https://arxiv.org/abs/2604.22891), 24 Apr 2026). Same paper: advanced capability is **uncorrelated or negatively correlated** with low self-preference — you cannot buy your way out with a bigger judge | ✅ **The best single lever**, and it composes with grounding |
| **Chain-of-thought forcing** | +1.5 to +13.0 pp on adversarial LLMBar across *all* models tested — "the only universally beneficial single strategy" ([arXiv:2604.23178](https://arxiv.org/html/2604.23178v1), Apr 2026) | ✅ but contested — see §3.4 |
| **Position swapping** | **Harmful** on adversarial data: −2.5 to −7.0 pp ([ibid.](https://arxiv.org/html/2604.23178v1)) | ❌ Skip for a pointwise correctness judge |
| **Authorship obfuscation** | Recommended by [Panickssery et al.](https://arxiv.org/abs/2404.13076) | ✅ Free; strip any generator-identifying framing from the judge prompt |

---

## 2. Grounded / reference-based judging vs reference-free

This is the crux of map decision 4. **The evidence is real but narrower and more
specific than "grounding helps".**

### 2.1 What is actually demonstrated

- **Reference-guided grading, MT-Bench.** Default GPT-4 grading of math answers failed
  **70%** of the time; supplying an independently-generated reference answer first cut
  that to **15%** ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)). Big effect —
  but on math, where the reference is a *complete solution to the exact question*, not a
  topically-retrieved passage. **(judgement)** Danaher on mount escapes is not that; it
  is closer to a corpus than a key.
- **Decomposition + per-claim verification (the strong result).** Ragas
  ([arXiv:2309.15217](https://arxiv.org/abs/2309.15217), Sep 2023) computes faithfulness
  by having an LLM split the answer into atomic statements and then verify each against
  the retrieved context, scoring |verified| / |statements|. On WikiEval:

  | Method | Faithfulness | Answer relevance | Context relevance |
  |---|---|---|---|
  | **Ragas** (decompose + verify) | **95%** | 78% | 70% |
  | GPT direct 0–10 score | 72% | 52% | 63% |
  | GPT ranking | 54% | 40% | 52% |

  Human–human agreement on faithfulness was ~95%, i.e. Ragas hit the human ceiling.
  **Caveat: WikiEval is 50 Wikipedia pages / ~50 triples with 2 annotators.** That is a
  small sample carrying a lot of weight in the field.
- **FActScore** ([arXiv:2305.14251](https://arxiv.org/abs/2305.14251), EMNLP 2023): same
  shape — break generation into atomic facts, verify each against a reliable knowledge
  source via retrieval. Their automated estimator tracks human FActScore with **<2%
  error**. It also gives the closed-book comparison used in §6: ChatGPT scored **58%**
  factual precision on people biographies.
- **Reference-Guided Verdict** ([arXiv:2408.09235](https://arxiv.org/html/2408.09235),
  v3 Nov 2025) reports strong judge–human agreement with references supplied (κ 0.79
  TruthfulQA, up to 0.96 TriviaQA) — but **runs no reference-free ablation**, so it is
  not evidence for the comparison the map needs. Human annotators still beat the LLM
  panel on inter-rater reliability (Fleiss' κ 0.74–0.97 vs 0.61–0.80).

### 2.2 Where grounding fails, and it is exactly our case

**The corpus is escapes-only. Every cue about guard retention, passing or submissions is
an out-of-corpus query.** *Sufficient Context* measured what happens then:

- Gemma hallucination: **10.2% with no context → 66.1% with insufficient context**.
- Large models (Gemini 1.5 Pro, GPT-4o, Claude 3.5) "excel at answering queries when the
  context is sufficient, but often output incorrect answers instead of abstaining when
  the context is not."
- Their good news: an LLM **autorater classifies sufficient vs insufficient context at
  ≥93% accuracy** (Gemini 1.5 Pro, no fine-tuning needed), and gating generation on that
  signal improved selective accuracy by **up to 10 pp**.
  ([Google Research blog, May 2025](https://research.google/blog/deeper-insights-into-retrieval-augmented-generation-the-role-of-sufficient-context/);
  [arXiv:2411.06037](https://arxiv.org/abs/2411.06037), ICLR 2025)

**(judgement)** This is the finding that most changes [#35]. Retrieving *something*
Danaher-shaped for a cue he never addresses is worse than retrieving nothing. The
sufficiency classifier is a separate, cheap, well-evidenced component and it belongs in
the design as a hard gate.

### 2.3 The uncomfortable calibration: judges are worst in expert domains

Correctness-in-a-technical-domain is the hardest judging task there is, and the
best-measured analogue is medicine.

- *Same Verdict, Different Reasons*
  ([arXiv:2604.16383](https://arxiv.org/html/2604.16383v1), 26 Mar 2026) put three judge
  backbones × three rubric granularities against clinician-annotated completeness on
  MedExpert (540 responses) and HealthBench (1,281). Judge–clinician **AUC 0.49–0.66**
  on HealthBench and **0.50–0.56** on MedExpert — best case GPT-5 Mini + analytical
  rubric at 0.66. Where judge and clinician *agreed* on the verdict, only **24.6%**
  showed full reasoning alignment and **30.2%** cited "entirely different concerns."
  Conclusion: deploying these as autonomous evaluators "is not justified by current
  evidence."
- A May 2026 scoping analysis of LLM-as-judge in healthcare
  ([arXiv:2605.25273](https://arxiv.org/abs/2605.25273), 26 May 2026) surveys the
  judge–expert correlation literature; a search-index summary reports a range of
  **0.40–0.94, median ≈0.69** across ~13 studies reporting Pearson/Spearman.
  **(unverified — I could not extract these figures from the PDF itself; re-check
  before quoting.)**

**(judgement)** Read together with §2.1: the way to get from the 0.5–0.66 AUC regime into
the 0.95 regime is *not* a better judge model or a longer prompt. It is turning the
judgement into many small verifiable entailment questions against a passage. That is the
difference between RAGAS-faithfulness and GPT-direct-scoring, on the same model.

---

## 3. Rubric design

### 3.1 Scalar vs categorical: prefer binary, per criterion

ResearchRubrics ([arXiv:2511.07685](https://arxiv.org/abs/2511.07685), 12 Nov 2025)
built 2,593 rubric criteria across 101 prompts and measured **human** consistency at
each granularity:

| Grading scheme | Human macro-F1 |
|---|---|
| Binary (Satisfied / Not) | **0.72–0.76** |
| Ternary (Satisfied / Partial / Not, scored 1.0 / 0.5 / 0.0) | **0.538–0.567** |

If *humans* lose ~0.19 F1 going from binary to ternary, an LLM judge on a 1–10 scale is
not producing a real number. Same paper, two more directly usable results:

- Adding brief inline **examples per criterion improves human–model alignment by 3–4%**
  (binary) / 2–3% (ternary).
- **LLM-based rubric augmentation** (letting a model expand or rephrase the rubric)
  **catastrophically degrades alignment by 15–20%.** Write the rubric by hand.

Provider guidance agrees on decomposition. Anthropic
([*Demystifying evals for AI agents*](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents),
9 Jan 2026): "create clear, structured rubrics to grade each dimension of a task, and
then grade each dimension with an isolated LLM-as-judge rather than using one to grade
all dimensions."

**One dissent, and it is worth reading carefully.** OpenAI's grader documentation
advises the opposite — "Produce a smooth score, not a pass/fail stamp. A score that
shifts gradually as answers improve helps the optimizer see which changes matter"
([OpenAI graders guide](https://developers.openai.com/api/docs/guides/graders)).
**(judgement)** That advice is for **reinforcement fine-tuning reward shaping**, where a
dense gradient is the point. For a correctness gate whose output is "ship / retry", the
optimiser argument does not apply and the reliability argument does. OpenAI also warns
that models "learn to exploit weaknesses in model graders," detectable only by comparing
grader output against expert human evaluations — a reward-hacking risk that lands
directly on repair option 6 in the map (grounded quality gate in a retry-with-critique
loop, where the generator gets to keep trying until the judge is satisfied).

### 3.2 Pairwise vs pointwise: contested, and the recent evidence favours pointwise

- **For pairwise:** PairS ([arXiv:2403.16950](https://arxiv.org/abs/2403.16950), Mar 2024,
  v5 Jan 2025) — uncertainty-guided pairwise search beats direct scoring on human
  alignment and produces more transitive evaluations.
- **Against pairwise:** *Pairwise or Pointwise?*
  ([arXiv:2504.14716](https://arxiv.org/abs/2504.14716), Apr 2025 / v2 Aug 2025) — when
  generators embed distractor features, **pairwise preferences flip ~35% of the time
  versus 9% for absolute scoring**. "Absolute scoring is more robust to such
  manipulation."

**(judgement)** For Flowlog the question mostly dissolves: "is this cue contradicted by
the instructional?" has no second candidate to compare against. Pairwise belongs in the
*repair* stage (A/B'ing prompt variants against the frozen baseline, map decision 2),
not in the correctness judge.

### 3.3 Verbosity / style bias

- Length control raised AlpacaEval's Spearman correlation with Chatbot Arena from
  **0.94 → 0.98** and made it robust to deliberate verbosity manipulation
  ([arXiv:2404.04475](https://arxiv.org/abs/2404.04475), Apr 2024).
- Style bias measured at **0.76–0.92**, the dominant bias in 2026 judges
  ([arXiv:2604.23178](https://arxiv.org/html/2604.23178v1)).

**(judgement)** Flowlog's ≤25-word hard cap removes most of the length axis for free —
all candidates are the same size. But the *style* axis is untouched and is the exact
shape of the problem: a confident mechanical-sounding wrong cue. This is the argument
for a judge that only ever answers "which passage supports this clause?", because that
question has no stylistic degrees of freedom.

### 3.4 Score clustering, and a real contradiction in the literature

Judges cluster scores toward the middle of wide scales. The best-evidenced fix is not
prompt engineering but reading the **judgment distribution** instead of the greedy token:
taking the *mean* of the score distribution beat the mode in **92 of 120 cases**
(GPT-4o 85.1% → **87.4%** on RewardBench; Llama-3.1-8B 69.6% → 72.7%)
([arXiv:2503.03064](https://arxiv.org/html/2503.03064v1), Mar 2025).

That same paper reports **"CoT often harms LLM-as-a-judge"** because it collapses the
spread of the judgment distribution — directly contradicting
[arXiv:2604.23178](https://arxiv.org/html/2604.23178v1)'s "CoT forcing emerges as the
only universally beneficial single strategy." **(judgement)** The two are measuring
different things (distributional score quality vs pairwise accuracy under adversarial
inputs) and neither is safe to assume. **This is a cheap thing to settle in-house on the
frozen baseline rather than to inherit from a paper.** Note also that reading the
judgment distribution requires logprobs, which the Anthropic API does not expose — so
for a Claude judge this lever is unavailable and binary criteria matter more.

---

## 4. Abstention

### 4.1 The state of the art is worse than you'd hope

- **Give the model a way out.** Anthropic's own guidance: "To avoid hallucinations, give
  the LLM a way out, like providing an instruction to return 'Unknown' when it doesn't
  have enough information"
  ([Anthropic, Jan 2026](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
  Necessary, nowhere near sufficient.
- **AbstentionBench** ([arXiv:2506.09038](https://arxiv.org/abs/2506.09038), 10 Jun 2025,
  Meta) — 20 datasets × 20 frontier models: **"abstention is an unsolved problem, and one
  where scaling models is of little use."** Worse for Flowlog's stack: **reasoning
  fine-tuning degrades abstention by an average of 24%**, including in domains those
  models are strong in.
- **Survey:** *Know Your Limits*
  ([arXiv:2407.18418](https://arxiv.org/abs/2407.18418), TACL 2025) frames abstention
  across query / model / human-values and catalogues the benchmarks and metrics — the
  right map for anyone specifying the abstention contract.

### 4.2 The two patterns that do work

1. **Externalise the decision — classify context sufficiency separately, then gate.**
   Do not ask the judge "do you have evidence?"; ask a *separate* call "does this passage
   contain what is needed to settle this claim?" That autorater ran at **≥93% accuracy**
   and gating on it improved selective accuracy by **up to 10 pp**
   ([Sufficient Context](https://arxiv.org/abs/2411.06037), ICLR 2025). This is the same
   shape as GroUSE's failure modes FM2 ("fails to refrain when unanswerable") and FM4
   ("wrongly claims the question cannot be answered") — both are testable directly (§5).
2. **Selective evaluation with a coverage/agreement trade-off.** *Trust or Escalate*
   ([arXiv:2407.18370](https://arxiv.org/abs/2407.18370), Jul 2024, ICLR 2025) makes the
   judge estimate confidence (via "simulated annotators") and abstain or escalate below
   threshold, giving a **provable guarantee of a user-specified human-agreement level**.
   On a Chatbot Arena subset where GPT-4 alone almost never reaches 80% human agreement,
   their cascade **guarantees >80% agreement at ~80% coverage** using models as small as
   Mistral-7B. **(judgement)** This is the right frame for [#35]: pick the agreement
   level you will defend, then report the coverage it costs — rather than picking a
   coverage and hoping the agreement holds. It also makes abstention *measurable* (the
   coverage number) instead of a prompt instruction nobody checks.

---

## 5. Validating the judge with no expert panel

This is where the prior art is most directly useful, and where the map's implicit plan
needs the most tightening.

### 5.1 Agreement is the wrong headline metric — measure defect recall

*Catching One in Five* ([arXiv:2606.10315](https://arxiv.org/abs/2606.10315), 10 Jun 2026)
opens with exactly this: "LLM-as-judge … reliability is almost always reported as
agreement with human ratings, **not recall of real defects**." In production multi-turn
transaction agents, the judge caught **2 of 9** human-confirmed systematic problems in one
batch (~22%) and **0 of 23** in another; **113 of 114** rounds where the judge's own notes
described a defect were routed to a "brand voice" verdict rather than a failure gate;
implied **3–6× undercount** of defect prevalence.

**(judgement)** Flowlog's target defect — the occasionally-wrong cue (map decision 1a) —
is low-prevalence and high-cost. A judge with 90% agreement and 20% recall would look
excellent on a spot-check and be worthless. **Recall on known-bad cues is the pass bar,
not agreement.**

### 5.2 Unit tests over correlation — the GroUSE pattern, and it is small enough to copy

GroUSE ([arXiv:2409.06595](https://arxiv.org/abs/2409.06595), COLING 2025) is the closest
existing thing to what [#35] needs: a **meta-evaluation benchmark of 144 unit tests**
(9 sets of 16, each set sharing one question and varying answers/references) targeting
**7 grounded-QA failure modes**:

| | Failure mode |
|---|---|
| FM1 | Irrelevant information included despite the question being answerable |
| FM2 | Fails to refrain on an unanswerable question |
| FM3 | Omits relevant information present in the documents |
| FM4 | Wrongly claims the question cannot be answered |
| FM5 | Adds unrelated information in unanswerable cases |
| FM6 | Facts lack proper or correct citations |
| FM7 | Facts distorted or unsupported by the documents |

Judge pass rates: **GPT-4 95.02%**, GPT-4-turbo 92.59%, finetuned Llama-3 8b 81.37%,
Llama-3 70b 79.17%, Mixtral 8x22b 77.20%, Llama-3 8b 69.33%, **Prometheus 2 8x7b 54.98%**.

**The headline finding is the one that matters most here:** *"Strong correlation with
GPT-4 does not imply good pass rate on unit tests."* Prometheus 2 7b matched a finetuned
Llama-3 8b on correlation with GPT-4 while scoring **52.78% vs 81.37%** on the unit
tests. **Inter-model agreement is not validation.** For [#35], "our judge agrees with a
frontier model" must not be accepted as evidence of anything.

### 5.3 Seeded known-bad examples work — but not if an LLM writes them

The map leans on seeded bad examples. That method has a documented failure of its own:
*The Test Oracle Problem in Synthetic LLM-as-Judge Corpora*
([arXiv:2607.13707](https://arxiv.org/html/2607.13707v1), 15 Jul 2026) distinguishes

- **Disappearance** — a fabricated effect with no counterpart in corrected data. Theirs
  was a 32-point selection-accuracy collapse that **vanished entirely** once generation
  parameters were fixed.
- **Distortion** — a real judge signature whose magnitude shifts with irrelevant stimulus
  properties (their Markdown-formatting preference varied with text length).

The cause was mundane: a token-budget setting silently truncated the injected
"hallucinated" answers, so **81.0%** of corrupted items began with truncated
conversational filler, **12.2%** reproduced the source field verbatim and **6.8%** were
degenerate fragments. Generation validity went **0% → 98.8%** after the fix.

Their protocol, which is cheap enough to adopt wholesale:
1. **Read 15–20 raw generated items per condition** before computing any statistic
   (sized to catch a 30%-rate fault at 99% confidence).
2. Report **mean word count** of generated content.
3. Measure **degeneration rates** — verbatim copies, fragments under three words.
4. Include a **mechanical positive control**: their gold-to-negative string comparison
   caught injected faults at **100% accuracy with zero API calls and zero human reading.**

**(judgement)** For Flowlog: the highest-value seeded-bad set is **hand-authored
corruptions of correct cues** — flip the direction of a frame, swap the limb, name the
wrong side, invert the sequencing step — because those are mechanically verifiable
(you know what you changed) and they map onto GroUSE's FM7. Have the LLM write the
*correct* cues if you like; write the *corruptions* by hand.

### 5.4 Self-consistency, robustness and what to actually stress-test

RAND's **Judge Reliability Harness**
([arXiv:2603.05399](https://arxiv.org/html/2603.05399v1), 5 Mar 2026;
[code](https://github.com/RANDCorporation/judge-reliability-harness)) tests five
dimensions — discriminative accuracy (does the verdict flip when the response violates
the rubric?), **format invariance**, semantic robustness (paraphrase), verbosity bias,
and **stochastic stability** (repeat identical inputs). Findings:

- **No universally reliable judge emerged**; performance varied sharply by task and model.
- **Format invariance was the weakest dimension across most benchmarks** — judges are
  more robust to meaning changes than to whitespace and layout changes.
- **Ordinal scoring is brittle**: accuracy fell to **40%** under semantic paraphrase on a
  multi-class scoring benchmark, while **binary safety tasks were markedly more robust** —
  independent corroboration of §3.1.
- Cost is not the axis: a Llama Maverick 4.1 17B matched or beat premium models.

For statistical hygiene on top of this, Anthropic's
[*Adding Error Bars to Evals*](https://arxiv.org/abs/2411.00640) (Evan Miller, 1 Nov 2024)
is the primary reference: treat eval questions as drawn from an unseen super-population,
report standard errors, use paired analysis when comparing variants, and plan sample
size up front.

### 5.5 The human budget: what the spot-checks are for

- **Criteria drift is real and it is a feature.** EvalGen / *Who Validates the Validators?*
  ([arXiv:2404.12272](https://arxiv.org/abs/2404.12272), UIST 2024) named the loop:
  "users need criteria to grade outputs, but grading outputs helps users define criteria."
  Expect the rubric to change once the dev has hand-graded 30 cues. Version it.
- **Provenance-checking is the right use of a non-expert reviewer** (map decision 9). It
  is confirmed by GroUSE FM6/FM7 being unit-testable and by the Test Oracle protocol's
  emphasis on *reading raw items*, not aggregate scores.
- **Pass bars.** I could **not** find a primary source that fixes a numeric pass bar.
  Practitioner consensus (blogs, not papers — **treat as weak**) is Cohen's κ ≥ 0.6
  acceptable / ≥ 0.8 strong, on 50–300 human-labelled examples with stratification for
  rare classes. **(judgement)** Given §5.1, [#35] should set its bar on **recall of
  hand-seeded known-bad cues** (a number you fully control, e.g. ≥90% on a 40-item
  corruption set) and treat κ against the dev's own spot-checks as a secondary,
  reported-with-error-bars figure.

---

## 6. Faithfulness of extraction-from-source vs recall-from-memory

Map decision 9 ("mining is LLM-extraction, not LLM-recall") is **the best-supported
assumption on the map.** The gap is roughly an order of magnitude.

| Setting | Measured error | Source |
|---|---|---|
| **Grounded summarisation** — "Summarize using only the information in the given passage. Do not infer. Do not use your internal knowledge." | Best model **1.8%** hallucination; GPT-5.4-nano 3.1%, Gemini 2.5 Flash Lite 3.3%, Llama-3.3-70B 4.1%, Mistral Large 4.5% | [Vectara Hallucination Leaderboard](https://github.com/vectara/hallucination-leaderboard), HHEM-2.3, 80+ models / 7,700+ docs, **updated 11 May 2026** |
| **Atomic-fact verification against a retrieved source** | Automated estimator within **<2%** of human FActScore | [FActScore](https://arxiv.org/abs/2305.14251), EMNLP 2023 |
| **Statement-level verification against context** | **95%** agreement with humans (human–human ≈95%) | [Ragas](https://arxiv.org/abs/2309.15217), Sep 2023 |
| **Closed-book factual recall (hard questions)** | **"All but three models are more likely to hallucinate than provide a correct answer."** Best accuracy 39% (Grok 4, GPT-5-high) with 64% / 81% hallucination rates; lowest hallucination Claude 4.5 Haiku at 28% | [AA-Omniscience](https://artificialanalysis.ai/articles/aa-omniscience-knowledge-hallucination-benchmark), 16 Nov 2025, 6,000 questions / 42 topics ([arXiv:2511.13029](https://arxiv.org/abs/2511.13029)) |
| **Closed-book long-form generation** | ChatGPT **58%** factual precision on people biographies | [FActScore](https://arxiv.org/abs/2305.14251) |

**Two honest caveats.**

1. **(judgement)** These are different benchmarks on different tasks, not a controlled
   same-model A/B. The *direction* is not in doubt — every measurement points the same
   way and the gap is 1.8–5% vs 28–81% — but the exact ratio is not something to quote
   as if it were one experiment.
2. **The gap only holds when the passage actually contains the answer.** §2.2's
   10.2% → 66.1% result is the counterexample, and it is the same phenomenon read from
   the other side: extraction is reliable, *retrieval* is what has to be right. Mining
   Danaher for what Danaher said is the safe operation the map thinks it is. Asking a
   grounded judge about a position Danaher never covers is the unsafe one.

---

## 7. Where this contradicts the map

Stated plainly, because this is the part worth acting on.

| Map claim | What the evidence says |
|---|---|
| **Dec. 4** — "The instructional corpus is the only source of BJJ truth that did not come from the model — so it must serve as the judge's **evidence**. A judge with a source, not a judge with an opinion." | Right instinct, wrong granularity. Handing a judge source text and asking for a verdict lands in the 0.5–0.66 AUC regime seen against clinicians ([2604.16383](https://arxiv.org/html/2604.16383v1)). **Decomposing into atomic claims and verifying each against a passage** is what reaches 95% ([Ragas](https://arxiv.org/abs/2309.15217)). The design must be per-claim entailment, not holistic grading. |
| **Dec. 4** — an LLM judging an LLM "shares the same blind spots"; implied fix is a judge with evidence | Evidence reduces the *knowledge* blind spot, not the *style* blind spot. Style bias is 0.76–0.92 in 2026 judges ([2604.23178](https://arxiv.org/html/2604.23178v1)) and self-preference tracks **perplexity, not authorship** ([2410.21819](https://arxiv.org/abs/2410.21819)) — so a fluent-but-wrong cue is still flattered by a different-family judge. Cross-family helps (PoLL κ 0.627→0.763) but a 7-family panel is worth **2.18 independent votes** ([2605.29800](https://arxiv.org/html/2605.29800v1)). |
| **Dec. 7** — abstention is framed as a *scope* question ("what the judge does outside the corpus") | It is a *correctness* question. Insufficient context raised one model's hallucination rate **6.5×** over having no context at all ([2411.06037](https://arxiv.org/abs/2411.06037)). Out-of-corpus is the regime where the grounded judge is **worse than no judge**. Needs a sufficiency gate before the judge, plus a coverage number reported alongside every result. |
| **Dec. 2 / 3** — score against a frozen baseline, validate with spot-checks + user 👍/👎 | Correct, but the metric must be **defect recall**, not agreement: a production judge caught ~22% and then 0% of confirmed defects while looking fine on agreement ([2606.10315](https://arxiv.org/abs/2606.10315)). And inter-model agreement is explicitly *not* validation ([GroUSE](https://arxiv.org/abs/2409.06595)). |
| **Dec. 9** — mining is extraction not recall, provenance makes review cheap | **Strongly supported** (§6). The one addition: if the seeded/synthetic parts of the eval set are LLM-generated, validate the generator too — 81% of one study's injected corruptions were silently malformed and produced a 32-point effect that did not exist ([2607.13707](https://arxiv.org/html/2607.13707v1)). |
| **Repair 6** — grounded quality gate reusing the existing retry-with-critique loop | Watch for reward hacking: OpenAI documents that models "learn to exploit weaknesses in model graders," detectable only against expert human evaluation ([graders guide](https://developers.openai.com/api/docs/guides/graders)). A generator that retries until a judge passes it is the textbook setup. Cap retries and log the pre-retry verdict. |

---

## Design constraints for issue #35

Each constraint is one thing the judge design must honour, with the source that forces it.

1. **Judge per claim, not per cue.** Decompose the ≤25-word cue into atomic mechanical
   claims and issue one grounded verdict per claim; score = fraction supported. Do not
   ask for a holistic correctness score.
   → [Ragas 95% vs 72% direct scoring](https://arxiv.org/abs/2309.15217) ·
   [FActScore <2% error](https://arxiv.org/abs/2305.14251)

2. **Binary verdicts per claim.** `supported / contradicted / no-evidence` — never a 1–10
   or 1–5 scale. Humans themselves lose ~0.19 macro-F1 going binary→ternary.
   → [ResearchRubrics](https://arxiv.org/abs/2511.07685) ·
   [Judge Reliability Harness: ordinal scoring fell to 40% under paraphrase](https://arxiv.org/html/2603.05399v1)

3. **A separate context-sufficiency gate runs before the judge.** A dedicated call
   decides whether the retrieved passages can settle the claim; if not, the verdict is
   `no-evidence` and the judge is never asked. Report coverage (% of claims judged) with
   every result.
   → [Sufficient Context: 10.2% → 66.1% hallucination on insufficient context; autorater ≥93% accurate](https://arxiv.org/abs/2411.06037)

4. **`no-evidence` must be a first-class, measured outcome — not a prompt instruction.**
   Set a target human-agreement level, report the coverage it costs, and validate
   abstention explicitly (unit tests for "refuses when it should" and "refuses when it
   shouldn't"). Do not assume a reasoning model abstains better — it abstains worse.
   → [Trust or Escalate: >80% agreement at ~80% coverage](https://arxiv.org/abs/2407.18370) ·
   [AbstentionBench: reasoning fine-tuning −24%](https://arxiv.org/abs/2506.09038) ·
   [Anthropic: "give the LLM a way out"](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

5. **The pass bar is recall on hand-seeded known-bad cues, not agreement with a human or
   with another model.** Build a corruption set by hand (flipped frame, wrong limb, wrong
   side, inverted sequence) mapped onto GroUSE FM7/FM2/FM4; a corruption is verifiable
   because you know what you changed.
   → [Catching One in Five: ~22% then 0% defect recall at good agreement](https://arxiv.org/abs/2606.10315) ·
   [GroUSE: correlation with GPT-4 ≠ unit-test pass rate (52.78% vs 81.37%)](https://arxiv.org/abs/2409.06595)

6. **Ship a GroUSE-style unit-test suite, not just a correlation number.** ~100–150 tests
   across the 7 grounded-QA failure modes is the demonstrated size; it is a fixture, it
   runs in CI, and it costs no expert time after authoring.
   → [GroUSE: 144 unit tests, 9 sets of 16](https://arxiv.org/abs/2409.06595)

7. **Never let an LLM author the corruption set or rewrite the rubric.** Hand-write both.
   Before trusting any eval statistic, read 15–20 raw generated items per condition and
   report mean word count + degeneration rate. Include one mechanical positive control.
   → [Test Oracle Problem: 81% malformed injections, 32-point phantom effect, 0%→98.8% validity](https://arxiv.org/html/2607.13707v1) ·
   [ResearchRubrics: LLM rubric augmentation −15–20% alignment](https://arxiv.org/abs/2511.07685)

8. **Judge model must be a different family from the generator (Claude Sonnet 4.6) — and
   the design must not assume that buys independence.** Use it, log it, and if a panel is
   ever added, compute effective independent votes and treat n_eff/k < 0.5 as a warning.
   → [PoLL: κ 0.627 → 0.763, 7–8× cheaper](https://arxiv.org/html/2404.18796v1) ·
   [Nine Judges: 7 families → 2.18 effective votes](https://arxiv.org/html/2605.29800v1)

9. **Strip authorship and style cues from the judge prompt.** No "this cue was generated
   by…", no model names, no confidence self-reports from stage 2b carried into the judge
   context. Style bias, not position bias, is the dominant 2026 bias.
   → [Panickssery et al.: authorship obfuscation as standard practice](https://arxiv.org/abs/2404.13076) ·
   [Style bias 0.76–0.92 vs position bias ≤0.04](https://arxiv.org/html/2604.23178v1)

10. **Don't spend effort on position-swap debiasing.** It is a 2023 problem and it is
    actively harmful on adversarial inputs. Spend it on rubric decomposition instead,
    which also cuts self-preference by ~31.5%.
    → [Position swap −2.5 to −7.0 pp on LLMBar](https://arxiv.org/html/2604.23178v1) ·
    [Structured multi-dimensional evaluation −31.5% self-preference](https://arxiv.org/abs/2604.22891)

11. **Cap retries in the grounded quality gate and log the pre-retry verdict.** A
    generator looping until a judge passes it is the canonical reward-hacking setup, and
    it is only detectable by comparing gate output against human review.
    → [OpenAI graders guide: "learn to exploit weaknesses in model graders"](https://developers.openai.com/api/docs/guides/graders)

12. **Report error bars and version the rubric.** Treat the eval set as a sample; report
    standard errors; expect the rubric to change once the dev has hand-graded ~30 cues,
    and version it alongside the existing `spec_prompt_version`-style provenance fields.
    → [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640) ·
    [EvalGen: criteria drift](https://arxiv.org/abs/2404.12272)

---

## Gaps and things I could not verify

- **No primary source fixes a numeric pass bar** for judge validation (§5.5). The κ ≥ 0.6
  / 50–300 examples guidance is practitioner blog consensus only.
- **The healthcare judge–expert correlation range (0.40–0.94, median 0.69)** appeared in
  a search-index summary of [arXiv:2605.25273](https://arxiv.org/abs/2605.25273) but I
  could not extract it from the paper itself — **do not quote it without re-checking.**
- **A clean reference-free vs reference-based ablation on the same judge, same data, with
  expert labels, does not appear to exist.** The field infers it from method comparisons
  (Ragas vs GPT-score) and from MT-Bench's math case. This is the weakest link in map
  decision 4 and worth stating out loud.
- **Nothing found on judging very short text.** Every result here is on paragraph-length
  answers. Whether a ≤25-word cue gives a judge enough surface to decompose is an open,
  Flowlog-specific question — and cheap to settle on the frozen baseline.
- **CoT is contested** (§3.4) and the judgment-distribution lever needs logprobs, which
  the Anthropic API does not expose. Settle in-house.
