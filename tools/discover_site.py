#!/usr/bin/env python3
"""Kortlægger hoebk.dk's menu (Joomla) — titler og links."""
import re, urllib.request, html
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (HØBK-app)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")
def note(t, m): print(f"::warning title={t}::{m}".replace("\n", " ")[:3800])
h = get("https://hoebk.dk/")
navs = re.findall(r'<ul[^>]*class="[^"]*mod-menu[^"]*"[^>]*>.*?</ul>\s*</nav>|<nav[^>]*>.*?</nav>', h, re.S)
note("Antal nav", str(len(navs)))
for i, n in enumerate(navs[:3]):
    items = re.findall(r'<li[^>]*class="([^"]*)"[^>]*>\s*(?:<a[^>]*href="([^"]*)"[^>]*>|<(?:span|button)[^>]*>)\s*(?:<[^>]+>\s*)*([^<]+)', n)
    note(f"Menu {i}", " | ".join(f"{('-' if 'deeper' not in c and 'parent' not in c else '+')}{t.strip()}→{u}" for c, u, t in items)[:3800])
main = re.search(r"<main[^>]*>(.*?)</main>", h, re.S)
note("Forside main", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", main.group(1)))[:1500] if main else "ingen main")
