import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import {
  authService,
  ChangePasswordError,
  type ChangePasswordFailure,
} from '@/services/AuthService';

/** Stricter than Supabase's default of 6; the server's own minimum still applies. */
const MIN_PASSWORD_LENGTH = 8;

const FAILURE_MESSAGE: Record<ChangePasswordFailure, string> = {
  'wrong-current': 'Your current password is incorrect.',
  rejected:
    'That new password wasn’t accepted. Try a longer one that’s harder to guess.',
  failed: 'Couldn’t change your password. Check your connection and try again.',
};

/** Checks that need no network call. Returns the message to show, or null. */
function validate(current: string, next: string, confirm: string) {
  if (!current || !next || !confirm) return 'Fill in all three fields.';
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (next !== confirm) return 'The new passwords don’t match.';
  if (next === current) {
    return 'Your new password must be different from your current one.';
  }
  return null;
}

function PasswordField(props: TextInputProps) {
  return (
    <TextInput
      className="min-h-[48px] rounded-xl bg-background px-4 py-3 text-white"
      placeholderTextColor="#8A8A99"
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
    />
  );
}

/**
 * Profile's "Change password" row. Stays a single row until tapped, then
 * expands in place into current / new / confirm fields. Profile renders it only
 * for a signed-in account that has a password, outside demo / local-test mode.
 * The athlete stays signed in afterwards.
 */
export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const close = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  };

  const onSave = async () => {
    if (saving) return;
    const invalid = validate(current, next, confirm);
    setError(invalid);
    if (invalid) return;
    setSaving(true);
    try {
      await authService.changePassword(current, next);
      close();
      setChanged(true);
    } catch (err) {
      const reason = err instanceof ChangePasswordError ? err.reason : 'failed';
      // Only a wrong current password needs retyping; keep the rest.
      if (reason === 'wrong-current') setCurrent('');
      setError(FAILURE_MESSAGE[reason]);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <View className="gap-2">
        <Button
          testID="change-password"
          title="Change password"
          variant="secondary"
          onPress={() => {
            setChanged(false);
            setOpen(true);
          }}
        />
        {changed ? (
          <Text
            variant="caption"
            className="text-success"
            accessibilityLiveRegion="polite"
          >
            Password changed. Use your new password next time you sign in.
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Card className="gap-3">
      <Text variant="heading">Change password</Text>
      <PasswordField
        testID="change-password-current"
        placeholder="Current password"
        accessibilityLabel="Current password"
        autoComplete="current-password"
        textContentType="password"
        editable={!saving}
        value={current}
        onChangeText={setCurrent}
      />
      <PasswordField
        testID="change-password-new"
        placeholder="New password"
        accessibilityLabel="New password"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!saving}
        value={next}
        onChangeText={setNext}
      />
      <PasswordField
        testID="change-password-confirm"
        placeholder="Confirm new password"
        accessibilityLabel="Confirm new password"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!saving}
        value={confirm}
        onChangeText={setConfirm}
      />
      <Text variant="caption">At least {MIN_PASSWORD_LENGTH} characters.</Text>
      {error ? (
        <Text
          variant="caption"
          className="text-danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        <Button
          testID="change-password-save"
          title="Save"
          accessibilityLabel="Save new password"
          loading={saving}
          className="flex-1"
          onPress={() => void onSave()}
        />
        <Button
          testID="change-password-cancel"
          title="Cancel"
          variant="secondary"
          disabled={saving}
          className="flex-1"
          onPress={close}
        />
      </View>
    </Card>
  );
}
