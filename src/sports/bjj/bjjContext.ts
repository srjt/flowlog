import type { ISportContext } from '@/sports/ISportContext';
import { BJJ_VOCABULARY_FLAT } from '@/sports/bjj/bjjVocabulary';
import {
  BJJ_COACHING_PROMPT,
  BJJ_EXTRACTION_PROMPT,
  BJJ_QUALITY_GATE_PHRASES,
  BJJ_SENTIMENT_LABELS,
  BJJ_SKILL_LEVELS,
} from '@/sports/bjj/bjjPrompts';

/**
 * Brazilian Jiu-Jitsu — Flowlog's beachhead sport. Fully implemented.
 *
 * This is the reference implementation of ISportContext. Every other sport
 * mirrors this shape; see docs/SPORTS.md.
 */
export const bjjContext: ISportContext = {
  sportKey: 'bjj',
  displayName: 'Brazilian Jiu-Jitsu',
  vocabulary: BJJ_VOCABULARY_FLAT,
  sessionUnit: 'roll',
  extractionPrompt: BJJ_EXTRACTION_PROMPT,
  coachingPrompt: BJJ_COACHING_PROMPT,
  sentimentLabels: BJJ_SENTIMENT_LABELS,
  skillLevels: BJJ_SKILL_LEVELS,
  qualityGatePhrases: BJJ_QUALITY_GATE_PHRASES,
  minRecordingSeconds: 20,
  maxRecordingSeconds: 90,
};
