import { addDays, isCalendarDate } from "../dates";
import type { PublishedRoom } from "../room-evidence";

export const INE_ROOM_FEED =
  "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/46298?nult=1";
export const INE_ROOM_TABLE = "https://www.ine.es/jaxiT3/Tabla.htm?t=46298&L=1";
export const INE_REUSE = "https://www.ine.es/dyngs/AYU/en/index.htm?cid=125";
export type IneRoomObservation = {
  seriesId: string;
  municipality: string;
  period: string;
  status: "available" | "suppressed" | "missing";
  roomNightCents: number | null;
  dataType: number;
};
export type IneRoomSnapshot = {
  schemaVersion: 1;
  table: "46298";
  fetchedAt: string;
  sourceUrl: string;
  sha256: string;
  observations: IneRoomObservation[];
};
const suffix = ". Tarifa media diaria (ADR). Total categorías. ";

/** Reject structural changes instead of guessing column meanings. Suppression is
 * retained as an explicit observation; it must never become zero or an old rate. */
export function parseIneRooms(payload: unknown): IneRoomObservation[] {
  if (!Array.isArray(payload) || !payload.length)
    throw Error("INE: empty/non-array table");
  const seen = new Set<string>();
  const names = new Set<string>();
  const observations: IneRoomObservation[] = [];
  for (const row of payload) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.Nombre !== "string" ||
      !row.Nombre.includes(suffix)
    )
      throw Error("INE: unexpected series scope");
    const [municipality, measure] = row.Nombre.trim().split(suffix);
    if (measure === "Tasa de variación interanual.") continue;
    if (
      measure !== "Dato." ||
      !municipality ||
      !/^EOT\d+$/.test(row.COD) ||
      row.FK_Unidad !== 7 ||
      row.FK_Escala !== 1 ||
      !Array.isArray(row.Data) ||
      row.Data.length !== 1
    )
      throw Error("INE: unexpected ADR schema or unit");
    if (seen.has(row.COD) || names.has(municipality))
      throw Error("INE: duplicate municipality/series");
    seen.add(row.COD);
    names.add(municipality);
    const d = row.Data[0];
    if (
      !d ||
      !Number.isInteger(d.Anyo) ||
      !Number.isInteger(d.FK_Periodo) ||
      d.FK_Periodo < 1 ||
      d.FK_Periodo > 12 ||
      typeof d.Secreto !== "boolean" ||
      !Number.isInteger(d.FK_TipoDato)
    )
      throw Error("INE: invalid period/status");
    const period = `${d.Anyo}-${String(d.FK_Periodo).padStart(2, "0")}`;
    if (!isCalendarDate(`${period}-01`))
      throw Error("INE: invalid calendar month");
    const value = d.Valor;
    if (
      value !== null &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > 10000 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
    )
      throw Error("INE: invalid room price");
    observations.push({
      seriesId: row.COD,
      municipality,
      period,
      status: d.Secreto
        ? "suppressed"
        : value === null
          ? "missing"
          : "available",
      roomNightCents:
        d.Secreto || value === null ? null : Math.round(value * 100),
      dataType: d.FK_TipoDato,
    });
  }
  if (!observations.length) throw Error("INE: no ADR observations");
  return observations.sort((a, b) => a.seriesId.localeCompare(b.seriesId));
}

export function validateIneSnapshot(snapshot: IneRoomSnapshot): void {
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.table !== "46298" ||
    snapshot.sourceUrl !== INE_ROOM_FEED ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
    !Number.isFinite(Date.parse(snapshot.fetchedAt))
  )
    throw Error("INE: invalid snapshot provenance");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const row of snapshot.observations) {
    if (
      !/^EOT\d+$/.test(row.seriesId) ||
      !row.municipality ||
      ids.has(row.seriesId) ||
      names.has(row.municipality) ||
      !isCalendarDate(row.period + "-01") ||
      row.period >= snapshot.fetchedAt.slice(0, 7) ||
      !Number.isInteger(row.dataType) ||
      !["available", "missing", "suppressed"].includes(row.status) ||
      (row.status === "available"
        ? !Number.isSafeInteger(row.roomNightCents) ||
          row.roomNightCents! <= 0 ||
          row.roomNightCents! > 1000000
        : row.roomNightCents !== null)
    )
      throw Error("INE: invalid observation");
    ids.add(row.seriesId);
    names.add(row.municipality);
  }
  if (!ids.size) throw Error("INE: empty snapshot");
}

/** Complete national table → dated context. No traveller-request network call. */
export function inePublishedRooms(snapshot: IneRoomSnapshot): PublishedRoom[] {
  validateIneSnapshot(snapshot);
  return snapshot.observations
    .filter((r) => r.status === "available")
    .map((r) => {
      const start = r.period + "-01";
      const endDate = new Date(start + "T12:00:00Z");
      endDate.setUTCMonth(endDate.getUTCMonth() + 1, 0);
      const end = endDate.toISOString().slice(0, 10);
      return {
        kind: "published",
        cityCode: `ine:${r.seriesId}`,
        municipalityName: r.municipality,
        countryCode: "ES",
        roomNightCents: r.roomNightCents!,
        currency: "EUR",
        scope: "pooled",
        period: {
          start,
          end,
          label:
            new Intl.DateTimeFormat("en-GB", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(start)) + " monthly average",
        },
        checkedAt: snapshot.fetchedAt.slice(0, 10),
        // Fetching the same old observation must never extend its usable life.
        reviewAfter: addDays(end, 120),
        frequency: "monthly",
        source: {
          title: `INE · ${r.municipality} hotel ADR`,
          url: INE_ROOM_TABLE,
          attribution: `Prepared by Trip Range using data extracted from the INE website: www.ine.es. Table 46298, series ${r.seriesId}, reference month ${r.period}. EUR converted to cents; English scope labels added. Retrieved ${snapshot.fetchedAt}.`,
          reuse:
            "CC BY 4.0; attribution and reference period required; no INE endorsement implied.",
          reuseUrl: INE_REUSE,
          sha256: snapshot.sha256,
        },
        caveat:
          "All hotel classes and room types pooled. Revenue per occupied room, not a quote for two adults or your stay dates. No adjustment to a budget-hotel rate has been made.",
      };
    });
}
