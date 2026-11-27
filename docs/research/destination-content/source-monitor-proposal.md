# Proposed source monitor for destination guides

Start after the 17 November collection. For the first run, use the 25 November menu and visitor-access recheck and the 11 December fare and airport-works recheck. Keep the daily expiry warning running independently, including when a source cannot be read.

Run one daily GitHub Actions job against a register of sources. Give each entry an official URL, owner, check interval, next check time, last successful check, affected item IDs, and narrowly defined claims to extract. Fetch each due URL once across all guides. For menus, follow the PDF link from the venue’s current menu page. Save the retrieval date, final URL, response validator or hash, extractor version and the evidence excerpt or page locator. Use conditional requests when supported. Back off and respect access restrictions.

| Source | Compare | Refer to an editor |
|---|---|---|
| Tariff table | Currency, amount, ticket, zone, eligibility and exceptions on the same row or in its footnotes | New fare product, revised boundaries, or changed conditions |
| Opening hours | Weekly closing days and separately listed holiday exceptions | Exceptional closures and conflicting calendars |
| Service notice | Route, replacement service and effective start/end dates | A disappeared notice, ambiguous extension, or claim that normal service resumed |
| Venue menu | Dish, size, price, currency and service terms on a text menu or verifiable PDF row. Recalculate basket totals after matching every line. | Scans, substitutions, removed dishes, missing sizes, or an indicative range presented differently |

Ignore cosmetic page changes. A meaningful difference produces one review entry with the old and new values, the official evidence, and every guide item affected. An unreadable or moved source, ambiguous row, or parser failure is a separate verification problem. Keep the last verified observation and its existing deadline. Never treat a failed fetch as unchanged. Test extractors against changed numbers, exceptions, reordered rows and missing data.

Under the current approval rule, group successful unchanged comparisons into one dated renewal packet. The editor approves its exact revisions in one pass. Changed wording, scope and exceptions get individual review. Automatic extensions of unchanged deadlines would require a separate editorial decision. Track fetch failures and missing scheduled runs independently of price changes.

Planning estimate for one developer familiar with this repository: 2–3 days for the register, scheduling, evidence and deduplication, 2–3 days for the first HTML and text-PDF extractors, and 1–2 days for fixtures, failure reporting and a shadow run. Total 5–8 engineering days, followed by one fortnight of comparison against normal review. Additional claims on an established page format should take hours. A new format or frequently changing PDF can take a day or longer and can stay manual. Reuse the current Actions and issue infrastructure. Measure owner review time, missed differences and false alerts during the shadow run before expanding.
