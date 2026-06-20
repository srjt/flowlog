/**
 * Sport-level shared types.
 *
 * The full sport-context contract lives in `@/sports/ISportContext`. This file
 * holds the lightweight identifiers the rest of the app references so that
 * nothing outside `src/sports/` needs to import a concrete sport module.
 */

/** Every supported (or planned) sport key. The string union is the contract. */
export type SportKey = 'bjj' | 'golf' | 'tennis' | 'climbing' | 'chess';

/** Convenience re-export so callers can `import { ISportContext } from '@/types/sport'`. */
export type { ISportContext } from '@/sports/ISportContext';
