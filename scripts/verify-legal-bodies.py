"""Check the production-rendered legal identity boundary after next build."""
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(".next/server/app")
LEGAL = {"en/privacy.html", "en/terms.html", "en/affiliate-disclosure.html"}
IDENTITY = ("Art Shllaku B.I.", "Rruga Halit Asllani pn", "812102078")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.main = False
        self.script = ""
        self.body = []
        self.outside = []
        self.robots = []
        self.publishers = []
        self.links = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "main":
            self.main = True
        if tag == "script":
            self.script = attrs.get("type") or "script"
        if tag == "a":
            self.links.add(attrs.get("href"))
        if tag == "meta" and attrs.get("name") == "publisher":
            self.publishers.append(attrs.get("content"))
        if tag == "meta" and attrs.get("name") in ("robots", "googlebot"):
            self.robots.append(attrs.get("content", ""))
        self.outside.extend(value for value in attrs.values() if value)

    def handle_endtag(self, tag):
        if tag == "main":
            self.main = False
        elif tag == "script":
            self.script = ""

    def handle_data(self, text):
        if self.script == "application/ld+json" or not self.script and not self.main:
            self.outside.append(text)
        elif self.main and not self.script:
            self.body.append(text)


seen = set()
for file in ROOT.rglob("*.html"):
    page = Page()
    html = file.read_text()
    page.feed(html)
    name = file.relative_to(ROOT).as_posix()
    if name in LEGAL:
        seen.add(name)
        body = " ".join(" ".join(page.body).split())
        if not all(item in body for item in (*IDENTITY, "Gjakovë, Kosovo", "hello@trip-range.com", "Art Shllaku")):
            raise ValueError(f"{name}: incomplete operator details")
        if any(item in " ".join(page.outside) for item in IDENTITY) or not any("noindex" in rule for rule in page.robots):
            raise ValueError(f"{name}: identity outside legal body or missing noindex")
    elif any(item in html for item in IDENTITY):
        raise ValueError(f"{name}: identity leak")
    if name.startswith("en/") and page.publishers != ["Trip Range"]:
        raise ValueError(f"{name}: missing Trip Range publisher credit")
    if name in LEGAL or name == "en/about.html":
        if not {"/privacy", "/terms", "/affiliate-disclosure"} <= page.links:
            raise ValueError(f"{name}: missing legal navigation")
if seen != LEGAL:
    raise ValueError(f"Missing legal pages: {LEGAL - seen}")
print("All three rendered legal bodies, noindex, navigation and site-wide identity checks passed.")
