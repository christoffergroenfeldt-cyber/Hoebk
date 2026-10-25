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
import collections
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

DATE_RE = re.compile(r"\b(\d{1,2})[-./\u2011](\d{1,2})[-./\u2011](\d{4})(?:\s+(\d{1,2}[:.]\d{2}))?")
SCORE_RE = re.compile(r"^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$")
SET_RE = re.compile(r"\b(\d{1,2})\s*-\s*(\d{1,2})\b")
DISC_RE = re.compile(r"^\s*(\d+)\.?\s*([A-Za-zÆØÅæøå]{1,3})\b")  # HS/DS/HD/DD/MD, eller S/D i 4-spiller-rækker
SHOW_RE = re.compile(r"ShowStanding\(([^)]*)\)")
ANCHOR_RE = re.compile(r"<a\b[^>]*ShowStanding\(([^)]*)\)[^>]*>(.*?)</a>", re.S | re.I)
PLAYER_A_RE = re.compile(r"<a\b[^>]*href=[\"'][^\"']*VisSpiller[^\"']*#(\d+)[^\"']*[\"'][^>]*>(.*?)</a>", re.S | re.I)
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

def http(url, data=None, extra_headers=None, timeout=None):
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if data is not None else "GET")
    with OPENER.open(req, timeout=timeout or TIMEOUT) as resp:
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


PROFILE_ENDPOINT = BASE + "/SportsResults/Components/WebService1.asmx/GetPlayerProfile"
PLAYER_PAGE = BASE + "/DBF/Spiller/VisSpiller/"
# Spillernummeret (fx 060718-01) indeholder fødselsdatoen — det må aldrig gemmes eller logges
PLAYERNO_RE = re.compile(r"\b\d{6}-\d{2}\b")


def player_profile(token, player_id, retries=2):
    """GetPlayerProfile → dict fra svaret ('d'), typisk med et html-felt."""
    payload = {"callbackcontextkey": token, "seasonid": None, "playerid": str(player_id),
               "getplayerdata": True, "showUserProfile": True, "showheader": False}
    data = json.dumps(payload).encode("utf-8")
    last = None
    for attempt in range(retries + 1):
        try:
            status, final_url, body = http(
                PROFILE_ENDPOINT, data=data,
                extra_headers={"Content-Type": "application/json; charset=utf-8",
                               "X-Requested-With": "XMLHttpRequest",
                               "Referer": PLAYER_PAGE})
            obj = json.loads(body)
            d = obj.get("d", obj)
            return d if isinstance(d, dict) else {"html": str(d)}
        except Exception as e:
            last = e
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"GetPlayerProfile fejlede for {player_id}: {last}")


def strip_private(obj):
    """Fjerner spillernummer/fødselsdato-felter rekursivt."""
    if isinstance(obj, dict):
        return {k: strip_private(v) for k, v in obj.items()
                if not re.search(r"playernumber|birth|fødsel|cpr|email|phone|tlf|mobil", k, re.I)}
    if isinstance(obj, list):
        return [strip_private(v) for v in obj]
    if isinstance(obj, str):
        return PLAYERNO_RE.sub("", obj)
    return obj


def parse_profile(fragment):
    """GetPlayerProfile-HTML → niveau, ranglister (single/double/mix), licens.
    Sektionen 'Tilknyttede brugerkonti' springes bevidst over."""
    out = {"level": "", "rankings": [], "license": ""}
    m = re.search(r"Tilmeldingsniveau ved s[^<]*</h3>\s*</td>\s*<td>\s*<h3>\s*([^<]+)</h3>", fragment, re.I)
    if m:
        out["level"] = text(m.group(1))
    sec = re.search(r"<h2>\s*Ranglister\s*</h2>(.*?)(?:<h2>|$)", fragment, re.S | re.I)
    if sec:
        for row in re.split(r"<tr\b[^>]*>", sec.group(1))[1:]:
            cells = [text(c) for c in re.findall(r"<td\b[^>]*>(.*?)(?=<td\b|</tr>|<tr\b|</table>|$)", row, re.S | re.I)]
            if len(cells) >= 6 and cells[0].lower().startswith("rangliste"):
                out["rankings"].append({
                    "list": cells[0].replace("Rangliste ", "").strip(),   # Single / Double / Mix
                    "category": cells[2], "points": cells[3], "matches": cells[4], "placement": cells[5],
                })
    lic = re.search(r"<h2>\s*Spillerlicens\s*</h2>\s*([^<]*)", fragment, re.I)
    if lic:
        out["license"] = text(lic.group(1))
    return out


def parse_tables(fragment):
    """Generisk: hver <table> med nærmeste overskrift før den → {'title', 'rows': [[celler]]}."""
    out = []
    for m in re.finditer(r"<table\b[^>]*>(.*?)</table>", fragment, re.S | re.I):
        before = fragment[max(0, m.start() - 1500):m.start()]
        heads = re.findall(r"<(?:h\d|caption|span|div)\b[^>]*>([^<]{2,80})</(?:h\d|caption|span|div)>", before)
        title = text(heads[-1]) if heads else ""
        rows = []
        for row in ROW_RE.findall(m.group(1)):
            cells = [text(c) for c in CELL_RE.findall(row)]
            if any(cells):
                rows.append(cells)
        if rows:
            out.append({"title": PLAYERNO_RE.sub("", title), "rows": [[PLAYERNO_RE.sub("", c) for c in r] for r in rows]})
    return out


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
    s = htmllib.unescape(TAG_RE.sub(" ", fragment))
    # badmintonplayer.dk bruger hårde bindestreger (U+2011) i datoer og bløde (U+00AD) i hal-navne
    s = s.replace("‑", "-").replace("‐", "-").replace("­", "")
    return re.sub(r"\s+", " ", s).strip()


