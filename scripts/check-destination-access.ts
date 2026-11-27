import { destinationAccessData } from "../content/travel/access/records";
import { placeIdentities } from "../src/places/runtime/registry";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { checkDestinationContentFiles } from "./lib/destination-content-files";
import { fxData } from "../content/money/fx/records";
import { supportedCurrencies } from "../src/domain/money/currency";
try {
  if (process.argv.length !== 2) throw Error("arguments");
  const store = createDestinationAccessStore(
    destinationAccessData,
    placeIdentities,
    () => Date.now(),
    fxData,
  );
  const files = checkDestinationContentFiles(
    "content/travel/access",
    destinationAccessData.records,
    "destinationSubject",
  );
  if (!files.ok) throw Error("manifest");
  const profiles = destinationAccessData.records.map((p) => ({
    destination: p.destinationSubject,
    active: !!store.get(p.destinationSubject),
    reviewAfter: p.reviewAfter,
    relationship: p.relationship ?? "external-gateway",
    ...(p.directCity
      ? {
          directCity: {
            providerCityCode: p.directCity.providerCityCode,
            airportCodes: p.directCity.airportCodes,
            gatewayTransferRequired: false,
          },
        }
      : {}),
    ...(p.directEntries
      ? {
          directEntries: p.directEntries.map((e) => ({
            providerCityCode: e.providerCityCode,
            airportCodes: e.airportCodes,
            gatewayTransferRequired: false,
          })),
          proactiveGroups:
            p.restoration?.providerCityCodes ??
            p.directEntries.map((e) => e.providerCityCode),
          selectedEntryFirst: true,
          maximumRestorationTargets: 3,
        }
      : {}),
    gateways: (p.gateways ?? []).map((g) => ({
      providerCityCode: g.providerCityCode,
      airport: g.airportCode,
      gatewayTransferRequired: true,
      priceReviewAfter:
        g.onwardTransfer.pricing.kind === "unpriced"
          ? null
          : g.onwardTransfer.pricing.reviewAfter,
      prices: Object.fromEntries(
        supportedCurrencies.map((c) => {
          const price = store.get(p.destinationSubject)?.transferPrices[
            g.airportCode
          ]?.[c];
          return [
            c,
            price?.status === "estimate"
              ? {
                  status: price.status,
                  amount: price.perPersonReturn,
                  validUntil: price.reviewAfter,
                }
              : {
                  status: "unpriced",
                  reason: price?.reason ?? "inactive-access",
                },
          ];
        }),
      ),
    })),
    state: p.reviewStatus,
  }));
  const expired =
    profiles.some((p) => p.state === "reviewed" && !p.active) ||
    destinationAccessData.records.some(
      (p) =>
        p.reviewStatus === "reviewed" &&
        (p.gateways ?? []).some(
          (g) =>
            g.onwardTransfer.pricing.kind === "observed" &&
            g.onwardTransfer.pricing.reviewStatus === "reviewed" &&
            supportedCurrencies.some(
              (c) =>
                store.get(p.destinationSubject)?.transferPrices[
                  g.airportCode
                ]?.[c]?.status !== "estimate",
            ),
        ),
    );
  console.log(
    JSON.stringify(
      {
        status: expired ? "failed" : "passed",
        mode: "offline",
        profiles,
        writes: 0,
        externalCalls: 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = expired ? 1 : 0;
} catch {
  console.error(
    "Destination access validation failed: invalid arguments, manifest or access data.",
  );
  process.exitCode = 1;
}
