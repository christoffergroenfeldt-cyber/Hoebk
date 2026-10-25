#!/usr/bin/env python3
"""
fetch_holdkampe.py — Henter alle HØBK-holds kampe, resultater, opstillinger og
spillere fra badmintonplayer.dk.

Kilde: Badminton Danmarks web service bag badmintonplayer.dk/DBF/HoldTurnering/Stilling/
  POST https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding
  Argumenter (samme rækkefølge som URL-hashen #2,2026,19102,5,,,,1151,):
    subPage, seasonID, leagueGroupID, ageGroupID, regionID,
    leagueGroupTeamID, leagueMatchID, clubID, playerID
  subPage: 2 = stilling i pulje, 3 = ét holds kampe, 4 = alle kampe i pulje,
           5 = én holdkamp (opstilling + sætcifre), 6 = klubbens hold
  Svar: {"d": {"html": "..."}} — HTML-fragment med ShowStanding(...)-links.

Login (valgfrit): sættes miljøvariablerne BP_USER og BP_PWD, logger scriptet ind
via sidens login-formular, men kun hvis de offentlige kald ikke giver data
(eller hvis --login always). Adgangskoden skrives aldrig til loggen.

Brug:
  python fetch_holdkampe.py --season 2026 --club 1151 --out data/holdkampe.json
  python fetch_holdkampe.py --dump-dir debug_html     # gemmer rå HTML til fejlsøgning
  python fetch_holdkampe.py --names first             # kun fornavne på spillere

Kun standardbiblioteket — ingen pip install nødvendig.
"""

import argparse
import html as htmllib
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://www.badmintonplayer.dk"
TOKEN_PAGE = BASE + "/DBF/HoldTurnering/Stilling/"
ENDPOINT = BASE + "/SportsResults/Components/WebService1.asmx/GetLeagueStanding"
PUBLIC_LINK = "https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#{}"

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "da-DK,da;q=0.9,en;q=0.8",
}
TIMEOUT = 30
PAUSE = 1.2  # sekunder mellem kald — vær flink ved Badminton Danmarks server

ARG_NAMES = ["subPage", "seasonID", "leagueGroupID", "ageGroupID", "regionID",
             "leagueGroupTeamID", "leagueMatchID", "clubID", "playerID"]

DATE_RE = re.compile(r"\b(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:\s+(\d{1,2}[:.]\d{2}))?")
SCORE_RE = re.compile(r"^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$")
SET_RE = re.compile(r"\b(\d{1,2})\s*-\s*(\d{1,2})\b")
DISC_RE = re.compile(r"^\s*(\d+)\.?\s*(HS|DS|HD|DD|MD|XD)\b", re.I)
SHOW_RE = re.compile(r"ShowStanding\(([^)]*)\)")
ANCHOR_RE = re.compile(r"<a\b[^>]*ShowStanding\(([^)]*)\)[^>]*>(.*?)</a>", re.S | re.I)
PLAYER_A_RE = re.compile(r"<a\b[^>]*href=\"[^\"]*VisSpiller[^\"]*#(\d+)[^\"]*\"[^>]*>(.*?)</a>", re.S | re.I)
ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")
INPUT_RE = re.compile(r"<input\b[^>]*>", re.I)
ATTR_RE = re.compile(r"(\w[\w-]*)\s*=\s*(\"[^\"]*\"|'[^']*')")

US_RE = re.compile(r"hørsholm|høbk|hobk", re.I)

# Fælles cookie-jar, så et login (hvis brugt) gælder for alle kald
COOKIES = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIES))


# ---------- HTTP ----------

def http(url, data=None, extra_headers=None):
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if data is not None else "GET")
    with OPENER.open(req, timeout=TIMEOUT) as resp:
        return resp.status, resp.geturl(), resp.read().decode("utf-8", "replace")


def get_page():
    return http(TOKEN_PAGE, extra_headers={"Accept": "text/html"})


