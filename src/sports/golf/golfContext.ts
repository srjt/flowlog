import type { ISportContext } from '@/sports/ISportContext';
import { GOLF_VOCABULARY_FLAT } from '@/sports/golf/golfVocabulary';
import {
  GOLF_COACHING_PROMPT,
  GOLF_EXTRACTION_PROMPT,
} from '@/sports/golf/golfPrompts';

/**
 * Golf — STUB. Structure only, no real content yet.
 *
 * This file proves the expansion contract: golf already satisfies
 * ISportContext and is wired into the registry, so turning it on is purely a
 * content task. Do NOT enable FEATURE_GOLF_SPORT until every TODO below is
 * resolved. See docs/SPORTS.md.
 */
export const golfContext: ISportContext = {
  sportKey: 'golf',
  displayName: 'Golf',
  // TODO(golf): populate golfVocabulary.ts (150+ terms). Currently empty.
  vocabulary: GOLF_VOCABULARY_FLAT,
  sessionUnit: 'round',
  // TODO(golf): replace stub prompts with authored prompts.
  extractionPrompt: GOLF_EXTRACTION_PROMPT,
  coachingPrompt: GOLF_COACHING_PROMPT,
  // TODO(golf): tune sentiment labels for golf.
  sentimentLabels: ['frustrated', 'flat', 'neutral', 'encouraged', 'dialed in'],
  // TODO(golf): refine handicap tiers.
  skillLevels: ['30+', '20–29', '10–19', '5–9', 'Scratch (0–4)'],
  // TODO(golf): add golf-specific generic phrases to reject.
  qualityGatePhrases: [
    'just keep practicing',
    'work on your swing',
    'keep your head down',
    'just have fun',
  ],
  // TODO(golf): golf's position vocabulary (lie, shot type, hazard) is not
  // written yet. An empty list plus a normalizer that always abstains is the
  // honest stub — it degrades to ungrounded behaviour rather than guessing.
  positions: [],
  normalizePosition: () => ({
    id: null,
    base: null,
    label: null,
    perspective: 'unknown',
  }),
  minRecordingSeconds: 20,
  maxRecordingSeconds: 90,
};
