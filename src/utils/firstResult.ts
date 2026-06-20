import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from '@/utils/logger';

/**
 * One-time flag for the first-result celebration. Persisted so the celebratory
 * treatment never replays, even across app restarts or revisiting the screen.
 */
const KEY = 'flowlog.celebratedFirstResult.v1';

export async function hasCelebratedFirstResult(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch (err) {
    logger.warn('hasCelebratedFirstResult failed', err);
    return false;
  }
}

export async function markFirstResultCelebrated(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch (err) {
    logger.warn('markFirstResultCelebrated failed', err);
  }
}
