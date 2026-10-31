#!/usr/bin/env python3
"""
fetch_sider.py — henter indholdet fra hoebk.dk (klubbens Joomla-hjemmeside) til appens menu "Sider".

- Følger hjemmesidens menu (alle punkter og underpunkter) og sider der linkes til fra dem (ét niveau ned).
- Gemmer kun selve indholdet (<main>): tekst, overskrifter, lister, tabeller, billeder og links. Menuer, scripts,
  cookie-banner, formularer og indlejrede rammer (iframes) fjernes — iframes bliver til et link.
- Sammenligner med forrige kørsel: hver side får "changed" (dato for sidste ændring) og "added".
- Skriver data/sider.json. Med --once-a-day springes kørslen over, hvis siderne allerede er hentet i dag.
"""
import argparse
import hashlib
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

BASE = "https://hoebk.dk"
OUT = "data/sider.json"
SKIP = re.compile(r"/login|/component/users|option=com_users|/kalender$|\.(pdf|jpe?g|png|gif|docx?|xlsx?|zip)$", re.I)
MAX_PAGES = 150


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (HØBK-app; +https://christoffergroenfeldt-cyber.github.io/Hoebk/)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def norm(url, base=BASE + "/"):
    u = urllib.parse.urljoin(base, htmllib.unescape(url or "").strip())
    p = urllib.parse.urlsplit(u)
    if p.netloc not in ("hoebk.dk", "www.hoebk.dk"):
        return None
    path = re.sub(r"/+$", "", p.path) or "/"
    return path + (("?" + p.query) if p.query and "option=" in p.query else "")


def slug(path):
    return (path.strip("/").replace("/", "~") or "forside")[:120]


# ---------- Menu ----------
class MenuParser(HTMLParser):
    """<nav> med indlejrede <ul>/<li> → træ [{title, path, children}]."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"children": []}; self.stack = [self.root]; self.cur = None; self.grab = False; self.depth_nav = 0

    def handle_starttag(self, tag, a):
        a = {k: (v or '') for k, v in a}
        if tag == "nav":
            self.depth_nav += 1
        if not self.depth_nav:
            return
        if tag == "li":
            self.cur = {"title": "", "path": None, "children": []}
            self.stack[-1]["children"].append(self.cur)
        elif tag == "ul" and self.cur is not None and self.stack[-1] is not self.cur:
            self.stack.append(self.cur)
        elif tag in ("a", "span", "button") and self.cur is not None and not self.cur["title"]:
            if tag == "a":
                self.cur["path"] = norm(a.get("href"))
            self.grab = True

    def handle_endtag(self, tag):
        if tag == "nav":
            self.depth_nav = max(0, self.depth_nav - 1)
        elif tag == "ul" and len(self.stack) > 1 and self.depth_nav:
            self.cur = self.stack.pop()
        elif tag in ("a", "span", "button"):
            self.grab = False

    def handle_data(self, d):
        if self.grab and self.cur is not None and d.strip():
            self.cur["title"] = (self.cur["title"] + " " + d.strip()).strip()


# ---------- Rensning af indhold ----------
ALLOWED = {"p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "b", "em", "i", "u", "blockquote", "hr",
           "table", "thead", "tbody", "tr", "th", "td", "a", "img", "div", "figure", "figcaption", "small", "sup", "sub"}
DROP_WITH_CONTENT = {"script", "style", "noscript", "form", "button", "select", "textarea", "svg", "nav", "template", "head"}
VOID = {"br", "hr", "img"}


class Clean(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=False)
        self.base = base; self.out = []; self.skip = 0; self.links = set()

    def handle_starttag(self, tag, attrs):
        a = {k: (v or '') for k, v in attrs}   # attributter uden værdi giver None
        if self.skip:
            if tag in DROP_WITH_CONTENT:
                self.skip += 1
            return
        if tag in DROP_WITH_CONTENT or "cookie" in (a.get("id", "") + a.get("class", "")).lower():
            self.skip = 1
            return
        if tag == "iframe":
            src = a.get("src") or a.get("data-src") or ""
            if src.startswith("http"):
                self.out.append('<p><a href="%s" target="_blank" rel="noopener">Åbn indlejret indhold ↗</a></p>' % htmllib.escape(src, True))
            return
        if tag not in ALLOWED:
            return
        keep = ""
        if tag == "a":
            href = urllib.parse.urljoin(self.base, htmllib.unescape(a.get("href", "")).strip())
            if not re.match(r"^(https?:|mailto:|tel:)", href):
                return self.out.append("<a>")
            p = norm(href, self.base)
            if p and not SKIP.search(p):
                self.links.add(p)
                keep = ' href="#/side/%s" data-side="1"' % htmllib.escape(slug(p), True)
            else:
                keep = ' href="%s" target="_blank" rel="noopener"' % htmllib.escape(href, True)
        elif tag == "img":
            src = a.get("src") or a.get("data-src") or ""
            src = urllib.parse.urljoin(self.base, htmllib.unescape(src).strip())
            if not src.startswith("https://") and not src.startswith("http://"):
                return
            keep = ' src="%s" alt="%s" loading="lazy"' % (htmllib.escape(src.replace("http://", "https://"), True), htmllib.escape(a.get("alt", ""), True))
        elif tag in ("td", "th"):
            for k in ("colspan", "rowspan"):
                if re.fullmatch(r"\d{1,2}", a.get(k, "")):
                    keep += ' %s="%s"' % (k, a[k])
        self.out.append("<%s%s%s>" % (tag, keep, " /" if tag in VOID else ""))

    def handle_endtag(self, tag):
        if self.skip:
            if tag in DROP_WITH_CONTENT:
                self.skip -= 1
            return
        if tag in ALLOWED and tag not in VOID:
            self.out.append("</%s>" % tag)

    def handle_data(self, d):
        if not self.skip:
            self.out.append(htmllib.escape(htmllib.unescape(d), False))

    def handle_entityref(self, name):
        if not self.skip:
            self.out.append("&%s;" % name)

    def handle_charref(self, name):
        if not self.skip:
            self.out.append("&#%s;" % name)


def tidy(h):
    h = re.sub(r"<(p|div|li|h\d|strong|em|span|figure)>\s*(?:&nbsp;|\s|<br />)*\s*</\1>", "", h)   # tomme elementer
    h = re.sub(r"(<br />\s*){3,}", "<br /><br />", h)
    h = re.sub(r"\s{2,}", " ", h)
    return h.strip()


def extract(page_html, url):
    m = re.search(r"<main[^>]*>(.*?)</main>", page_html, re.S | re.I)
    body = m.group(1) if m else ""
    title = ""
    t = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S) or re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S) or re.search(r"<title>(.*?)</title>", page_html, re.S)
    if t:
        title = htmllib.unescape(re.sub(r"<[^>]+>", "", t.group(1))).strip()
    c = Clean(url)
    c.feed(body)
    c.close()
    h = tidy("".join(c.out))
    text = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", h))).strip()
    return title, h, text, c.links


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once-a-day", action="store_true")
    a = ap.parse_args()
    today = datetime.now(ZoneInfo("Europe/Copenhagen")).date().isoformat()
    old = {}
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if a.once_a_day and (old.get("checked", "") or "")[:10] == today:
        print("Siderne er allerede hentet i dag.")
        return 0
    oldp = {p["id"]: p for p in old.get("pages", [])}

    home = get(BASE + "/")
    mp = MenuParser(); mp.feed(home)
    menu = mp.root["children"]
    if not menu:
        print("FEJL: menuen blev ikke fundet — beholder de gamle sider.", file=sys.stderr)
        return 0

    order, section_of, seen = [], {}, set()

    def walk(items, section):
        for it in items:
            p = it.get("path")
            sec = section or it["title"]
            if p and not SKIP.search(p) and p not in seen:
                seen.add(p); order.append(p); section_of[p] = sec
            walk(it["children"], sec)
    walk(menu, None)
    menu_paths = list(order)

    pages, queue = {}, list(order)
    while queue and len(pages) < MAX_PAGES:
        p = queue.pop(0)
        try:
            raw = home if p == "/" else get(BASE + p)
            time.sleep(0.5)
        except Exception as e:  # noqa
            print(f"ADVARSEL: {p}: {e}", file=sys.stderr)
            continue
        title, h, text, links = extract(raw, BASE + p)
        if not text:
            continue
        pages[p] = {"title": title, "html": h, "text": text}
        if p in menu_paths:     # sider der linkes til fra menusider (fx nyheder) — ét niveau ned
            for l in sorted(links):
                if l not in seen and len(seen) < MAX_PAGES:
                    seen.add(l); queue.append(l); order.append(l); section_of[l] = section_of.get(p, "Andre sider")

    def menu_out(items):
        out = []
        for it in items:
            p = it.get("path")
            out.append({"title": it["title"], "id": slug(p) if p and p in pages else None, "children": menu_out(it["children"])})
        return out

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out_pages, changed = [], 0
    for p in order:
        if p not in pages:
            continue
        pg = pages[p]
        pid = slug(p)
        hsh = hashlib.sha1(pg["text"].encode("utf-8")).hexdigest()[:12]
        prev = oldp.get(pid)
        added = prev["added"] if prev else today
        ch = prev["changed"] if prev and prev.get("hash") == hsh else today
        if not prev or prev.get("hash") != hsh:
            changed += 1
        out_pages.append({"id": pid, "url": BASE + p, "title": pg["title"] or p, "section": section_of.get(p, ""),
                          "inMenu": p in menu_paths, "html": pg["html"], "text": pg["text"][:4000],
                          "hash": hsh, "changed": ch, "added": added})
    data = {"updated": now if changed or not old else old.get("updated", now), "checked": today + "T" + now[11:],
            "source": BASE, "menu": menu_out(menu), "pages": out_pages}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"Sider: {len(out_pages)} hentet, {changed} nye/ændrede siden sidst → {OUT}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        import traceback
        tb = traceback.format_exc()
        print("::error title=fetch_sider::" + tb.replace("\n", " ⏎ ")[-1500:])
        raise
