# The mission is seams, measurement and tracing — not operating the pipeline

Asked what they want to be able to DO, Surjit picked **improve cue quality**,
**debug it when it breaks**, and **explain it to others** — and explicitly did
not pick *operate it solo*. They already own the codebase and the three
`flowlog-*` skills cover how to run each step.

**Implications.** Do not spend lessons on command invocations, flags, or dry-run
output — that is documented and it is not what is wanted. Teach instead: where
the seams are, why each constant has the value it does, what each measurement
can and cannot conclude, and how to trace a bad cue backwards. Every lesson
should end with a knob they could turn or a trace they could follow.

**Evidence.** Direct answer to a multi-select question at the start of session 1.
Prior knowledge is assumed high on TypeScript, Supabase and this repo's layout;
assumed low on the specific reasoning frozen into `src/sports/grounding.ts` and
`docs/LOCAL_MINING.md`, which is where lesson 1 aimed.

See [[MISSION.md]].
