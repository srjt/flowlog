# 0010. Pipeline runs in a Supabase edge function (secrets server-side)

**Status:** accepted · **Date:** 2026-06-15

The live pipeline executes in the `process-session` Supabase edge function
(Deno). The client uploads audio to Storage and invokes the function;
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` live in function secrets. The client entry
point is `src/pipeline/PipelineClient.ts`. We did this because Expo only exposes
`EXPO_PUBLIC_*` vars to the app and API keys must never ship in a client bundle;
running transcription + AI server-side keeps secrets secure and lets the server
hold the service role for privileged writes. The function derives `userId` from
the caller's JWT rather than trusting client input.

## Consequences

- The pipeline logic now exists in two places — the unit-tested reference in
  `src/` and the Deno edge function — and they must be kept in sync. Sport
  content is single-sourced (`_shared/sports.ts` imports the pure files from
  `src/sports/`) so drift is limited to the orchestration + AI-call code.
- **How to apply:** change pipeline behaviour in BOTH `src/` (with tests) and
  `supabase/functions/`; deploy with `supabase functions deploy process-session`
  after `supabase secrets set ...`.

## Considered options

- **Calling OpenAI/Anthropic directly from the client** — rejected: leaks keys,
  and the keys aren't even available on the Expo client.
- **A separate Node backend** — rejected: Supabase edge functions are already
  part of the stack (ADR 0003).