TD_CLASS_RE = re.compile(r"<td\b[^>]*class='([^']*)'[^>]*>(.*?)</td>", re.S | re.I)


def cells_by_class(row):
    """Liste af (klasse, tekst, rå html) for hver <td> i rækken."""
    return [(cls, text(inner), inner) for cls, inner in TD_CLASS_RE.findall(row)]


def parse_args(raw):
    parts = [p.strip().strip("'\"") for p in raw.split(",")]
    parts += [""] * (len(ARG_NAMES) - len(parts))
    return dict(zip(ARG_NAMES, parts[:len(ARG_NAMES)]))


def hash_of(a):
    return ",".join(a.get(k, "") for k in ARG_NAMES)


def parse_club_teams(fragment):
    """subPage 6 → klubbens egne hold. Siden lister alle puljer og ALLE hold i dem
    (også modstandere), så kun hold med Hørsholm i navnet tages med. Puljenavnet
    (fx "U15 B, 6200 (4 spillere) Pulje 2") hentes fra puljelinket uden holdID."""
    pulje_names, teams, seen = {}, [], set()
    for raw, label in ANCHOR_RE.findall(fragment):
        a = parse_args(raw)
        name = text(label)
        if not a["leagueGroupID"]:
            continue
        if not a["leagueGroupTeamID"]:
            # Længste navn vinder ("U15 B, 6200 (4 spillere) Pulje 2" frem for kortere varianter)
            if len(name) > len(pulje_names.get(a["leagueGroupID"], "")):
                pulje_names[a["leagueGroupID"]] = name
            continue
        if a["subPage"] != "3" or not US_RE.search(name):
            continue
        if a["leagueGroupTeamID"] in seen:
            continue
        seen.add(a["leagueGroupTeamID"])
        teams.append({"name": name, "args": a})
    for t in teams:
        t["pulje"] = pulje_names.get(t["args"]["leagueGroupID"], "")
    return teams


def parse_standings(fragment):
    """subPage 2 → stillingen i puljen."""
    rows = []
    for row in ROW_RE.findall(fragment):
        c = cells_by_class(row)
        if not c or c[0][0] != "standing":
            continue
        vals = [t for _, t, _ in c]
        team_id = ""
        for raw in SHOW_RE.findall(row):
            team_id = parse_args(raw)["leagueGroupTeamID"]
        nums = vals[2:]
        rows.append({
            "pos": vals[0],
            "team": vals[1],
            "teamID": team_id,
            "isUs": bool(US_RE.search(vals[1])),
            "played": nums[0] if len(nums) > 0 else "",
            "won": nums[1] if len(nums) > 1 else "",
            "score": nums[2] if len(nums) > 2 else "",
            "sets": nums[3] if len(nums) > 3 else "",
            "points": nums[4] if len(nums) > 4 else "",
        })
    return rows


def find_team_id_in_pulje(fragment):
    """Fra en puljestilling (subPage 2): find holdlinks der tilhører klubben."""
    found = []
    for raw, label in ANCHOR_RE.findall(fragment):
        a = parse_args(raw)
        if a["subPage"] == "3" and a["leagueGroupTeamID"]:
            found.append({"name": text(label), "args": a})
    own = [t for t in found if US_RE.search(t["name"])]
    return own or found


def parse_matches(fragment, team_id=""):
    """subPage 3 → kampe. Tabellen 'matchlist' har kolonnerne:
    time | matchno | team (hjemme) | team (ude) | team (arrangør) | venue | score | points | wo | livescore
    Uspillede kampe har '-' i score."""
    matches = []
    for row in ROW_RE.findall(fragment):
        c = cells_by_class(row)
        if not c or c[0][0] != "time":
            continue  # header eller andet
        by = {}
        for cls, t, raw in c:
            by.setdefault(cls, []).append((t, raw))
        when = by["time"][0][0]
        m = DATE_RE.search(when)
        if not m:
            continue
        d, mo, y, tm = m.groups()
        teams = by.get("team", [])
        home, away = (teams[0][0] if len(teams) > 0 else ""), (teams[1][0] if len(teams) > 1 else "")
        home_id = away_id = ""
        if len(teams) > 0:
            ids = [parse_args(r)["leagueGroupTeamID"] for r in SHOW_RE.findall(teams[0][1])]
            home_id = ids[0] if ids else ""
        if len(teams) > 1:
            ids = [parse_args(r)["leagueGroupTeamID"] for r in SHOW_RE.findall(teams[1][1])]
            away_id = ids[0] if ids else ""
        organiser = teams[2][0] if len(teams) > 2 else ""
        venue = by.get("venue", [("", "")])[0][0]
        score = by.get("score", [("", "")])[0][0]
        points = by.get("points", [("", "")])[0][0]
        wo = by.get("wo", [("", "")])[0][0]
        sm = SCORE_RE.match(score)
        played = bool(sm)
        if team_id:
            is_home = home_id == team_id
        else:
            is_home = bool(US_RE.search(home))
        outcome = None
        if played:
            h, a = int(sm.group(1)), int(sm.group(2))
            us, them = (h, a) if is_home else (a, h)
            outcome = "V" if us > them else "T" if us < them else "U"
        match_id, link_args = "", None
        for raw in SHOW_RE.findall(by["matchno"][0][1] if "matchno" in by else ""):
            a = parse_args(raw)
            if a["subPage"] == "5" and a["leagueMatchID"]:
                match_id, link_args = a["leagueMatchID"], a
        matches.append({
            "date": f"{y}-{int(mo):02d}-{int(d):02d}",
            "time": tm.replace(".", ":") if tm else None,
            "home": home,
            "away": away,
            "isHome": is_home,
            "opponent": away if is_home else home,
            "organiser": organiser,
            "venue": venue,
            "result": score.replace(" ", "") if played else None,   # None = ikke spillet
            "points": points if played else None,
            "outcome": outcome,        # V / T / U set fra Hørsholms side
            "walkover": wo,            # fx "Afb." = afgjort uden kamp
            "played": played,
            "matchID": match_id,
            "url": PUBLIC_LINK.format(hash_of(link_args)) if link_args else "",
            "games": [],               # udfyldes fra subPage 5
        })
    matches.sort(key=lambda m: (m["date"], m["time"] or ""))
    return matches


