# Grounding is live as of pipeline 1.1.0, and the fetch limit is the next real defect

Session 1 found and fixed the `{{GROUNDING}}` gap (PR #112), and session 2 added
migration 019 to segment the void rows (PR #113). Both are merged, the migration
is applied and verified in production (`grounding_reached_model` returns
false/true/false for 1.0.0/1.1.0/NULL; `grounding_experiment` exists and is
correctly refused to anon), and `process-session` v25 is deployed from a tree
containing the fix.

**Still unproven:** no session has been recorded since the deploy, so no row
carries `pipeline_version = 1.1.0` and grounding has not been observed working
end to end. `grounding_experiment` is empty, exactly as predicted.

**The finding that drives the next lessons.** `loadGroundingRecords` fetches with
`limit=200` and no `order by`. The corpus is 5,574 records across 42 positions
and **9 positions exceed 200 on their own** (`standing` alone holds 1,114).
Three of the 18 arm-carrying sessions report `grounding_candidates` of exactly
200, so truncation is not hypothetical. It matters more than a missing-records
bug because `rankRecords` computes IDF over the candidate pool by design — a
truncated pool changes the ordering of what survives, not merely the membership.

**Measured 2026-09-07.** Across the nine oversized positions, 2,494 of 4,294
records (58.1%) are unreachable by grounding; `standing` is 82% blind. Six
consecutive runs of the identical query returned the same 200 ids in the same
order, so there is NO determinism bug today and re-analysis is not re-grounding
differently — but the stability is incidental (no `order by`), and the day a
vacuum or write reshuffles the heap, ADR 0011's re-analysis promise breaks
silently. A per-publish-batch skew exists (`standing`'s newest 422 records are
1.7% reachable) but does NOT generalise; the blind rate is the defensible
number, the publish-recency story is a heap artefact.

**Correction to carry forward.** An earlier read of an 8-row sample said every
grounded session sat at the 20-record cap. Over all 18 rows it is 6 of 8
grounded sessions at 20, one at 18, and two at 1 — there is no middle. The cap
is binding often, not always.

See [[0001-mission-is-seams-not-runbooks]].

Filed as srjt/flowlog#114 (`bug`, `ready-for-human`) — the remedy is a design
call, not a specified task: ordering by `created_at` would bake in the heap
artefact the measurement explicitly does not support.
