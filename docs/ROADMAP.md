# Roadmap

_Updated 2026-11-10. The detailed milestone plan from 2026-11-04 is in git
history, on branch `claude/backlog-planning-milestones-2e0i9p`._

## Focus: "I trust the cues it gives me"

Until this is met, the project works on one question. Everything else is parked:
it carries the `parked` label on GitHub, and each parked issue says what would
bring it back.

- **What trust means:** at most 1 in 5 wrong over your last 20 judged Cues
  (`TRUST_TARGET` in `scripts/admin/review.ts`; change it there). The baseline
  is the #36 hand read: 36 cues, **47% wrong**, written before the Pro coaching
  model.
- **How it's measured:** your own verdicts in the local cue review tool. The
  **Cue trust** page shows the status, the comparison with the baseline, why the
  wrong ones are wrong, and which model wrote them (`docs/ADMIN.md`).
- **The loop, weekly:**
  1. Record sessions in the app.
  2. Judge the new Cues in the review tool: sound, shallow or wrong, and why.
  3. Open **Cue trust**. Read the status and the top reason.
  4. Fix only what the top reason points at, one fix at a time, then measure
     again.

## Next steps

| # | step | who | state |
| --- | --- | --- | --- |
| 1 | Deploy what's merged: `npx supabase db push` (migrations 024–026), **then** `npx supabase functions deploy process-session` | You | open |
| 2 | Ship the app update: compare fingerprints with build 30; if only `.gitignore` differs, OTA to `testflight` | You | open |
| 3 | #138: one real Re-analyze, including a declined one; an agent reads the rows | You + agent | after step 1 |
| 4 | Judge every Cue written since the Pro model went live (8 Oct). This is also #137's read | You | after step 1 |
| 5 | Read **Cue trust**; choose the fix from the top reason | You + agent | after step 4 |
| 6 | #153 (draft PR #154): merge only after #137 reads out, and only if off-target records show up as a real share of wrong Cues | — | waiting |

## Parked (GitHub label `parked`)

| what | issues | unpark when |
| --- | --- | --- |
| Competition Stats | #90, #91, #92, #94, #95, #96 | the trust target is met |
| Cue diagrams and 3D poses | #10, #135, #136, #15, #24, #25 | the trust target is met |
| Weakness into coaching (#1 half B) | #1 | the trust target is met |
| Corpus growth and cleanup | #97, #100, #133 | verdicts show `records_wrong` among the top reasons |
| Certification go-live | #77, #132 (story 12) | verdicts show `records_wrong` or `records_misapplied` among the top reasons |
| Semantic retrieval | #116 | verdicts show `off_target` or `records_misapplied` among the top reasons |
| Automated judge | #62 | about 50 or more Cues carry verdicts |

Still active: #137, #138, #153, #30 (the cue-quality map) and #139 (the findings
log, for reference).

## Rules that still hold

- **Measure before changing** (#139). On the coaching path, change one thing at
  a time, and bump `pipeline_version` (`src/constants/pipelineVersion.ts`) when
  what a row means changes.
- **Migrations go in merge order;** never reserve numbers ahead. 027 is drafted
  in #154.
- **Apply migrations before `functions deploy`.** The function writes the new
  columns on every Session.
- **In PR text, write "Part of #N",** never "does not close #N": GitHub reads
  that as closing #N.
- **Never merge `feat/cue-image-generation`.** It carries the retired
  generative-image code.

## Done, 4–10 Nov 2026

#125 (PR #140) · fingerprint (#129) · #131 (#143) · #145 (#147) · #130 (#142) ·
#93 (#141) · #1 half A (#146) · #135 phases a and b (#144, #149) · #132 (#152) ·
single pipeline version (#151).
