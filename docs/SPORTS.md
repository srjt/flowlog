# Adding a New Sport to Flowlog

## The Contract

Every sport implements `ISportContext` (`src/sports/ISportContext.ts`). The
pipeline is sport-agnostic. Adding a sport is a content and config task, not a
code task.

## Step-by-Step

### 1. Create the sport directory

`src/sports/{sportKey}/`

### 2. Create three files

- `{sport}Context.ts` — implements `ISportContext` fully
- `{sport}Vocabulary.ts` — domain terms for Whisper priming (aim for 150+ terms)
- `{sport}Prompts.ts` — extraction prompt and coaching prompt

### 3. Write the extraction prompt

Must instruct the AI to return strict JSON matching `ExtractionOutput`. Must use
sport-appropriate field names in descriptions. Must not generate coaching
advice.

### 4. Write the coaching prompt

Must cap response at 25 words. Must reference the sport's specific mechanics.
Must include sport-specific generic phrases to avoid (these also feed
`qualityGatePhrases`).

### 5. Register the sport

Add to `src/sports/index.ts` registry.

### 6. Add feature flag

Add `FEATURE_{SPORT}_SPORT=false` to `.env.example` and `src/config/env.ts`.

### 7. Add database support

Ensure `sport_key` values are documented. No schema change needed — `sport_key`
is already a text field on `sessions` and `user_trends`.

### 8. Test

Add sport context unit tests (the parameterised test in
`tests/unit/sportContext.test.ts` automatically validates every registered sport
against the interface). Run a full pipeline integration test with sample
transcripts from that sport.

## Worked Example: Golf (current stub)

Golf already exists as a structural stub under `src/sports/golf/` and is wired
into the registry. It satisfies `ISportContext`, so the pipeline already runs
for it — every gap is a `TODO(golf)` marker for content, not a code change. To
finish golf: populate `golfVocabulary.ts`, author the two prompts in
`golfPrompts.ts`, tune `sentimentLabels` / `qualityGatePhrases` in
`golfContext.ts`, then flip `FEATURE_GOLF_SPORT=true`.

## Current Sports

| Sport | Status   | Feature Flag         |
| ----- | -------- | -------------------- |
| BJJ   | Complete | Always on (beachhead) |
| Golf  | Stub     | `FEATURE_GOLF_SPORT` |