def parse_games(fragment):
    """subPage 5 → enkeltkampe fra tabellen 'matchresultschema'.
    Pr. række: discipline | player (hjemme) | player/playerwinner (ude) | result × sæt | wo.
    Kun disse rækker læses — holdledernes kontaktoplysninger øverst gemmes aldrig."""
    games = []
    for row in ROW_RE.findall(fragment):
        c = cells_by_class(row)
        disc_cell = next((t for cls, t, _ in c if cls == "discipline"), "")
        disc = DISC_RE.match(disc_cell)
        if not disc:
            continue
        sides = [(cls, raw) for cls, _, raw in c if cls in ("player", "playerwinner")]
        def players(raw):
            return [{"id": pid, "name": text(n)} for pid, n in PLAYER_A_RE.findall(raw)]
        home = players(sides[0][1]) if len(sides) > 0 else []
        away = players(sides[1][1]) if len(sides) > 1 else []
        sets = []
        for cls, t, _ in c:
            if cls == "result":
                m = SET_RE.search(t)
                if m:
                    sets.append([int(m.group(1)), int(m.group(2))])
        winner = None
        if len(sides) > 1:
            if sides[0][0] == "playerwinner":
                winner = "home"
            elif sides[1][0] == "playerwinner":
                winner = "away"
        if winner is None and sets:
            hs = sum(1 for a, b in sets if a > b)
            as_ = sum(1 for a, b in sets if b > a)
            winner = "home" if hs > as_ else "away" if as_ > hs else None
        wo = next((t for cls, t, _ in c if cls == "wo"), "")
        games.append({
            "discipline": f"{disc.group(1)}. {disc.group(2).upper()}",
            "home": home,
            "away": away,
            "sets": sets,
            "winner": winner,
            "walkover": wo,
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
                                            "games": 0, "won": 0, "disciplines": [],
                                            "url": (f"https://badmintonplayer.dk/DBF/Spiller/VisSpiller/#{p['id']}"
                                                    if p["id"] else "")})
                r["games"] += 1
                if g["winner"] == side:
                    r["won"] += 1
                d = re.sub(r"^\d+\.\s*", "", g["discipline"])
                if d not in r["disciplines"]:
                    r["disciplines"].append(d)
    return sorted(roster.values(), key=lambda r: (-r["games"], r["name"]))



# ---------- Individuelle turneringer (sæsonplan) ----------
# GetSeasonPlan returnerer hele Danmarks turneringskalender som HTML-tabel, 100 rækker pr. side.
# Vi henter den UDEN spillerfilter: et spillerfilter lægger spillerens fødselsdato i svaret.
MONTHS_DA = {"januar": 1, "februar": 2, "marts": 3, "april": 4, "maj": 5, "juni": 6, "juli": 7,
             "august": 8, "september": 9, "oktober": 10, "november": 11, "december": 12}
LEVELS = ["E", "M", "A", "B", "C", "D"]          # Elite, Mester, A … D
CLASS_RE = re.compile(r"^\s*((?:U\d{2}|SEN(?:\+\d{2})?)(?:/(?:U\d{2}|SEN(?:\+\d{2})?))*)\s*([EMABCD](?:\s*,\s*[EMABCD])*)\s*$")


def parse_class(txt):
    """'U17/U19 A,B' → {'raw', 'ages': ['U17','U19'], 'levels': ['A','B']}; ukendt format → kun raw."""
    t = re.sub(r"\s+", " ", txt.replace("\xa0", " ")).strip()
    m = CLASS_RE.match(t) or CLASS_RE.match(re.sub(r"^(U\d{2})([EMABCD])", r"\1 \2", t))
    if not m:
        return {"raw": t, "ages": [], "levels": []}
    return {"raw": t, "ages": m.group(1).split("/"), "levels": [x.strip() for x in m.group(2).split(",")]}


def seasonplan(token, season, page):
    payload = {"callbackcontextkey": token, "seasonid": str(season), "regionids": None, "agegroupids": None,
               "classids": None, "strfrom": "", "strto": "", "strweekno": "", "strweekno2": "",
               "georegionids": None, "clubid": None, "disciplines": None, "playerid": None, "birthdate": None,
               "age": None, "points": None, "gender": None, "publicseasonplan": True, "showleague": False,
               "selectclientfunction": None, "page": page}
    status, final_url, body = http(BASE + "/SportsResults/Components/WebService1.asmx/GetSeasonPlan",
                                   data=json.dumps(payload).encode("utf-8"),
                                   extra_headers={"Content-Type": "application/json; charset=utf-8",
                                                  "X-Requested-With": "XMLHttpRequest",
                                                  "Referer": BASE + "/DBF/Turnering/SaesonPlan/"})
    d = json.loads(body).get("d", {})
    return d.get("html", "") if isinstance(d, dict) else ""


LINK_LABELS = collections.Counter()   # linktekster i sæsonplanen (til fejlsøgning — skrives som notits i Actions)


