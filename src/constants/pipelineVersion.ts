/**
 * The pipeline version stamped on every Session row (`sessions.pipeline_version`).
 *
 * This is the ONE definition. The client reference pipeline
 * (`src/pipeline/FlowlogPipeline.ts`, through `pipelineConfig.ts`) and the
 * `process-session` edge function both import it. Before this file existed,
 * each kept its own copy behind a "kept in lockstep" comment, and they drifted:
 * the client still said 1.1.0 while the edge had moved to 1.3.0.
 *
 * It is dependency-free (no `@/` imports, no env), so the Deno edge function
 * can import it by relative path, the same way it imports `src/sports/*`.
 *
 * A Session row has to state for itself which pipeline wrote it. Migrations
 * 019 and 020 both segment on this value rather than on a timestamp, so
 * bumping it is part of a fix, not cosmetic:
 *
 *   1.0.0  wrote `grounding = 'grounded'` while sending the literal
 *          `{{GROUNDING}}` to the model: selected, never injected (019).
 *   1.1.0  first version whose prompt actually carries the grounding block,
 *          but whose candidate fetch was capped at 200 unordered rows, so
 *          `grounding_candidates` is a LOWER BOUND over those rows (#114).
 *   1.2.0  candidate pool is paged and ordered; `grounding_candidates` is the
 *          database's exact count (020).
 *   1.3.0  re-analysis writes the grounding provenance it changes the truth of,
 *          and honours the session's existing arm (021).
 *
 * What the version can and cannot segment for 1.3.0: re-analysis stamps the
 * version CURRENT AT THE TIME, so a row re-analysed under 1.0.0 still reads
 * 1.0.0 and is indistinguishable from one never re-analysed. `reanalyzed_at`
 * (021) is the marker that actually reaches those rows; the version only
 * asserts that a row written by THIS code is consistent.
 *
 * Bump it only when what a row MEANS changes: the prompt, record selection,
 * or how a stored value should be read. A new column that describes itself
 * does not need a bump (migrations 022 and 024 set that precedent).
 */
export const PIPELINE_VERSION = '1.3.0';
