export type PlaceKind =
  | "city"
  | "island"
  | "region"
  | "nature-area"
  | "unknown";
export type Coordinates = { latitude: number; longitude: number };
/** Our destination ID is primary. No list/union of world cities. */
export type PlaceInput = {
  subject: string;
  name: string;
  placeKind: PlaceKind;
  countryCode: string;
  coordinates?: Coordinates;
  iataCodes?: string[];
  cityCode?: string;
};
export type ExternalIdentity = { authority: string; id: string };
export type PlaceIdentity = PlaceInput & {
  /** Human/provider spellings only; never alternate canonical subjects. */
  aliases?: string[];
  external: ExternalIdentity | null;
  resolutionMethod:
    | "reviewed"
    | "transport-code"
    | "constrained-name"
    | "unresolved";
  confidence: "reviewed" | "high" | "unresolved";
  resolvedAt: string | null;
  policyVersion: string;
  unresolvedReason: string | null;
};
export interface PlaceIdentityResolver {
  resolve(input: PlaceInput, reviewed?: PlaceIdentity): Promise<PlaceIdentity>;
}

export type PlaceRegistryData = { schemaVersion: 1; records: PlaceIdentity[] };
