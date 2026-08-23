/**
 * Stage 2a½ — grounding.
 *
 * The selection and rendering logic lives in `src/sports/grounding.ts`, which
 * is dependency-free so the Supabase edge function imports the same code. This
 * file is the app-side entry point; keeping the logic single-sourced is what
 * stops the client reference implementation and the live server from building
 * different prompts.
 */
export {
  candidatePositions,
  groundingSection,
  rankRecords,
  GROUNDING_RECORD_LIMIT,
} from '@/sports/grounding';
export type {
  GroundableExtraction,
  GroundableRecord,
} from '@/sports/grounding';
