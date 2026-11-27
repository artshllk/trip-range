#!/usr/bin/env node
// Offline converter: a Eurostat prc_ppp_ind_1 JSON-stat 2.0 response, saved by a
// person from the dissemination API, → the snapshot shape in src/domain/costs/eurostat.ts.
// No network. Output is reviewStatus "pending" until someone approves the diff.
//
//   curl -o pli.json "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_ppp_ind_1?format=JSON&lang=EN&indic_ppp=PLI_EU27_2020&ppp_cat18=A0111"
//   npm run snapshot:eurostat -- --pli pli.json --retrieved 2026-12-18 > snapshot.json
//
// Dimension names verified against a live response on 2026-11-04:
//   prc_ppp_ind_1: freq, indic_ppp, ppp_cat18, geo, time (annual)
// No HICP: the roll-forward was dropped (owner decision 2026-11-04).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/";
// OECD-computed rows: never reused (spec, "Reuse terms").
const FORBIDDEN = new Set(["UK", "US", "JP"]);

/** Every non-missing cell as { <dimension>: code, value, status }. */
export function decodeJsonStat(d) {
  if (
    d?.version !== "2.0" ||
    d.class !== "dataset" ||
    !Array.isArray(d.id) ||
    !Array.isArray(d.size)
  )
    throw Error("Expected a JSON-stat 2.0 dataset.");
  const codes = d.id.map((name) => {
    const index = d.dimension?.[name]?.category?.index;
    const list = Array.isArray(index)
      ? index
      : Object.entries(index ?? {})
          .sort((a, b) => a[1] - b[1])
          .map(([code]) => code);
    if (!list.length) throw Error(`Dimension ${name} has no categories.`);
    return list;
  });
  if (codes.some((list, i) => list.length !== d.size[i]))
    throw Error("Dimension sizes disagree.");
  const values = Array.isArray(d.value)
    ? Object.fromEntries(d.value.map((v, i) => [i, v]))
    : (d.value ?? {});
  const rows = [];
  for (const [flat, value] of Object.entries(values)) {
    if (value === null) continue;
    let rest = Number(flat);
    const row = {};
    for (let i = d.id.length - 1; i >= 0; i--) {
      row[d.id[i]] = codes[i][rest % d.size[i]];
      rest = Math.floor(rest / d.size[i]);
    }
    rows.push({ ...row, value, status: d.status?.[flat] ?? null });
  }
  return rows;
}
const updatedDate = (d) => {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(d?.updated ?? "");
  if (!m) throw Error("Response has no 'updated' timestamp.");
  return m[1];
};
const need = (d, names) => {
  for (const n of names)
    if (!d.id.includes(n))
      throw Error(`Missing dimension ${n}; not a ${names.join("/")} response.`);
};

export function priceLevelSnapshot(d, { retrievedAt }) {
  need(d, ["indic_ppp", "ppp_cat18", "geo", "time"]);
  const values = decodeJsonStat(d)
    .filter(
      (r) =>
        r.indic_ppp === "PLI_EU27_2020" &&
        r.ppp_cat18 === "A0111" &&
        !FORBIDDEN.has(r.geo),
    )
    .map((r) => ({
      geo: r.geo,
      year: Number(r.time),
      value: r.value,
      ...(r.status === "p" ? { provisional: true } : {}),
    }))
    .sort((a, b) => a.geo.localeCompare(b.geo) || a.year - b.year);
  if (!values.length)
    throw Error("No PLI_EU27_2020 × A0111 values in this response.");
  return {
    dataset: "prc_ppp_ind_1",
    indicator: "PLI_EU27_2020",
    category: "A0111",
    updated: updatedDate(d),
    retrievedAt,
    sourceUrl: API + "prc_ppp_ind_1",
    reviewStatus: "pending",
    values,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const arg = (name) => {
      const i = process.argv.indexOf(name);
      return i > 0 ? process.argv[i + 1] : undefined;
    };
    const pli = arg("--pli"),
      retrievedAt = arg("--retrieved");
    if (!pli || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt ?? ""))
      throw Error("Usage: --pli <prc_ppp_ind_1.json> --retrieved YYYY-MM-DD");
    const out = {
      priceLevels: priceLevelSnapshot(JSON.parse(readFileSync(pli, "utf8")), {
        retrievedAt,
      }),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
