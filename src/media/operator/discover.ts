import "server-only";
import type {
  DestinationMediaRole,
  PlaceInput,
  PlaceIdentity,
  MediaRejection,
} from "../../domain/media/types";
import {
  AUTOMATIC_MEDIA_APPROVAL,
  AUTOMATIC_MEDIA_INGESTION,
} from "../../domain/media/policy";
import { createMediaApi, MEDIA_REQUEST_LIMITS } from "../adapters/api";
import { createWikidataIdentityResolver } from "../../places/adapters/wikidata";
import { createCommonsMediaDiscovery } from "../adapters/commons";
import {
  reviewedIdentity,
  unresolvedIdentity,
} from "../../places/operator/identity";

export async function discoverDestinationMedia(
  input: PlaceInput,
  options: {
    live: boolean;
    role: DestinationMediaRole;
    reviewed?: PlaceIdentity;
    rejections: MediaRejection[];
  },
  fetcher: typeof fetch = fetch,
) {
  const transport = createMediaApi(fetcher);
  const base = {
    subject: input.subject,
    role: options.role,
    automaticApproval: AUTOMATIC_MEDIA_APPROVAL,
    backgroundIngestion: AUTOMATIC_MEDIA_INGESTION,
    requestLimits: MEDIA_REQUEST_LIMITS,
  };
  if (!options.live)
    return {
      ...base,
      status: "offline",
      identity:
        reviewedIdentity(input, options.reviewed) ??
        unresolvedIdentity(input, "live-resolution-not-requested"),
      candidates: [],
      requests: transport.counts,
    };
  const identity = await createWikidataIdentityResolver(transport.api).resolve(
    input,
    options.reviewed,
  );
  if (!identity.external)
    return {
      ...base,
      status: "unresolved",
      identity,
      candidates: [],
      requests: transport.counts,
    };
  try {
    const candidates = await createCommonsMediaDiscovery(
      transport.api,
    ).discover(identity, options.role, options.rejections);
    return {
      ...base,
      status: "complete",
      identity,
      candidates,
      requests: transport.counts,
    };
  } catch {
    return {
      ...base,
      status: "unavailable",
      reason: "bounded-media-discovery-unavailable",
      identity,
      candidates: [],
      requests: transport.counts,
    };
  }
}
