/**
 * RFC-4122-shaped v4 UUID. Uses crypto.randomUUID when the runtime provides
 * it (web); falls back to Math.random on Hermes — React Native 0.81 ships no
 * WebCrypto, and expo-crypto is deliberately NOT a dependency (native module;
 * adding it would cost an EAS build for something OTA-updatable JS can do).
 * Collision scope is per-user idempotency keys, so this entropy is plenty.
 */
export function generateUuid(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  let out = '';
  for (const ch of 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx') {
    if (ch === 'x') out += ((Math.random() * 16) | 0).toString(16);
    else if (ch === 'y') out += (((Math.random() * 4) | 0) + 8).toString(16);
    else out += ch;
  }
  return out;
}
