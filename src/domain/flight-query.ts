import type { Destination, TravelLocation } from "./types";
import type { AccessibleDestination } from "./destination-access/types";
import {
  directEntryForCode,
  gatewayForCode,
} from "./destination-access/arrival";

export const MAX_RESTORATION_QUERIES = 3;
export type FlightQueryPlan = {
  kind: "broad" | "targeted" | "gateway";
  targets: (TravelLocation | undefined)[];
};
/** Trusted catalogue/metadata/access identity in; bounded provider query identities out.
 * A city group covers its airports. An island without a city group queries its airports.
 * Empty targeted plans never accidentally turn into worldwide searches. */
export function flightQueryPlan(
  destination?: Destination,
  selected?: TravelLocation,
  access?: AccessibleDestination,
  selectedEntryCode?: string,
): FlightQueryPlan {
  if (access?.directEntries && selected?.type !== "airport") {
    const selectedEntry =
      directEntryForCode(access, selectedEntryCode) ??
      gatewayForCode(access, selectedEntryCode);
    const entries = [
      ...access.directEntries,
      ...access.gateways.map((g) => ({ ...g, airportCodes: [g.airportCode] })),
    ];
    const groups = [
      ...new Set([
        ...(selectedEntry ? [selectedEntry.providerCityCode] : []),
        ...(access.restorationGroups ??
          access.directEntries.map((g) => g.providerCityCode)),
      ]),
    ].slice(0, MAX_RESTORATION_QUERIES);
    return {
      kind: "targeted",
      targets: groups
        .map((code) => entries.find((g) => g.providerCityCode === code)!)
        .map((g) => ({
          id: `city:${g.providerCityCode}`,
          type: "city",
          name: g.cityLabel.en,
          cityCode: g.providerCityCode,
          iataCodes: [
            g.providerCityCode,
            ...entries
              .filter((e) => e.providerCityCode === g.providerCityCode)
              .flatMap((e) => e.airportCodes),
          ],
          countryCode: access.destination.countryCode,
          countryName: access.destination.country,
        })),
    };
  }
  if (access && !access.directCity && !access.directEntries) {
    const groups = [
      ...new Map(access.gateways.map((g) => [g.providerCityCode, g])).values(),
    ];
    return {
      kind: "gateway",
      targets: groups.slice(0, MAX_RESTORATION_QUERIES).map((g) => ({
        id: `city:${g.providerCityCode}`,
        type: "city",
        name: g.cityLabel.en,
        cityCode: g.providerCityCode,
        iataCodes: [
          g.providerCityCode,
          ...access.gateways
            .filter((a) => a.providerCityCode === g.providerCityCode)
            .map((a) => a.airportCode),
        ],
        countryCode: access.destination.countryCode,
        countryName: access.destination.country,
      })),
    };
  }
  if (!destination && (!selected || selected.type === "country"))
    return { kind: "broad", targets: [selected] };
  if (selected?.type === "airport")
    return {
      kind: "targeted",
      targets: [
        access?.directCity
          ? {
              ...selected,
              iataCodes: [
                ...new Set([
                  ...(selected.iataCodes ?? []),
                  ...(access.destination.iataCodes ?? []),
                ]),
              ],
            }
          : selected,
      ],
    };
  const group = destination?.cityCode ?? selected?.cityCode;
  const codes = [
    ...new Set(
      group ? [group] : (destination?.iataCodes ?? selected?.iataCodes ?? []),
    ),
  ]
    .filter((code) => /^[A-Z]{3}$/.test(code))
    .slice(0, MAX_RESTORATION_QUERIES);
  return {
    kind: "targeted",
    targets: codes.map((code) => ({
      id: `${group ? "city" : "airport"}:${code}`,
      type: group ? "city" : "airport",
      ...(group ? { cityCode: code } : { airportIata: code }),
      name: destination?.name.en ?? selected!.name,
      iataCodes: group
        ? [
            ...new Set([
              code,
              ...(destination?.iataCodes ?? selected?.iataCodes ?? []),
            ]),
          ]
        : [code],
      countryCode: destination?.countryCode ?? selected!.countryCode,
      countryName: destination?.country ?? selected!.countryName,
    })),
  };
}
