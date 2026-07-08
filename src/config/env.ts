/**
 * Typed, validated environment access — THE ONLY file permitted to read
 * `process.env`. Enforced by an ESLint `no-restricted-syntax` rule.
 *
 * The app throws a clear, descriptive error at startup if any required
 * variable is missing or malformed, so misconfiguration fails fast and loud
 * rather than surfacing as a confusing runtime bug deep in the pipeline.
 */

/* eslint-disable no-restricted-syntax, no-restricted-properties */

export type AppEnv = 'development' | 'staging' | 'production';
export type TranscriptionProviderKey =
  | 'whisper'
  | 'assemblyai'
  | 'deepgram'
  | 'gemini';
export type AIProviderKey = 'claude' | 'openai' | 'gemini';

class EnvError extends Error {
  constructor(message: string) {
    super(`[env] ${message}`);
    this.name = 'EnvError';
  }
}

const raw = process.env;

// Local warn (env.ts must not import the logger — the logger imports from here).
function warn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[env] ${message}`);
}

// `literal`, when passed, MUST be a static `process.env.EXPO_PUBLIC_X` member
// expression at the call site (not a variable or computed key). Metro's Babel
// env-inlining plugin only rewrites that exact literal pattern into a string at
// bundle time — it cannot see through `raw[key]` dynamic lookups, which read as
// `undefined` in a release Hermes bundle (there is no real `process.env` object
// on-device, only whatever got statically inlined). Server-only vars have no
// `literal` and keep using `raw[key]`, which is correct there: they run in a
// real Node process (tests, the edge function) and must never be inlined into
// the client bundle. See docs/SDK54_UPGRADE.md — "EXPO_PUBLIC_ vars missing at
// runtime" for the incident this fixes.
function resolve(key: string, literal: string | undefined): string | undefined {
  return literal !== undefined ? literal : raw[key];
}

function required(key: string, literal?: string): string {
  const value = resolve(key, literal);
  if (value === undefined || value === null || value.trim() === '') {
    throw new EnvError(
      `Missing required environment variable "${key}". ` +
        `Add it to your .env.local (see .env.example for the full list).`,
    );
  }
  return value.trim();
}

function optional(key: string, fallback = '', literal?: string): string {
  const value = resolve(key, literal);
  return value === undefined || value === null ? fallback : value.trim();
}

function asInt(key: string, fallback: number, literal?: string): number {
  const value = resolve(key, literal);
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new EnvError(
      `Environment variable "${key}" must be an integer, got "${value}".`,
    );
  }
  return parsed;
}

function asBool(key: string, fallback: boolean, literal?: string): boolean {
  const value = resolve(key, literal);
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function asEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  literal?: string,
): T {
  const value = (resolve(key, literal)?.trim() ?? '') as T;
  if (value === '') return fallback;
  if (!allowed.includes(value)) {
    throw new EnvError(
      `Environment variable "${key}" must be one of [${allowed.join(
        ', ',
      )}], got "${value}".`,
    );
  }
  return value;
}

export interface Env {
  // App
  APP_NAME: string;
  APP_ENV: AppEnv;

  // Supabase
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Transcription
  TRANSCRIPTION_PROVIDER: TranscriptionProviderKey;
  OPENAI_API_KEY: string;
  ASSEMBLYAI_API_KEY: string;
  DEEPGRAM_API_KEY: string;

  // AI
  AI_PROVIDER: AIProviderKey;
  ANTHROPIC_API_KEY: string;
  OPENAI_CHAT_API_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;

  // Payments
  REVENUECAT_API_KEY_IOS: string;
  REVENUECAT_API_KEY_ANDROID: string;
  STRIPE_PUBLISHABLE_KEY: string;

  // Pipeline tuning
  COACHING_CUE_MAX_WORDS: number;
  QUALITY_GATE_ENABLED: boolean;
  QUALITY_GATE_RETRY_LIMIT: number;
  MAX_RECORDING_SECONDS: number;
  MIN_RECORDING_SECONDS: number;

  // Feature flags
  FEATURE_TREND_ANALYSIS: boolean;
  FEATURE_GAME_PROFILE: boolean;
  FEATURE_SOCIAL: boolean;
  FEATURE_VIDEO_INTEGRATION: boolean;
  FEATURE_GOLF_SPORT: boolean;

  // Demo / prototyping. EXPO_PUBLIC_ so it's available to the running app.
  // When true, the pipeline returns canned results locally — no audio upload,
  // no edge function, no API keys. For offline UX prototyping.
  DEMO_MODE: boolean;

  // Local TEST pipeline. When true, the app runs the real transcription + AI
  // pipeline directly in the client using the EXPO_PUBLIC keys below — no
  // Supabase, no edge function. LOCAL TESTING ONLY: the keys ship in the client
  // bundle, so never enable this in a real build. Production uses the edge
  // function (keys server-side).
  LOCAL_PIPELINE: boolean;
  LOCAL_TRANSCRIPTION_PROVIDER: TranscriptionProviderKey;
  LOCAL_AI_PROVIDER: AIProviderKey;
  LOCAL_OPENAI_API_KEY: string;
  LOCAL_ANTHROPIC_API_KEY: string;
  LOCAL_GEMINI_API_KEY: string;

  // Auth bypass. TEMPORARY, TESTING ONLY: when both are set, the app signs in
  // as this fixed test account directly against Supabase's token endpoint on
  // launch (bypassing the login/signup screens) so real Supabase data/pipeline
  // testing can proceed while the sign-in UI crash (see docs/SDK54_UPGRADE.md)
  // is investigated separately. Never enable in a real build — credentials
  // ship in the client bundle.
  AUTH_BYPASS_EMAIL: string;
  AUTH_BYPASS_PASSWORD: string;
}

/**
 * Build and validate the env object once at module load. Importing this module
 * is sufficient to trigger validation, so the app crashes early on
 * misconfiguration.
 */
function buildEnv(): Env {
  const env: Env = {
    APP_NAME: optional('APP_NAME', 'Flowlog'),
    APP_ENV: asEnum<AppEnv>(
      'APP_ENV',
      ['development', 'staging', 'production'],
      'development',
    ),

    SUPABASE_URL: required(
      'EXPO_PUBLIC_SUPABASE_URL',
      process.env.EXPO_PUBLIC_SUPABASE_URL,
    ),
    SUPABASE_ANON_KEY: required(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    ),
    SUPABASE_SERVICE_ROLE_KEY: optional('SUPABASE_SERVICE_ROLE_KEY'),

    TRANSCRIPTION_PROVIDER: asEnum<TranscriptionProviderKey>(
      'TRANSCRIPTION_PROVIDER',
      ['whisper', 'assemblyai', 'deepgram', 'gemini'],
      'whisper',
    ),
    OPENAI_API_KEY: optional('OPENAI_API_KEY'),
    ASSEMBLYAI_API_KEY: optional('ASSEMBLYAI_API_KEY'),
    DEEPGRAM_API_KEY: optional('DEEPGRAM_API_KEY'),

    AI_PROVIDER: asEnum<AIProviderKey>(
      'AI_PROVIDER',
      ['claude', 'openai', 'gemini'],
      'claude',
    ),
    ANTHROPIC_API_KEY: optional('ANTHROPIC_API_KEY'),
    OPENAI_CHAT_API_KEY: optional('OPENAI_CHAT_API_KEY'),
    GEMINI_API_KEY: optional('GEMINI_API_KEY'),
    GEMINI_MODEL: optional(
      'EXPO_PUBLIC_GEMINI_MODEL',
      'gemini-2.5-flash',
      process.env.EXPO_PUBLIC_GEMINI_MODEL,
    ),

    REVENUECAT_API_KEY_IOS: optional('REVENUECAT_API_KEY_IOS'),
    REVENUECAT_API_KEY_ANDROID: optional('REVENUECAT_API_KEY_ANDROID'),
    STRIPE_PUBLISHABLE_KEY: optional('STRIPE_PUBLISHABLE_KEY'),

    COACHING_CUE_MAX_WORDS: asInt('COACHING_CUE_MAX_WORDS', 25),
    QUALITY_GATE_ENABLED: asBool('QUALITY_GATE_ENABLED', true),
    QUALITY_GATE_RETRY_LIMIT: asInt('QUALITY_GATE_RETRY_LIMIT', 2),
    MAX_RECORDING_SECONDS: asInt('MAX_RECORDING_SECONDS', 90),
    MIN_RECORDING_SECONDS: asInt('MIN_RECORDING_SECONDS', 20),

    FEATURE_TREND_ANALYSIS: asBool('FEATURE_TREND_ANALYSIS', false),
    FEATURE_GAME_PROFILE: asBool('FEATURE_GAME_PROFILE', false),
    FEATURE_SOCIAL: asBool('FEATURE_SOCIAL', false),
    FEATURE_VIDEO_INTEGRATION: asBool('FEATURE_VIDEO_INTEGRATION', false),
    FEATURE_GOLF_SPORT: asBool('FEATURE_GOLF_SPORT', false),

    DEMO_MODE: asBool(
      'EXPO_PUBLIC_DEMO_MODE',
      false,
      process.env.EXPO_PUBLIC_DEMO_MODE,
    ),

    LOCAL_PIPELINE: asBool(
      'EXPO_PUBLIC_LOCAL_PIPELINE',
      false,
      process.env.EXPO_PUBLIC_LOCAL_PIPELINE,
    ),
    LOCAL_TRANSCRIPTION_PROVIDER: asEnum<TranscriptionProviderKey>(
      'EXPO_PUBLIC_TRANSCRIPTION_PROVIDER',
      ['whisper', 'assemblyai', 'deepgram', 'gemini'],
      'whisper',
      process.env.EXPO_PUBLIC_TRANSCRIPTION_PROVIDER,
    ),
    LOCAL_AI_PROVIDER: asEnum<AIProviderKey>(
      'EXPO_PUBLIC_AI_PROVIDER',
      ['claude', 'openai', 'gemini'],
      'claude',
      process.env.EXPO_PUBLIC_AI_PROVIDER,
    ),
    LOCAL_OPENAI_API_KEY: optional(
      'EXPO_PUBLIC_OPENAI_API_KEY',
      '',
      process.env.EXPO_PUBLIC_OPENAI_API_KEY,
    ),
    LOCAL_ANTHROPIC_API_KEY: optional(
      'EXPO_PUBLIC_ANTHROPIC_API_KEY',
      '',
      process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY,
    ),
    LOCAL_GEMINI_API_KEY: optional(
      'EXPO_PUBLIC_GEMINI_API_KEY',
      '',
      process.env.EXPO_PUBLIC_GEMINI_API_KEY,
    ),

    AUTH_BYPASS_EMAIL: optional(
      'EXPO_PUBLIC_AUTH_BYPASS_EMAIL',
      '',
      process.env.EXPO_PUBLIC_AUTH_BYPASS_EMAIL,
    ),
    AUTH_BYPASS_PASSWORD: optional(
      'EXPO_PUBLIC_AUTH_BYPASS_PASSWORD',
      '',
      process.env.EXPO_PUBLIC_AUTH_BYPASS_PASSWORD,
    ),
  };

  // Provider-credential checks are WARNINGS, not fatal errors.
  //
  // OPENAI_API_KEY / ANTHROPIC_API_KEY are server-side secrets. Expo only
  // exposes EXPO_PUBLIC_* vars to the running app, so these are intentionally
  // absent on the client — the app must still boot. The providers throw a clear
  // error only if they are actually invoked without a key (see WhisperProvider
  // / ClaudeProvider `isAvailable`). In production these calls belong in a
  // Supabase edge function where the secrets live. See docs/PROVIDERS.md.
  if (env.TRANSCRIPTION_PROVIDER === 'whisper' && env.OPENAI_API_KEY === '') {
    warn('TRANSCRIPTION_PROVIDER=whisper has no OPENAI_API_KEY — transcription will fail until a key is provided server-side.');
  }
  if (env.AI_PROVIDER === 'claude' && env.ANTHROPIC_API_KEY === '') {
    warn('AI_PROVIDER=claude has no ANTHROPIC_API_KEY — AI calls will fail until a key is provided server-side.');
  }
  // This one IS fatal: it's a pure misconfiguration of always-present numeric vars.
  if (env.MIN_RECORDING_SECONDS >= env.MAX_RECORDING_SECONDS) {
    throw new EnvError(
      'MIN_RECORDING_SECONDS must be less than MAX_RECORDING_SECONDS.',
    );
  }

  return env;
}

export const env: Env = buildEnv();

/** True only in local development — gates console cost logging, etc. */
export const isDev = env.APP_ENV === 'development';
