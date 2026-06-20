// Server-side sport registry for the edge function.
//
// The heavy, canonical content (200+ vocab terms, the extraction/coaching
// prompts, sentiment labels, quality-gate phrases) is imported directly from
// the SAME pure files the client uses under `src/sports/`. Those files are
// dependency-free, so they import cleanly into Deno. This keeps sport content
// single-sourced (CLAUDE.md rule 3) — there is no duplicated vocabulary or
// prompt text here.
//
// Note: the imports reach outside `supabase/functions/`. Recent Supabase CLI
// versions bundle these fine. If your CLI rejects cross-directory imports,
// either bump the CLI or add an import_map / copy the pure files into _shared.

import { BJJ_VOCABULARY_FLAT } from '../../../src/sports/bjj/bjjVocabulary.ts';
import {
  BJJ_COACHING_PROMPT,
  BJJ_EXTRACTION_PROMPT,
  BJJ_QUALITY_GATE_PHRASES,
  BJJ_SENTIMENT_LABELS,
} from '../../../src/sports/bjj/bjjPrompts.ts';
import { GOLF_VOCABULARY_FLAT } from '../../../src/sports/golf/golfVocabulary.ts';
import {
  GOLF_COACHING_PROMPT,
  GOLF_EXTRACTION_PROMPT,
} from '../../../src/sports/golf/golfPrompts.ts';

export interface ServerSportContext {
  sportKey: string;
  displayName: string;
  vocabulary: string[];
  sessionUnit: string;
  extractionPrompt: string;
  coachingPrompt: string;
  sentimentLabels: string[];
  qualityGatePhrases: string[];
  minRecordingSeconds: number;
  maxRecordingSeconds: number;
}

const bjj: ServerSportContext = {
  sportKey: 'bjj',
  displayName: 'Brazilian Jiu-Jitsu',
  vocabulary: BJJ_VOCABULARY_FLAT,
  sessionUnit: 'roll',
  extractionPrompt: BJJ_EXTRACTION_PROMPT,
  coachingPrompt: BJJ_COACHING_PROMPT,
  sentimentLabels: BJJ_SENTIMENT_LABELS,
  qualityGatePhrases: BJJ_QUALITY_GATE_PHRASES,
  minRecordingSeconds: 20,
  maxRecordingSeconds: 90,
};

const golf: ServerSportContext = {
  sportKey: 'golf',
  displayName: 'Golf',
  vocabulary: GOLF_VOCABULARY_FLAT,
  sessionUnit: 'round',
  extractionPrompt: GOLF_EXTRACTION_PROMPT,
  coachingPrompt: GOLF_COACHING_PROMPT,
  sentimentLabels: ['frustrated', 'flat', 'neutral', 'encouraged', 'dialed in'],
  qualityGatePhrases: [
    'just keep practicing',
    'work on your swing',
    'keep your head down',
    'just have fun',
  ],
  minRecordingSeconds: 20,
  maxRecordingSeconds: 90,
};

const registry: Record<string, ServerSportContext> = { bjj, golf };

export function getSportContext(sportKey: string): ServerSportContext {
  const ctx = registry[sportKey];
  if (!ctx) throw new Error(`Unknown sport: ${sportKey}`);
  return ctx;
}
