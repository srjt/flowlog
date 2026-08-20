import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { FEEDBACK_REASONS } from '@/constants/feedback';

/** Max length for the free-text 👎 note — a sensible cap, not a hard limit. */
export const FEEDBACK_NOTE_MAX = 500;

/**
 * Thumbs up/down on a coaching cue. Choosing 👎 reveals single-select reason
 * chips (the quick "why" signal) plus an optional free-text note (the richer
 * "what was wrong / how to improve" signal) — the two are independent. Fully
 * controlled: the parent owns thumb/reason/note and persists them. Used by both
 * the Result screen and Session Detail.
 */
export function FeedbackControls({
  thumb,
  reason,
  note,
  onThumb,
  onReason,
  onNote,
}: {
  thumb: boolean | null;
  reason: string | null;
  note: string | null;
  onThumb: (up: boolean) => void;
  onReason: (reason: string) => void;
  // May return a promise; the note field awaits it so it can confirm a real
  // save or surface a failure (rather than optimistically claiming "Saved").
  onNote: (note: string) => void | Promise<void>;
}) {
  return (
    <View className="gap-3">
      <Text variant="caption">Was this cue useful?</Text>
      <View className="flex-row gap-3">
        <Pressable
          testID="thumb-up"
          accessibilityRole="button"
          accessibilityLabel="Mark cue helpful"
          accessibilityState={{ selected: thumb === true }}
          onPress={() => onThumb(true)}
          className={`h-12 flex-1 items-center justify-center rounded-xl border ${
            thumb === true
              ? 'border-success bg-success/20'
              : 'border-muted bg-surface'
          }`}
        >
          <Text variant="body">{thumb === true ? '👍 Helpful' : '👍'}</Text>
        </Pressable>
        <Pressable
          testID="thumb-down"
          accessibilityRole="button"
          accessibilityLabel="Mark cue unhelpful"
          accessibilityState={{ selected: thumb === false }}
          onPress={() => onThumb(false)}
          className={`h-12 flex-1 items-center justify-center rounded-xl border ${
            thumb === false
              ? 'border-danger bg-danger/20'
              : 'border-muted bg-surface'
          }`}
        >
          <Text variant="body">{thumb === false ? '👎 Off' : '👎'}</Text>
        </Pressable>
      </View>

      {thumb === false ? (
        <View className="gap-3">
          <View className="gap-2">
            <Text variant="caption">What was off?</Text>
            <View className="flex-row flex-wrap gap-2">
              {FEEDBACK_REASONS.map((r) => {
                const selected = reason === r;
                return (
                  <Pressable
                    key={r}
                    testID={`reason-${r}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Reason: ${r}`}
                    accessibilityState={{ selected }}
                    onPress={() => onReason(r)}
                    className={`min-h-[44px] justify-center rounded-full border px-3 py-2 ${
                      selected
                        ? 'border-primary bg-primary/20'
                        : 'border-muted bg-surface'
                    }`}
                  >
                    <Text
                      variant="caption"
                      className={selected ? 'text-white' : 'text-muted'}
                    >
                      {r}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <NoteField value={note} onCommit={onNote} />
        </View>
      ) : null}
    </View>
  );
}

type NoteSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Optional free-text note. Keeps a local draft so we don't persist on every
 * keystroke. An explicit "Save note" button commits it and reflects the REAL
 * outcome — "Saving…", then "Saved ✓" only once the parent's persist resolves,
 * or an error the user can retry — so the confirmation never lies. Blur also
 * commits (when there are unsaved changes) as a safety net. Re-seeds from
 * `value` when it changes externally (a loaded session, or a clear on flip).
 */
function NoteField({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (note: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [savedValue, setSavedValue] = useState(value ?? '');
  const [status, setStatus] = useState<NoteSaveStatus>('idle');
  useEffect(() => {
    setDraft(value ?? '');
    setSavedValue(value ?? '');
    setStatus('idle');
  }, [value]);

  const dirty = draft.trim() !== savedValue;

  const save = async () => {
    const trimmed = draft.trim();
    setStatus('saving');
    try {
      await onCommit(trimmed);
      setSavedValue(trimmed);
      setStatus('saved');
    } catch {
      // The parent's persist rejected (e.g. the write hit 0 rows / a network
      // error). Keep the draft so the user can retry, and show the failure.
      setStatus('error');
    }
  };

  const statusText =
    status === 'saving'
      ? 'Saving…'
      : status === 'error'
        ? 'Couldn’t save — tap Save note to try again.'
        : dirty
          ? 'Unsaved changes'
          : savedValue.length > 0
            ? 'Saved ✓'
            : '';
  const statusClass =
    status === 'error'
      ? 'text-danger'
      : status === 'saved' && !dirty
        ? 'text-success'
        : 'text-muted';

  return (
    <View className="gap-2">
      <Text variant="caption">Add a note (optional)</Text>
      <TextInput
        testID="feedback-note-input"
        accessibilityLabel="Feedback note: what was wrong and how it could be improved"
        placeholder="What was wrong, and how could it be better?"
        placeholderTextColor="#8A8A99"
        value={draft}
        onChangeText={setDraft}
        onBlur={() => {
          if (dirty) void save();
        }}
        multiline
        maxLength={FEEDBACK_NOTE_MAX}
        textAlignVertical="top"
        className="min-h-20 rounded-xl border border-muted bg-surface px-4 py-3 text-base text-white"
      />
      <View className="flex-row items-center justify-between gap-3">
        <Text
          testID="feedback-note-status"
          variant="caption"
          className={statusClass}
        >
          {statusText}
        </Text>
        <Button
          testID="feedback-note-save"
          title="Save note"
          variant="secondary"
          loading={status === 'saving'}
          // Enabled while there are unsaved changes, or to retry after an error.
          disabled={status === 'saving' || (!dirty && status !== 'error')}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}
