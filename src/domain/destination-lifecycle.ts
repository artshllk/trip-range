import archive from "../config/archived-destinations.json";
import parked from "../config/parked-destinations.json";

type LifecycleRecord = {
  id: string;
  name: string;
  countryCode: string;
  directCodes: string[];
};
const inactive = [...archive.records, ...parked.records];
const originOnly: LifecycleRecord[] = [
  {
    id: "prishtina",
    name: "Prishtina",
    countryCode: "XK",
    directCodes: ["PRN"],
  },
];
const matchesId = (record: LifecycleRecord, id: string) =>
  record.id === id ||
  record.directCodes.some(
    (code) => id === `city:${code}` || id === `airport:${code}`,
  );

export function isParkedDestinationId(id: string): boolean {
  return parked.records.some((r) => matchesId(r, id));
}

/** Inactive as a destination only: never used to reject a departure origin. */
export function isInactiveDestinationId(id: string): boolean {
  return inactive.some((r) => matchesId(r, id));
}

/** Scope decision, not a statement about flight service. Origins remain unrestricted. */
export function isArchivedDestinationId(id: string): boolean {
  return archive.records.some((r) => matchesId(r, id));
}

type DestinationIdentity = {
  id: string;
  countryCode: string;
  name: string | { en: string };
  cityCode?: string;
  iataCodes?: string[];
};
function matchesRecord(
  records: LifecycleRecord[],
  destination: DestinationIdentity,
) {
  if (records.some((r) => matchesId(r, destination.id))) return true;
  const name =
    typeof destination.name === "string"
      ? destination.name
      : destination.name.en;
  return records.some(
    (r) =>
      r.countryCode === destination.countryCode &&
      (r.name.toLocaleLowerCase("en") === name.toLocaleLowerCase("en") ||
        r.directCodes.some(
          (code) =>
            destination.cityCode === code ||
            destination.iataCodes?.includes(code),
        )),
  );
}

export function isArchivedDestination(
  destination: DestinationIdentity,
): boolean {
  return matchesRecord(archive.records, destination);
}

export function isInactiveDestination(
  destination: DestinationIdentity,
): boolean {
  return matchesRecord(inactive, destination);
}

/** Origin-only is an owner use-case decision, never inferred from fare zeroes.
 * Its content and future local-knowledge anchor work remain active. */
export function isExcludedTravelDestination(
  destination: DestinationIdentity,
): boolean {
  return (
    isInactiveDestination(destination) || matchesRecord(originOnly, destination)
  );
}

export function isExcludedTravelDestinationId(id: string): boolean {
  return (
    isInactiveDestinationId(id) || originOnly.some((r) => matchesId(r, id))
  );
}
