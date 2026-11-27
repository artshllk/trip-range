"""Verify frozen bytes and anonymous HTTP delivery. No credentials, redirects or cookies."""
import argparse
import gzip
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE.parents[1]/"docs/content/resource-launch/public-evidence-file-manifest.json").read_text())
PAGES = {"/data":{"citation-and-corrections"}, "/methodology":{"which-fares-count","room-measurement"},
         "/data/fare-coverage/2026-11-05-v1":{"what-we-count","coverage-methods","price-methods","weighting-methods"},
         "/data/municipal-hotel-scaling/2025-v1":{"one-city-in-two-seasons","how-often-the-capital-was-close","sources-and-citation"}}
STUDIES = {("fareFiles", "/data/fare-coverage/2026-11-05-v1/files/", 32),
           ("municipalFiles", "/data/municipal-hotel-scaling/2025-v1/files/", 10)}


def require(ok,msg):
    if not ok:
        raise ValueError(msg)


def check_public_content(data, path):
    private_content = rb"Art Shllaku B\.I\.|Rruga Halit Asllani|812102078|github\.com/artshllk/goeksplo|[?&](?:access_token|api[_-]?key|token)="
    held = rb"room-panel-v8|room-panel-protocol|room-observation-round|in-lombardia|in-lombardia.it|istanbul-union|WienTourismus|Paris je t.aime|Paris tourism office|Business Hotel Barometer|HIT-CDS|\bMKG\b|3[ -]of[ -]6"
    require(not re.search(held, data, re.I), "Held material in "+path)
    require(not re.search(private_content, data, re.I), "Private content in " + path)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


class Anchors(HTMLParser):
    def __init__(self,html):
        super().__init__()
        self.ids=set()
        self.links=set()
        self.feed(html)

    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if "id" in attrs:
            require(attrs["id"] not in self.ids, "Duplicate fragment "+attrs["id"])
            self.ids.add(attrs["id"])
        if tag=="a" and attrs.get("href"):
            self.links.add(attrs["href"])


