import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import {
  reviewService,
  type ReviewerIdentity,
  type Verdict,
} from '@/services/ReviewService';
import {
  orderQueue,
  queueProgress,
  type ReviewableRecord,
  type VoteTally,
} from '@/utils/reviewQueue';
import { logger } from '@/utils/logger';

/**
 * The certification bench (#77).
 *
 * A separate route rather than a tab: reviewers are black belts doing a favour,
 * not Flowlog users. Reaching /review directly skips the onboarding gate in
 * `app/index.tsx`, so nobody has to pick a belt level and prime a microphone to
 * judge a card.
 *
 * Reviewers see the SERVING record only — never the source quote. That is what
 * lets this page be shared with people outside the project: it holds no
 * verbatim instructional text. Measured before deciding: 99% of records carry a
 * `why` and 91% a `detail`, so the distilled text is judgeable on its own.
 */
export default function ReviewScreen() {
  const [reviewer, setReviewer] = useState<ReviewerIdentity | null | undefined>(
    undefined,
  );
  const [records, setRecords] = useState<ReviewableRecord[]>([]);
  const [tallies, setTallies] = useState<Map<string, VoteTally>>(new Map());
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await reviewService.whoAmI();
    setReviewer(me);
    if (!me) return;
    try {
      const data = await reviewService.loadQueue(me.id);
      setRecords(data.records);
      setTallies(data.tallies);
      setMyVotes(data.myVotes);
      setError(null);
    } catch (err) {
      logger.error('review queue failed', err);
      setError('Could not load the queue. Check your connection and retry.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const queue = useMemo(
    () => orderQueue(records, tallies, myVotes),
    [records, tallies, myVotes],
  );
  const progress = useMemo(
    () => queueProgress(records, queue),
    [records, queue],
  );
  const card = queue[0];

  const submit = async (verdict: Verdict) => {
    if (!card || !reviewer || saving) return;
    setSaving(true);
    try {
      await reviewService.vote(card.id, reviewer.id, verdict, note);
      // Advance locally rather than refetching: a full reload between every
      // card would make the bench feel like paperwork.
      setMyVotes((prev) => new Set(prev).add(card.id));
      setTallies((prev) => {
        const next = new Map(prev);
        const t = next.get(card.id) ?? { certify: 0, reject: 0 };
        next.set(card.id, {
          certify: t.certify + (verdict === 'certify' ? 1 : 0),
          reject: t.reject + (verdict === 'reject' ? 1 : 0),
        });
        return next;
      });
      setNote('');
      setError(null);
    } catch {
      setError('That vote did not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (reviewer === undefined) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  // RLS makes a non-reviewer's queue look exactly like a finished one, so say
  // which it is rather than congratulating someone on work they cannot see.
  if (reviewer === null) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
        <View className="gap-3">
          <Text variant="heading">Not a reviewer</Text>
          <Text variant="caption">
            This bench is invite-only. If you were expecting access, sign in
            with the account you were invited on and ask to be added.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-5 p-6">
        <View className="gap-1">
          <Text variant="heading">Certification bench</Text>
          <Text variant="caption" testID="review-progress">
            {reviewer.displayName} · {progress.remaining} to review ·{' '}
            {progress.settled} settled · {progress.contested} contested
          </Text>
        </View>

        {error ? (
          <Card>
            <Text variant="body" className="text-accent">
              {error}
            </Text>
          </Card>
        ) : null}

        {!card ? (
          <Card>
            <View className="gap-2">
              <Text variant="title">Queue clear</Text>
              <Text variant="caption">
                Nothing left that you have not already voted on. Records where
                reviewers disagree stay in the queue for a third opinion.
              </Text>
            </View>
          </Card>
        ) : (
          <>
            <Card testID="review-card">
              <View className="gap-4">
                <View className="flex-row items-center justify-between">
                  <Text variant="caption" className="text-primary">
                    {card.position}
                  </Text>
                  {card.contested ? (
                    <Text variant="caption" className="text-accent">
                      reviewers disagree
                    </Text>
                  ) : null}
                </View>

                <Text variant="title">{card.prescription}</Text>

                {card.why ? (
                  <View className="gap-1">
                    <Text variant="caption" className="text-muted">
                      WHY
                    </Text>
                    <Text variant="body">{card.why}</Text>
                  </View>
                ) : null}

                {card.detail ? (
                  <View className="gap-1">
                    <Text variant="caption" className="text-muted">
                      DETAIL
                    </Text>
                    <Text variant="body">{card.detail}</Text>
                  </View>
                ) : null}

                {card.counter ? (
                  <View className="gap-1">
                    <Text variant="caption" className="text-muted">
                      THEY COUNTER WITH
                    </Text>
                    <Text variant="body">{card.counter}</Text>
                  </View>
                ) : null}

                <Text variant="caption" className="text-muted">
                  Applies when: {card.gi}
                  {card.level !== 'any' ? `, ${card.level}` : ''}
                  {card.opponent ? `, ${card.opponent}` : ''}
                </Text>
              </View>
            </Card>

            <View className="gap-2">
              <Text variant="caption" className="text-muted">
                NOTE — required in spirit on a reject: &ldquo;wrong&rdquo;
                without a reason cannot be acted on.
              </Text>
              <TextInput
                testID="review-note"
                value={note}
                onChangeText={setNote}
                placeholder="What is wrong with it, or what would you change?"
                placeholderTextColor="#8A8A99"
                multiline
                className="min-h-[80px] rounded-xl border border-muted bg-surface p-3 text-white"
              />
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button
                  testID="review-reject"
                  title={saving ? '…' : 'Wrong'}
                  variant="secondary"
                  onPress={() => void submit('reject')}
                />
              </View>
              <View className="flex-1">
                <Button
                  testID="review-certify"
                  title={saving ? '…' : 'Sound'}
                  onPress={() => void submit('certify')}
                />
              </View>
            </View>

            <Text variant="caption" className="text-muted">
              Two reviewers agreeing settles a record. Judge only whether this
              is correct jiu-jitsu for the position named — not whether it is
              the most important thing to say about it.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