def parse_seasonplan(fragment, season):
    """Én side af sæsonplanen → liste af turneringer."""
    out, month, year = [], None, int(season)
    # Del i måneds-overskrifter og turneringsrækker i dokumentrækkefølge
    for m in re.finditer(r"<tr class='grouphdr'><td[^>]*>\s*([^<]+?)\s*</td>|<tr class='row[^']*'>(.*?)<td class='links'>(.*?)</td>\s*</tr>",
                         fragment, re.S):
        if m.group(1):
            mm = re.match(r"([a-zæøå]+)\s+(\d{4})", text(m.group(1)).lower())
            if mm and mm.group(1) in MONTHS_DA:
                month, year = MONTHS_DA[mm.group(1)], int(mm.group(2))
            continue
        row, links = m.group(2), m.group(3)
        if not month:
            continue
        # Turnerings-id fra et af linkene — mange kommende turneringer har kun Invitation/Tilmeld endnu
        tid = (re.search(r"DeltagerListe/(\d+)", links) or re.search(r"VisResultater/#(\d+)", links)
               or re.search(r"VisInvitation/#(\d+)", links) or re.search(r"TilmeldTurnering/#(\d+)", links))
        cells = dict()
        for cls, inner in re.findall(r"<td class='(week|date|title)'>(.*?)</td>", row, re.S):
            cells.setdefault(cls, []).append(text(inner))
        days = re.findall(r"\d+", (cells.get("date") or [""])[0])
        if not days:
            continue
        d1 = int(days[0]); d2 = int(days[-1])
        start = f"{year}-{month:02d}-{d1:02d}"
        em, ey = month, year
        if d2 < d1:                       # fx 31.-1. går over månedsskifte
            em, ey = (1, year + 1) if month == 12 else (month + 1, year)
        end = f"{ey}-{em:02d}-{d2:02d}"
        deadline = ""
        dl = (cells.get("date") or ["", ""])
        if len(dl) > 1:
            dm = re.match(r"(\d{1,2})-(\d{1,2})", dl[1])
            if dm:
                dd, mo = int(dm.group(1)), int(dm.group(2))
                dy = year if mo <= month else year - 1
                deadline = f"{dy}-{mo:02d}-{dd:02d}"
        classes = []
        for cd, cn in re.findall(r"class='classdate'\s*>(.*?)</td>.*?class='classnames'>(.*?)</td>", row, re.S):
            c = parse_class(text(cn))
            c["days"] = text(cd)
            classes.append(c)
        organiser = (cells.get("title") or [""])[0]
        if tid:
            t_id = tid.group(1)
        else:                                  # fx kun ekstern invitationsfil: stabilt id ud fra dato + arrangør
            import hashlib
            t_id = "x" + hashlib.sha1(f"{start}|{organiser}".encode("utf-8")).hexdigest()[:10]
        # Hvilke links rækken har (ændrer sig når invitation, deltagerliste, program og resultater lægges ud)
        kinds, labels = set(), []
        for href, attrs, inner in re.findall(r"<a\b[^>]*?href=[\'\"]([^\'\"]*)[\'\"]([^>]*)>(.*?)</a>", links, re.S):
            lab = text(inner) or (re.search(r"title=[\'\"]([^\'\"]*)", attrs) or [None, ""])[1]
            labels.append(lab)
            low = (href + " " + lab).lower()
            if "program" in low or "lodtr" in low:
                kinds.add("program")
            if "deltagerliste" in low:
                kinds.add("deltagere")
            if "visresultater" in low or "resultat" in low:
                kinds.add("resultater")
            if "invitation" in low or href.lower().endswith(".pdf"):
                kinds.add("invitation")
            if "tilmeld" in low:
                kinds.add("tilmelding")
        LINK_LABELS.update(labels)
        out.append({
            "id": t_id,
            "links": sorted(kinds),
            "entryOpen": "TilmeldTurnering" in links,
            "hasResults": "VisResultater" in links and "Program" not in links,
            "start": start, "end": end,
            "week": (cells.get("week") or [""])[0],
            "deadline": deadline,
            "organiser": organiser,
            "classes": classes,
        })
    return out


def fetch_tournaments(token, season, dump, max_pages=20):
    seen, allt = set(), []
    for page in range(max_pages):
        if page:
            time.sleep(PAUSE)
        html_page = seasonplan(token, season, page)
        dump(f"seasonplan_{page}.html", html_page)
        rows = parse_seasonplan(html_page, season)
        new = [t for t in rows if t["id"] not in seen]
        for t in new:
            seen.add(t["id"])
        allt.extend(new)
        pages = [int(x) for x in re.findall(r"ShowPage\((\d+)\)", html_page)]
        if not new or (pages and page >= max(pages)) or not pages:
            break
    allt.sort(key=lambda t: (t["start"], t["organiser"]))
    if os.environ.get("GITHUB_ACTIONS"):
        print("::notice title=Sæsonplan-links::" + "; ".join(f"{k or '(tom)'}={v}" for k, v in LINK_LABELS.most_common(15)).replace("\n", " "))
    return allt



