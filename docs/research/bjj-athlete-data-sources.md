# BJJ Athlete Competition Data — Source Feasibility Research

**Question:** Can we programmatically fetch BJJ athlete competition data (rankings,
match results, points, event history, medals, weight/belt divisions) from
jiujitsu.net, IBJJF (ibjjf.com), and comparable sources, to power a user-facing
"my competition stats" section in Flowlog?

**Snapshot date:** 2026-08-26. Websites, endpoints, robots.txt, and terms change
without notice — every endpoint and quote below was captured on this date and must
be re-verified before any build.

**Method:** Primary-source inspection only. Real sites loaded in a browser; network
tab (XHR/JSON) inspected directly; API responses fetched from the page origin;
robots.txt and Terms of Use read from the source. Findings are labelled
**[verified]** (observed directly) vs **[inferred]** (reasoned, not directly confirmed).

---

## Summary verdict

**Technically feasible, legally constrained.** The single best source is
**jiujitsu.net**, which is a React SPA backed by a clean, unauthenticated public
JSON API that already returns everything the feature needs — per-athlete Elo
rating, rank + percentile, full medal/podium history, rating-over-time history,
team history, and a match-by-match record with scores and video links
**[verified]**. The catch is legal, not technical: jiujitsu.net's own terms
**prohibit commercial use of their data without an explicit license**, and Flowlog
is a commercial app. The right move is to **contact the maintainers (an open-source,
hobby project) for a license or a data copy** — they explicitly invite this.

**IBJJF (ibjjf.com) is effectively blocked** for our use: its data is server-rendered
HTML with no JSON API, and its Terms of Use expressly forbid scraping, data mining,
database-building, and any revenue-generating/commercial reuse of content **[verified]**.

**Coverage caveat that shapes the whole feature:** all of these sources only know
about athletes who have competed in **IBJJF** events. A typical Flowlog hobbyist who
trains but has never entered an IBJJF tournament will not be found. This should be an
opt-in "link my IBJJF competition record" feature, not something every user gets.

---

## Source 1 — jiujitsu.net  ·  Feasibility: **Easy (technical) / needs license (legal)**

### What it is
An independent, unofficial site that ranks IBJJF competitors with an Elo system
("Weisshart Elo") and preserves IBJJF match results. It is **not affiliated with
IBJJF**. Built by Dan Lukehart and Will Weisser; the source code is open
(`https://github.com/weisserw/ibjjf-elo`, **MIT licensed** — the *code*, not the
data) and also runs at `ibjjfrankings.com`. Stack: React/TypeScript/Vite frontend,
Python/Flask backend. **[verified — /about page + GitHub]**

### How the data is served — a public JSON API (no scraping needed)
The site is a SPA; the browser network tab shows it calling its own `/api/*`
endpoints returning `application/json`. **No auth header, cookie, or token was
required** on any call — all requests below returned `200` when fetched from the page
origin with no credentials. **[verified — network tab + direct fetch, base `https://jiujitsu.net`]**

| Endpoint (GET) | Returns |
|---|---|
| `/api/athletes?search={query}` | Typeahead athlete search → array of `{name, personal_name, slug}`. **This is the identity-matching endpoint.** |
| `/api/athlete/{slug\|uuid}` | Full athlete profile (see shape below). Accepts either the URL slug (`tainan-dalpra-costa`) or the UUID. |
| `/api/top?gender=Male&age=Adult&belt=BLACK&weight=&country=&changed=false&upcoming=false&name=&gi=true&page=1` | Ranking table rows for one division; `name=` filters within the division; `gi=true/false` toggles Gi/No-Gi. |
| `/api/matches?gi=true&page=1` | Global reverse-chronological match feed (winner/loser, ratings before→after, event, division, score, submission, video link). |
| `/api/site-statistics` | `{ "coveredMatchCount": 91942 }` |

