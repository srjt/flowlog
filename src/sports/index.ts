import type { ISportContext } from '@/sports/ISportContext';
import { bjjContext } from '@/sports/bjj/bjjContext';
import { golfContext } from '@/sports/golf/golfContext';
import type { SportKey } from '@/types/sport';

/**
 * Sport registry — maps a sport key to its context. This is THE expansion
 * point: adding a sport means adding three files under `src/sports/{key}/`
 * and one line here. No pipeline, service, or provider code changes.
 */
const sportRegistry: Record<string, ISportContext> = {
  bjj: bjjContext,
  golf: golfContext,
};

/**
 * Fetch a sport context by key. Throws on unknown keys so misconfiguration
 * fails fast rather than silently producing sport-agnostic garbage.
 */
export const getSportContext = (sportKey: string): ISportContext => {
  const context = sportRegistry[sportKey];
  if (!context) throw new Error(`Unknown sport: ${sportKey}`);
  return context;
};

/** All registered sport keys — useful for sport pickers and validation. */
export const registeredSportKeys = (): SportKey[] =>
  Object.keys(sportRegistry) as SportKey[];

export { sportRegistry };
export type { ISportContext };