# ---------- Sted, region og afstand for turneringer ----------
# Arrangørens navn → stednavn → koordinater via Danmarks Adressers Web API (api.dataforsyningen.dk, åbent, ingen nøgle).
# Resultater gemmes i data/steder.json (slås kun op én gang). Rettelser i hånden: data/steder_rettelser.json
#   {"Rosendal": {"sted": "Gentofte"}}  eller  {"KMB2010": {"lat": 55.68, "lon": 12.57}}  eller  {"Kredsmatch": {"ukendt": true}}
# DAWA (api.dataforsyningen.dk) blev lukket i 2026 (svarer 410 Gone) — vi bruger OpenStreetMap's Nominatim.
NOMINATIM = "https://nominatim.openstreetmap.org/search"
NOM_UA = "hoebk-app/1.0 (github.com/christoffergroenfeldt-cyber/Hoebk)"   # påkrævet af Nominatims brugsregler
NET_FAIL = [0]   # tæller netværksfejl, så vi ikke gemmer "ukendt" pga. en midlertidig fejl
HOME = (55.8806, 12.5007)          # Hørsholm
# Udenlandske turneringer (BWF/BE-turneringer i sæsonplanen) — store/små bogstaver er ligegyldige
ABROAD_RE = re.compile(r"\b(international|intern\.|open|ic|is|fs|future series|super \d+|challenge|youth games|junior|german|irish|"
                       r"swedish|norwegian|polish|czech|hellas|bulgarien|ungarn|türkiye|tyrkiye|croatian|lithuanian|belgian|dutch|"
                       r"artic|arctic|ruhr|scottish|welsh|english|sloven\w*|iceland\w*|finn\w*|eston\w*|latvi\w*|spa\w*nish|spain|"
                       r"portug\w*|ital\w*|austria\w*|swiss|slovak\w*|hungar\w*|serbia\w*|romania\w*|gree\w*|ukrain\w*|"
                       r"luxembourg|cyprus|malta|france|french|sweden|norway|poland|germany|netherlands|belgium|ireland|scotland|"
                       r"wales|england|lithuania|croatia|bulgaria|turkey|faroe|greenland)\b", re.I)
DANISH_RE = re.compile(r"\b(denmark|danish|danmark|dansk|DMC|DM|DMU|UDM|LMU|KMU|KMB)\b", re.I)


def is_abroad(org):
    return bool(ABROAD_RE.search(org)) and not DANISH_RE.search(org)
NOISE = {"badminton", "bk", "bc", "sk", "sf", "if", "ic", "obk", "tik", "ab", "dgi", "hb2000", "hsb85", "begynderturnering",
         "introturnering", "kredsmesterskab", "victor", "denmark", "junior", "senior", "lbs", "hallen", "kultur", "og",
         "idrætscenter", "stævne", "monrad", "tpi", "bec", "circuit", "mgp", "dmc", "efterskole", "aflyst", "pulje-cup",
         "turnering", "alle", "kategorier", "niveau", "puljeturnering", "double", "mix", "danish", "cup", "pigetræningsdag",
         "jyske", "mesterskaber", "d.", "efterskoleturnering", "specielle", "tilmeldingsbetingelser", "-", "–", "i", "super",
         "storstrømmen"}
ABBREV = {"kbh.": "København", "kbh": "København", "nr.": "Nørre", "sdr.": "Søndre", "st.": "Store", "ll.": "Lille"}


def place_candidates(org):
    """Mulige stednavne i en arrangør-tekst, mest sandsynlige først."""
    parts = [org]
    if " i " in org:
        parts.insert(0, org.split(" i ")[-1])
    if ":" in org:
        a, b = org.split(":", 1)
        parts += [b, a]
    out = []
    for part in parts:
        words = [w.strip(":;.") if w.lower() not in ABBREV else w for w in re.split(r"[\s/,]+", part) if w]
        words = [ABBREV.get(w.lower(), w) for w in words if w]
        words = [re.sub(r"(?i)hallen$", "", w) if len(w) > 9 else w for w in words]
        words = [w for w in words if w.lower() not in NOISE and not re.match(r"^(U\d|\d)", w)]
        if not words:
            continue
        joined = " ".join(words)
        for c in [joined] + [" ".join(words[i:i + 2]) for i in range(len(words) - 1)] + words:
            for v in (c, c.split("-")[0]):
                v = v.strip(" .-")
                if len(v) >= 3 and v not in out:
                    out.append(v)
    return out[:8]


def _find_center(obj):
    if isinstance(obj, dict):
        for k in ("visueltcenter", "visueltCenter"):
            v = obj.get(k)
            if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
                return v
        for v in obj.values():
            r = _find_center(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_center(v)
            if r:
                return r
    return None


GEO_DEADLINE = [0.0]   # tidsbudget for stedopslag pr. kørsel (resten tages næste gang)


def geo_time_left():
    return time.time() < GEO_DEADLINE[0]


_NOM_LAST = [0.0]
_NOM_CACHE = {}


def nominatim(q):
    """Første danske træf for q fra Nominatim: {lat, lon, region, kind} eller None. Højst 1 kald/sek."""
    if q in _NOM_CACHE:
        return _NOM_CACHE[q]
    wait = 1.1 - (time.time() - _NOM_LAST[0])
    if wait > 0:
        time.sleep(wait)
    _NOM_LAST[0] = time.time()
    url = NOMINATIM + "?" + urllib.parse.urlencode({"q": q, "countrycodes": "dk", "format": "jsonv2",
                                                    "addressdetails": 1, "limit": 1, "accept-language": "da"})
    try:
        status, final, body = http(url, extra_headers={"Accept": "application/json", "User-Agent": NOM_UA}, timeout=12)
        res = json.loads(body)
    except Exception:
        NET_FAIL[0] += 1
        return None
    hit = None
    if isinstance(res, list) and res:
        r = res[0]
        addr = r.get("address") or {}
        hit = {"lat": round(float(r["lat"]), 4), "lon": round(float(r["lon"]), 4),
               "region": (addr.get("state") or "").replace("Region ", ""),
               "kind": r.get("category", "") + "/" + r.get("type", ""),
               "by": addr.get("town") or addr.get("city") or addr.get("village") or addr.get("suburb") or ""}
    _NOM_CACHE[q] = hit
    return hit


def geocode(name):
    g = nominatim(name)
    return dict(g, via="nominatim") if g else None


def region_of(lat, lon, hint=""):
    return hint or ""


def km_from_home(lat, lon):
    import math
    r = 6371.0
    p1, p2 = math.radians(HOME[0]), math.radians(lat)
    dp, dl = p2 - p1, math.radians(lon - HOME[1])
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(a)))



