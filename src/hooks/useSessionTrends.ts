import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { loadSessions } from '@/services/sessionsSource';
import { computeTrends, type SportTrends } from '@/services/TrendsService';
import { useUserStore } from '@/store/userStore';

/**
 * Loads the user's sessions for the active sport and computes trends
 * (single source of truth: `computeTrends`). Lazy — refreshes on screen focus —
 * so callers can render immediately and fill in when data arrives. Used by both
 * the Record streak strip and the "Working on" pill.
 */
export function useSessionTrends(): {
  trends: SportTrends | null;
  loading: boolean;
} {
  const { authUser, activeSport } = useUserStore();
  const [trends, setTrends] = useState<SportTrends | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      loadSessions(authUser?.id ?? 'demo-user', activeSport)
        .then((sessions) => {
          if (!active) return;
          setTrends(
            computeTrends(sessions.filter((s) => s.sportKey === activeSport)),
          );
          setLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setTrends(null);
          setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [authUser, activeSport]),
  );

  return { trends, loading };
}
