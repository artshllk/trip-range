# Vienna / London media review candidates

**INTERNAL REVIEW ONLY — not runtime media approval.**

Two bounded Commons file lookups/downloads were made. Original file bytes were checked against Commons SHA-1, then visually inspected. No random image search, generated destination artwork, API key, screenshot reuse or live image-search provider is involved.

| Destination | Exact subject and evidence | Author | Reuse licence |
| --- | --- | --- | --- |
| Vienna | [File page](https://commons.wikimedia.org/wiki/File:Wien_katedra_sw_Szczepana_widok_z_wiezy_6.jpg): Vienna skyline from the north tower of St Stephen’s Cathedral. This is **not** an exterior photograph of the cathedral. The file is the P18 image of [Vienna Q1741](https://www.wikidata.org/wiki/Q1741). | Andrzej Otrębski | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| London | [File page](https://commons.wikimedia.org/wiki/File:London_Skyline_(125508655).jpeg): Tower Bridge, Thames, Shard, City skyline at dusk. This is **not** Westminster or London Bridge. The file is the P18 image of [London Q84](https://www.wikidata.org/wiki/Q84). | Ilya Grigorik | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |

`candidates.json` records original checksum, localized factual alt text, exact source, author, licence, derivative checksum, dimensions and file size. Source canonical upload URLs contain no tracking query. The original files remain outside the repository; only six optimized WebP derivatives are included here.

Derivatives: 640, 1200 and 1920 px wide; WebP quality 78, no retouching/generation. Files preserve source aspect ratio; the responsive hero uses `object-fit: cover`, so the **displayed** view is cropped. Attribution identifies resizing and the UI's existing localized crop notice. All derivatives are offered under their respective original CC BY-SA licence; credit, licence link, source link and modification disclosure must accompany publication. No photographer endorsement is implied.

Visual checks: Vienna roofs and modern skyline, not a generic palace photograph; London Tower Bridge and both banks visible in the wide image. Check the actual mobile/desktop crop and legibility before final selection. Source file pages and Commons metadata assert the licences; ownership is not independently guaranteed beyond that evidence.

Final local responsive verification, 21 October 2026: the shared `DestinationImage` component now accepts explicit validated same-photo local variants and renders native width-descriptor `srcset`/`sizes`. No service, dependency, derivative bytes, quality setting, dimensions, photographer or licence changed. Forty cold-browser views (EN/SQ, 1440/390/375/360/320px, DPR 1/2) decoded actual network response bytes and found one image request per view. Standard-density mobile uses 640px (Vienna 36,408 bytes; London 45,986), desktop 1200px; DPR 2 uses 1200px at 390/375, 640px at 360/320 and 1920px desktop. Expanded attribution stays within the viewport. Forced load errors retain no-photo with no misleading credit. These measurements close local delivery acceptance; they do not claim hosted publication or bypass human media selection.

These files are not in `public/`, are not imported by `src/` or runtime content, and do not change `content/media/approved.json`. Only the explicit loopback review harness serves their six allowlisted paths. The preview uses a clearly labelled in-memory candidate, not a persisted human approval. For publication, the existing human media selection process must verify identity, crop and reuse metadata; do not mark the agent as a human reviewer or forge an approval receipt.
