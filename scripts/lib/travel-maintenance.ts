import { destinationAccessData } from "../../content/travel/access/records";
import { fxData } from "../../content/money/fx/records";
/** Safe offline review dates, independent from editorial publication freshness. */
export function travelMaintenance(withinDays: number, now = Date.now()) {
  if (!Number.isInteger(withinDays) || withinDays < 0 || withinDays > 365)
    throw Error("invalid-days");
  const rows = [
    ...destinationAccessData.records.flatMap((p) => [
      { kind: "access", id: p.destinationSubject, reviewAfter: p.reviewAfter },
      ...(p.gateways ?? []).flatMap((g) =>
        g.onwardTransfer.pricing.kind === "unpriced"
          ? []
          : [
              {
                kind: "transfer-price",
                id: `${p.destinationSubject}:${g.airportCode}`,
                reviewAfter: g.onwardTransfer.pricing.reviewAfter,
              },
            ],
      ),
    ]),
    ...fxData.records.map((s) => ({
      kind: "fx",
      id: s.id,
      reviewAfter: s.reviewAfter,
    })),
  ];
  return rows
    .filter((r) => Date.parse(r.reviewAfter) <= now + withinDays * 86400000)
    .map((r) => ({ ...r, expired: Date.parse(r.reviewAfter) <= now }));
}