`/api/athlete/{slug}` response shape **[verified — fetched for `tainan-dalpra-costa`]**:
```
athlete:        { belt, team_name, country, country_note, rating,
                  personal_name, name, slug, instagram_profile,
                  instagram_profile_photo_url, bjjheroes_link, id (uuid) }
eloHistory:     [ { date, Rating, belt, age, team } ]      // rating over time (35 pts here)
medals:         [ { division, event_name, event_id, place, happened_at } ]  // 64 podiums here
ranks:          [ { gender, age, belt, weight, rank, rating, avg_rating, percentile } ]
registrations:  [ { division, event_name, event_id, event_start_date, event_end_date, link } ]  // upcoming
teamHistory:    [ { date, team_name } ]
mediaCoverage:  [ { date, title, type, url, ... } ]
suspensions:    [ ]
```
A ranking row from `/api/top` includes `athlete_id` (uuid), `slug`, `name`,
`personal_name`, `rating`, `rank`, `previous_rank`, `previous_rating`,
`match_count`, `country`, `instagram_profile`, `profile_image_url` (a **time-limited
signed S3 URL** on `ibjjf-elo.s3.amazonaws.com` — do not cache the URL, it expires),
and `registrations`. A `/api/matches` row includes `winner`/`loser`, `winnerId`/`loserId`,
`winnerStartRating`→`winnerEndRating` (and loser), `event`, `belt`, `age`, `gender`,
`weight`, `weightForOpen`, `submission`, `videoLink` (YouTube w/ timestamp), and
scoreboard point/advantage/penalty fields. **[verified]**

### Coverage / data quality
From the FAQ **[verified — /about]**: ~150,000 match results covering **2022–2024**;
**full match data accumulates from December 2024 forward**. Only IBJJF athletes are
rated. IBJJF itself deletes non-podium match results shortly after events, so
jiujitsu.net's preserved match feed is genuinely differentiated data. Athletes across
all belts (we saw purple-belt open-tournament competitors), not just elite, appear —
so a hobbyist who *has* competed at an IBJJF event is plausibly present.

### robots.txt / terms stance
`https://jiujitsu.net/robots.txt` **[verified]**:
```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
```
(plus explicit `Disallow: /` blocks for a list of AI crawlers including `ClaudeBot`,
`GPTBot`, `CCBot`, `Google-Extended`, `Bytespider`, `meta-externalagent`, etc.)
Generic access is allowed; the `Content-Signal` marks content as usable only for
`reference`, not AI training. There is no `Disallow: /api`.

The binding constraint is the **/about page terms [verified — direct quote]**:
> "If you would like a copy of our source data for research purposes, contact us and
> we'll be happy to help. You have permission to use data or screenshots from this
> site in articles, blog posts, and other media, but we ask that you credit
> JiuJitsu.net. **All other uses of our data, including commercial use, is prohibited
> without an explicit license.**"

So: the API is trivially reachable, but using it to power a commercial app's stats
feature requires their permission. They are a free, open-source, community-minded
project that explicitly offers to share source data and answer methodology questions —
**a licensing/partnership conversation is realistic and is the correct path.**

Feasibility: **Easy** to integrate technically; **Blocked until licensed** for
commercial use. Rating overall: **the recommended source, pending permission.**

---

## Source 2 — IBJJF (ibjjf.com)  ·  Feasibility: **Blocked**

### What data exists & how it's served
IBJJF is the official federation and the ultimate source of truth for points-based
rankings and podium results. Pages inspected **[verified]**:
- **Athlete page** `https://ibjjf.com/athletes/{slug}` (e.g. `/athletes/j-grout`) —
  shows name, academy, belt, ranking points (e.g. "60.0 pts"), rank (e.g. "#242"),
  Gi/No-Gi, age division.
- **Rankings** `https://ibjjf.com/2026-athletes-ranking` (also academies ranking) —
  ranked lists of name + points per Gi/No-Gi × age × gender × belt division.

