"""Build a complete candidate in an empty private directory, without contacting providers."""
import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DRAFT = ROOT / "docs/content/resource-launch"
PIN = json.loads((DRAFT / "public-evidence-file-manifest.json").read_text())
SCHEMA_REVISION = "2f31b04a8ed05ca619cd28fd850bc77c660bbd30"
LIMIT = "The public files let you inspect the method and check the published summaries. Recalculating the medians or rerunning the selection requires the private retained fare records, which are not included."
FOLDERS = ("coverage", "prices", "weighting")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dump(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


def git_bytes(revision, path):
    return subprocess.check_output(["git", "show", f"{revision}:{path}"], cwd=ROOT)


def mime(name):
    if name.endswith(".gz"):
        return "application/gzip"
    if name.endswith(".csv"):
        return "text/csv; charset=utf-8"
    if name.endswith(".json"):
        return "application/json"
    return "text/plain; charset=utf-8"


def source_files(entries, base):
    sources = {}
    for row in entries:
        if row.get("sourcePath"):
            data = (git_bytes(row["sourceRevision"], row["sourcePath"]) if "sourceRevision" in row
                    else (ROOT / row["sourcePath"]).read_bytes())
            if digest(data) != row["sourceSha256"] or len(data) != row["sourceBytes"]:
                raise ValueError("Source pin mismatch: " + row["sourcePath"])
            sources[row["publicPath"].removeprefix(base)] = data
    return sources


def coverage(files):
    cohorts = list(csv.DictReader(io.StringIO(files["coverage/cohort-results.csv"].decode())))
    keys = ("origin", "travel_month", "duration")
    def key(row):
        return tuple(row[k] for k in keys)
    destinations = defaultdict(set)
    for row in csv.DictReader(io.StringIO(files["coverage/destination-results.csv"].decode())):
        destinations[key(row)].add(row["destination_key"])
    audit = json.loads(files["coverage/gate-export.json"])[0]["audit"]
    from_json = defaultdict(set)
    for row in audit["current_destinations"]:
        from_json[key(row)].add(row["destination_key"])
    if from_json != destinations or set(destinations) - {key(row) for row in cohorts}:
        raise ValueError("Retained destination rows disagree")
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow([*keys,"destinations"])
    for row in cohorts:
        count = len(destinations[key(row)])
        if count != int(row["destinations"]):
            raise ValueError(f"Retained count mismatch: {key(row)}")
        writer.writerow([*key(row),count])
    files["coverage/destination-results.csv"] = buf.getvalue().encode()
    columns = list(cohorts[0])
    files["coverage/gate-export.json"] = dump([{"audit":{
        "metadata":audit["metadata"],
        "current_gate":[{field: row[field] for field in columns} for row in audit["current_gate"]]
    }}])


def schema():
    definitions = []
    for migration, pattern in [
        ("0001_fare_store",r"^create table (?:fare_fetches|fare_observations) \(.*?^\);"),
        ("0003_fetch_outcome",r"^alter table fare_fetches\n.*? stored;"),
        ("0004_warm_attempts",r"^create table warm_attempts \(.*?^\);"),
    ]:
        sql = git_bytes(SCHEMA_REVISION,f"db/migrations/{migration}.sql").decode()
        definitions.extend(re.findall(pattern,sql,re.M|re.S))
    if len(definitions) != 4:
        raise ValueError("Unexpected historical schema")
    return ("\n\n".join(definitions)+"\n").encode()


def prepare_fare(files):
    coverage(files)
    for group in FOLDERS:
        name = group + "/verification.json"
        old = json.loads(files[name])
        hashes = old.get("files",old.get("hashes"))
        omitted = []
        for key in ("README.md","terms-review.md"):
            if key in hashes:
                omitted.append({"name":key,"reason":"Internal source document, outside the public package."})
                del hashes[key]
        old["recordType"] = "Historical analytical verification. Hashes describe the original analytical inputs, including inputs subsequently projected for publication."
        old["omittedInternalFiles"] = omitted
        files[name] = dump(old)
    for name in ("data-dictionary.md","methods.md","verify-aggregates.py"):
        files[name] = (HERE/name).read_bytes()
    files["source-schema.sql"] = schema()


def describe(name, data, base, rows):
    source = rows.get(name,{})
    row = {"path":base+name,"format":Path(name).suffix.lstrip(".") or "text","contentType":mime(name),
           "bytes":len(data),"sha256":digest(data),"transformation":source.get("buildAction","generated")}
    for k in ("sourceRevision","sourcePath","sourceBytes","sourceSha256","role"):
        if k in source:
            row[k]=source[k]
    row["purpose"] = source.get("purpose") or purpose(name)
    return row


def purpose(name):
    name = name.split("/")
    label = name[-1].split(".")[0].replace("-"," ")
    if name[0] in FOLDERS:
        return f"{name[0].capitalize()} analysis: {label}."
    return label.capitalize()


def verify_municipal(data):
    rows = list(csv.DictReader(io.StringIO(data.decode())))
    targets = {}
    for design in ("domestic", "foreign"):
        targets[design] = {(r["country"],r["code"],r["month"]) for r in rows if r["design"] == design}
    if len(rows) != 2874 or len(targets["domestic"]) != 1437 or targets["domestic"] != targets["foreign"]:
        raise ValueError("Unexpected municipal holdouts")
    for design,country,n,scaled,baseline in [
        ("domestic","ES",1209,171,171), ("domestic","FI",228,167,167),
        ("foreign","ES",1209,692,429), ("foreign","FI",228,10,18)
    ]:
        group = [r for r in rows if (r["design"],r["country"]) == (design,country)]
        hits = [sum(abs(float(r[key])) <= 25 for r in group) for key in ("scaled_error_pct","unscaled_error_pct")]
        if (len(group), *hits) != (n,scaled,baseline):
            raise ValueError("Headline or denominator differs: "+design+" "+country)
        if design == "domestic" and any(r["scaled_eur"] != r["unscaled_eur"] for r in group):
            raise ValueError("Different domestic predictions")
    example = {r["month"]:round(float(r["scaled_error_pct"])) for r in rows
               if r["design"] == "domestic" and r["municipality"] == "Rovaniemi"}
    if (example["2025M06"],example["2025M12"]) != (43,-74):
        raise ValueError("Seasonal comparison differs")
    return ["1437 shared targets, 2874 predictions, both baselines and seasonal example verified."]


def package(stage, group, base, stamp, published):
    rows = {r["publicPath"].removeprefix(base):r for r in PIN[group]}
    files = source_files(PIN[group], base)
    fare = group == "fareFiles"
    if fare:
        prepare_fare(files)
    path = stage/base.strip("/")
    for name,data in files.items():
        (path/name).parent.mkdir(parents=True,exist_ok=True)
        (path/name).write_bytes(data)
    if fare:
        checks = [subprocess.check_output([sys.executable,"verify-aggregates.py"],cwd=path,text=True).strip()]
    else:
        files["results.txt"] = subprocess.check_output(
            [sys.executable, "analyze.py", "--predictions", "predictions.csv"], cwd=path)
        files["predictions.csv"] = (path/"predictions.csv").read_bytes()
        (path/"results.txt").write_bytes(files["results.txt"])
        checks = verify_municipal(files["predictions.csv"])
    records = [describe(n,d,base,rows) for n,d in sorted(files.items())]
    source_map = {r["path"]:{"sourceSha256":r.get("sourceSha256"),"publishedSha256":r["sha256"]} for r in records}
    limits = LIMIT if fare else "Achieved municipal rates for 2025. Hotel class, location within a municipality and booking lead are uncontrolled."
    verification = {"tool":"Trip Range evidence packager v1","checkedAt":stamp,"scope":"offline packaging and retained checks","result":"passed","checks":checks,"limits":limits,"files":source_map}
    files["verification.json"] = dump(verification)
    records.append(describe("verification.json",files["verification.json"],base,rows))
    manifest = {"id":base.removeprefix("/data/").removesuffix("/files/"),"version":"v1","publisher":"Trip Range","publishedAt":published,"packagedAt":stamp,"status":"publication package" if published else "unpublished candidate","limits":limits,"files":records}
    if fare:
        manifest.update(evidenceCutoff="2026-11-05T14:55:28.867230Z",sourceCredit="Aviasales",rightsDecision="7 November 2026, ticket 255231. Aggregate summaries, counts and method only.")
    else:
        manifest.update(referenceYear=2025, accessed="2026-11-11",
                        attribution=base+"sources/README.md",
                        sourceCredit="Instituto Nacional de Estadística (INE), Statistics Finland and Eurostat. Calculations by Trip Range.",
                        reuse="INE and Statistics Finland municipal data and Trip Range calculations: CC BY 4.0. Eurostat indices: Eurostat statistical reuse terms.")
    files["manifest.json"] = dump(manifest)
    files["SHA256SUMS"] = "".join(f"{digest(d)}  {n}\n" for n,d in sorted(files.items())).encode()
    if set(rows) != set(files):
        raise ValueError("Package differs from allowlist")
    for name in ("verification.json","manifest.json","SHA256SUMS"):
        (path/name).write_bytes(files[name])
    return [describe(n,d,base,rows) for n,d in sorted(files.items())]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output",type=Path)
    parser.add_argument("--published-at",help="UTC timestamp of authorised publication; omit for a candidate")
    args = parser.parse_args()
    out = args.output.resolve()
    if out.exists():
        parser.error("Use a fresh directory; immutable packages are never overwritten.")
    if ROOT/"public" in (out,*out.parents):
        parser.error("Evidence is served through the versioned allowlist; use private build storage.")
    stamp = datetime.now(timezone.utc).isoformat()
    if args.published_at:
        parsed = datetime.fromisoformat(args.published_at.replace("Z","+00:00"))
        if parsed.utcoffset() != timezone.utc.utcoffset(None):
            parser.error("Publication time must include UTC offset")
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as temp:
        stage = Path(temp)/"bundle"
        items = []
        for group, base in [("fareFiles", PIN["fareReleaseBase"]), ("municipalFiles", PIN["municipalReleaseBase"])]:
            items.extend(package(stage, group, base, stamp, args.published_at))
        (stage/"delivery.json").write_bytes(dump({"files":items,"publishedAt":args.published_at}))
        subprocess.run(["node",str(HERE/"render.mjs"),str(stage)],cwd=ROOT,check=True)
        subprocess.run([sys.executable,str(HERE/"verify-delivery.py"),str(stage)],check=True)
        stage.rename(out)
    print(f"{len(items)} evidence files in {out}")


if __name__ == "__main__":
    main()
