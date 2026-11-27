import "server-only";
import { destinationAccessData } from "../../../content/travel/access/records";
import { placeIdentities } from "../../places/runtime/registry";
import { createDestinationAccessStore } from "./access-store";
import { fxData } from "../../../content/money/fx/records";
export const destinationAccess = createDestinationAccessStore(
  destinationAccessData,
  placeIdentities,
  () => Date.now(),
  fxData,
);