# ---------- Køretid fra Hørsholm (OSRM, OpenStreetMap) ----------
HOME_ADDR = "Stadion Allé 7D, 2960 Rungsted Kyst"
HOME_HALL = (55.8783, 12.5167)       # Hørsholm Badminton Hal (cirka)
OSRM = "https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=false"


def drive(lat, lon):
    """(minutter, km) i bil fra Hørsholm-hallen, eller (None, None)."""
    try:
        if not geo_time_left():
            return None, None
        status, final, body = http(OSRM.format(HOME_HALL[1], HOME_HALL[0], lon, lat), extra_headers={"Accept": "application/json"}, timeout=10)
        r = json.loads(body)["routes"][0]
        time.sleep(1.0)                                  # OSRM's demo-server: højst 1 kald pr. sekund
        return round(r["duration"] / 60), round(r["distance"] / 1000)
    except Exception:
        return None, None


def hall_name(venue):
    """'Skinderskov­hallen 1-2' → 'Skinderskovhallen'; 'Hørsholm Badminton Hal 2-5' → 'Hørsholm Badminton Hal'."""
    v = re.sub(r"\s+\d+(\s*-\s*\d+)?\s*$", "", venue or "").strip()
    v = re.sub(r",?\s*Hal\s*\d.*$", "", v).strip()
    return v


def locate_matches(teams, data_dir):
    """Sæt match['travel'] = {min, km, precision, query} for alle holdkampe (cachet i data/steder.json)."""
    cache_p = os.path.join(data_dir, "steder.json")
    cache = json.load(open(cache_p, encoding="utf-8")) if os.path.exists(cache_p) else {}
    fix_p = os.path.join(data_dir, "steder_rettelser.json")
    fixes = json.load(open(fix_p, encoding="utf-8")) if os.path.exists(fix_p) else {}
    done = new = 0
    for t in teams:
        for m in t["matches"]:
            venue, org = m.get("venue", ""), m.get("organiser", "") or (m["home"] if not m["isHome"] else "Hørsholm")
            key = f"hal|{venue}|{org}"
            if key not in cache and not geo_time_left():
                m["travel"] = {"precision": "ukendt", "query": ", ".join(x for x in [hall_name(venue), org] if x)}
                continue
            if key not in cache:
                new += 1
                hall = hall_name(venue)
                entry = None
                fix = fixes.get(venue) or fixes.get(hall)
                if fix and "lat" in fix:
                    entry = {"lat": fix["lat"], "lon": fix["lon"], "precision": "rettet", "by": fix.get("by", "")}
                if entry is None and re.search(r"hørsholm", venue, re.I):
                    entry = {"lat": HOME_HALL[0], "lon": HOME_HALL[1], "precision": "hal"}
                fails = NET_FAIL[0]
                towns = (place_candidates(org) + place_candidates(m["home"] if not m["isHome"] else m["away"]))[:3]
                if entry is None and hall:
                    for q in [f"{hall}, {towns[0]}" if towns else None, hall]:
                        g = geocode(q) if q else None
                        if g and not g["kind"].startswith("boundary/") and not g["kind"].startswith("place/"):
                            entry = {"lat": g["lat"], "lon": g["lon"], "precision": "hal", "by": g.get("by", "")}
                            break
                if entry is None:
                    for cand in towns:
                        g = geocode(cand)
                        if g:
                            entry = {"lat": g["lat"], "lon": g["lon"], "precision": "by", "by": cand}
                            break
                if entry:
                    mins, km = (0, 0) if entry["precision"] == "hal" and re.search(r"hørsholm", venue, re.I) else drive(entry["lat"], entry["lon"])
                    entry.update({"min": mins, "km": km})
                elif NET_FAIL[0] == fails:
                    entry = {"ukendt": True}
                if entry is None:          # netværksfejl — prøv igen næste gang
                    m["travel"] = {"precision": "ukendt", "query": ", ".join(x for x in [hall, org] if x)}
                    continue
                cache[key] = entry
            e = cache[key]
            hall = hall_name(venue)
            town = e.get("by") or org
            m["travel"] = {
                "min": e.get("min"), "km": e.get("km"), "precision": e.get("precision", "ukendt"),
                "lat": e.get("lat"), "lon": e.get("lon"),
                "query": ", ".join(x for x in [hall, town] if x),     # til rutevejledning i kortappen
            }
            done += 1
    with open(cache_p, "w", encoding="utf-8") as fh:
        json.dump(dict(sorted(cache.items())), fh, ensure_ascii=False, indent=1)
    print(f"Køretider: {done} holdkampe ({new} nye spillesteder slået op)")


