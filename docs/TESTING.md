# Testing Standards

## Philosophy

Test behavior, not implementation. Mock providers at the boundary. Never mock
services.

## What Must Be Tested Before Any PR

- [ ] Every `src/services/` file: unit tests with mocked providers
- [ ] `FlowlogPipeline.ts`: integration test for happy path, quality gate
      rejection, max retry exceeded
- [ ] `QualityGateService.ts`: unit test for every phrase in every sport's blocklist
- [ ] `env.ts`: missing required vars throw descriptive errors at startup
- [ ] Every provider: happy path + network error + malformed API response + timeout
- [ ] Sport context: every registered sport context passes interface validation

## Mock Strategy

All provider mocks in `tests/mocks/`. Every mock implements the full interface.
Shared across test files — never inline a provider mock inside a test file. Import
them via `tests/mocks` (the barrel) e.g.
`import { MockAIProvider } from '../mocks'`.

## Running Tests

```bash
npm test                    # all tests
npm test -- --watch         # watch mode
npm test -- --coverage      # coverage report
```

Jest config: `jest.config.js` (preset `jest-expo`, `@/` mapped to `src/`, test
files matched under `tests/**/*.test.ts`). Shared env defaults and the
AsyncStorage mock live in `jest.setup.js`.

## Coverage Targets

| Layer          | Target |
| -------------- | ------ |
| Pipeline       | 90%    |
| Services       | 85%    |
| Sport Contexts | 80%    |
| Providers      | 70%    |
| Screens        | 50%    |

## Regression Prevention

- `npm test` must pass with zero failures before any commit
- No new `any` types without an explanatory comment
- No direct API calls outside `src/providers/`
- No sport-specific logic outside `src/sports/`
- No `process.env` access outside `src/config/env.ts` (ESLint-enforced)
- Pipeline cost per session asserted in the integration test — fails if the
  estimate exceeds `$0.03`