**All of it is server-rendered HTML** (a Rails/"packs" app). The network tab showed
**only** the HTML document plus static CSS/JS/font/image assets — **no XHR, no JSON,
no GraphQL, no discoverable backend API** **[verified — network tab on both an
athlete page and the rankings page]**. Extracting data would require **HTML scraping**.

### robots.txt / Terms of Use
`https://ibjjf.com/robots.txt` is permissive **[verified]**:
```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /wp-content/*
Sitemap: https://ibjjf.com/sitemap.xml
```
**But the Terms of Use (updated 2025-10-06) directly forbid what we'd need
[verified — direct quotes]:**
> "Systematically retrieve data or other content from the Services to create or
> compile, directly or indirectly, a collection, compilation, database, or directory
> without written permission from us."

> "Engage in any … data mining, robots, or similar data gathering and extraction tools."

> "Use the Services … for any revenue-generating endeavor or commercial enterprise."

> "No part of the Services and no Content … may be copied, reproduced, aggregated,
> republished … or otherwise exploited for any commercial purpose whatsoever, without
> our express prior written permission."

The permissive robots.txt does **not** override the Terms; the Terms explicitly
prohibit scraping, database-building, and commercial reuse. Feasibility: **Blocked**
for our use without a written agreement/license from IBJJF. (An official data
partnership is theoretically possible but there is no public/self-serve API to build on.)

---

## Source 3 — Other candidate sources (brief assessment)

| Source | What it has | How obtainable | Verdict |
|---|---|---|---|
| **BJJ Heroes** (`bjjheroes.com`) | Curated athlete biographies + win/loss records for notable competitors. jiujitsu.net links each athlete to their BJJ Heroes page (`bjjheroes_link`). **[verified that the link field exists]** | Site is WordPress; would be HTML scraping. Skews to famous athletes, not hobbyists. Own ToS/copyright applies (not checked in depth). | **Hard / niche** — biographies, not structured stats; poor hobbyist coverage. |
| **Smoothcomp** (`smoothcomp.com`) | The dominant BJJ tournament registration/bracket/results platform; most US events run on it, so it holds registrations, brackets, and live results (incl. many non-IBJJF and local events → **best potential hobbyist coverage**). | No public developer API documentation was found **[verified — search turned up none]**. It exposes public event result pages (scrapeable) and has internal app endpoints, but no confirmed open API. Would need to contact them. | **Unknown / promising** — worth a direct API/partnership inquiry; best coverage of amateurs if reachable. |
| **FloGrappling / FloArena** (`flograppling.com`) | Results/brackets for FloArena-run events; heavily paywalled editorial. | No public API; content is subscription-gated. | **Blocked/Hard.** |
| **ADCC** | ADCC event results. | No structured public API; sporadic HTML. Elite-only, tiny coverage. | **Hard / niche.** |
| **Digitsu BJJ Elo, BJJ Metrics, jits.gg, bjjlf.pro** | Third-party analytics/rankings sites that (like jiujitsu.net) **derive from IBJJF data**. `digitsu.com/bjj-elo-rankings`, `bjjmetrics.com`, `jits.gg` (youth), `bjjlf.pro/en/rankings`. **[verified they exist via search]** | Not inspected for APIs. Each carries the same upstream-IBJJF licensing question plus its own ToS. | **Unknown** — no advantage over jiujitsu.net, whose API we've already mapped and whose maintainers are approachable. |

---

## Athlete-matching feasibility (mapping a Flowlog user → their record)

**On jiujitsu.net this is clean [verified]:**
1. User types their name → call `GET /api/athletes?search={name}` → get candidate
   list of `{name, personal_name, slug}`.
2. User confirms which candidate is them (disambiguation UI).
3. Persist the **`slug`** (and the stable **`athlete_id` UUID**) on the Flowlog profile.
4. Thereafter fetch `GET /api/athlete/{slug}` for the full stats payload.