def locate_tournaments(tours, data_dir):
    cache_p = os.path.join(data_dir, "steder.json")
    fix_p = os.path.join(data_dir, "steder_rettelser.json")
    cache = json.load(open(cache_p, encoding="utf-8")) if os.path.exists(cache_p) else {}
    fixes = json.load(open(fix_p, encoding="utf-8")) if os.path.exists(fix_p) else {}
    fixes = {k: v for k, v in fixes.items() if not k.startswith("_")}
    for t in tours:
        org = t["organiser"]
        fix = fixes.get(org)
        if fix is None and org in cache and bool(cache[org].get("abroad")) != is_abroad(org):
            del cache[org]                         # udlands-reglen er ændret siden opslaget
        if fix is None and org not in cache and is_abroad(org):
            cache[org] = {"abroad": True}
        if fix is None and org not in cache and geo_time_left():
            entry = None
            if is_abroad(org):
                entry = {"abroad": True}
            else:
                fails = NET_FAIL[0]
                for cand in place_candidates(org)[:4]:
                    g = geocode(cand)
                    if g:
                        entry = {"sted": cand, "lat": g["lat"], "lon": g["lon"], "region": g["region"], "via": g["via"]}
                        break
                if entry is None and NET_FAIL[0] == fails:
                    entry = {"ukendt": True, "prøvet": place_candidates(org)[:4]}
            if entry is not None:
                cache[org] = entry
        e = dict(cache.get(org, {}))
        if fix:                                   # håndrettelse vinder altid
            if fix.get("sted") and not ("lat" in fix):
                g = geocode(fix["sted"])
                e = {"sted": fix["sted"], "lat": g["lat"], "lon": g["lon"], "region": g["region"]} if g else {"ukendt": True}
            else:
                e = dict(fix)
                if "lat" in e and "region" not in e:
                    e["region"] = ""
        if "lat" in e:
            if "min" not in e and org in cache and "lat" in cache[org] and geo_time_left():
                cache[org]["min"], cache[org]["roadKm"] = drive(e["lat"], e["lon"])
                e["min"], e["roadKm"] = cache[org]["min"], cache[org]["roadKm"]
            t["place"] = {"name": e.get("sted", org), "lat": e["lat"], "lon": e["lon"],
                          "km": km_from_home(e["lat"], e["lon"]), "region": e.get("region", ""),
                          "min": e.get("min"), "roadKm": e.get("roadKm")}
        elif e.get("abroad"):
            t["place"] = {"abroad": True, "region": "Udland"}
        else:
            t["place"] = {"unknown": True}
    with open(cache_p, "w", encoding="utf-8") as fh:
        json.dump(dict(sorted(cache.items())), fh, ensure_ascii=False, indent=1)
    found = sum(1 for t in tours if "km" in t.get("place", {}))
    print(f"Steder: {found}/{len(tours)} turneringer placeret, "
          f"{sum(1 for t in tours if t['place'].get('abroad'))} i udlandet, "
          f"{sum(1 for t in tours if t['place'].get('unknown'))} ukendte (ret i data/steder_rettelser.json)")


