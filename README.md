# Flowlog

**Talk. Reflect. Improve.**

Flowlog is a voice reflection tool for serious hobbyists. Record a 60–90 second
post-session voice dump; a two-stage AI pipeline transcribes it with
sport-specific vocabulary priming, extracts structured insight, and returns one
mechanical coaching cue (max 25 words). Sessions accumulate into a trend log.

Flowlog launches in **Brazilian Jiu-Jitsu** and is architected so adding golf,
tennis, rock climbing, or chess is a content task, not a code change.

> **AI agents:** start with [`CLAUDE.md`](./CLAUDE.md) — it is the primary entry
> point and describes the full project state, the non-negotiable rules, and
> where to read next.

## Stack

- **Framework:** React Native via Expo (SDK 51+), TypeScript strict mode
- **Navigation:** Expo Router (file-based)
- **Backend/DB:** Supabase (auth, Postgres, storage, edge functions)
- **Payments:** Stripe + RevenueCat
- **State:** Zustand
- **Styling:** NativeWind (Tailwind for React Native)
- **Testing:** Jest + React Native Testing Library
- **Linting:** ESLint + Prettier

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
#    then fill in Supabase + provider keys in .env.local

# 3. Run
npm start            # Expo dev server
npm run ios          # iOS simulator
npm run android      # Android emulator
```

The app validates required environment variables at startup and fails fast with
a descriptive error if anything is missing (see `src/config/env.ts`).

## Project layout

```
app/        Expo Router screens (auth + tabs)
src/
  components/ui/   UI primitives (Button, Card, Text)
  config/          Typed env + feature flags (single source of truth)
  constants/       Pipeline tuning constants
  hooks/           UI ↔ pipeline glue
  pipeline/        FlowlogPipeline — the single orchestrator
  providers/       External service abstractions (transcription, ai, storage, payments)
  services/        Business logic (transcription, extraction, coaching, quality gate)
  sports/          Sport context configs — the expansion layer
  store/           Zustand client state
  types/           Shared types
  utils/           Logger, cost logging
supabase/   Migrations + edge functions
docs/       Architecture & agent documentation
tests/      unit / integration / mocks
```

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm start`         | Start the Expo dev server                     |
| `npm run ios`       | Run on the iOS simulator                      |
| `npm run android`   | Run on the Android emulator                   |
| `npm test`          | Run the Jest test suite                       |
| `npm run lint`      | ESLint (incl. the `process.env` guard rule)   |
| `npm run typecheck` | `tsc --noEmit` in strict mode                 |
| `npm run format`    | Prettier write                                |

## Documentation

| Doc                                          | Purpose                          |
| -------------------------------------------- | -------------------------------- |
| [CLAUDE.md](./CLAUDE.md)                      | Agent entry point & project state |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Layers, rules, expansion model  |
| [docs/PIPELINE.md](./docs/PIPELINE.md)       | The two-stage AI pipeline         |
| [docs/PROVIDERS.md](./docs/PROVIDERS.md)     | Provider system & swapping        |
| [docs/SPORTS.md](./docs/SPORTS.md)           | How to add a new sport            |
| [docs/DATABASE.md](./docs/DATABASE.md)       | Schema & migration rules          |
| [docs/TESTING.md](./docs/TESTING.md)         | Testing standards                 |
| [docs/DECISIONS.md](./docs/DECISIONS.md)     | Architecture decision log         |

## License

Proprietary — all rights reserved (placeholder; update before any release).