**Ambiguity risks:** BJJ competitor names are heavily Brazilian and highly collisional
(the search for "silva" returns many). Disambiguation must be user-driven — show
belt, team, country, photo, and rank next to each candidate so the user picks
correctly. Store the UUID, not just the name, so the mapping survives name-formatting
changes. There is **no email/DOB/government-ID linkage** — matching is name +
human confirmation only, so we cannot *prove* the linked record is really the user's;
treat it as self-asserted.

**Hobbyist coverage risk (the big one):** if the user has never competed in an IBJJF
event, `/api/athletes?search=` returns nothing for them. The feature must degrade
gracefully to "no competition record found — add your IBJJF results when you compete."

---

## Recommendation

**Preferred approach, in priority order:**
1. **License jiujitsu.net data (official API > scraping).** Contact the maintainers
   (they invite it on their /about page and offer a source-data copy for research).
   Ask for (a) permission for commercial use and (b) either continued use of the live
   `/api/*` endpoints or a periodic data export. This is the highest-quality, lowest-
   effort structured source and its terms make an unlicensed commercial build
   off-limits, so the conversation is required, not optional.
2. **In parallel, inquire with Smoothcomp** about API/data access — it's the only
   source with realistic *amateur/hobbyist* coverage, which matches Flowlog's user base
   far better than elite-only rankings.
3. **Do not scrape IBJJF directly** — the Terms of Use forbid it and there's no API.
   IBJJF remains the upstream source of truth, but reach it via a licensed intermediary
   (jiujitsu.net) or an official IBJJF agreement, not by scraping.
4. **Manual-entry fallback** for everyone else: let users self-log competition results
   (event, division, placement, W/L). This works for 100% of users regardless of data
   licensing and de-risks the whole feature.

**Where the fetch must live:** All third-party fetching should run **server-side in a
Supabase edge function**, not from the RN/web client, because:
- API secrets / any partner credential must stay off the client (project rule #1).
- jiujitsu.net's `/api` CORS posture for cross-origin browser calls is **unverified**
  (we only confirmed *same-origin* fetches) — a server-side call sidesteps CORS entirely.
- Terms-of-use attribution/caching and rate-limiting are easier to enforce centrally.
- We can cache/normalize the payload and re-sign the expiring S3 photo URLs server-side.

**Realistic MVP of the stats section (given what jiujitsu.net actually returns):**
- Current Gi & No-Gi Elo rating + rank + **percentile** ("top X% of your division").
- **Rating-over-time chart** (from `eloHistory`).
- **Medal/podium history** (from `medals`: event, division, placement, date).
- **Match record** for recent events (W/L, opponent, score, submission, video link).
- Team/affiliation and upcoming registrations.
All of that maps 1:1 onto fields we verified — no derived computation required on our side.

---

## Open questions / could not verify

- **Commercial license terms** from jiujitsu.net (cost, attribution requirements,
  rate limits, whether they'd prefer a data export vs. live API). Requires contacting them.
- **CORS**: whether `/api/*` is callable cross-origin from a browser/RN client
  (only same-origin fetch was confirmed). Moot if we go server-side, which we should.
- **Rate limits / stability** of the `/api/*` endpoints (undocumented; it's a free
  hobby service — a partnership should cover acceptable request volume).
- **Smoothcomp API**: existence/terms of a developer API were not confirmed — needs a
  direct inquiry. Same for ADCC and the other derivative analytics sites.
- **IBJJF official data partnership**: whether IBJJF offers any licensed data feed was
  not established (no public evidence of one).
- **Exact hobbyist coverage**: we confirmed sub-elite (purple-belt open) athletes
  appear, but not how deep coverage goes for small local IBJJF opens or very recent
  white/blue-belt first-timers.
- I intentionally did **not** attempt to bypass any access control, and respected that
  jiujitsu.net's robots.txt blocks AI crawlers — the inspection above used a normal
  browser session on public pages, and the commercial-use decision is deferred to the
  licensing conversation above.
