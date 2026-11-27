"""Replay the v1 hotel frame: python extract.py CITY dated.osm.pbf output.json
Dependencies: pyosmium 4.3.0. No live geocoding or hotel-site requests.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import osmium

CENTRES = {"berlin": None}
DOWNLOADS = {"berlin": "https://download.geofabrik.de/europe/germany/berlin-261117.osm.pbf"}

TYPES = {"n": osmium.osm.NODE, "w": osmium.osm.WAY, "r": osmium.osm.RELATION}
NAMES = {"n": "node", "w": "way", "r": "relation"}

def sha256(path):
    result = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(2**20), b""):
            result.update(block)
    return result.hexdigest()

def distance(centre, lat, lon):
    a, b = map(math.radians, centre)
    c, d = map(math.radians, (lat, lon))
    h = math.sin((c-a)/2)**2 + math.cos(a)*math.cos(c)*math.sin((d-b)/2)**2
    return 2*6371008.8*math.asin(math.sqrt(h))

def element(obj):
    kind = obj.type_str()
    row = dict(type=NAMES[kind], id=obj.id, version=obj.version,
               timestamp=obj.timestamp.isoformat().replace("+00:00", "Z"))
    if obj.changeset: row["changeset"] = obj.changeset
    if kind == "n": row.update(lat=obj.location.lat, lon=obj.location.lon)
    if kind == "w": row["nodes"] = [n.ref for n in obj.nodes]
    if kind == "r": row["members"] = [dict(type=NAMES[m.type],ref=m.ref,role=m.role) for m in obj.members]
    return row

def refs(row):
    return ([("n", n) for n in row.get("nodes", [])] +
            [(m["type"][0], m["ref"]) for m in row.get("members", [])])

def descendants(key, elements):
    seen = set()
    todo = [key]
    while todo:
        item = todo.pop()
        if item in seen: continue
        seen.add(item)
        todo.extend(refs(elements[item]))
    return seen

def extract(city, pbf):
    # Pin the square footprint, never a geocoder result or railway station.
    for central in osmium.FileProcessor(str(pbf),osmium.osm.WAY).with_filter(osmium.filter.IdFilter([783052052])):
        central_row = element(central)
        central_row["tags"] = dict(central.tags)
    assert central_row["tags"].get("name") == "Alexanderplatz"
    assert central_row["tags"].get("place") == "square"
    vertices = [element(o) for o in osmium.FileProcessor(str(pbf),osmium.osm.NODE).with_filter(osmium.filter.IdFilter(central_row["nodes"]))]
    centre = tuple((min(n[f] for n in vertices)+max(n[f] for n in vertices))/2 for f in ("lat","lon"))
    centre_evidence = dict(object=central_row,vertices=vertices,coordinates=centre,rule="Bounding-box midpoint of pinned square geometry")
    elements, hotels = {}, {}
    for obj in osmium.FileProcessor(str(pbf)).with_filter(osmium.filter.TagFilter(("tourism","hotel"))):
        key = obj.type_str(), obj.id
        elements[key] = element(obj)
        hotels[key] = {k:v for k,v in dict(obj.tags).items()
                       if k in {"name","official_name","alt_name","old_name","brand","operator","tourism","website","contact:website","wikidata","ref","stars","stars:official"} or k.startswith(("name:","addr:"))}
    # Resolve nested relations before their ways, then fetch referenced vertices once.
    todo = {ref for key in hotels for ref in refs(elements[key])}
    for kind in ("r","w","n"):
        while True:
            ids = {ref for t,ref in todo if t == kind and (t,ref) not in elements}
            if not ids: break
            for obj in osmium.FileProcessor(str(pbf),TYPES[kind]).with_filter(osmium.filter.IdFilter(ids)):
                item = element(obj)
                elements[kind,obj.id] = item
                todo.update(refs(item))
            missing = ids - {i for t,i in elements if t == kind}
            if missing: raise ValueError(f"Geometry dependency missing in input: {kind} {sorted(missing)[:5]}")
    retained, rows = set(), []
    for key, tags in sorted(hotels.items()):
        geometry = descendants(key,elements)
        points = [elements[k] for k in geometry if k[0] == "n"]
        if not points: raise ValueError(f"No geometry for {key}")
        lat,lon = [(min(n[f] for n in points)+max(n[f] for n in points))/2 for f in ("lat","lon")]
        metres = distance(centre,lat,lon)
        if metres > 2000: continue
        retained.update(geometry)
        rows.append(dict(property_id=f"{city}-{key[0]}{key[1]}",osm_type=NAMES[key[0]],osm_id=key[1],
                         version=elements[key]["version"],tags=tags,latitude=lat,longitude=lon,distance_metres=metres))
    hdr=osmium.io.Reader(str(pbf)).header()
    return dict(query_version="osm-hotel-radius-v1",source_url=DOWNLOADS[city],source_sha256=sha256(pbf),
                snapshot_utc=hdr.get("osmosis_replication_timestamp"),replication_sequence=hdr.get("osmosis_replication_sequence_number"),
                attribution="© OpenStreetMap contributors; ODbL 1.0. Regional PBF from Geofabrik.",
                licence_url="https://www.openstreetmap.org/copyright",centre=centre,centre_evidence=centre_evidence,radius_metres=2000,
                filter="Every node, way and relation carrying tourism=hotel. Include unnamed objects. Use the point or bbox midpoint of all descendant vertices, Haversine R=6371008.8 m, inclusive radius. Deduplication and eligibility occur after enumeration.",
                properties=rows,elements=[elements[k] for k in sorted(retained)])

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("city",choices=CENTRES);parser.add_argument("pbf",type=Path);parser.add_argument("output",type=Path)
    args=parser.parse_args()
    frame=extract(args.city,args.pbf)
    args.output.write_text(json.dumps(frame,ensure_ascii=False,separators=(",",":"))+"\n")
    print(args.city,frame["snapshot_utc"],len(frame["properties"]),"hotel objects")