def token_from(body, status=None, final_url=None):
    m = re.search(r"SR_CallbackContext\s*=\s*'([^']*)'", body)
    if not m:
        print(f"FEJL: fandt ikke SR_CallbackContext. status={status} url={final_url} "
              f"længde={len(body)}\nStart af svar:\n{body[:1000]}", file=sys.stderr)
        sys.exit(2)
    return m.group(1)


def get_token():
    status, final_url, body = get_page()
    return token_from(body, status, final_url)


def standing(token, args, retries=2):
    payload = {"callbackcontextkey": token}
    payload.update({k: str(args.get(k, "") or "") for k in ARG_NAMES})
    data = json.dumps(payload).encode("utf-8")
    last = None
    for attempt in range(retries + 1):
        try:
            status, final_url, body = http(
                ENDPOINT, data=data,
                extra_headers={"Content-Type": "application/json; charset=utf-8",
                               "X-Requested-With": "XMLHttpRequest",
                               "Referer": TOKEN_PAGE})
            obj = json.loads(body)
            d = obj.get("d", obj)
            return d.get("html", "") if isinstance(d, dict) else str(d)
        except Exception as e:  # netværk / JSON — prøv igen
            last = e
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"GetLeagueStanding fejlede for subPage={payload['subPage']}: {last}")


# ---------- Login (valgfrit) ----------

def attrs(tag):
    return {k.lower(): v[1:-1] for k, v in ATTR_RE.findall(tag)}


