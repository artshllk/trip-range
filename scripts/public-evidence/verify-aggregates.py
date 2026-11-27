"""Check the published tables offline. Run: python3 verify-aggregates.py"""
import csv
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIELDS = ("origin", "travel_month", "duration")


def check(ok, message):
    if not ok:
        raise ValueError(message)


def read(path):
    with (ROOT / path).open(encoding="utf-8", newline="") as handle:
        if path.endswith(".csv"):
            return list(csv.DictReader(handle))
        return json.load(handle, parse_float=Decimal)


def key(row):
    return tuple(row[field] for field in FIELDS)


def index(rows, expected):
    result = {key(row): row for row in rows}
    check(len(rows) == len(result) == expected, "Missing or duplicate cohorts")
    return result


def normalize(value):
    if value in ("", None):
        return None
    if str(value).lower() in ("true", "false"):
        return str(value).lower()
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return value


def compare(rows, reference, columns=None):
    check(set(rows) == set(reference), "Different cohort keys")
    for k, row in rows.items():
        other = reference[k]
        fields = columns or row.keys()
        for name in fields:
            check(normalize(row[name]) == normalize(other[name]), f"{k}: {name}")


def main():
    cov = index(read("coverage/cohort-results.csv"), 306)
    audit = read("coverage/gate-export.json")[0]["audit"]
    check(set(audit) == {"metadata", "current_gate"}, "Unexpected coverage structure")
    compare(cov, index(audit["current_gate"], 306))
    counts = index(read("coverage/destination-results.csv"), 306)
    compare(counts, cov)
    months = [f"2026-{m}" for m in (11, 12)] + [f"2027-0{m}" for m in range(1, 5)]
    durations = [f"exact-{i}" for i in range(1, 15)] + ["broad-1-14", "short-2-4", "week-6-8"]
    check(set(cov) == {(o, m, d) for o in ("TIA","PRN","SKP") for m in months for d in durations}, "Wrong coverage grid")
    verification = {(r["origin"], r["travel_month"]): r for r in read("coverage/verification-query-results.json")}
    for (o, m, d), row in cov.items():
        for field in ("destinations", "distinct_fares", "distinct_sightings", "distinct_departure_dates"):
            parents = ["broad-1-14"]
            if d in ("exact-2","exact-3","exact-4"):
                parents.append("short-2-4")
            if d in ("exact-6","exact-7","exact-8"):
                parents.append("week-6-8")
            for parent in parents:
                check(0 <= int(row[field]) <= int(cov[o,m,parent][field]), f"{o}/{m}/{d}: {field} bound")
        if d == "short-2-4":
            previous = verification.get((o,m), {})
            for a,b in (("destinations","destinations"),("distinct_fares","distinct_fares"),("destinations_3_fares_3_dates","qualifying_destinations")):
                check(int(row[a]) == previous.get(b,0), f"Independent count {o}/{m}/{a}")
    prices = index(read("prices/price-summary.json")["cohorts"],12)
    compare(index(read("prices/price-summary.csv"),12), prices)
    compare(index(read("prices/independent-price-check.json")["rows"],12),prices)
    weights = index(read("weighting/destination-weighting.json")["cohorts"],6)
    compare(index(read("weighting/destination-weighting.csv"),6),weights)
    compare(index(read("weighting/independent-weighting-check.json")["rows"],6),weights)
    for k,r in prices.items():
        bands = ["under_50","from_50_under_100","from_100_under_200","from_200_under_400","at_least_400"]
        check(sum(r[b] for b in bands) == r["distinct_fares"], f"{k}: histogram")
        qs = [r[b] for b in ("min_eur","p25_eur","median_eur","p75_eur","max_eur")]
        check(sorted(qs) == qs, f"{k}: quantile order")
        for field in ("distinct_fares","destinations"):
            check(r[field] == int(cov[k][field]), f"{k}: coverage total")
        check(r["departure_dates"] == int(cov[k]["distinct_departure_dates"]), f"{k}: dates")
    for k,r in weights.items():
        check(r["fare_record_median_eur"] == prices[k]["median_eur"] and all(r[f] == prices[k][f] for f in ("distinct_fares","destinations")), f"{k}: weighting")
    expected = {("TIA","2026-11"):(38,19,50,95),("PRN","2026-11"):(8,3,63,167),("SKP","2026-11"):(17,4,76,139),
                ("TIA","2026-12"):(32,22,31,Decimal("89.50")),("PRN","2026-12"):(8,4,50,Decimal("194.50")),("SKP","2026-12"):(8,5,38,153)}
    reductions = read("weighting/coverage-reductions.json")["cells"]
    check(len(reductions) == len(expected) and {(r["origin"],r["travel_month"]) for r in reductions} == set(expected), "Reduction grid")
    for r in reductions:
        o,m = r["origin"],r["travel_month"]
        broad,exact,percent,median = expected[o,m]
        delta = Decimal(100)*(broad-exact)/broad
        check((int(cov[o,m,"short-2-4"]["destinations"]), int(cov[o,m,"exact-2"]["destinations"])) == (broad,exact), "Study counts")
        check((r["destinations_2_to_4_nights"],r["destinations_exactly_2_nights"],r["destinations_removed"]) == (broad,exact,broad-exact), "Reduction counts")
        check(delta.quantize(Decimal(".000001"),rounding=ROUND_HALF_UP) == Decimal(r["reduction_percent"]) and delta.quantize(Decimal(1),rounding=ROUND_HALF_UP) == percent == r["reduction_percent_display"], "Reduction rounding")
        check(weights[o,m,"exact-2"]["destination_median_eur"] == median, "Destination-weighted median")
    for origin,stay,n,median,low,high in [("TIA","short-2-4",91,92,31,718),("TIA","exact-2",35,54,32,164),("PRN","short-2-4",20,130,85,206),("PRN","exact-2",3,167,85,203),("SKP","short-2-4",24,173,71,417),("SKP","exact-2",4,139,101,180)]:
        row = prices[origin,"2026-11",stay]
        check(tuple(row[f] for f in ("distinct_fares","median_eur","min_eur","max_eur")) == (n,median,low,high), "Published price table")
    example = prices["TIA","2026-11","exact-2"]
    check([example[f] for f in ("under_50","from_50_under_100","from_100_under_200","from_200_under_400","at_least_400","p25_eur","p75_eur")] == [15,7,13,0,0,41,110], "Tirana published bands and quartiles")
    check(weights["TIA","2026-11","exact-2"]["difference_eur"] == 41, "Tirana weighting difference")
    check(read("coverage/parameters.json") == read("prices/parameters.json") == read("weighting/parameters.json"), "Replay parameters")
    print("PASS: 306 coverage cells, 12 price cohorts, 6 weighting cohorts and 6 reductions. This check does not recompute medians from original fares.")


if __name__ == "__main__":
    main()
