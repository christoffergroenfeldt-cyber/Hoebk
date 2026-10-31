#!/usr/bin/env python3
"""Undersøger hoebk.dk/kalender: hvor kommer aktivitetskalenderens begivenheder fra? Skriver kun struktur/URL'er."""
import re, sys, urllib.request
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (HØBK-app)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")
def note(t, m): print(f"::warning title={t}::{m}".replace("\n", " ")[:3000])
h = get("https://hoebk.dk/kalender")
note("Længde", str(len(h)))
for kind, rx in [("iframe", r"<iframe[^>]+src=[\"']([^\"']+)"), ("script", r"<script[^>]+src=[\"']([^\"']+)"),
                 ("link", r"<link[^>]+href=[\"']([^\"']+)"), ("feed", r"(https?://[^\"' <>]*(?:ical|ics|calendar|kalender|feed|google)[^\"' <>]*)")]:
    vals = sorted(set(re.findall(rx, h, re.I)))
    note(kind, " | ".join(vals[:40]))
i = h.find("Nedenfor finder du")
note("Omkring intro", re.sub(r"\s+", " ", h[i:i + 2500]) if i >= 0 else "ikke fundet")
for m in re.findall(r"<script[^>]*>(.*?)</script>", h, re.S):
    if re.search(r"calendar|kalender|event|fullcalendar|gcal|ics", m, re.I):
        note("inline script", re.sub(r"\s+", " ", m)[:1500])