def login(user, pwd, dump):
    """Logger ind via ASP.NET-formularen på siden. Returnerer nyt token eller None."""
    status, final_url, body = get_page()
    dump("login_page.html", body)
    fields, email_name, pwd_name, submit_name = {}, None, None, None
    for tag in INPUT_RE.findall(body):
        a = attrs(tag)
        name, typ = a.get("name"), a.get("type", "text").lower()
        if not name:
            continue
        if typ == "password":
            pwd_name = pwd_name or name
        elif typ in ("text", "email") and re.search(r"mail|login|user|bruger", name, re.I):
            email_name = email_name or name
        elif typ == "hidden":
            fields[name] = htmllib.unescape(a.get("value", ""))
        elif typ in ("submit", "image") and re.search(r"login", name, re.I) \
                and not re.search(r"cancel|menu", name, re.I):
            submit_name = submit_name or name
            fields[name] = a.get("value", "")
    target = ""
    if not submit_name:
        for t in re.findall(r"__doPostBack\('([^']*)'", body):
            if re.search(r"login", t, re.I) and not re.search(r"cancel|menu|logud|logout", t, re.I):
                target = t
                break
    if not (email_name and pwd_name and (submit_name or target)):
        print(f"ADVARSEL: login-formularen blev ikke genkendt (email={email_name}, "
              f"password={pwd_name}, knap={submit_name or target}). Fortsætter uden login.",
              file=sys.stderr)
        return None
    fields[email_name] = user
    fields[pwd_name] = pwd
    fields["__EVENTTARGET"] = target
    fields.setdefault("__EVENTARGUMENT", "")
    action_m = re.search(r"<form\b[^>]*action=\"([^\"]*)\"", body, re.I)
    action = urllib.parse.urljoin(final_url, htmllib.unescape(action_m.group(1))) if action_m else final_url
    data = urllib.parse.urlencode(fields).encode("utf-8")
    status, final_url, body = http(action, data=data, extra_headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html", "Referer": TOKEN_PAGE})
    still_form = any(attrs(t).get("type", "").lower() == "password" for t in INPUT_RE.findall(body))
    logged_in = re.search(r"log\s*ud|logout", body, re.I) and not still_form
    if not logged_in:
        dump("login_response.html", body)
        print(f"ADVARSEL: login ser ikke ud til at lykkes (status={status}). "
              "Fortsætter uden login.", file=sys.stderr)
        return None
    print("Logget ind på badmintonplayer.dk.")
    m = re.search(r"SR_CallbackContext\s*=\s*'([^']*)'", body)
    return m.group(1) if m else get_token()


# ---------- Parsing ----------

def text(fragment):
    return re.sub(r"\s+", " ", htmllib.unescape(TAG_RE.sub(" ", fragment))).strip()


def parse_args(raw):
    parts = [p.strip().strip("'\"") for p in raw.split(",")]
    parts += [""] * (len(ARG_NAMES) - len(parts))
    return dict(zip(ARG_NAMES, parts[:len(ARG_NAMES)]))


def hash_of(a):
    return ",".join(a.get(k, "") for k in ARG_NAMES)


def parse_club_teams(fragment):
    """subPage 6 → ét element pr. hold (links til subPage 3 eller 2)."""
    teams, seen = [], set()
    for raw, label in ANCHOR_RE.findall(fragment):
        a = parse_args(raw)
        if a["subPage"] not in ("2", "3") or not a["leagueGroupID"]:
            continue
        key = (a["leagueGroupID"], a["leagueGroupTeamID"] or text(label))
        if key in seen:
            continue
        seen.add(key)
        teams.append({"name": text(label), "args": a})
    return teams


def find_team_id_in_pulje(fragment):
    """Fra en puljestilling (subPage 2): find holdlinks der tilhører klubben."""
    found = []
    for raw, label in ANCHOR_RE.findall(fragment):
        a = parse_args(raw)
        if a["subPage"] == "3" and a["leagueGroupTeamID"]:
            found.append({"name": text(label), "args": a})
    own = [t for t in found if US_RE.search(t["name"])]
    return own or found


def parse_matches(fragment):
    """subPage 3 → kampe. Best-effort: genkender dato- og resultatceller."""
    matches = []
    for row in ROW_RE.findall(fragment):
        cells_html = CELL_RE.findall(row)
        if not cells_html:
            continue
        cells = [text(c) for c in cells_html]
        date_iso, time_str, date_idx = None, None, None
        for i, c in enumerate(cells):
            m = DATE_RE.search(c)
            if m:
                d, mo, y, t = m.groups()
                date_iso = f"{y}-{int(mo):02d}-{int(d):02d}"
                time_str = t.replace(".", ":") if t else None
                date_idx = i
                break
        if date_iso is None:
            continue
        result, res_idx = None, None
        for i, c in enumerate(cells):
            if SCORE_RE.match(c):
                result, res_idx = c.replace(" ", ""), i
        rest = [c for i, c in enumerate(cells)
                if i not in (date_idx, res_idx) and c
                and not re.fullmatch(r"[\d\s:.\-/]+", c)]
        match_id, link_args = "", None
        for raw in SHOW_RE.findall(row):
            a = parse_args(raw)
            if a["subPage"] == "5" and a["leagueMatchID"]:
                match_id, link_args = a["leagueMatchID"], a
                break
        home = rest[0] if len(rest) > 0 else ""
        away = rest[1] if len(rest) > 1 else ""
        matches.append({
            "date": date_iso,
            "time": time_str,
            "home": home,
            "away": away,
            "isHome": bool(US_RE.search(home)),
            "result": result,          # None = ikke spillet endnu
            "played": result is not None,
            "matchID": match_id,
            "url": PUBLIC_LINK.format(hash_of(link_args)) if link_args else "",
            "games": [],               # udfyldes fra subPage 5
            "cells": cells,            # rå celler — til fejlsøgning/justering
        })
    matches.sort(key=lambda m: (m["date"], m["time"] or ""))
    return matches


def parse_games(fragment):
    """subPage 5 → enkeltkampe: disciplin, spillere pr. side, sætcifre, vinder.
    Kun rækker med en disciplin (1. HS, 2. DD …) læses — holdlederens
    kontaktoplysninger på samme side gemmes aldrig."""
    games = []
    for row in ROW_RE.findall(fragment):
        cells_html = CELL_RE.findall(row)
        if not cells_html:
            continue
        cells = [text(c) for c in cells_html]
        disc = next((DISC_RE.match(c) for c in cells if DISC_RE.match(c)), None)
        if not disc:
            continue
        discipline = f"{disc.group(1)}. {disc.group(2).upper()}"
        players = [(pid, text(n)) for pid, n in PLAYER_A_RE.findall(row)]
        per_side = 2 if disc.group(2).upper() in ("HD", "DD", "MD", "XD") else 1
        home_p = players[:per_side]
        away_p = players[per_side:per_side * 2]
        sets = []
        for c in cells:
            if DISC_RE.match(c):
                continue
            for a, b in SET_RE.findall(c):
                a, b = int(a), int(b)
                if max(a, b) >= 11:   # sætcifre, ikke fx "1-0"
                    sets.append([a, b])
        home_sets = sum(1 for a, b in sets if a > b)
        away_sets = sum(1 for a, b in sets if b > a)
        winner = "home" if home_sets > away_sets else "away" if away_sets > home_sets else None
        games.append({
            "discipline": discipline,
            "home": [{"id": p, "name": n} for p, n in home_p],
            "away": [{"id": p, "name": n} for p, n in away_p],
            "sets": sets,
            "winner": winner,
        })
    return games


def short_name(name, style):
    return name.split()[0] if style == "first" and name else name


def build_roster(matches, style):
    roster = {}
    for m in matches:
        side = "home" if m["isHome"] else "away"
        for g in m["games"]:
            for p in g[side]:
                key = p["id"] or p["name"]
                r = roster.setdefault(key, {"id": p["id"], "name": short_name(p["name"], style),
                                            "games": 0, "won": 0, "disciplines": []})
                r["games"] += 1
                if g["winner"] == side:
                    r["won"] += 1
                d = re.sub(r"^\d+\.\s*", "", g["discipline"])
                if d not in r["disciplines"]:
                    r["disciplines"].append(d)
    return sorted(roster.values(), key=lambda r: (-r["games"], r["name"]))


# ---------- Hovedflow ----------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", default="2026")
    ap.add_argument("--club", default="1151", help="clubID på badmintonplayer.dk")
    ap.add_argument("--pulje", action="append", default=[],
                    help="Ekstra leagueGroupID:ageGroupID (fx 19102:5) hvis et hold mangler")
    ap.add_argument("--out", default="holdkampe.json")
    ap.add_argument("--dump-dir", default="", help="Gem rå HTML-svar her")
    ap.add_argument("--login", choices=["auto", "always", "never"], default="auto",
                    help="auto = kun hvis offentlige kald ikke giver hold (kræver BP_USER/BP_PWD)")
    ap.add_argument("--names", choices=["full", "first"], default="full",
                    help="Spillernavne: fulde navne eller kun fornavn")
    ap.add_argument("--no-lineups", action="store_true", help="Spring opstillinger (subPage 5) over")
    opts = ap.parse_args()

    def dump(name, fragment):
        if opts.dump_dir:
            os.makedirs(opts.dump_dir, exist_ok=True)
            with open(os.path.join(opts.dump_dir, name), "w", encoding="utf-8") as f:
                f.write(fragment)

    user, pwd = os.environ.get("BP_USER", ""), os.environ.get("BP_PWD", "")
    have_creds = bool(user and pwd)

    def do_login():
        if not have_creds:
            print("Ingen BP_USER/BP_PWD sat — springer login over.")
            return None
        return login(user, pwd, dump)

    token = None
    if opts.login == "always":
        token = do_login()
    token = token or get_token()
    print("Token hentet.")

    def fetch_teams(tok):
        club_html = standing(tok, {"subPage": "6", "seasonID": opts.season, "clubID": opts.club})
        dump("club_teams_subpage6.html", club_html)
        found = parse_club_teams(club_html)
        print(f"subPage 6: {len(found)} hold fundet.")
        for spec in opts.pulje:
            lg, _, ag = spec.partition(":")
            time.sleep(PAUSE)
            p_html = standing(tok, {"subPage": "2", "seasonID": opts.season,
                                    "leagueGroupID": lg, "ageGroupID": ag, "clubID": opts.club})
            dump(f"pulje_{lg}.html", p_html)
            for t in find_team_id_in_pulje(p_html):
                if not any(x["args"].get("leagueGroupTeamID") == t["args"]["leagueGroupTeamID"]
                           for x in found):
                    found.append(t)
        return found, club_html

    teams, club_html = fetch_teams(token)

    if not teams and opts.login == "auto" and have_creds:
        print("Ingen hold uden login — prøver med login.")
        new_token = do_login()
        if new_token:
            token = new_token
            teams, club_html = fetch_teams(token)

    if not teams:
        print("FEJL: ingen hold fundet. Kør med --dump-dir debug_html og send "
              "club_teams_subpage6.html, så parseren kan tilpasses.\n"
              f"Start af svar:\n{club_html[:1500]}", file=sys.stderr)
        sys.exit(3)

    out_teams = []
    for t in teams:
        a = dict(t["args"])
        a.update({"subPage": "3", "seasonID": opts.season, "clubID": opts.club})
        time.sleep(PAUSE)
        try:
            m_html = standing(token, a)
        except RuntimeError as e:
            print(f"ADVARSEL: {t['name']}: {e}", file=sys.stderr)
            continue
        dump(f"team_{a.get('leagueGroupTeamID') or a.get('leagueGroupID')}.html", m_html)
        matches = parse_matches(m_html)

        if not opts.no_lineups:
            for m in matches:
                if not (m["played"] and m["matchID"]):
                    continue
                time.sleep(PAUSE)
                try:
                    g_html = standing(token, dict(a, subPage="5", leagueMatchID=m["matchID"]))
                except RuntimeError as e:
                    print(f"ADVARSEL: kamp {m['matchID']}: {e}", file=sys.stderr)
                    continue
                dump(f"match_{m['matchID']}.html", g_html)
                m["games"] = parse_games(g_html)
                if opts.names == "first":
                    for g in m["games"]:
                        for side in ("home", "away"):
                            for p in g[side]:
                                p["name"] = short_name(p["name"], "first")

        standing_args = dict(a, subPage="2", leagueGroupTeamID="")
        out_teams.append({
            "name": t["name"],
            "leagueGroupID": a.get("leagueGroupID", ""),
            "ageGroupID": a.get("ageGroupID", ""),
            "leagueGroupTeamID": a.get("leagueGroupTeamID", ""),
            "url": PUBLIC_LINK.format(hash_of(a)),
            "standingUrl": PUBLIC_LINK.format(hash_of(standing_args)),
            "matches": matches,
            "players": build_roster(matches, opts.names),
        })
        played = sum(1 for m in matches if m["played"])
        with_lineup = sum(1 for m in matches if m["games"])
        print(f"  {t['name']}: {len(matches)} kampe ({played} spillet, "
              f"{with_lineup} med opstilling), {len(out_teams[-1]['players'])} spillere")

    data = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": opts.season,
        "clubID": opts.club,
        "source": "badmintonplayer.dk",
        "teams": out_teams,
    }
    if os.path.dirname(opts.out):
        os.makedirs(os.path.dirname(opts.out), exist_ok=True)
    with open(opts.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Skrev {opts.out}: {len(out_teams)} hold.")
    if not any(t["matches"] for t in out_teams):
        print("ADVARSEL: ingen kampe genkendt — kør med --dump-dir og tjek team_*.html",
              file=sys.stderr)
        sys.exit(4)


if __name__ == "__main__":
    main()
