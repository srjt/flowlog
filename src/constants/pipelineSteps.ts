import type { ProcessingStepName } from '@/types/pipeline';

/**
 * Human-readable labels for the processing steps shown to the user. Kept free of
 * internal/pipeline jargon (no "sport context", "extraction", "quality gate").
 * Single source of truth so every path (local, demo, production progress)
 * renders the same friendly copy.
 */
export const STEP_LABELS: Record<ProcessingStepName, string> = {
  context: 'Getting set up',
  transcription: 'Transcribing your reflection',
  extraction: 'Reviewing what happened',
  coaching: 'Finding your cue',
  quality_gate: 'Polishing the cue',
  persistence: 'Saving your session',
};

export const STEP_ORDER: ProcessingStepName[] = [
  'context',
  'transcription',
  'extraction',
  'coaching',
  'quality_gate',
  'persistence',
];
