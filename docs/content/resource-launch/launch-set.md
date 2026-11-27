# First public release

Trip Range, 12 November 2026. The accepted release has 12 indexable English pages. The four resource pages share a single deployment and anonymous download check. Source permission for room frames is not a dependency for any of them.

| Page | What it claims |
| --- | --- |
| `/` | Visitors can start a trip search with a departure point, dates, travellers and budget. |
| `/destinations` | A directory of five reviewed city guides. |
| `/destinations/vienna` | A short visit organised around the old centre, with Schönbrunn as a separate outing. |
| `/destinations/london` | Westminster and the South Bank fit together, with the Tower on another day and arrivals depending on the airport. |
| `/destinations/paris` | The Eiffel Tower, Louvre, Notre-Dame and Montmartre can be grouped by area. |
| `/destinations/istanbul` | A visit around the historic peninsula, its main sights and airport access. |
| `/destinations/barcelona` | Neighbourhood-based planning around the Eixample, Gothic Quarter and major Gaudí sights. |
| `/about` | Who Trip Range serves and how its planning service works. |
| `/methodology` | How cached fares qualify, how stay length and weighting affect results, and what visitors can verify. Room measurement is underway and its method awaits source permissions. |
| `/data` | A catalogue of two versioned studies, with citations and a corrections contact. |
| `/data/fare-coverage/2026-11-05-v1` | Exactly two nights yielded 31–76% fewer recorded destinations across six airport/month comparisons. Ticket 255231 clears the aggregate format and methods with Aviasales credit. The 32 files allow the summaries to be checked. Recomputing the medians requires private fares. |
| `/data/municipal-hotel-scaling/2025-v1` | Within a country, scaling and copying the same-month capital rate tie in 1,437 holdouts. Madrid falls within ±25% in 14.1% of cases and Helsinki in 73.2%. Ten files supply the official inputs, calculation, results, attribution and integrity records. These are achieved municipal rates. |

## Public pages outside the sitemap

| Page | Visitor use |
| --- | --- |
| `/plan`, `/plan/results`, `/plan/trips/{id}` | Search, view available results and inspect a particular trip. A trip detail needs a valid trip identifier. |
| `/from/tirana`, `/from/prishtina`, `/from/skopje` | Departure-specific planning. The stored editorial decisions keep all three noindex. |
| `/from/zurich`, `/from/zurich/weekend-trips`, `/from/zurich/weekend-trips-under-500` | Existing Zurich planning examples, outside the launch acquisition markets and noindex. |
| `/privacy`, `/terms`, `/affiliate-disclosure` | Data handling, service terms and commercial relationships. The operator details appear in the legal page bodies. |

The 42 evidence downloads remain accessible and noindex. English paths are unprefixed. There is no public room protocol page, fragment, download, model-derived city room figure from this study or city-cost page in this release.

## Opening and delivery

The source-permission scope of both studies is settled. The live site returned HTTP 401 to an anonymous request at `/data` on 12 November. All visitor pages share the site-opening decision. The [operator account review](../../legal-launch-drafts-review.md) still lists Netlify, Upstash, Neon and the contact mailbox. The [launch checklist](../../launch-checklist.md) tracks the wider production checks. A prepared research release is independent of whether the planner meets its operational opening criteria.

From a full Git checkout with Node 24 and locked dependencies, run `python3 scripts/public-evidence/package.py .evidence-build`. In `TRIP_RANGE_EVIDENCE_MODE=candidate` build and start the application. Run `python3 scripts/public-evidence/verify-delivery.py .evidence-build --origin http://localhost:4288 --report .evidence-checks/local.json` on the local candidate. The input pins, generated file trees, checksums, replay, HTML links and both GET and HEAD delivery are checked.

For the opening, seal the bundle once using the resource-evidence workflow and the authorised UTC publication timestamp. Archive those exact bytes. Include them in the release build with `TRIP_RANGE_EVIDENCE_MODE=release`. Verify anonymous delivery from the canonical host using the same artifact and the workflow’s verify-public operation. Place its passing report at `.evidence-checks/public.json` and use the same bundle in accepted mode to list the studies in the catalogue, footer and sitemap. Repeat the HTTP check with `--listed` to verify the 12 public URLs. Default builds retain the prior nine-URL sitemap until the accepted bundle is enabled.