def offline(bundle):
    rows = {r["path"]:r for r in load(bundle/"delivery.json")["files"]}
    hashes = {}
    allowed=set()
    for group,base,count in STUDIES:
        require(len(PINS[group])==count and all(r["publicPath"].startswith(base) for r in PINS[group]), "Wrong launch pins "+base)
        allowed.update(r["publicPath"] for r in PINS[group])
        names={r["publicPath"].removeprefix(base) for r in PINS[group]}
        folder=bundle/base.lstrip("/")
        require({p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()}==names, "Wrong file inventory "+base)
        sums = {name:checksum for checksum,name in (line.split("  ",1) for line in (folder/"SHA256SUMS").read_text().splitlines())}
        require(set(sums)==names-{"SHA256SUMS"},"Incorrect checksum scope")
        manifest=load(folder/"manifest.json")
        hashes[base]=sha((folder/"manifest.json").read_bytes())
        published={r["path"]:r for r in manifest["files"]}
        require(set(published)=={base+n for n in names-{"manifest.json","SHA256SUMS"}},"Manifest scope")
        checks=load(folder/"verification.json")["files"]
        require(set(checks)==set(published)-{base+"verification.json"},"Verification scope")
        for pin in PINS[group]:
            name=pin["publicPath"].removeprefix(base)
            data=(folder/name).read_bytes()
            check_public_content(gzip.decompress(data) if name.endswith(".gz") else data, base+name)
            row=rows[base+name]
            require(len(data)==row["bytes"] and sha(data)==row["sha256"],row["path"])
            if name in sums:
                require(sums[name]==sha(data),name+" checksum")
            if row["path"] in published:
                require(published[row["path"]]==row,name+" manifest metadata")
            if pin.get("sourceSha256"):
                require(row["sourceSha256"]==pin["sourceSha256"],name+" source pin")
            if pin["buildAction"]=="copy_exact_after_reuse_review":
                require(sha(data)==pin["sourceSha256"],name+" copied bytes")
            if name.endswith(".md"):
                for link in re.findall(r"\[[^\]]*\]\(([^)\s]+)\)",data.decode()):
                    require("github.com/artshllk/goeksplo" not in link and not link.startswith("/en/"),name+" private link")
                    if not urlsplit(link).scheme:
                        require(urlsplit(urljoin(base+name,link)).path in rows,name+" unresolved "+link)
            if row["path"] in checks:
                require(checks[row["path"]]=={"sourceSha256":row.get("sourceSha256"),"publishedSha256":sha(data)},name+" verification map")
    require(set(rows)==allowed and len(load(bundle/"delivery.json")["files"])==len(allowed), "Unexpected delivery manifest")
    inventory = {p.relative_to(bundle).as_posix() for p in bundle.rglob("*") if p.is_file()}
    expected = {s.lstrip("/") for s in allowed} | {"delivery.json", "pages/catalogue-before-acceptance.html"} | {"pages"+p+".html" for p in PAGES}
    require(inventory == expected, "Unexpected file in sealed bundle: "+str(inventory ^ expected))
    check_public_content((bundle/"delivery.json").read_bytes(), "delivery.json")
    check_public_content((bundle/"pages/catalogue-before-acceptance.html").read_bytes(), "unlisted catalogue")
    html={p:(bundle/"pages"/(p[1:]+".html")).read_text() for p in PAGES}
    for page, body in html.items():
        check_public_content(body.encode(), page)
    parsed={p:Anchors(h) for p,h in html.items()}
    links=set()
    for page,anchors in parsed.items():
        require(PAGES[page]<=anchors.ids,page+" missing required fragments")
        for ref in anchors.links:
            target=urlsplit(urljoin("https://www.trip-range.com"+page,ref))
            require(not target.netloc.endswith("github.com") or not target.path.startswith("/artshllk/goeksplo"),"Private evidence link "+ref)
            if target.netloc!="www.trip-range.com":
                continue
            require(not target.path.startswith("/en/"),"Locale-prefixed reference "+ref)
            if target.path in parsed and target.fragment:
                require(target.fragment in parsed[target.path].ids,"Broken fragment "+ref)
            if target.path.startswith("/data/"):
                require(target.path in rows or target.path in parsed,"Missing resource "+ref)
            links.add(target.path)
    for page in (p for p in PAGES if p.startswith("/data/")):
        expected_study = {r for r in allowed if r.startswith(page+"/files/")}
        require(expected_study <= parsed[page].links, "Study omits downloads: "+page)
        require(page in parsed["/data"].links, "Catalogue omits study: "+page)
    return rows,hashes,html,links


def retained_versions(previous, current):
    prior = load(previous/"delivery.json")
    require(prior["publishedAt"],"Compare against a sealed prior release")
    for row in prior["files"]:
        path = current/row["path"].lstrip("/")
        require(path.is_file() and sha(path.read_bytes()) == row["sha256"], "A historical file changed: "+row["path"])
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args):
        return None


