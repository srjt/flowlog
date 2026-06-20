/**
 * Golf domain vocabulary for transcription priming — STUB.
 *
 * TODO(golf): Populate with 150+ real golf terms across categories before
 * enabling FEATURE_GOLF_SPORT. Mirror the structure of bjjVocabulary.ts.
 * Suggested categories: clubs, shotTypes, courseFeatures, swingMechanics,
 * shortGame, scoring, slang.
 */
export const GOLF_VOCABULARY = {
  // TODO(golf): clubs — Driver, 3-Wood, 7-Iron, Pitching Wedge, Putter, ...
  clubs: [] as string[],
  // TODO(golf): shotTypes — Draw, Fade, Punch, Flop, Stinger, ...
  shotTypes: [] as string[],
  // TODO(golf): courseFeatures — Fairway, Rough, Bunker, Green, Dogleg, ...
  courseFeatures: [] as string[],
  // TODO(golf): swingMechanics — Takeaway, Downswing, Lag, Release, Tempo, ...
  swingMechanics: [] as string[],
  // TODO(golf): shortGame — Chip, Pitch, Bump and Run, Lag Putt, ...
  shortGame: [] as string[],
  // TODO(golf): scoring — Birdie, Bogey, Par, Eagle, Up and Down, ...
  scoring: [] as string[],
  // TODO(golf): slang — Shank, Duff, Gimme, Mulligan, Sandbagger, ...
  slang: [] as string[],
} as const;

export const GOLF_VOCABULARY_FLAT: string[] =
  Object.values(GOLF_VOCABULARY).flat();
