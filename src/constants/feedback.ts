/**
 * Single-select reasons offered when a user marks a cue unhelpful (👎). Kept
 * short and tappable; the "why" is the most useful feedback signal.
 */
export const FEEDBACK_REASONS = [
  'Too generic',
  'Wrong position',
  'Not actionable',
  'Already knew it',
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
