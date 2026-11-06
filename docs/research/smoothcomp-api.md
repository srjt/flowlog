# Smoothcomp: API and Data-Access Findings

**Question (#93, part of #90):** Does Smoothcomp, the major BJJ tournament
registration and results platform, offer a usable API or structured data feed for
athlete registrations and results? It matters because Smoothcomp is the only source
with realistic **amateur** coverage, and most Flowlog users are hobbyists who do not
appear in IBJJF-only datasets (see [`bjj-athlete-data-sources.md`](bjj-athlete-data-sources.md)).

**Snapshot date:** 2026-11-04. Platforms, terms and robots.txt change without
notice. Re-verify everything below before any build or any message to Smoothcomp.

**Method and its limits (read this first):** This session's network policy
**denied every request to `smoothcomp.com`, `www.smoothcomp.com`,
`support.smoothcomp.com` and `api.smoothcomp.com`**. Both the fetch tool and a
direct HTTPS request got a proxy `403` / DNS refusal, as did control hosts such as
`en.wikipedia.org` **[verified, 2026-11-04]**. So **no Smoothcomp page, robots.txt,
terms page or endpoint was loaded directly**, and no request was made to probe
Smoothcomp for structured data. The evidence comes from:

- **Search-engine index entries** for Smoothcomp's own pages (help center, privacy
  notice, about page) and its parent company's pages. The URL is real and the claim
  appears in the index's summary of that page, but the page itself was not loaded.
  Wording may be paraphrased. Labelled **[unverified: indexed]**.
- **Third-party code and docs on GitHub** (scrapers, hobby projects) that record
  their own observations of Smoothcomp, read through GitHub code search. Labelled
  **[unverified: secondary]**, with the third party's own observation date where it
  gives one. What *is* verified is that the repo says it, not that it is true.
- **[verified]** marks only what this session observed directly.
- **[inferred]** marks reasoning, not observation.

No account was created, nothing was logged into, no access control was bypassed,
and nobody was contacted.

---

## Summary verdict

**No public API. At best partner-only, and no partner programme is documented.**

Smoothcomp publishes **no developer documentation, API reference, developer portal,
or integration-request form** that any search surfaced **[unverified: indexed
absence]**. The "API keys" its help center mentions are the **payment-gateway keys
organisers paste in** (Stripe, Paystack, PayPal and others), not a data API for
third parties **[unverified: indexed]**. The web app has an internal `/api/v1/` REST
namespace that returns `401 {"error":"Unauthenticated."}` without a logged-in
session, and its public event pages sit behind a Cloudflare managed challenge
**[unverified: secondary, third-party probes on 2026-08-11]**. That is a first-party
app backend, not an open feed.

Under the platform are **organiser exports** (CSV and Excel registrations, match
lists, toplists; some need the paid Federation Platform (Premium) tier) and **iframe
embeds** for federation sites **[unverified: indexed]**. These are human-operated
exports owned by each organiser, not a programmatic feed for Flowlog.

**Legal standing is unknown, not cleared.** The platform Terms of Service live at
`https://smoothcomp.com/en/agreements`. Neither this session nor the third-party
researchers whose notes we found could read their full text. So **no clause on
scraping, automated access or commercial reuse can be quoted**. The privacy notice
makes **organisers and federations separate data controllers** for the results they
administer **[unverified: indexed]**. Any licensed access therefore probably involves
Smoothcomp *and* an organiser layer, under GDPR (Smoothcomp AB is a Swedish company).

**Coverage is as good as expected.** Smoothcomp self-reports about 150 events on an
average weekend (200+ at peak), about 27,000 athletes per average weekend, about 2M
athlete profiles and about 7,000 events a year. Its organisers include NAGA,
Grappling Industries, ADCC, AJP, UFC BJJ and many regional federations **[unverified:
indexed, company-issued figures]**. This is the amateur circuit where Flowlog's users
actually compete.

