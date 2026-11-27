import type { PlaceIdentity } from "../../domain/places/types";
import type {
  AccessibleDestination,
  DestinationAccessStore,
} from "../../domain/destination-access/types";
import { validateDestinationAccess } from "../../domain/destination-access/validation";
import {
  arrivalAccess,
  directBindings,
  matchesDirectFare,
} from "../../domain/destination-access/arrival";
import { supportedCurrencies } from "../../domain/money/currency";
import { validateFxData, type FxSnapshot } from "../../domain/money/fx";
import { resolveGatewayTransferPricing } from "../../domain/destination-access/transfer-pricing";

/** Indexed source-controlled relationships; one airport can serve multiple final places. */
export function createDestinationAccessStore(
  input: unknown,
  places: readonly PlaceIdentity[],
  clock = () => Date.now(),
  fxInput: unknown = { schemaVersion: 1, records: [] },
): DestinationAccessStore {
  const data = validateDestinationAccess(structuredClone(input), places);
  // Bad conversion evidence disables conversion, not the destination/access relationship.
  let snapshots: FxSnapshot[];
  try {
    snapshots = validateFxData(structuredClone(fxInput)).records;
  } catch {
    snapshots = [];
  }
  const fx = new Map(snapshots.map((s) => [s.id, s]));
  const identities = new Map(
    structuredClone(places).map((p) => [p.subject, p]),
  );
  const profiles = new Map(data.records.map((p) => [p.destinationSubject, p]));
  const codes = new Map<string, Set<string>>();
  const directCodes = new Map<string, string>();
  for (const p of data.records) {
    const bindings = directBindings(p);
    const direct = bindings.flatMap((b) => [
      b.providerCityCode,
      ...b.airportCodes,
    ]);
    const providerCodes = [
      ...direct,
      ...(p.gateways ?? []).flatMap((g) => [g.providerCityCode, g.airportCode]),
    ];
    for (const code of direct) directCodes.set(code, p.destinationSubject);
    for (const code of providerCodes) {
      if (!codes.has(code)) codes.set(code, new Set());
      codes.get(code)!.add(p.destinationSubject);
    }
  }
  const get = (id: string): AccessibleDestination | undefined => {
    const p = profiles.get(id),
      place = identities.get(id),
      now = clock();
    if (
      !p ||
      !place ||
      place.confidence === "unresolved" ||
      p.reviewStatus !== "reviewed" ||
      !p.reviewedAt ||
      Date.parse(p.reviewedAt) > now ||
      Date.parse(p.reviewAfter) <= now
    )
      return;
    const country =
      new Intl.DisplayNames(["en"], { type: "region" }).of(place.countryCode) ??
      place.countryCode;
    return {
      destination: {
        id,
        name: { en: place.name, sq: place.name },
        country: {
          en: country,
          sq:
            new Intl.DisplayNames(["sq"], { type: "region" }).of(
              place.countryCode,
            ) ?? country,
        },
        countryCode: place.countryCode,
        coordinates: structuredClone(place.coordinates),
        // Tokyo's reviewed city guide covers an urban trip inside a region identity.
        // Travel style must not rewrite that canonical geography or imply other styles.
        styles:
          place.placeKind === "city" || id === "place:Q1490" ? ["city"] : [],
        stylesKnown: false,
        requiresFlight: true,
        travelHours: 0,
        metadataSource: "reviewed-destination-access",
        ...(directBindings(p).length
          ? {
              ...(p.directCity
                ? { cityCode: p.directCity.providerCityCode }
                : {}),
              iataCodes: [
                ...new Set(
                  directBindings(p).flatMap((b) => [
                    b.providerCityCode,
                    ...b.airportCodes,
                  ]),
                ),
              ],
            }
          : {}),
        why: p.directCity
          ? {
              en: "A city trip with estimated non-flight costs. Check current flight prices and availability with the provider.",
              sq: "Një udhëtim në qytet me vlerësime për kostot e tjera. Kontrollo çmimet dhe disponueshmërinë e fluturimeve me ofruesin.",
            }
          : p.directEntries
            ? {
                en: "Choose an arrival point that suits your base. Local and regional journeys still need planning.",
                sq: "Zgjidh një pikë mbërritjeje pranë vendit ku do të qëndrosh. Planifiko edhe udhëtimet vendore dhe rajonale.",
              }
            : {
                en: "Continue from the arrival gateway to your destination. Check the onward journey and its cost.",
                sq: "Vazhdo nga aeroporti i mbërritjes drejt destinacionit. Kontrollo udhëtimin në vijim dhe koston e tij.",
              },
      },
      directCity: p.directCity ? structuredClone(p.directCity) : undefined,
      directEntries: p.directEntries
        ? structuredClone(p.directEntries)
        : undefined,
      restorationGroups: p.restoration
        ? [...p.restoration.providerCityCodes]
        : undefined,
      gateways: structuredClone(p.gateways ?? []),
      transferPrices: Object.fromEntries(
        (p.gateways ?? []).map((g) => {
          const policy = g.onwardTransfer.pricing;
          return [
            g.airportCode,
            Object.fromEntries(
              supportedCurrencies.map((currency) => [
                currency,
                resolveGatewayTransferPricing({
                  policy,
                  currency,
                  airportConfirmed: true,
                  now,
                  accessReviewAfter: p.reviewAfter,
                  snapshot:
                    policy.kind === "observed"
                      ? fx.get(policy.fxSnapshotId)
                      : undefined,
                }),
              ]),
            ),
          ];
        }),
      ),
    };
  };
  return {
    get,
    directForCode(code) {
      const id = directCodes.get(code);
      return id ? get(id) : undefined;
    },
    forFare(fare) {
      return [
        ...(codes.get(fare.destinationAirport ?? fare.destinationCode) ?? []),
      ]
        .slice(0, 10)
        .flatMap((id) => {
          const a = get(id);
          return a && (matchesDirectFare(a, fare) || arrivalAccess(a, fare))
            ? [a]
            : [];
        });
    },
  };
}