def write_players(out_teams, out_dir, season, token=None, profiles=None, dump=lambda *a: None):
    """Spillere: historik fra opstillinger + profil fra badmintonplayer.dk → spillere.json (inkl. klubrangliste).
    profiles: None = ingen profiler, "all" = hent alle, "new" = genbrug fra sidste spillere.json og hent kun nye."""
    SENIOR_AGES = {"1", "9", "16"}   # SEN, SEN+40, MOT — voksne rækker
    players = {}
    for t in out_teams:
        for m in t["matches"]:
            side = "home" if m["isHome"] else "away"
            other = "away" if side == "home" else "home"
            for g in m["games"]:
                ours = g[side]
                for p in ours:
                    key = p["id"] or p["name"]
                    pl = players.setdefault(key, {"id": p["id"], "name": p["name"], "teams": [],
                                                  "adult": False, "games": []})
                    if t["label"] not in pl["teams"]:
                        pl["teams"].append(t["label"])
                    if t.get("ageGroupID") in SENIOR_AGES:
                        pl["adult"] = True
                    pl["games"].append({
                        "date": m["date"], "team": t["label"], "teamName": t["name"],
                        "opponentTeam": m["opponent"], "matchID": m["matchID"],
                        "discipline": g["discipline"],
                        "partner": [x["name"] for x in ours if (x["id"] or x["name"]) != key],
                        "opponents": [x["name"] for x in g[other]],
                        "sets": g["sets"] if side == "home" else [[b, a] for a, b in g["sets"]],
                        "won": g["winner"] == side,
                        "walkover": g.get("walkover", ""),
                    })
    for pl in players.values():
        pl["games"].sort(key=lambda x: x["date"], reverse=True)
        real = [x for x in pl["games"] if x["sets"]]          # kampe med sætcifre (ikke W.O.)
        pl["played"] = len(pl["games"])
        pl["won"] = sum(1 for x in pl["games"] if x["won"])
        pl["lost"] = pl["played"] - pl["won"]
        pl["winPct"] = round(100 * pl["won"] / pl["played"]) if pl["played"] else 0
        pl["pointsFor"] = sum(a for x in real for a, b in x["sets"])
        pl["pointsAgainst"] = sum(b for x in real for a, b in x["sets"])
        pl["avgPoints"] = round(pl["pointsFor"] / len(real), 1) if real else 0
        pl["avgDiff"] = round((pl["pointsFor"] - pl["pointsAgainst"]) / len(real), 1) if real else 0
        pl["setsWon"] = sum(1 for x in real for a, b in x["sets"] if a > b)
        pl["setsLost"] = sum(1 for x in real for a, b in x["sets"] if b > a)
        by_disc = {}
        for x in pl["games"]:
            k = re.sub(r"^\d+\.\s*", "", x["discipline"])
            d = by_disc.setdefault(k, {"played": 0, "won": 0})
            d["played"] += 1
            d["won"] += 1 if x["won"] else 0
        pl["byDiscipline"] = by_disc

    old_prof = {}
    if profiles == "new":                      # genbrug profiler fra sidste fulde kørsel
        try:
            for op in json.load(open(os.path.join(out_dir, "spillere.json"), encoding="utf-8")).get("players", []):
                if op.get("id") and op.get("profile"):
                    old_prof[op["id"]] = op["profile"]
        except (OSError, ValueError):
            pass
    if profiles:
        todo = [pl for pl in players.values() if pl["id"] and not (profiles == "new" and pl["id"] in old_prof)]
        for pl in players.values():
            if pl["id"] in old_prof and profiles == "new":
                pl["profile"] = old_prof[pl["id"]]
        print(f"Henter profiler for {len(todo)} af {len(players)} spillere …")
        for pl in todo:
            time.sleep(PAUSE)
            try:
                prof = player_profile(token, pl["id"])
            except RuntimeError as e:
                print(f"ADVARSEL: profil {pl['id']}: {e}", file=sys.stderr)
                continue
            prof = strip_private(prof)
            dump(f"player_{'a' if pl['adult'] else 'y'}_{pl['id']}.json",
                 json.dumps(prof, ensure_ascii=False, indent=1))
            html_part = (prof.get("Html") or prof.get("html") or "") if isinstance(prof, dict) else ""
            pl["profile"] = parse_profile(html_part)

    players_out = sorted(players.values(), key=lambda p: p["name"])
    # Klubrangliste: flest vundne kampe; ved lighed højest sejrsprocent, så flest point
    ranked = sorted(players_out, key=lambda p: (-p["won"], -p["winPct"], -p["pointsFor"], p["name"]))
    club_ranking = [{"rank": i + 1, "id": p["id"], "name": p["name"], "teams": p["teams"],
                     "played": p["played"], "won": p["won"], "winPct": p["winPct"],
                     "pointsFor": p["pointsFor"], "avgPoints": p["avgPoints"], "avgDiff": p["avgDiff"]}
                    for i, p in enumerate(ranked)]
    pdata = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "season": season, "clubRanking": club_ranking, "players": players_out}
    p_out = os.path.join(out_dir, "spillere.json")
    with open(p_out, "w", encoding="utf-8") as f:
        json.dump(pdata, f, ensure_ascii=False, indent=1)
    print(f"Skrev {p_out}: {len(players_out)} spillere.")
    return players_out


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
    ap.add_argument("--tournaments", action="store_true",
                    help="Hent sæsonplanen for individuelle turneringer til data/turneringer.json")
    ap.add_argument("--profiles", action="store_true",
                    help="Hent spillerprofiler (rangliste, point, resultater) til data/spillere.json")
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

    out_teams, standings_cache = [], {}
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
        matches = parse_matches(m_html, a.get("leagueGroupTeamID", ""))

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
                dump(f"match_{a.get('ageGroupID') or 'x'}_{m['matchID']}.html", g_html)
                m["games"] = parse_games(g_html)
                if opts.names == "first":
                    for g in m["games"]:
                        for side in ("home", "away"):
                            for p in g[side]:
                                p["name"] = short_name(p["name"], "first")

        standing_args = dict(a, subPage="2", leagueGroupTeamID="")
        lg = a.get("leagueGroupID", "")
        if lg not in standings_cache:
            time.sleep(PAUSE)
            try:
                s_html = standing(token, standing_args)
                dump(f"pulje_{lg}.html", s_html)
                standings_cache[lg] = parse_standings(s_html)
            except RuntimeError as e:
                print(f"ADVARSEL: stilling {lg}: {e}", file=sys.stderr)
                standings_cache[lg] = []
        table = standings_cache[lg]
        me = next((r for r in table if r["teamID"] == a.get("leagueGroupTeamID")), None)
        out_teams.append({
            "name": t["name"],
            "pulje": t.get("pulje", ""),
            "label": re.split(r",|\s+Pulje\b", t.get("pulje", "") or t["name"])[0].strip(),
            "position": me["pos"] if me else "",
            "standing": table,
            "leagueGroupID": a.get("leagueGroupID", ""),
            "ageGroupID": a.get("ageGroupID", ""),
            "leagueGroupTeamID": a.get("leagueGroupTeamID", ""),
            "bpArgs": {k: v for k, v in a.items() if k not in ("subPage", "leagueMatchID")},   # til hurtig opdatering (fetch_live.py)
            "url": PUBLIC_LINK.format(hash_of(a)),
            "standingUrl": PUBLIC_LINK.format(hash_of(standing_args)),
            "matches": matches,
            "players": build_roster(matches, opts.names),
        })
        played = sum(1 for m in matches if m["played"])
        with_lineup = sum(1 for m in matches if m["games"])
        print(f"  {t['name']} · {t.get('pulje', '')}: {len(matches)} kampe ({played} spillet, "
              f"{with_lineup} med opstilling), {len(out_teams[-1]['players'])} spillere")

    # ---- Individuelle turneringer (hele landets sæsonplan) ----
    if opts.tournaments:
        try:
            GEO_DEADLINE[0] = time.time() + 6 * 60
            tours = fetch_tournaments(token, opts.season, dump)
            try:
                locate_tournaments(tours, os.path.dirname(opts.out) or ".")
            except Exception as e:  # steder må ikke vælte turneringerne
                print(f"ADVARSEL: stedopslag fejlede: {e}", file=sys.stderr)
            t_out = os.path.join(os.path.dirname(opts.out) or ".", "turneringer.json")
            with open(t_out, "w", encoding="utf-8") as fh:
                json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           "season": opts.season, "source": "badmintonplayer.dk sæsonplan",
                           "levels": LEVELS, "tournaments": tours}, fh, ensure_ascii=False, indent=1)
            print(f"Skrev {t_out}: {len(tours)} turneringer.")
        except Exception as e:  # turneringer må ikke vælte holdkampene
            print(f"ADVARSEL: sæsonplan fejlede: {e}", file=sys.stderr)

    # ---- Køretid til holdkampenes spillesteder ----
    if not GEO_DEADLINE[0]:
        GEO_DEADLINE[0] = time.time() + 4 * 60
    else:
        GEO_DEADLINE[0] = max(GEO_DEADLINE[0], time.time() + 6 * 60)   # holdkampe går forud — altid mindst 6 min
    try:
        locate_matches(out_teams, os.path.dirname(opts.out) or ".")
    except Exception as e:  # må ikke vælte holdkampene
        print(f"ADVARSEL: køretider fejlede: {e}", file=sys.stderr)

    # ---- Spillere: historik fra opstillinger + profil fra badmintonplayer.dk ----
    write_players(out_teams, os.path.dirname(opts.out) or ".", opts.season, token,
                  "all" if opts.profiles else None, dump)

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
