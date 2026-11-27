import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  parseIneRooms,
  inePublishedRooms,
  type IneRoomSnapshot,
} from "../src/domain/costs/ine-spain";
import { roomEvidence } from "../src/domain/room-evidence";
import { monthPlace } from "../src/domain/month-places";
import { sameSpanishMunicipality } from "../src/domain/spain-municipalities";
import snapshot from "../content/rooms/ine-spain.json";
import download from "../public/data/room-market-context/ine-spain.json";
const raw = readFileSync(
  "public/data/room-market-context/ine-source.json",
  "utf8",
);
const payload = JSON.parse(
  readFileSync("tests/fixtures/ine/september-2026.json", "utf8"),
);
const fixtureSnapshot: IneRoomSnapshot = {
  ...snapshot,
  fetchedAt: "2026-11-20T00:00:00Z",
  observations: parseIneRooms(payload),
} as IneRoomSnapshot;
const records = inePublishedRooms(fixtureSnapshot);
const sample = () =>
  structuredClone(
    payload.find(
      (r: { Nombre: string }) =>
        r.Nombre ===
        "Madrid. Tarifa media diaria (ADR). Total categorías. Dato. ",
    ),
  );

test("national snapshot reproduces the pinned source and exposes every available municipality", () => {
  assert.deepEqual(snapshot, download);
  assert.equal(createHash("sha256").update(raw).digest("hex"), snapshot.sha256);
  assert.deepEqual(parseIneRooms(JSON.parse(raw)), snapshot.observations);
  assert.equal(fixtureSnapshot.observations.length, 107);
  assert.equal(records.length, 106);
  for (const r of records) {
    const found = roomEvidence(
      "ZZZ",
      "ES",
      "2026-11-20",
      records,
      { figures: [] },
      r.municipalityName,
    );
    assert.equal(found.kind, "published", r.municipalityName);
    if (found.kind === "published")
      assert.equal(found.roomNightCents, r.roomNightCents);
  }
});
test("Spain destinations resolve beyond the current shortlist without another feed", () => {
  for (const [code, amount] of [
    ["MAD", 21296],
    ["BCN", 20703],
    ["AGP", undefined],
    ["VLC", undefined],
    ["LCG", undefined],
    ["EAS", undefined],
    ["LPA", undefined],
  ] as const) {
    const place = monthPlace(code)!;
    assert.ok(place, code);
    const f = roomEvidence(
      code,
      place.countryCode,
      "2026-11-20",
      records,
      { figures: [] },
      place.name,
    );
    assert.equal(f.kind, "published", code);
    if (f.kind === "published" && amount)
      assert.equal(f.roomNightCents, amount);
  }
  for (const code of ["OVD", "TCI", "MAH"]) {
    const p = monthPlace(code)!;
    assert.equal(
      roomEvidence(
        code,
        p.countryCode,
        "2026-11-20",
        records,
        { figures: [] },
        p.name,
      ).kind,
      "unavailable",
    );
  }
  assert.equal(
    roomEvidence("MAD", "US", "2026-11-20", records, { figures: [] }, "Madrid")
      .kind,
    "unavailable",
  );
  assert.equal(sameSpanishMunicipality("Palma", "La Palma"), false);
  assert.equal(
    sameSpanishMunicipality("Palmas de Gran Canaria, Las", "Las Palmas"),
    true,
  );
  assert.equal(
    sameSpanishMunicipality("Donostia/San Sebastián", "San Sebastian"),
    true,
  );
});
test("missing and suppressed observations never become zero or another city's rate", () => {
  const r = sample();
  r.Data[0].Secreto = true;
  r.Data[0].Valor = 123;
  assert.equal(parseIneRooms([r])[0].roomNightCents, null);
  r.Data[0].Secreto = false;
  r.Data[0].Valor = null;
  assert.equal(parseIneRooms([r])[0].status, "missing");
  assert.equal(
    roomEvidence(
      "XXX",
      "ES",
      "2026-11-20",
      records,
      { figures: [] },
      "Villaviciosa",
    ).kind,
    "unavailable",
  );
});
test("unexpected units, scope, duplicate series, invalid months and malformed prices fail closed", () => {
  for (const mutate of [
    (r: ReturnType<typeof sample>) => {
      r.FK_Unidad = 135;
    },
    (r: ReturnType<typeof sample>) => {
      r.Nombre = r.Nombre.replace("ADR", "RevPAR");
    },
    (r: ReturnType<typeof sample>) => {
      r.Data[0].FK_Periodo = 13;
    },
    (r: ReturnType<typeof sample>) => {
      r.Data[0].Valor = "212.96";
    },
    (r: ReturnType<typeof sample>) => {
      r.Data[0].Valor = -1;
    },
    (r: ReturnType<typeof sample>) => {
      delete r.Data[0].Secreto;
    },
  ]) {
    const r = sample();
    mutate(r);
    assert.throws(() => parseIneRooms([r]));
  }
  assert.throws(() => parseIneRooms([sample(), sample()]));
  assert.throws(() => parseIneRooms([]));
});
test("refetching a stale observation does not extend its expiry or substitute it for a suppressed month", () => {
  const later = inePublishedRooms({
    ...fixtureSnapshot,
    fetchedAt: "2027-02-01T00:00:00Z",
  } as IneRoomSnapshot);
  assert.equal(
    roomEvidence("MAD", "ES", "2027-02-01", later, { figures: [] }, "Madrid")
      .kind,
    "unavailable",
  );
  const suppressed = {
    ...fixtureSnapshot,
    observations: fixtureSnapshot.observations.map((r) =>
      r.municipality === "Madrid"
        ? { ...r, status: "suppressed", roomNightCents: null }
        : r,
    ),
  } as IneRoomSnapshot;
  assert.equal(
    roomEvidence(
      "MAD",
      "ES",
      "2026-11-20",
      inePublishedRooms(suppressed),
      { figures: [] },
      "Madrid",
    ).kind,
    "unavailable",
  );
});

test("ambiguous normalized municipality matches are withheld", () => {
  const madrid = records.find((r) => r.municipalityName === "Madrid")!;
  assert.equal(
    roomEvidence(
      "MAD",
      "ES",
      "2026-11-20",
      [
        madrid,
        { ...madrid, cityCode: "ine:EOT99999", municipalityName: "Madríd" },
      ],
      { figures: [] },
      "Madrid",
    ).kind,
    "unavailable",
  );
});
