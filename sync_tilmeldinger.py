#!/usr/bin/env python3
"""
sync_tilmeldinger.py — Henter alle tilmeldinger fra Google Apps Script og gemmer dem i
SQLite (data/hoebk.db) + en letvægts-JSON til appen (data/tilmeldinger.json).

Miljøvariabler (GitHub-secrets):
  REG_URL  webapp-URL fra Apps Script (slutter på /exec)
  REG_KEY  nøglen som setup() i Apps Script loggede

Databasen genopbygges fra den komplette log hver gang (idempotent).
Tabeller:
  registrations  — hver eneste afgivne svar (fuld historik)
  latest         — view: seneste svar pr. (event_id, player_id)
"""
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TIMEOUT = 30


def fetch_rows(url, key):
    q = urllib.parse.urlencode({"action": "all", "key": key})
    req = urllib.request.Request(f"{url}?{q}", headers={"User-Agent": "hoebk-sync/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:   # følger Googles redirect automatisk
        obj = json.loads(r.read().decode("utf-8"))
    if not obj.get("ok"):
        raise SystemExit(f"FEJL fra Apps Script: {obj.get('error')}")
    return obj["rows"], obj.get("lineups", [])


def build_db(rows, path, lineups=()):
    tmp = path + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    con = sqlite3.connect(tmp)
    con.executescript("""
        CREATE TABLE registrations (
            id INTEGER PRIMARY KEY,
            ts TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('match','training')),
            event_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            player_name TEXT NOT NULL,
            status TEXT NOT NULL,
            label TEXT
        );
        CREATE INDEX idx_reg_event ON registrations(event_id);
        CREATE INDEX idx_reg_player ON registrations(player_id);
        CREATE TABLE lineups (
            event_id TEXT PRIMARY KEY,      -- m:<matchID>
            team TEXT NOT NULL,             -- holdlabel, fx "U15 B"
            status TEXT NOT NULL,           -- udkast | klar | indtastet
            saved_by TEXT,
            saved_at TEXT,
            squad_json TEXT NOT NULL,       -- [{id, name}]
            games_json TEXT NOT NULL,       -- [{k: "1. HS", p: [playerId, …]}]
            note TEXT
        );
        CREATE VIEW latest AS
            SELECT r.* FROM registrations r
            WHERE r.id = (SELECT r2.id FROM registrations r2
                          WHERE r2.event_id = r.event_id AND r2.player_id = r.player_id
                          ORDER BY r2.ts DESC, r2.id DESC LIMIT 1);
    """)
    con.executemany(
        "INSERT INTO registrations (ts, type, event_id, player_id, player_name, status, label) VALUES (?,?,?,?,?,?,?)",
        [(r["ts"], r["type"], r["eventId"], r["playerId"], r["playerName"], r["status"], r.get("label", ""))
         for r in sorted(rows, key=lambda x: x["ts"])])
    con.executemany(
        "INSERT OR REPLACE INTO lineups VALUES (?,?,?,?,?,?,?,?)",
        [(l["e"], l.get("team", ""), l.get("status", ""), l.get("by", ""),
          datetime.fromtimestamp(l.get("t", 0) / 1000, timezone.utc).isoformat(timespec="seconds") if l.get("t") else "",
          json.dumps(l.get("squad", []), ensure_ascii=False), json.dumps(l.get("games", []), ensure_ascii=False), l.get("note", ""))
         for l in lineups])
    con.commit()
    latest = con.execute(
        "SELECT event_id, player_id, player_name, status, ts FROM latest ORDER BY event_id, player_name").fetchall()
    con.close()
    os.replace(tmp, path)
    return latest


def main():
    url, key = os.environ.get("REG_URL", "").strip(), os.environ.get("REG_KEY", "").strip()
    if not url or not key:
        print("REG_URL/REG_KEY er ikke sat endnu — springer over.")
        return 0
    rows, lineups = fetch_rows(url, key)
    os.makedirs("data", exist_ok=True)
    latest = build_db(rows, "data/hoebk.db", lineups)
    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": [{"e": e, "p": p, "n": n, "s": s, "ts": ts} for e, p, n, s, ts in latest],
        "lineups": lineups,
    }
    with open("data/tilmeldinger.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(rows)} svar i alt, {len(latest)} aktuelle, {len(lineups)} holdopstillinger → data/hoebk.db + data/tilmeldinger.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
