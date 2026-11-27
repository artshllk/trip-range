# Indexing gate G1–G4

**Owner decision, 25 November 2026.** This replaces the publication gates in
[content-architecture.md](content-architecture.md) section 3B: the "three
complete, comparable destination-cost baskets" rule and the three-destination
minimum. Those assumed room prices would become available, and they never will, so
no page could ever pass. Code: `src/seo/indexing.ts`. Stored decisions:
`src/seo/indexing-decisions.json`.

## The gate

A page is indexable only when a dated review records that it passes all four
tests. A missing, invalid or failing review is noindex (fail closed). The review
date drives the sitemap `lastmod`; `npm run check:seo` reports overdue reviews.

| Test                    | Passes when                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1 Integrity**        | Every figure shown is sourced, dated and linked to its receipt. Every unknown is named. Nothing implies a total the evidence does not support. A figure that expires becomes "not known" automatically. The review records zero unsourced figures and zero unnamed unknowns.                                                 |
| **G2 Its own question** | The page answers one stated search question that no other indexed Trip Range page answers. Removing the city or origin name must leave a different answer, not the same template.                                                                                                                                            |
| **G3 Information gain** | For that query, the page offers at least one fact that matters to the decision and that the current top results get wrong or leave out. The review records the query, at least three top results checked within 30 days, and what the page adds. A cached provider fare is not information gain over live fare-search tools. |
| **G4 Maintainable**     | Every figure has a review date and a refresh path one person can run with agents. The review states when the page is withdrawn, for example when most of its figures lapse.                                                                                                                                                  |

Interactive state (origin, month, budget, party, hotel class) never creates an
indexable identity. The kill list in content-architecture.md section 5 still
applies.

## Recording a decision

    npm run review:seo-indexing                       # stored-fare context, read-only
    npm run review:seo-indexing -- --record <pageId> --decision noindex --basis "..."
    npm run review:seo-indexing -- --record <pageId> --decision index --gate review.json

`review.json` is a `GateReview` (`version: "g1-g4-v1"`, `integrity`, `question`,
`informationGain`, `maintenance`, `reviewer`). The script refuses to record an index
decision whose review fails, and says which test failed.

## Applied on 25 November 2026

| Page                                | Decision                        | Reason                                                                                                                                      |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/methodology`, `/about`       | index                           | Brand and trust pages; they do not target a search question.                                                                                |
| `/destinations` and the five guides | **noindex**, out of the sitemap | G3: sourced and dated, but they add nothing to what the established results for "<city> travel guide" show. They stay published and linked. |
| `/from/tirana`                      | noindex                         | G3: stored fares plus city tax for about half its destinations add nothing decisive over live fare-search tools.                            |
| `/from/zurich` and its variants     | noindex                         | Outside the launch market (unchanged).                                                                                                      |
| `/plan` and product states          | noindex                         | Product states, not editorial pages (unchanged).                                                                                            |

**Not reachable yet.** Production is behind Netlify site protection: every URL,
`robots.txt` included, returns 401. No indexing decision takes effect until that
protection is removed at launch.

**Next candidate:** a single sourced tourist-tax reference built from
`content/city-costs/`. It is held until search demand has been measured
(owner, 25 November 2026).
