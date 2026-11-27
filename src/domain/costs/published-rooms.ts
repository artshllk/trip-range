import records from "../../../content/rooms/published-market-context.json";
import spain from "../../../content/rooms/ine-spain.json";
import { inePublishedRooms, type IneRoomSnapshot } from "./ine-spain";
import { validatePublishedRooms, type PublishedRoom } from "../room-evidence";

export const publishedRooms: readonly PublishedRoom[] = [
  ...(records as PublishedRoom[]),
  ...inePublishedRooms(spain as IneRoomSnapshot),
];
validatePublishedRooms(publishedRooms);
