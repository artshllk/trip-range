# Cost-scope archive — 2 November 2026

The owner approved archiving these 20 destinations because the pricing model is
Europe-only. The owner identified the 2021 worldwide price comparison as having no
accepted current successor. Retained fare observations do not supply the missing
cost model. This is a cost-scope decision, not a finding that flights do not exist.

Archived: Bali, Banff National Park, Bangkok, Buenos Aires, Cape Town, Dubai,
Kruger National Park, Kyoto, Marrakesh, Mauritius Island, Mexico City, New York City,
Oahu, Rio de Janeiro, Singapore, Sydney, Tasmania, Tokyo, Vancouver and Yosemite
National Park.

**Dubai and Marrakesh are the first candidates if scope extends.** Both have retained
home-origin fare observations in the 2 November network audit. The owner also cites
real demand from this market; no demand volume has been measured or inferred here.

## Retention and exclusion

- `destinations/`, `travel/access/` and `operations/reviews/` retain all 60 original
  files byte for byte. `manifest.json` records original paths and SHA-256 checksums.
- Archived editorial findings are retained in `operations/editorial-findings.json`.
  Nothing was renewed or approved. Sydney's expired WSI item remains expired.
- The live content and access manifests no longer import these records. Live guide
  listings, sitemap generation and canonical planning targets exclude them.
- `src/config/archived-destinations.json` records the archive identity guard. Provider
  metadata cannot recreate an archived destination through its direct city/airport
  aliases or its exact name and country. A gateway airport is not treated as the
  archived region itself. This list is not a worldwide country-scope policy.
- Canonical identity records, media provenance/assets, research reports and historical
  batch/queue receipts remain at their original paths. They preserve identity and
  approval history; they do not authorize publication. Active operator contexts,
  research queues and review queues exclude the archived identities.
- Daily expiry and editorial maintenance scan the live directories only. The archive
  is not a review schedule. Production import-boundary checks forbid loading archived
  content into the runtime. Tests explicitly load historical fixtures to preserve
  receipt, expiry, media and transfer regression coverage; separate integration tests
  verify current exclusion.

Restoration requires an explicit scope decision, defensible current cost inputs,
source and expiry re-review, deliberate restoration to the live manifests and removal
of the identity exclusion. Moving a file back cannot renew its approval or dates.

The before/after evidence is in
`docs/research/destination-network-2026-11-02/post-archive-review-burden.json`:
30 → 10 content destinations, 393 → 138 items, 281 → 92 dated item obligations,
and 286 → 109 content-source records. The retained content has no expired items on
2 November. Three separate access records have review dates on 10 January 2027.
