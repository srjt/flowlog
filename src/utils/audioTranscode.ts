/**
 * Web-only audio transcoding. Chrome's MediaRecorder produces WebM/Opus, which
 * Gemini's audio API does not accept (it takes wav/mp3/aac/ogg/flac). We decode
 * the recording with the Web Audio API and re-encode it to 16 kHz mono WAV
 * (Gemini downsamples to 16 kHz mono anyway). Used by the local Gemini
 * transcription provider AND the production upload path (so the server-side
 * pipeline receives a supported format).
 */

interface WebAudioBuffer {
  duration: number;
  getChannelData(channel: number): Float32Array;
}
interface OfflineCtx {
  createBufferSource(): {
    buffer: WebAudioBuffer | null;
    connect(node: unknown): void;
    start(when: number): void;
  };
  destination: unknown;
  startRendering(): Promise<WebAudioBuffer>;
}
interface AudioCtx {
  decodeAudioData(data: ArrayBuffer): Promise<WebAudioBuffer>;
  close(): Promise<void>;
}
interface WebAudioGlobals {
  AudioContext?: new () => AudioCtx;
  webkitAudioContext?: new () => AudioCtx;
  OfflineAudioContext?: new (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineCtx;
  webkitOfflineAudioContext?: new (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineCtx;
  btoa?(data: string): string;
}

const TARGET_RATE = 16000;

/** Decode any browser-recorded audio buffer and re-encode to 16 kHz mono WAV. */
export async function encodeToWav16kMono(
  input: ArrayBuffer,
): Promise<ArrayBuffer> {
  const g = globalThis as unknown as WebAudioGlobals;
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctx || !Offline) {
    throw new Error('Web Audio API unavailable for audio transcoding.');
  }
  const ctx = new Ctx();
  const decoded = await ctx.decodeAudioData(input.slice(0));
  await ctx.close();

  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new Offline(1, frames, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return floatToWav(rendered.getChannelData(0), TARGET_RATE);
}

/** Fetch the recording and return a 16 kHz mono WAV Blob. */
export async function recordingToWavBlob(audioUri: string): Promise<Blob> {
  const buffer = await (await fetch(audioUri)).arrayBuffer();
  const wav = await encodeToWav16kMono(buffer);
  return new Blob([wav], { type: 'audio/wav' });
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const g = globalThis as unknown as WebAudioGlobals;
  const btoaFn = g.btoa;
  if (!btoaFn) throw new Error('btoa unavailable for base64 encoding.');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoaFn(binary);
}

function floatToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}
