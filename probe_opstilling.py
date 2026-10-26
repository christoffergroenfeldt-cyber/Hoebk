#!/usr/bin/env python3
"""probe_opstilling.py — TRIN 1 (kun læsning): undersøger badmintonplayer.dk's interne API for en holdkamp.

Logger ind med holdleder-kontoen (secrets BP_LEADER_USER / BP_LEADER_PWD) og LÆSER kampen via
/api/LeagueMatch/{kamp-id} — både uden og med login — og skriver kun STRUKTUREN ud (feltnavne, typer,
antal), aldrig navne, spillernumre eller andre værdier. Intet bliver gemt eller ændret på badmintonplayer.dk.
"""
import json, os, re, sys, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_holdkampe as F

API = F.BASE + "/api"


def note(title, msg):
    print(f"::warning title={title}::{msg}".replace("\n", " ")[:1500])


def shape(v, depth=0):
    """Struktur uden værdier: {felt: type} / [antal × struktur]."""
    if depth > 5:
        return "…"
    if isinstance(v, dict):
        return {k: shape(x, depth + 1) for k, x in list(v.items())[:60]}
    if isinstance(v, list):
        return [f"{len(v)}×", shape(v[0], depth + 1)] if v else ["0×"]
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "tal"
    if v is None:
        return "null"
    return f"tekst({len(str(v))})"


def get(path, label):
    try:
        status, final, body = F.http(API + path, extra_headers={"Accept": "application/json", "Referer": F.BASE + "/DBF/User/IndberetResultat/Kamp"})
    except urllib.error.HTTPError as e:
        note(label, f"HTTP {e.code} {e.reason}")
        return None
    except Exception as e:  # noqa
        note(label, f"fejl: {str(e)[:200]}")
        return None
    try:
        obj = json.loads(body)
    except ValueError:
        note(label, f"status {status}, ikke JSON ({len(body)} tegn): {re.sub(r'<[^>]+>', ' ', body)[:200]}")
        return None
    note(label, f"status {status}: " + json.dumps(shape(obj), ensure_ascii=False)[:1400])
    return obj


def main():
    match_id = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if not match_id:
        d = json.load(open("data/holdkampe.json", encoding="utf-8"))
        nxt = sorted((m for t in d["teams"] for m in t["matches"] if not m.get("played") and m.get("matchID")), key=lambda m: m["date"])
        match_id = nxt[0]["matchID"]
    note("Kamp", f"undersøger holdkamp {match_id}")
    get(f"/LeagueMatch/clubid/{match_id}", "Uden login: klub")
    get(f"/LeagueMatch/{match_id}?isLiveScore=false", "Uden login: kamp")

    user, pwd = os.environ.get("BP_LEADER_USER", ""), os.environ.get("BP_LEADER_PWD", "")
    if not (user and pwd):
        note("Login", "BP_LEADER_USER/BP_LEADER_PWD er ikke sat — kun offentlig læsning testet.")
        return 0
    tok = F.login(user, pwd, lambda *a: None)
    note("Login", "lykkedes" if tok else "lykkedes IKKE (se loggen — evt. robot-tjek/reCAPTCHA; det omgås ikke)")
    if not tok:
        return 0
    cookies = sorted({c.name for c in F.COOKIES})
    note("Cookies efter login", ", ".join(cookies))
    get("/Players/user/list", "Med login: konto")
    get(f"/LeagueMatch/{match_id}?isLiveScore=false", "Med login: kamp")
    return 0


if __name__ == "__main__":
    sys.exit(main())
