#!/usr/bin/env python3
"""discover_spillere.py — undersøger badmintonplayer.dk's ranglister for at finde alle spillere i en klub.
Gemmer sider og script-uddrag (maskeret) i diag/ til parser-arbejde."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_holdkampe as f
import discover_turneringer as d

d.OUT = "diag"

def main():
    pages = ["/DBF/Ranglister/", "/DBF/Klub/", "/DBF/Spiller/"]
    found = {}
    for p in pages:
        try:
            _, final, html = f.http(f.BASE + p, extra_headers={"Accept": "text/html"})
        except Exception as e:
            print("fejl", p, e); continue
        d.save("side_" + p.strip("/").replace("/", "_") + ".html", html)
        import urllib.parse as up
        for src in re.findall(r"<script[^>]+src=['\"]([^'\"]+)['\"]", html):
            found[up.urljoin(f.BASE + p, src.replace("&amp;", "&"))] = 1
        for m in set(re.findall(r"WebService1\.asmx/(\w+)", html)):
            print("::notice title=metode i " + p + "::" + m)
    for src in list(found)[:40]:
        url = src
        if "badmintonplayer" not in url or "ScriptResource" in url or "WebResource" in url:
            continue
        try:
            _, _, js = f.http(url)
        except Exception:
            continue
        ms = set(re.findall(r"WebService1\.asmx/(\w+)", js)) | set(re.findall(r"(Get\w*(?:Rank|Player|Club)\w*)", js))
        if ms or "asmx/js" in url or "sportsresults.js" in url.lower():
            name = "js_" + re.sub(r"\W+", "_", src.split("?")[0])[-60:] + ".txt"
            d.save(name, js)
            print("::notice title=metoder i " + src.split("?")[0][-50:] + "::" + ", ".join(sorted(ms)))

if __name__ == "__main__":
    main()
