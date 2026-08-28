---
name: flowlog-publish
description: Publish mined coaching records to the Supabase serving store, stripping every link back to the source instructional and verifying it independently. Use when the user says "publish the records", asks to push mined records live, or after mining a title. Wraps scripts/mining/publish.sh.
---

# Publishing records to the serving store

Moves distilled coaching mechanics from the local review store into
`coaching_records`, where grounding can use them.

**The thing this protects:** records are derived from third-party copyrighted
instructionals. The review store keeps the verbatim quote, chapter and source;
the serving store must keep none of it. This repository is public and the
serving store is reachable by the app.

## Two stores, and why

| store | where | holds |
| --- | --- | --- |
| review | `~/flowlog-records` (outside the repo) | verbatim quote, source, chapter, timestamps |
| serving | Supabase `coaching_records` | distilled mechanics only |

`publish.sh` drops `quote`, `source` and `chapter`, scrubs person names, and
**refuses to run** if any source marker survives.

Never move the review store into the repo. Never paste transcript text into a
commit message, PR body, or issue.

## 1. Dry run

```bash
scripts/mining/publish.sh --dry-run
```

Read the summary before going further:

```
review store   1637 records across 81 volumes
serving store  1637 records  (315 new ids, 1322 reused — certification preserved)
leak check     clean — no source markers survive
```

- **`reused`** is the important half. Ids are stable across re-mines via
  `~/flowlog-records/id-mapping.json`, which is what keeps human certification
  alive. Never delete that file.
- **It publishes the WHOLE review store**, not just the title you mined. If
  probe volumes from other series are sitting there, they go too. Say so rather
  than letting the number surprise the user.

## 2. Verify the payload yourself

**A passing leak guard is not the same as having looked.** The guard's marker
list was written against the titles mined so far; a new instructor or series
name is exactly what it has never seen.

```bash
scripts/mining/publish.sh --sql /tmp/out.sql

for t in "danaher" "gordon" "ryan" "garry" "tonon" "mateus" \
         "go further faster" "gff" "instructional" "this video" "this series" \
         "<new series name>" "<new instructor>"; do
  n=$(grep -icE "$t" /tmp/out.sql); [ "$n" -gt 0 ] && echo "LEAK  $t: $n"
done

grep -cE "[0-9]:[0-9]{2}:[0-9]{2}" /tmp/out.sql   # expect 0 — a timestamp is a citation
grep -cE '"quote"|"source"|"chapter"' /tmp/out.sql # expect 0 — dropped fields
```

**Add the new title's own terms to that list.** Mining a series called
"Strangles & Turtle Breakdowns" means checking for "strangles & turtle" and
"turtle breakdowns", not only the terms that mattered last time.

If anything hits, extend `SCRUBBED_NAMES` / `SOURCE_MARKERS` in
`scripts/mining/publish.ts` and re-run. Do not publish and fix later — the app
serves this table.

## 3. Publish

```bash
scripts/mining/publish.sh
```

## 4. Verify live, with exact counts

PostgREST caps a plain select at 1000 rows, so a naive count silently
understates the store. Use `count=exact`:

```bash
node -e "
const{readFileSync}=require('fs');
const e=Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const u=e.SUPABASE_URL??e.EXPO_PUBLIC_SUPABASE_URL,k=e.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:k,Authorization:'Bearer '+k,Prefer:'count=exact',Range:'0-0'};
const c=async q=>{const r=await fetch(u+'/rest/v1/coaching_records?'+q,{headers:H});return +(r.headers.get('content-range')||'/0').split('/')[1];};
(async()=>{ console.log('total', await c('select=id'));
  for(const g of ['gi','no-gi','either']) console.log(' gi='+g, await c('select=id&gi=eq.'+g)); })();
"
```

## 5. Report coverage, not counts

The question is never "how many records" — it is whether positions the athletes
**actually train** improved. Compare before and after per position, and say
plainly when a batch only deepened positions that were already the strongest.

Watch the **gi split**. A gi-heavy batch helps gi sessions and, because #60
filters gi-specific records out of no-gi sessions, does much less for a no-gi
practitioner at the same position. That is correct behaviour, but it means a
coverage number is not universal — say which sessions it helps.

## Related

- `flowlog-mine` — produces the records this publishes
- `docs/REVIEW_BENCH.md` — how published records get certified