def remote(origin,bundle,report,listed):
    rows,hashes,pages,links=offline(bundle)
    report["manifestHashes"]=hashes
    if load(bundle/"delivery.json")["publishedAt"] and not listed:
        pages["/data"]=(bundle/"pages/catalogue-before-acceptance.html").read_text()
    http=build_opener(NoRedirect())
    def fetch(path,method,status=200):
        url=origin+path
        try:
            response=http.open(Request(url,method=method,headers={"Accept-Encoding":"gzip"}),timeout=30)
        except HTTPError as error:
            response=error
        with response:
            report["requests"].append({"method":method,"path":path,"status":response.status,"finalUrl":response.url,"checkedAt":datetime.now(timezone.utc).isoformat()})
            require(response.url==url and response.status==status,f"{method} {path}: {response.status}")
            data=response.read()
            if response.headers.get("Content-Encoding")=="gzip" and data:
                data=gzip.decompress(data)
            return response.headers,data
    for path,row in rows.items():
        name=path.rsplit("/",1)[1]
        disposition="attachment" if Path(name).suffix in (".csv",".py",".sql",".mjs",".gz") else "inline"
        expected={"Content-Type":row["contentType"],"Content-Disposition":f'{disposition}; filename="{name}"',
                  "Cache-Control":"public, max-age=31536000, immutable","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff",
                  "Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"Content-Disposition"}
        for method in ("GET","HEAD"):
            headers,data=fetch(path,method)
            for field,value in expected.items():
                require(headers.get(field)==value,f"{path}: {field} got {headers.get(field)}")
            require(not headers.get("Set-Cookie") and not headers.get("Access-Control-Allow-Credentials"),path+" credentials")
            if method=="GET":
                require(sha(data)==row["sha256"] and len(data)==row["bytes"],path+" response bytes")
            else:
                require(not data,path+" HEAD body")
    for path,html in pages.items():
        for method in ("GET","HEAD"):
            h,data=fetch(path,method)
            require(h.get("Content-Type")=="text/html; charset=utf-8" and not h.get("Content-Disposition"),path+" not HTML")
            require(h.get("Cache-Control")=="public, max-age=0, must-revalidate",path+" HTML cache")
            if method=="GET":
                require(data.decode()==html,path+" unexpected HTML or login screen")
    robots=fetch("/robots.txt","GET")[1].decode()
    require(not re.search(r"Disallow:\s*/(?:data|$)",robots,re.I|re.M),"File URLs cannot be blocked by robots.txt")
    from xml.etree.ElementTree import fromstring
    sitemap=fromstring(fetch("/sitemap.xml","GET")[1])
    urls={urlsplit(el.text).path or "/" for el in sitemap.findall("{*}url/{*}loc")}
    expected=load(HERE.parents[1]/"docs/content/resource-launch/publication-status.json")["urlContract"]["indexableLaunchPaths"]
    if listed:
        expected.extend(p for p in PAGES if p != "/methodology")
    require(urls==set(expected),"Unexpected launch sitemap or premature resource indexing")
    for path in sorted(links-set(rows)-set(pages)):
        fetch(path,"HEAD")
    for name in ["/data/room-panel-protocol/v8", "/data/room-panel-protocol/v8/files/manifest.json", "/data/room-panel-protocol/v8/files/method.json"]:
        fetch(name, "GET", 404)
    for root in hashes:
        fetch(root+"missing.json","GET",404)
        fetch(root+"undefined","HEAD",404)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("bundle",type=Path)
    parser.add_argument("--origin")
    parser.add_argument("--previous-bundle",type=Path)
    parser.add_argument("--report",type=Path)
    parser.add_argument("--listed",action="store_true",help="Check catalogue and sitemap after a successful, already accepted public release")
    args=parser.parse_args()
    if args.previous_bundle:
        retained_versions(args.previous_bundle,args.bundle)
    if not args.origin:
        offline(args.bundle)
        print("Allowlist, checksums, provenance, links and required fragments passed.")
    else:
        origin=urlsplit(args.origin)
        local=origin.hostname in ("localhost","127.0.0.1","::1")
        require(local or args.origin=="https://www.trip-range.com","Use the canonical production host or a local verification server")
        require(local or load(args.bundle/"delivery.json")["publishedAt"],"Public checks require the sealed publication bundle")
        report={"scope":"local candidate" if local else "anonymous public host","requests":[],"passed":False}
        try:
            remote(args.origin.rstrip("/"),args.bundle,report,args.listed)
            report["passed"]=True
        finally:
            if args.report:
                args.report.parent.mkdir(parents=True,exist_ok=True)
                args.report.write_text(json.dumps(report,indent=2)+"\n")
        print(f"{len(report['requests'])} anonymous HTTP checks passed ({report['scope']}).")
