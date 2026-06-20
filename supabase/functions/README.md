# Supabase Edge Functions

## `process-session`

The Flowlog pipeline's production runtime. The client uploads audio to Storage
and calls this function; it transcribes (Whisper), extracts + coaches (Claude),
runs the quality gate, persists the session, and returns the structured result.
**All API secrets live here, never in the client bundle.**

### Layout

```
supabase/functions/
├── _shared/
│   ├── cors.ts          # CORS + JSON response helpers
│   ├── types.ts         # wire shapes (mirror src/types/pipeline.ts)
│   ├── sports.ts        # server sport registry — imports the SAME pure
│   │                    #   vocab/prompt files the client uses (src/sports/*)
│   ├── ai.ts            # Whisper + Claude calls (secrets via Deno.env)
│   └── quality-gate.ts  # word cap, blocklist, confidence, retries, fallback
└── process-session/
    └── index.ts         # Deno.serve orchestrator
```

### Prerequisites

- Supabase CLI: <https://supabase.com/docs/guides/cli>
- A Storage bucket named `session-audio` (the client uploads here):
  ```bash
  supabase storage create session-audio
  ```
  Add an RLS policy so users can write/read only their own folder
  (`{userId}/...`).

### Set the secrets (server-side only)

```bash
supabase secrets set OPENAI_API_KEY=sk-...        # Whisper transcription
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # Claude extraction + coaching
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically by the platform — do not set them manually.

### Deploy

```bash
supabase functions deploy process-session
```

### Run locally

```bash
supabase functions serve process-session --env-file ./supabase/.env.local
```

### Note on cross-directory imports

`_shared/sports.ts` imports the canonical, dependency-free sport content from
`../../../src/sports/...` so vocabulary and prompts are single-sourced (no
duplication). Recent Supabase CLI versions bundle this correctly. If your CLI
rejects imports outside `supabase/functions/`, bump the CLI, or add an
`import_map.json`, or copy those pure files into `_shared/`.
