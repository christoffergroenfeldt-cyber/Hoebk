#!/usr/bin/env python3
"""Undersøger Conventus-aktivitetskalenderen (foreningsid 6493), som hoebk.dk/kalender viser."""
import re, sys, urllib.request
U = "https://www.conventus.dk/dataudv/www/kalender.php?type_ikon=1&niveau_ikon=0&mos=1&kort_dato=0&dato=1&dato_tidspunkt=1&tidspunkt=1&kort_tid=0&titel=1&sted=1&klikbar=1&tid=5&niveau=1&gruppe=&gruppe_type=2&rss=1&smal=0&foreningsid=6493"
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (HØBK-app)", "Referer": "https://hoebk.dk/kalender"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace"), r.headers.get("Content-Type")
def note(t, m): print(f"::warning title={t}::{m}".replace("\n", " ")[:3500])
h, ct = get(U)
note("Type/længde", f"{ct} {len(h)}")
note("Start", h[:3000])
note("Links", " | ".join(sorted(set(re.findall(r"https?://[^\"' <>\\\\]+", h)))[:30]))
txt = re.sub(r"<[^>]+>", " ", h.replace("\\'", "'").replace('\\"', '"'))
note("Tekst", re.sub(r"\s+", " ", txt)[:3000])
for rss in sorted(set(re.findall(r"https?://[^\"' <>\\\\]*rss[^\"' <>\\\\]*", h, re.I)))[:2]:
    try:
        r, ct2 = get(rss.replace("&amp;", "&")); note("RSS " + rss[:80], f"{ct2} {len(r)} :: " + re.sub(r"\s+", " ", r)[:2500])
    except Exception as e:
        note("RSS fejl", str(e))