**Bottom line for #94:** Smoothcomp is the right amateur source **in principle**. In
practice it is **not usable without a written agreement**, and nothing should be
built against its internal endpoints. Ask for a partnership, design manual entry so
it can later take Smoothcomp data, and do not block the MVP on Smoothcomp.

---

## Findings by question

### 1. Is there a public or partner API?

| Finding | Status |
|---|---|
| No public developer documentation, API reference or developer portal was found. Searches of `smoothcomp.com` and `support.smoothcomp.com` for "API", "developer", "integration" and "webhook" return only payment-gateway and organiser-settings articles. | **[unverified: indexed absence]**, searches run 2026-11-04 |
| Help-center "API keys" are organiser-entered **payment-gateway** keys: [Receive payments online](https://support.smoothcomp.com/article/94-receive-payments-online), [How to create a Stripe account](https://support.smoothcomp.com/article/96-how-to-create-a-stripe-account), [How to create a Paystack account](https://support.smoothcomp.com/article/401-how-to-create-a-paystack-account). The top staff role "can access everything including API keys, payment options and refunds" ([Assign access and roles](https://support.smoothcomp.com/article/207-assign-access-and-roles-for-your-admin-and-staff)). | **[unverified: indexed]**. That these are only payment keys is **[inferred]** from context. |
| An internal REST namespace exists on tenant subdomains. `GET https://adcc.smoothcomp.com/api/v1/event/{id}` returns **401** `{"error":"Unauthenticated."}`. `/brackets` and `/entries` sub-resources also return 401. Guest cookies plus an XSRF header did not unlock it. Source: [JFrankfurt/adcc-rankings `design/data-source-spec.md`](https://github.com/JFrankfurt/adcc-rankings/blob/HEAD/design/data-source-spec.md), probes dated 2026-08-11. | **[unverified: secondary]** |
| Third-party projects report JSON behind public pages (for example `/en/event/{id}/schedule/brackets.json`, and a `var events` JSON blob on `/en/events/upcoming`). Sources: [Vicorico17/bjj-predict `docs/data-sources.md`](https://github.com/Vicorico17/bjj-predict/blob/HEAD/docs/data-sources.md) and README. The same project warns "Live site access can return HTTP 403" and says stronger guarantees need "Smoothcomp partner/API access". | **[unverified: secondary]**. These are the site's own frontend data calls, not a published API. Listed here only so nobody mistakes them for one. |
| A third-party "awesome list" claims "Smoothcomp API Docs: `https://smoothcomp.com/api`, API key required" ([gwenf/awesome-bjj-data `EXTERNAL_RESOURCES.md`](https://github.com/gwenf/awesome-bjj-data/blob/HEAD/EXTERNAL_RESOURCES.md)). | **[unverified: secondary]**, **uncorroborated**. Nothing in Smoothcomp's indexed pages or in any other third-party project supports it. Treat as unreliable until a human loads that URL. |
| A third-party forum thread on reading Smoothcomp results automatically concludes the platform would have to "agree to open their platform and database" ([BJJ Beltchecker forum](https://www.beltchecker.com/forum.php?p=read&type=1&id=16117&selectedmenu=)). | **[unverified: secondary]** |
| **Gymdesk acquired Smoothcomp** (deal closed earlier in 2026, announced 2026-10-06). The first joint product, **Smoothcomp Connect**, lets gyms "find events, register members, and pull results into the gym dashboard", and is included in every Gymdesk plan ([press release](https://gymdesk.com/press/gymdesk-smoothcomp-acquisition), [About Gymdesk](https://gymdesk.com/about-us)). | **[unverified: indexed]**, company-issued |
| That Smoothcomp therefore *has* a results integration surface, but a **first-party** one inside its own company group. | **[inferred]** |

**Answer:** no public API. A partner route may exist (the Gymdesk integration shows
the plumbing is there), but nothing documents one for outside companies.

### 2. Auth model

- **Public API auth:** not applicable, because none is documented **[unverified:
  indexed absence]**.
- **Internal web API:** session-cookie auth (`sc_session` and `XSRF-TOKEN` cookies).
  Unauthenticated calls return `{"error":"Unauthenticated."}` **[unverified:
  secondary, JFrankfurt/adcc-rankings]**. That cookie pair and error string are the
  defaults of a common PHP web framework, so the backend is likely built on one
  **[inferred]**. The same third-party project's tooling considered sending a
  logged-in user's session cookie. **Flowlog must never do that**: it would run a
  personal login session as a data feed, outside any agreement.
- **Bot protection:** event pages under `/en/event/*` (detail, schedule, results)
  return **403 with a Cloudflare managed challenge** (`cf-mitigated: challenge`) to
  plain HTTP clients. Marketing pages, `/en/agreements`, `/en/privacypolicy` and the
  past-events listing return 200 **[unverified: secondary, JFrankfurt/adcc-rankings,
  2026-08-11; corroborated by [sfw185/BJJCal
  `scraper.py`](https://github.com/sfw185/BJJCal/blob/HEAD/scraper.py): "Individual
  event pages sit behind a Cloudflare challenge and cannot be fetched"]**. Several
  hobby projects get past this with headless or "stealth" browsers or paid
  unblocking proxies (for example [fandiyacine-ai/RollPlan
  `lib/smoothcomp/scraper.ts`](https://github.com/fandiyacine-ai/RollPlan/blob/HEAD/lib/smoothcomp/scraper.ts))
  **[verified that the code does this, 2026-11-04]**. That is **circumventing an
  access control** and is off the table for Flowlog.
- **Athlete-authorised access** (an OAuth-style "connect your Smoothcomp account"):
  **none found [unverified: indexed absence]**. Worth asking for, because it fits
  Flowlog's opt-in model best (see the recommendation).

### 3. What athlete, result and registration data exists

From Smoothcomp's help center **[unverified: indexed]**:

| Data | Where it lives | Source |
|---|---|---|
| **Athlete profile:** nationality, age, belt rank, win stats from past events broken down by win type, academy and affiliation | Public profile (`smoothcomp.com/en/profile/{numericId}`) | [Athlete profile](https://support.smoothcomp.com/article/398-athlete-profile) |
| **Competition history:** upcoming registrations, divisions entered, opponents and result of each match, ranking points if the event is linked to a ranking list | Public profile | same |
| **Results:** shown only for events whose organiser has **published** results. Hidden or archived events go through the organiser. | Event pages and profile | same; [Who can access my data](https://support.smoothcomp.com/article/196-who-can-access-my-data-and-can-i-hide-it-from-them) |
| **Ranking or top lists:** built per organiser or federation, calculated from published bracket results. They can rank athletes, academies, affiliations or nations. Points pool across events on the Premium federation platform. | Federation and organiser pages | [Ranking (Premium)](https://support.smoothcomp.com/article/182-ranking), [Create a top/ranking list](https://support.smoothcomp.com/article/202-how-to-create-a-top-ranking-list-for-your-event) |
| **W/L semantics:** a walkover counts as a win for the opponent and a loss for the forfeiter. A no-show does not appear in match stats. | Match stats | [No-show or Walkover?](https://support.smoothcomp.com/article/279-no-show-or-walk-over) |
| **Organiser exports (human-operated):** registrations as CSV; event statistics (registrations plus match list) as Excel; toplist points download; federation-wide event-registration export (**Federation Platform (Premium) only**) | Organiser and federation admin UI | [CSV](https://support.smoothcomp.com/article/109-download-registrations-as-a-csv-file), [Event statistics](https://support.smoothcomp.com/article/161-how-to-find-your-statistics-section), [Toplist download](https://support.smoothcomp.com/article/293-how-to-edit-and-or-download-information-from-a-toplist), [Federation export](https://support.smoothcomp.com/article/306-export-event-registrations) |
| **Embeds:** federation sites can iframe Smoothcomp pages (events, rankings, brackets) with `embedView=1`; requires the federation platform | Federation sites | [Embedding content (iframe)](https://support.smoothcomp.com/article/235-embed-iframe) |
| **Athlete self-export:** no documented "download my data" export for athletes. The GDPR article says users can access their personal data from their account. | Account settings | [Who can access my data](https://support.smoothcomp.com/article/196-who-can-access-my-data-and-can-i-hide-it-from-them) |

**Privacy controls that any integration would have to honour [unverified: indexed]:**
- **"Hide public profile"** is **off by default**. When on, the athlete's stats leave
  ranking lists and others cannot view their statistics.
- **Account deletion** keeps historical results but shows them as "Unknown user".
  They still count toward academy, affiliation and nation totals ([Please remove,
  delete or hide my account](https://support.smoothcomp.com/article/193-please-remove-delete-hide-my-account-gdpr)).

Compared with jiujitsu.net, Smoothcomp holds **per-event facts** (divisions,
placements, opponents, win type) but **no cross-event rating** such as Elo. Rankings
are per organiser or federation **[inferred from the above]**. A Flowlog stats
section built on Smoothcomp would show medals and match history, not a "top X%"
percentile.

### 4. Terms of Service and robots.txt

See [ToS and legal stance](#tos-and-legal-stance) below. In short: **the platform ToS
text could not be read, so no clause can be quoted.** robots.txt could not be
fetched either. One third party records it as disallowing only checkout and order
paths for all agents, plus a full block on one SEO crawler. Another says it blocks
bots. The record conflicts and needs a direct read.

### 5. Rate limits

- **Documented:** none. There is no API, so there are no published limits
  **[unverified: indexed absence]**.
- **Observed by third parties:** paginated event-history endpoints "start returning
  429s mid-pagination when hit back-to-back". The project spaces requests about 3
  seconds apart ([fandiyacine-ai/RollPlan
  `jobs/build-opponent-intel.ts`](https://github.com/fandiyacine-ai/RollPlan/blob/HEAD/jobs/build-opponent-intel.ts))
  **[unverified: secondary]**. Combined with the Cloudflare challenge, Smoothcomp
  clearly works to limit automated reads **[inferred]**.

### 6. How to request partner access

- **No partner programme, developer sign-up or integration form was found**
  **[unverified: indexed absence]**.
- **Contact path:** the support and contact page, `https://smoothcomp.com/en/support`
  (indexed as "Support & Contact - Smoothcomp") **[unverified: indexed]**. User
  questions about registrations and results go to each event's organiser, so a
  partnership request should go to Smoothcomp corporate, not an organiser
  **[unverified: indexed; [How to contact the
  organizer](https://support.smoothcomp.com/article/353-how-to-contact-the-organizer)]**.
- **Since the acquisition**, decisions on data partnerships probably sit with the
  combined Gymdesk/Smoothcomp company. Smoothcomp keeps its own brand and founders
  (CEO Martin Janson) **[unverified: indexed, Gymdesk press release]**. Gymdesk's
  corporate or partnerships channel is a reasonable second route **[inferred]**.
- **Strategic note [inferred]:** Smoothcomp Connect already pulls results into a
  first-party gym product, and Gymdesk ships a coach companion app. Results data now
  has strategic value inside that company group. Expect the answer to depend on
  whether Flowlog looks complementary (a hobbyist reflection app that sends athletes
  *to* Smoothcomp events) or competitive. Frame the request accordingly.
- **Alternative, not scalable:** an individual organiser or federation can export its
  own events' data in its controller role. Data sharing per organiser is possible,
  but it is manual, per event, and needs its own GDPR basis **[inferred]**.

### 7. Amateur coverage

| Signal | Status |
|---|---|
| About 150 events on an average weekend, 200+ at peak; about 27,000 athletes per average weekend (founders' figures, Gymdesk Originals, published 2026-10-06) | **[unverified: indexed, company-issued]** ([Ten Years In](https://gymdesk.com/originals/smoothcomp)) |
| About 2M athlete profiles, about 7,000 events a year | **[unverified: indexed, company-issued]** ([About Gymdesk](https://gymdesk.com/about-us)) |
| Organisers named as customers: **ADCC, NAGA, Grappling Industries, UFC BJJ, AJP, USA Judo** | **[unverified: indexed, company-issued]** ([press release](https://gymdesk.com/press/gymdesk-smoothcomp-acquisition)) |
| **NAGA** runs registration, payment and brackets on Smoothcomp (`naga.smoothcomp.com`); first events on the platform in December 2018 | **[unverified: indexed]** ([NAGA and Smoothcomp](https://www.nagafighter.com/?p=1409)) |
| Federations and organisers on tenant subdomains, e.g. `grapplingindustries.`, `adcc.`, `immaf.`, `bjjitalia.`, `azbjjf.`, `wbjja.`, `acbjj.`, `saskmartialarts.smoothcomp.com`; AJP's `ajptour.com` uses the same Smoothcomp-powered structure | **[unverified: indexed and secondary]** |
| **IBJJF does not run its events on Smoothcomp.** That gap is why Smoothcomp complements jiujitsu.net rather than duplicating it. | **[inferred]** from the earlier research (IBJJF results live on ibjjf.com) and from third-party code that treats IBJJF and Smoothcomp as separate sources |
| Depth caveat: results exist only where the organiser published them, and athletes can hide their profiles | **[unverified: indexed]** |

Most Flowlog hobbyists who have entered a NAGA, Grappling Industries, AGF-style or
local open have a Smoothcomp profile. Smoothcomp's coverage of Flowlog's real users
is likely **far** higher than any IBJJF-derived source **[inferred]**.

---

## ToS and legal stance

**What could be established, and how firmly:**

1. **Platform Terms of Service:** these live at `https://smoothcomp.com/en/agreements`
   (locale variants such as `/es/agreements` exist). Users (athletes, organisers,
   academy and federation managers) are bound by Smoothcomp's Terms of Service.
   Organisers also accept a separate **SaaS agreement** and **SLA** ([Agreements and
   Terms of Service](https://support.smoothcomp.com/article/197-agreements-and-terms-of-service),
   [SaaS and SLA](https://support.smoothcomp.com/article/195-more-information-about-our-saas-and-sla-agreements))
   **[unverified: indexed]**.
   **The full ToS text was not available.** This session could not load it, no search
   result surfaced its clauses, and the third-party researcher who did load the page
   recorded that its "Full text" was still to be checked
   ([JFrankfurt/adcc-rankings](https://github.com/JFrankfurt/adcc-rankings/blob/HEAD/design/data-source-spec.md))
   **[unverified: secondary]**. **No clause on scraping, automated access, database
   building or commercial reuse can be quoted here. Do not assume it is permissive.**

2. **Acceptable Use Policy:** an AUP was indexed only on the **demo** tenant's privacy
   page (`demo.smoothcomp.com/en/privacypolicy`). It lists prohibited conduct such as
   unauthorised access, hacking, malware, phishing, denial of service, spam and IP
   infringement. The indexed excerpts name no scraping clause **[unverified:
   indexed]**. Because it sits on a demo tenant, it may not be the live policy.

3. **Privacy notice** ([`smoothcomp.com/en/privacypolicy`](https://smoothcomp.com/en/privacypolicy)).
   The index excerpts below may be paraphrased, so re-verify them verbatim before
   relying on them **[unverified: indexed]**:
   > "Official registrations, brackets, match records, rankings, statistics and
   > historical results, administered by the relevant official organiser,
   > federation, academy, etc., are processed by them as their own data controllers."

   > "…some profile, registration, brackets, schedule, ranking and result information
   > may also be made public for other users, subject to applicable settings and
   > event configuration."

   > "…historical results and statistics may be retained to preserve competition
   > history and rankings … following account deletion, such data is dissociated
   > from your identifiers…"

   **Implication [inferred, needs counsel]:** "publicly visible" is not a licence. The
   data is personal data under GDPR, with Smoothcomp *and* organisers as controllers.
   A Flowlog integration would need (a) an agreement with Smoothcomp, (b) clarity on
   whether organisers must consent, and (c) a lawful basis for processing **other**
   athletes' data (opponent names in match histories), not just the opted-in user's.

4. **robots.txt:** **not fetched (proxy-blocked)**. Secondary accounts conflict:
   - JFrankfurt/adcc-rankings (observed 2026-08-11) records it as identical on the
     apex and `adcc.` subdomain, with `User-agent: *` disallowing `/order/` and
     `/checkout`, and `User-agent: SemrushBot` / `Disallow: /`. It reads the
     SemrushBot block as a sign that Smoothcomp curates crawler access. The excerpt
     seen may be partial **[unverified: secondary]**.
   - [Epetaway/DojoNet-Prototype-MAX
     `LEGAL_COMPLIANCE.md`](https://github.com/Epetaway/DojoNet-Prototype-MAX/blob/HEAD/LEGAL_COMPLIANCE.md)
     states "Smoothcomp currently blocks bots" **[unverified: secondary]**. It may
     refer to its own user agent or to the Cloudflare challenge rather than
     robots.txt.

   As the earlier research found for IBJJF, a permissive robots.txt would **not**
   override the ToS, and an active Cloudflare challenge is a stronger signal than
   robots.txt **[inferred]**.

5. **Net stance:** **not cleared for any automated or commercial use.** The binding
   constraints we *can* see are technical (an auth-gated API, a bot challenge on
   event pages) and data-protection related (controller split, hidden-profile and
   deletion rights). The contractual constraint (ToS) is **unknown**. Treat Smoothcomp
   like IBJJF until a human reads the ToS: no scraping, no internal endpoints,
   written permission first.

---

## What the server-side rule implies

Flowlog's rule is that third-party fetching runs **server-side in a Supabase edge
function**, never in the client (CLAUDE.md, rule 1; #90 notes). For Smoothcomp:

- **Without an agreement, a server-side fetch is still not viable, technically or
  legally.** The `/en/event/*` pages challenge plain HTTP clients, and edge
  functions call out from cloud-datacentre IPs, which bot challenges target
  **[inferred]**. Getting past that needs a headless or stealth browser, which is
  circumventing an access control and is ruled out. Moving the fetch server-side
  does not make unlicensed access acceptable.
- **With an agreement**, the edge-function shape is the right one:
  - The partner credential is a Supabase secret (`supabase secrets set`), never an
    `EXPO_PUBLIC_*` var.
  - The client calls only a thin wrapper, like `PipelineClient` does for
    `process-session`.
  - Persist Smoothcomp's **numeric profile ID**, never only a name.
  - Cache centrally and **re-check visibility on refresh**, so that a later "Hide
    public profile" or account deletion propagates to Flowlog (a GDPR erasure duty)
    **[inferred]**.
  - Throttle centrally (third parties hit 429s).
- **Zero-fetch option that is fine today:** let the user paste their own Smoothcomp
  profile URL into manual entry and render it as an outbound "View on Smoothcomp"
  link. That stores a user-supplied URL and fetches nothing **[inferred]**.
- The Flowlog repo is public. Never commit Smoothcomp sample payloads or athlete
  data, even from research **[inferred]**.

---

## Recommendation for #94

1. **Do not plan the MVP around Smoothcomp.** There is no public API, the ToS is
   unread, and partner access is undocumented. The MVP data strategy should be
   **hybrid: manual entry for everyone (the base layer) plus jiujitsu.net
   auto-fetch for IBJJF competitors once licensed.** Add Smoothcomp as a third tier
   only if and when a written agreement exists.
2. **Make manual entry fit Smoothcomp's data shape.** Model a self-logged result as
   event, organiser, date, division (belt, age, weight, gi or no-gi), placement, and
   per-match opponent, result and win type (submission, points, advantage, decision,
   DQ, walkover). Add an optional **Smoothcomp profile URL** field (link-out only).
   A future Smoothcomp feed then backfills the same records instead of forcing a
   migration. The walkover and no-show semantics above are worth copying.
3. **Expect Smoothcomp to give per-event facts, not a rating.** Even with access,
   Smoothcomp gives medals and match history but no cross-event Elo or percentile.
   #94's field list should not promise "rank / top X%" for amateur-only users.
4. **Pursue a partnership in parallel**, using the steps below. The jiujitsu.net
   licence request is in flight; Smoothcomp is the amateur-coverage complement, not
   a replacement.

### What the human needs to do next

1. **Read the primary pages yourself (about 15 minutes, before contacting anyone).**
   Either allow `smoothcomp.com` and `support.smoothcomp.com` in this cloud
   environment's network settings (environment menu, Edit, Network access, then add
   them under Allowed domains;
   [docs](https://code.claude.com/docs/en/cloud-environments#network-access)) and
   re-run this research, or open them in a browser:
   - `https://smoothcomp.com/en/agreements`: record any clauses on automated access,
     scraping, data reuse and commercial use, verbatim, with the "last updated" date.
   - `https://smoothcomp.com/en/privacypolicy`: confirm the controller-split and
     public-visibility wording quoted above.
   - `https://smoothcomp.com/robots.txt`.
   - `https://smoothcomp.com/api`: settles the uncorroborated "API docs" claim.
2. **Send a partnership inquiry** via `https://smoothcomp.com/en/support` (or Gymdesk
   corporate, given the acquisition). Ask:
   - Is there a partner or read API, or a data feed, for third-party apps? On what
     terms (cost, attribution, caching, rate limits)?
   - Is there **athlete-authorised access** (OAuth-style "connect your Smoothcomp
     account") limited to the user's own profile, results and matches? This fits
     Flowlog's opt-in model best and narrows the GDPR scope.
   - How must a partner honour "Hide public profile" and account deletion? Do
     organisers have to consent, given they are controllers of their results?
   - Is opponent data (names in match history) in scope, or only the athlete's own
     record?
   - Is the Smoothcomp Connect results integration available to non-Gymdesk
     partners?
3. **Get a short legal read** (GDPR controller and processor roles, and the lawful
   basis for opponent data) before any agreement is signed.
4. **Until then: build nothing** against `/api/v1/`, `.json` page endpoints or
   rendered pages, and do not reuse third-party scrapers.

---

## Open questions

- **ToS text:** what `smoothcomp.com/en/agreements` actually says about automated
  access and commercial reuse. This is the central unknown, and nothing in this
  session could read it.
- **robots.txt:** its actual contents (the secondary accounts conflict).
- **`smoothcomp.com/api`:** whether it exists. The claim came from a single
  uncorroborated third-party list.
- **Partner API:** whether a partner or read API exists, its auth model (API key
  vs. OAuth vs. athlete-consented), and its rate limits and pricing.
- **Gymdesk post-acquisition policy:** whether Gymdesk now gates third-party access
  to Smoothcomp results, or offers it through a Gymdesk API. Gymdesk's own API was
  not researched.
- **Organiser consent:** whether a Smoothcomp-level agreement covers results that
  organisers control, or whether each organiser or federation must opt in.
- **Coverage depth:** the share of amateur events whose organisers *publish*
  results (vs. brackets only), how far match-level history goes back, and how many
  athletes turn on "Hide public profile".
- **Identity matching:** whether a partner feed could match on something stronger
  than name, such as an athlete-initiated account link, given BJJ name collisions
  (see the matching section of the earlier research).
- **Figures:** the company-issued volume numbers (events per weekend, profiles,
  events per year) conflict across Gymdesk's own pages. Treat them as orders of
  magnitude, not facts.
