# Flowlog pipeline resources

The highest-trust sources for this topic are inside this repo. That is unusual
and worth saying: the docs here record what was *measured*, including where an
earlier draft was wrong. Prefer them over anything external about RAG or
"grounding" in general, which is written for document Q&A and does not describe
this shape of problem.

## Knowledge — primary (in-repo)

- [`docs/LOCAL_MINING.md`](../docs/LOCAL_MINING.md)
  The single best document in the repo. A full experiment: Gemini vs local
  models over 88 volumes, the metrics, and — crucially — the blind human read
  that contradicted every mechanical metric. Use for: what "record quality"
  means, why the splice repair exists, why measurements mislead.
- [`src/sports/grounding.ts`](../src/sports/grounding.ts)
  Selection and rendering, single-sourced for client and server. The comments
  are the design rationale, not decoration. Use for: why the relevance gate is
  2, why IDF alone tied `allowing` with `kimura`, why records go last.
- [`scripts/mining/records.ts`](../scripts/mining/records.ts)
  The record schema and its gates. Use for: what a record is, why there is no
  `mistake` field, what `repairQuote` narrows and why it never rewrites.
- [`scripts/mining/publish.ts`](../scripts/mining/publish.ts)
  The two-store boundary in code. Use for: what may cross into Supabase.
- [`docs/PIPELINE.md`](../docs/PIPELINE.md) and [`docs/adr/`](../docs/adr/)
  Stage-by-stage runtime description; ADR 0002 (two-stage split), 0010 (edge
  function), 0011 (correct after the cue).
- Migrations [`008`](../supabase/migrations/008_coaching_records.sql),
  [`010`](../supabase/migrations/010_grounding_experiment.sql),
  [`014`](../supabase/migrations/014_certification_votes.sql),
  [`018`](../supabase/migrations/018_grounding_provenance.sql)
  The schema comments carry the reasoning. Use for: what each grounding column
  means and why `NULL` and `{}` must not be conflated.

## Knowledge — external

- [Anthropic: "Building effective agents" / prompt-engineering docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
  Use for: why extraction and coaching are separate calls, and why strict-JSON
  output plus a retry beats one clever prompt.
- [OpenAI Whisper paper](https://cdn.openai.com/papers/whisper.pdf)
  Use for: what vocabulary priming actually does, and why timestamps and VAD
  matter to a long instructional.

## Wisdom (communities)

- [r/bjj](https://reddit.com/r/bjj) — for whether a *cue* is good coaching.
  The one thing no metric in this repo can tell you; `docs/LOCAL_MINING.md`
  proves that by having its metrics all point the wrong way.
- BJJ black belts already in the reviewer table (migration 014) — the intended
  certification community. The queue is the product's own wisdom loop.

## Gaps

- **No external source describes this shape.** Retrieval over a *closed,
  human-certified, provenance-stripped* corpus, ranked against an extracted
  mistake rather than a query, is not standard RAG. Lessons must be built from
  the repo, not from analogy.
- **No source on cue quality.** Nothing measures whether a 25-word cue changed
  anyone's jiu-jitsu. The blind-compare harness is the closest thing and it
  compares records, not outcomes.
