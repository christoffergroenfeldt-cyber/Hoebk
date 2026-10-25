#!/usr/bin/env python3
"""
discover_turneringer.py — engangs-undersøgelse af badmintonplayer.dk's turneringsdel.
Gemmer rå sider i diag/ så parseren til individuelle turneringer kan skrives mod rigtig HTML.

Henter:
  - web servicens metodeliste (WebService1.asmx/js) — viser hvilke funktioner siden kalder
  - alle /DBF/Turnering/...-sider der linkes til fra menuen, og deres scripts
Kontaktoplysninger (mail/telefon) og spillernumre maskeres før noget gemmes.
"""
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_holdkampe as f  # genbruger http(), cookies og headers

OUT = "diag"
MASK = [(re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "[EMAIL]"),
        (re.compile(r"(?<!\d)(?:\+45\s?)?(?:\d{2}\s?){3}\d{2}(?!\d)"), "[TLF]"),
        (re.compile(r"\b\d{6}-\d{2}\b"), "[SPILLERNR]"),
        (re.compile(r'(name="__[A-Z]+"[^>]*value=")[^"]*'), r"\1[STRIPPED]")]


def save(name, text):
    for rx, rep in MASK:
        text = rx.sub(rep, text)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"  gemt {name} ({len(text)} tegn)")


def get(url):
    try:
        status, final, body = f.http(url, extra_headers={"Accept": "text/html,*/*"})
        return final, body
    except Exception as e:  # noqa
        print(f"  FEJL {url}: {e}")
        return url, ""


def main():
    final, start = get(f.TOKEN_PAGE)
    save("start_holdturnering.html", start)
    _, js = get(f.BASE + "/SportsResults/Components/WebService1.asmx/js")
    save("webservice1_asmx.js", js)
    methods = sorted(set(re.findall(r"(\w+)\s*:\s*function\s*\(", js)))
    print("Metoder i WebService1:", ", ".join(methods))
    save("webservice1_methods.txt", "\n".join(methods))

    links = set()
    for href in re.findall(r'href="([^"]+)"', start):
        if re.search(r"/Turnering|Kalender|Turneringer", href, re.I) and "HoldTurnering" not in href:
            links.add(urllib.parse.urljoin(final, href.split("#")[0]))
    for extra in ["/DBF/Turnering/", "/DBF/Turnering/Turneringskalender/", "/DBF/Turnering/VisTurnering/"]:
        links.add(f.BASE + extra)
    print("Turnering-sider:", sorted(links))
    for i, url in enumerate(sorted(links)):
        final_u, body = get(url)
        if not body:
            continue
        slug = re.sub(r"[^a-z0-9]+", "_", urllib.parse.urlparse(final_u).path.lower()).strip("_")[:60] or "root"
        save(f"page_{i:02d}_{slug}.html", body)
        for src in re.findall(r'<script[^>]+src="([^"]+)"', body):
            if re.search(r"turner|tournament|sportsresult|calendar|kalender", src, re.I):
                s_url = urllib.parse.urljoin(final_u, src)
                _, sjs = get(s_url)
                if sjs:
                    save("script_" + re.sub(r"[^a-z0-9]+", "_", src.lower())[-60:] + ".js", sjs)


if __name__ == "__main__":
    main()
