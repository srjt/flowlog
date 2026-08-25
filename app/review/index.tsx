import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import {
  reviewService,
  type ReviewerAccess,
  type Verdict,
} from '@/services/ReviewService';
import {
  orderQueue,
  queueProgress,
  type PriorVote,
  type ReviewableRecord,
  type VoteTally,
} from '@/utils/reviewQueue';
import { logger } from '@/utils/logger';

/**
 * The certification bench (#77, notes added in #84).
 *
 * A separate route rather than a tab: reviewers are black belts doing a favour,
 * not Flowlog users. Reaching /review directly skips the onboarding gate in
 * `app/index.tsx`, so nobody has to pick a belt level and prime a microphone to
 * judge a card.
 *
 * Reviewers see the SERVING record only — never the source quote. That is what
 * lets this page be shared with people outside the project: it holds no
 * verbatim instructional text.
 */
export default function ReviewScreen() {
  const [access, setAccess] = useState<ReviewerAccess | undefined>(undefined);
  const reviewer = access?.state === 'reviewer' ? access.identity : null;
  const [records, setRecords] = useState<ReviewableRecord[]>([]);
  const [tallies, setTallies] = useState<Map<string, VoteTally>>(new Map());
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [priorVotes, setPriorVotes] = useState<Map<string, PriorVote[]>>(
    new Map(),
  );
  const [myVoteFor, setMyVoteFor] = useState<Map<string, PriorVote>>(new Map());
  const [note, setNote] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState<ReviewableRecord | null>(null);
  /**
   * The record just voted on. A voted card leaves the queue at once, so an
   * edit control attached to the card itself could never be reached — the
   * only moment a reviewer realises they mistyped is straight after sending.
   */
  const [justVoted, setJustVoted] = useState<{
    record: ReviewableRecord;
    verdict: Verdict;
  } | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await reviewService.whoAmI();
    setAccess(me);
    if (me.state !== 'reviewer') return;
    try {
      const data = await reviewService.loadQueue(me.identity.id);
      setRecords(data.records);
      setTallies(data.tallies);
      setMyVotes(data.myVotes);
      setPriorVotes(data.priorVotes);
      setMyVoteFor(data.myVoteFor);
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
    () => orderQueue(records, tallies, myVotes, [], skipped),
    [records, tallies, myVotes, skipped],
  );
  const progress = useMemo(
    () => queueProgress(records, queue),
    [records, queue],
  );
  const card = editing ?? queue[0];
  const others = card ? (priorVotes.get(card.id) ?? []) : [];
  const withNotes = others.filter((v) => v.note);

  // A reject with no reasoning is a boolean. It cannot be acted on: nobody can
  // re-mine, correct, or argue with "wrong". The bench asks for black-belt
  // attention, and this is the part of it worth keeping.
  const rejectBlocked = note.trim().length === 0;

  /**
   * Pass on this card. Writes NOTHING.
   *
   * A reviewer who does not know a position must have an exit that is not a
   * guess — a guessed "sound" is worse than no vote, because two of them
   * certify a record nobody actually vouched for.
   */
  const skip = () => {
    if (!card) return;
    setSkipped((prev) => new Set(prev).add(card.id));
    setEditing(null);
    setJustVoted(null);
    setNote('');
    setRevealed(false);
  };

  const startEditing = (record: ReviewableRecord) => {
    setEditing(record);
    setJustVoted(null);
    setNote(myVoteFor.get(record.id)?.note ?? '');
    setRevealed(false);
  };

  const submit = async (verdict: Verdict) => {
    if (!card || !reviewer || saving) return;
    if (verdict === 'reject' && rejectBlocked) return;
    setSaving(true);
    try {
      await reviewService.vote(card.id, reviewer.id, verdict, note);
      const mine: PriorVote = {
        reviewerId: reviewer.id,
        reviewerName: reviewer.displayName,
        credential: reviewer.credential,
        verdict,
        note: note.trim() || null,
      };
      setMyVoteFor((prev) => new Map(prev).set(card.id, mine));
      // Advance locally rather than refetching: a full reload between every
      // card would make the bench feel like paperwork.
      if (!editing) {
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
      }
      setJustVoted(editing ? null : { record: card, verdict });
      setEditing(null);
      setNote('');
      setRevealed(false);
      setError(null);
    } catch {
      setError('That vote did not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (access === undefined) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  // Three distinct reasons the bench might be shut, said distinctly. Collapsing
  // them is how a backend 500 spent an afternoon impersonating a permissions
  // decision.
  if (access.state !== 'reviewer') {
    const copy =
      access.state === 'signed-out'
        ? {
            testID: 'review-signed-out',
            heading: 'Sign in first',
            body: 'Log in with the account you were invited on, then come back to this page.',
          }
        : access.state === 'not-a-reviewer'
          ? {
              testID: 'review-not-reviewer',
              heading: 'Not a reviewer',
              body: 'This bench is invite-only. You are signed in, but this account is not on the reviewer list yet — ask to be added.',
            }
          : {
              testID: 'review-error',
              heading: 'Could not check your access',
              body: `Something went wrong reaching the server, so we cannot tell whether you are a reviewer. This is a fault on our side, not a permissions decision. ${access.message}`,
            };
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
        <View className="gap-3" testID={copy.testID}>
          <Text variant="heading">{copy.heading}</Text>
          <Text variant="caption">{copy.body}</Text>
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
            {access.identity.displayName} · {progress.remaining} to review ·{' '}
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
                {skipped.size > 0
                  ? `Nothing left in this sitting. ${skipped.size} skipped card${skipped.size === 1 ? '' : 's'} will come back next time you open the bench — a skip is not recorded as a verdict.`
                  : 'Nothing left that you have not already voted on. Records where reviewers disagree stay in the queue for a third opinion.'}
              </Text>
            </View>
          </Card>
        ) : (
          <>
            {justVoted ? (
              <Card testID="review-just-voted">
                <View className="gap-2">
                  <Text variant="caption" className="text-muted">
                    Recorded &ldquo;
                    {justVoted.verdict === 'certify' ? 'sound' : 'wrong'}&rdquo;
                    on the previous card.
                  </Text>
                  <Button
                    testID="review-edit-mine"
                    title="Change that"
                    variant="ghost"
                    onPress={() => startEditing(justVoted.record)}
                  />
                </View>
              </Card>
            ) : null}

            {editing ? (
              <Card testID="review-editing-banner">
                <Text variant="caption" className="text-primary">
                  Changing your earlier verdict on this record.
                </Text>
              </Card>
            ) : null}

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

            {/*
              Anchoring, handled deliberately (#84).

              Showing another reviewer's reasoning up front would tell you what
              to think before you have thought. Hiding it entirely makes you
              re-derive an argument someone already made, which is how two
              competent people reach opposite verdicts and mark a record
              contested — and contested records ground no cues at all.

              So: the fact of disagreement is always visible, the argument is
              one tap away. Form a view, then read theirs.
            */}
            {others.length > 0 ? (
              <Card testID="review-prior">
                <View className="gap-3">
                  <Text variant="caption" className="text-muted">
                    {others.filter((v) => v.verdict === 'certify').length} sound
                    · {others.filter((v) => v.verdict === 'reject').length}{' '}
                    wrong , from other reviewers
                  </Text>
                  {revealed ? (
                    others.map((v) => (
                      <View key={v.reviewerId} className="gap-1">
                        <Text variant="caption" className="text-primary">
                          {v.reviewerName}
                          {v.credential ? `, ${v.credential}` : ''} ·{' '}
                          {v.verdict === 'certify' ? 'sound' : 'wrong'}
                        </Text>
                        <Text variant="body">
                          {v.note ?? 'No reason given.'}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Button
                      testID="review-reveal"
                      title={
                        withNotes.length > 0
                          ? `Read ${withNotes.length === 1 ? 'their reasoning' : 'their reasoning'}`
                          : 'See who voted'
                      }
                      variant="ghost"
                      onPress={() => setRevealed(true)}
                    />
                  )}
                </View>
              </Card>
            ) : null}

            <View className="gap-2">
              <Text variant="caption" className="text-muted">
                WHY — required to mark something wrong
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
                  disabled={saving || rejectBlocked}
                  onPress={() => void submit('reject')}
                />
              </View>
              <View className="flex-1">
                <Button
                  testID="review-certify"
                  title={saving ? '…' : 'Sound'}
                  disabled={saving}
                  onPress={() => void submit('certify')}
                />
              </View>
            </View>

            <Button
              testID="review-skip"
              title="Skip — I can't judge this one"
              variant="ghost"
              disabled={saving}
              onPress={skip}
            />

            {rejectBlocked ? (
              <Text
                variant="caption"
                className="text-muted"
                testID="review-reject-hint"
              >
                To mark this wrong, say why. &ldquo;Wrong&rdquo; on its own
                cannot be re-mined, corrected, or argued with — the reason is
                the part worth having.
              </Text>
            ) : null}

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
