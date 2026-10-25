#!/usr/bin/env python3
"""
fetch_live.py — hurtig opdatering af holdkampe på kampdage.

Opdaterer KUN de hold, der har kamp i dag (eller en kamp fra i går uden resultat endnu):
kampprogram, resultater, opstillinger og stilling. Alt andet i data/holdkampe.json beholdes
(køretider, andre hold). Spillerstatistik (data/spillere.json) opdateres ved den fulde kørsel.

  python fetch_live.py --check     # exit 0 og skriv "ja"/"nej": er der kampe at opdatere?
  python fetch_live.py             # opdatér data/holdkampe.json

Kører i .github/workflows/live.yml hver halve time i dagtimerne. Tager typisk under et minut.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import fetch_holdkampe as F

DATA = "data/holdkampe.json"


def today_dk():
    return datetime.now(ZoneInfo("Europe/Copenhagen")).date()


def due_teams(d, today):
    """Hold med kamp i dag, eller en kamp fra i går/forgårs der endnu ikke har resultat."""
    t0, back = today.isoformat(), (today - timedelta(days=2)).isoformat()
    out = []
    for t in d.get("teams", []):
        if any(m.get("date") == t0 or (back <= (m.get("date") or "") < t0 and not m.get("played")) for m in t.get("matches", [])):
            out.append(t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--today", default="")
    ap.add_argument("--season", default="2026")
    ap.add_argument("--club", default="1151")
    a = ap.parse_args()
    today = date.fromisoformat(a.today) if a.today else today_dk()
    d = json.load(open(DATA, encoding="utf-8"))
    due = due_teams(d, today)
    if a.check:
        print("ja" if due else "nej")
        return 0
    if not due:
        print("Ingen kampe i dag — intet at opdatere.")
        return 0

    token = F.get_token()
    missing = [t for t in due if not t.get("bpArgs")]
    if missing:   # ældre data uden bpArgs: slå holdenes argumenter op på klubsiden
        club = F.parse_club_teams(F.standing(token, {"subPage": "6", "seasonID": a.season, "clubID": a.club}))
        by_id = {c["args"].get("leagueGroupTeamID"): c["args"] for c in club}
        for t in missing:
            if t["leagueGroupTeamID"] in by_id:
                t["bpArgs"] = {k: v for k, v in by_id[t["leagueGroupTeamID"]].items() if k not in ("subPage", "leagueMatchID")}

    changed = 0
    for t in due:
        args = dict(t.get("bpArgs") or {})
        if not args:
            print(f"ADVARSEL: {t['label']}: mangler holdets id'er — tages ved næste fulde kørsel", file=sys.stderr)
            continue
        args.update({"seasonID": a.season, "clubID": a.club})
        try:
            time.sleep(F.PAUSE)
            matches = F.parse_matches(F.standing(token, dict(args, subPage="3")), args.get("leagueGroupTeamID", ""))
        except RuntimeError as e:
            print(f"ADVARSEL: {t['label']}: {e}", file=sys.stderr)
            continue
        if not matches:
            continue
        old = {m.get("matchID"): m for m in t.get("matches", [])}
        for m in matches:
            o = old.get(m.get("matchID")) or {}
            if o.get("travel"):
                m["travel"] = o["travel"]
            if not m["played"] or not m.get("matchID"):
                continue
            if o.get("games") and o.get("played"):
                m["games"] = o["games"]            # allerede hentet
                continue
            try:
                time.sleep(F.PAUSE)
                m["games"] = F.parse_games(F.standing(token, dict(args, subPage="5", leagueMatchID=m["matchID"])))
            except RuntimeError as e:
                print(f"ADVARSEL: kamp {m['matchID']}: {e}", file=sys.stderr)
        new_played = sum(1 for m in matches if m["played"]) - sum(1 for m in t["matches"] if m.get("played"))
        try:
            time.sleep(F.PAUSE)
            table = F.parse_standings(F.standing(token, dict(args, subPage="2", leagueGroupTeamID="")))
        except RuntimeError:
            table = t.get("standing", [])
        me = next((r for r in table if r["teamID"] == t["leagueGroupTeamID"]), None)
        t.update({"matches": matches, "standing": table or t.get("standing", []),
                  "position": me["pos"] if me else t.get("position", ""),
                  "players": F.build_roster(matches, "full")})
        changed += 1
        print(f"  {t['label']}: {len(matches)} kampe, {new_played} nye resultater")

    d["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"Opdaterede {changed} hold med kamp i dag.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
