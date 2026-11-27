import { Suspense } from "react";
import type { TripRequest } from "@/domain/types";
import type { Locale } from "@/i18n/config";
import { RecentFares } from "./RecentFares";
export function HomePlanning({
  request,
  locale,
}: {
  request: TripRequest;
  locale: Locale;
}) {
  return (
    <>
      <section
        id="how-it-works"
        className="shell home-how home-planning"
        aria-labelledby="how-title"
      >
        <h2 id="how-title">Your budget. The whole trip.</h2>
        <ol>
          <li>
            <div className="home-step-art" aria-hidden="true">
              <span>One budget</span>
              <strong>Flights + stay + daily costs</strong>
              <span>For everyone going</span>
            </div>
            <h3>Set one total</h3>
            <p>
              Choose where you leave from, when and who’s coming. Your budget
              covers everyone.
            </p>
          </li>
          <li>
            <div className="home-step-art" aria-hidden="true">
              <div className="home-cost-bars">
                <i />
                <i />
                <i />
                <i />
              </div>
              <span>Travel · stay · daily costs · reserve</span>
            </div>
            <h3>Compare whole trips</h3>
            <p>
              See flights, stays and daily costs together, with a separate
              reserve and missing costs made clear.
            </p>
          </li>
          <li>
            <div className="home-step-art" aria-hidden="true">
              <strong>
                Trip Range <span>↗</span> Booking provider
              </strong>
              <span>Check the fare and availability</span>
            </div>
            <h3>Book with the provider</h3>
            <p>
              Explore the destination, then check the actual price and
              availability on the booking site.
            </p>
          </li>
        </ol>
      </section>
      <section
        className="home-price-explanation"
        aria-labelledby="home-prices-title"
      >
        <div className="shell home-price-grid">
          <div className="discovery-trust">
            <h2 id="home-prices-title">Every cost says where it came from.</h2>
            <p>
              Flight evidence comes from previous searches, not a live quote.
              Stays and daily costs are estimates. A total stays incomplete when
              required costs are missing.
            </p>
            <dl className="home-price-legend">
              <div>
                <dt>
                  <i className="cost-dot" />
                  Seen fare
                </dt>
                <dd>A fare found recently, with the date it was seen.</dd>
              </div>
              <div>
                <dt>
                  <i className="cost-dot estimate" />
                  Estimate
                </dt>
                <dd>Typical costs for stays, food and local transport.</dd>
              </div>
              <div>
                <dt>
                  <i className="cost-dot checking" />
                  Needs checking
                </dt>
                <dd>
                  Missing or reference-only evidence still needs checking.
                </dd>
              </div>
              <div>
                <dt>
                  <i className="cost-dot provider" />
                  Booking site price
                </dt>
                <dd>Only the provider can confirm the actual price.</dd>
              </div>
            </dl>
          </div>
          {/* Real observations only. The former illustrative route was fabricated. */}
          <Suspense fallback={null}>
            <RecentFares request={request} locale={locale} />
          </Suspense>
        </div>
      </section>
    </>
  );
}
