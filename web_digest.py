#!/usr/bin/env python3
"""
web_digest.py — lille udtræk af holdkampe til hjemmesiden hoebk.dk.

Joomla-skabelonen "HØBK" (joomla/cassiopeia_hoebk) viser på forsiden de næste holdkampe og de
seneste resultater. Den henter denne fil fra GitHub Pages i stedet for hele data/holdkampe.json
(som er ca. 400 kB). Indeholder kun hold, modstander, dato, hjemme/ude og resultat — ingen spillere.

  python web_digest.py            # data/holdkampe.json → data/hjemmeside.json

Køres i holdkampe.yml og live.yml lige før commit.
"""
import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SRC = "data/holdkampe.json"
OUT = "data/hjemmeside.json"
APP = "https://christoffergroenfeldt-cyber.github.io/Hoebk/"
N = 8


def team_name(t):
    lbl = (t.get("label") or t.get("pulje") or "").strip()
    return lbl or t.get("name", "Hørsholm")


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    today = datetime.now(ZoneInfo("Europe/Copenhagen")).date().isoformat()
    up, res = [], []
    for t in d.get("teams", []):
        base = {"team": team_name(t), "club": t.get("name", "")}
        for m in t.get("matches", []):
            if not m.get("date"):
                continue
            item = dict(base, date=m["date"], time=m.get("time") or "", opponent=m.get("opponent", ""),
                        home=bool(m.get("isHome")), venue=m.get("venue") or "", url=m.get("url") or t.get("url", ""))
            if m.get("played"):
                res.append(dict(item, result=m.get("result") or "", outcome=m.get("outcome") or "",
                                walkover=m.get("walkover") or ""))
            elif m["date"] >= today:
                up.append(item)
    up.sort(key=lambda x: (x["date"], x["time"] or "99:99"))
    res.sort(key=lambda x: (x["date"], x["time"] or ""), reverse=True)
    out = {"updated": d.get("updated") or datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "season": d.get("season", ""), "app": APP, "teams": len(d.get("teams", [])),
           "upcoming": up[:N], "results": res[:N]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = None
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if old and {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in out.items() if k != "updated"}:
        print("Hjemmeside-udtræk uændret.")
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"Hjemmeside: {len(out['upcoming'])} kommende, {len(out['results'])} resultater → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
