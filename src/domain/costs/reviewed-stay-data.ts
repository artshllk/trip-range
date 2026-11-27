import { validateStayData, type StayData } from "./stay-figures";

/**
 * Production stay inputs. Deliberately empty: no observation has been reviewed, no
 * Eurostat snapshot approved and no holdout run, so every destination keeps its
 * labelled planning allowance and nothing new is shown live.
 *
 * To plug in a round: `npm run derive:room-panel -- <city>-<date>-observations.json
 * --review-after YYYY-MM-DD` prints a pending figure; after review, set
 * `review: { status: "reviewed", reviewer, reviewedAt }` and add it to `figures`.
 * The price-level snapshot (`npm run snapshot:eurostat`) goes in `series` with
 * `reviewStatus: "reviewed"`. The 18 November holdout (`npm run holdout:room-panels`)
 * goes in `holdout` once reviewed; it replaces the provisional bands.
 */
export const reviewedStayData: StayData = {
  figures: [],
  series: undefined,
  holdout: undefined,
};
validateStayData(reviewedStayData); // Once at load, like the cost-profile catalogue.
