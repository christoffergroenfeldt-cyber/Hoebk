#!/usr/bin/env python3
"""
notify_turneringer.py — finder nyt om individuelle turneringer og sender det til dem der følger dem.
Også hold (id "f"+leagueGroupTeamID i fanen Følger): påmindelse 3 dage før og på kampdagen, resultat + placering,
og når dato/tid/spillested for en kommende kamp ændres (--old-hold / --new-hold).

Køres i GitHub Actions lige efter fetch_holdkampe.py --tournaments:
  python notify_turneringer.py --old /tmp/turneringer_old.json --new data/turneringer.json

1. Sammenligner forrige og ny data/turneringer.json → ændringer pr. turnering
   (frist, datoer, rækker, aflysning, tilmelding åbnet/lukket, invitation/deltagerliste/program/resultater lagt ud).
2. Påmindelser om tilmeldingsfrist 7 og 2 dage før (huskes i data/notifikationer.json, så de kun sendes én gang).
3. Skriver data/turnering_nyt.json (seneste nyt pr. turnering — vises i appen, ingen persondata).
4. Sender nyt om de turneringer der følges til Apps Script (action notify), som mailer dem der følger.

Miljø: REG_URL, REG_KEY (samme secrets som tilmeldingerne). Uden dem springes afsendelsen over.
       VAPID_PRIVATE: privat nøgle til push-notifikationer (offentlig nøgle står i config.json). Uden den: kun mail.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

APP_URL = "https://christoffergroenfeldt-cyber.github.io/Hoebk/"
MONS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
DAYS = ["man", "tir", "ons", "tor", "fre", "lør", "søn"]
REMIND = (7, 2)            # dage før tilmeldingsfristen
KEEP_NEWS = 12             # nyheder pr. turnering i turnering_nyt.json


def dk(d):
    x = date.fromisoformat(d)
    return f"{DAYS[x.weekday()]} {x.day}. {MONS[x.month - 1]}"


def when(t):
    return dk(t["start"]) + ("" if t.get("end", t["start"]) == t["start"] else "–" + dk(t["end"]))


def load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def classes(t):
    return [c.get("raw", "") for c in t.get("classes", [])]


def diff(old, new, today):
    """Liste af tekster om hvad der er ændret fra old til new (samme turnering)."""
    out = []
    if new.get("deadline") != old.get("deadline") and new.get("deadline"):
        out.append(f"Tilmeldingsfristen er ændret til {dk(new['deadline'])}" + (f" (var {dk(old['deadline'])})" if old.get("deadline") else ""))
    if (new.get("start"), new.get("end")) != (old.get("start"), old.get("end")):
        out.append(f"Datoen er ændret til {when(new)} (var {when(old)})")
    if new.get("organiser") != old.get("organiser"):
        if "aflyst" in new.get("organiser", "").lower():
            out.append("Turneringen er AFLYST")
        else:
            out.append(f"Navnet er ændret til {new.get('organiser')}")
    oc, nc = classes(old), classes(new)
    added = [c for c in nc if c not in oc]
    removed = [c for c in oc if c not in nc]
    if added:
        out.append("Nye rækker: " + ", ".join(added))
    if removed:
        out.append("Rækker fjernet: " + ", ".join(removed))
    if new.get("entryOpen") and not old.get("entryOpen"):
        out.append("Tilmeldingen er åbnet")
    elif old.get("entryOpen") and not new.get("entryOpen") and (not new.get("deadline") or new["deadline"] >= today):
        out.append("Tilmeldingen er lukket")
    if "links" in old:                          # ældre data har ikke links — ellers ville alt se nyt ud
        ol, nl = set(old.get("links", [])), set(new.get("links", []))
        started = new.get("start", "9999") <= today
        if "invitation" in nl - ol:
            out.append("Invitationen er lagt ud")
        if "deltagere" in nl - ol:
            out.append("Deltagerlisten er offentliggjort")
        if "program" in nl - ol or ("resultater" in nl - ol and not started):
            out.append("Programmet er klar (lodtrækning og spilletider)")
        elif "resultater" in nl - ol and started:
            out.append("Resultaterne er klar")
    return out


# ---------- Hold ----------
TEAM_REMIND = 3            # dage før en holdkamp (plus en besked på selve kampdagen)


def team_fid(t):
    return "f" + str(t.get("leagueGroupTeamID", ""))


def ours(score, is_home):
    if not score:
        return score
    a, _, b = score.partition("-")
    return score if is_home else f"{b}-{a}"


def match_line(m):
    tr = m.get("travel") or {}
    drive = ""
    if isinstance(tr.get("min"), int) and tr["min"] > 3:
        drive = f" · ca. {tr['min']} min i bil"
    return (f"{'Hjemme mod' if m.get('isHome') else 'Ude mod'} {m.get('opponent', '')} kl. {m.get('time') or '?'}"
            f" · {m.get('venue') or 'spillested ikke oplyst'}{drive}")


def team_events(old, new, today, sent):
    """id ('f'+holdID) → (titel, [tekster], url-suffix)."""
    out = {}
    olds = {team_fid(t): t for t in (old or {}).get("teams", [])}
    for t in (new or {}).get("teams", []):
        fid = team_fid(t)
        ot = olds.get(fid)
        om = {m.get("matchID"): m for m in (ot or {}).get("matches", [])}
        lines, link = [], ""
        for m in t.get("matches", []):
            mid, o = m.get("matchID"), om.get(m.get("matchID"))
            if m.get("played") and o is not None and not o.get("played"):
                word = {"V": "Sejr", "T": "Nederlag", "U": "Uafgjort"}.get(m.get("outcome"), "Resultat")
                pos = f" — holdet er nr. {t.get('position')} af {len(t.get('standing', []))}" if t.get("position") else ""
                lines.append(f"{word} {ours(m.get('result'), m.get('isHome'))} mod {m.get('opponent')}{pos}")
                link = link or f"/kamp/{mid}"
            elif not m.get("played") and o is not None and not o.get("played"):
                ch = []
                if m.get("date") != o.get("date"):
                    ch.append(f"ny dato {dk(m['date'])} (var {dk(o['date'])})")
                if m.get("time") != o.get("time"):
                    ch.append(f"nyt tidspunkt kl. {m.get('time')} (var {o.get('time')})")
                if (m.get("venue") or "") != (o.get("venue") or ""):
                    ch.append(f"nyt spillested {m.get('venue')}")
                if ch:
                    lines.append(f"Kampen mod {m.get('opponent')} er ændret: " + ", ".join(ch))
                    link = link or f"/kamp/{mid}"
            if not m.get("played") and m.get("date") and m["date"] >= today:
                left = (date.fromisoformat(m["date"]) - date.fromisoformat(today)).days
                k_day, k_pre = f"m{mid}:dag:{m['date']}", f"m{mid}:pre:{m['date']}"
                if left == 0 and k_day not in sent:
                    sent[k_day] = sent[k_pre] = today
                    lines.append("Kamp i dag: " + match_line(m))
                    link = link or f"/kamp/{mid}"
                elif 0 < left <= TEAM_REMIND and k_pre not in sent:
                    sent[k_pre] = today
                    lines.append(f"Kamp {dk(m['date'])}" + (" (i morgen)" if left == 1 else "") + ": " + match_line(m))
                    link = link or f"/kamp/{mid}"
        if lines:
            out[fid] = (f"{t.get('label')} ({t.get('name')})", lines, link)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", default="data/turneringer.json")
    ap.add_argument("--news", default="data/turnering_nyt.json")
    ap.add_argument("--state", default="data/notifikationer.json")
    ap.add_argument("--today", default="")
    ap.add_argument("--old-hold", default="", help="forrige data/holdkampe.json (til hold-notifikationer)")
    ap.add_argument("--new-hold", default="data/holdkampe.json")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    new = load(a.new)
    if not new:
        print("Ingen turneringer — springer over.")
        return 0
    old = load(a.old) or {"tournaments": []}
    today = a.today or datetime.now(timezone.utc).astimezone().date().isoformat()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    olds = {t["id"]: t for t in old.get("tournaments", [])}
    news_all = load(a.news) or {"tournaments": {}, "alias": {}}
    state = load(a.state) or {"sent": {}}

    # Turneringer der skifter fra midlertidigt id (x…) til rigtigt id: samme start + arrangør
    by_key = {(t["start"], t["organiser"]): t["id"] for t in old.get("tournaments", [])}
    alias = news_all.get("alias", {})
    events = {}                                   # id → [tekster]
    first_run = not olds
    for t in new["tournaments"]:
        o = olds.get(t["id"])
        if o is None:
            prev = by_key.get((t["start"], t["organiser"]))
            if prev and prev != t["id"] and prev in olds:
                alias[prev] = t["id"]
                o = olds[prev]
        if o is None:
            if not first_run:
                events.setdefault(t["id"], []).append("Ny turnering i kalenderen")
            continue
        lines = diff(o, t, today)
        if lines:
            events.setdefault(t["id"], []).extend(lines)
    new_ids = {t["id"] for t in new["tournaments"]}
    for oid, o in olds.items():
        if oid not in new_ids and oid not in alias and o.get("start", "") >= today:
            events.setdefault(oid, []).append("Turneringen er fjernet fra kalenderen (aflyst eller flyttet)")

    # Påmindelser om tilmeldingsfrist
    sent = state.setdefault("sent", {})
    for t in new["tournaments"]:
        dl = t.get("deadline")
        if not dl or dl < today or "aflyst" in t.get("organiser", "").lower():
            continue
        left = (date.fromisoformat(dl) - date.fromisoformat(today)).days
        keys = [f"{t['id']}:frist{n}:{dl}" for n in REMIND if left <= n]
        if keys and any(k not in sent for k in keys):   # kun én påmindelse ad gangen (den nærmeste)
            for k in keys:
                sent[k] = today
            txt = "i dag" if left == 0 else "i morgen" if left == 1 else f"om {left} dage"
            events.setdefault(t["id"], []).append(f"Tilmeldingsfristen er {txt} ({dk(dl)})")
    teams = team_events(load(a.old_hold) if a.old_hold else None, load(a.new_hold), today, sent) if a.old_hold else {}
    cutoff = (date.fromisoformat(today) - timedelta(days=120)).isoformat()
    state["sent"] = {k: v for k, v in sent.items() if v >= cutoff}

    # Nyheder til appen (frister er beregnet i appen, så de gemmes ikke som nyheder)
    tmap = {t["id"]: t for t in new["tournaments"]}
    nt = news_all.setdefault("tournaments", {})
    for old_id, new_id in alias.items():
        if old_id in nt:
            nt.setdefault(new_id, [])[:0] = nt.pop(old_id)
    for tid, lines in events.items():
        keep = [l for l in lines if not l.startswith("Tilmeldingsfristen er i") and not l.startswith("Tilmeldingsfristen er om")]
        if keep and tid in tmap:
            nt[tid] = ([{"d": today, "t": l} for l in keep] + nt.get(tid, []))[:KEEP_NEWS]
    keep_ids = new_ids
    news_all["tournaments"] = {k: v for k, v in nt.items() if k in keep_ids}
    news_all["alias"] = {k: v for k, v in alias.items() if v in keep_ids}
    news_all["updated"] = now
    with open(a.news, "w", encoding="utf-8") as f:
        json.dump(news_all, f, ensure_ascii=False, indent=1)
    with open(a.state, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)

    print(f"{len(events)} turneringer og {len(teams)} hold med nyt" + (" (første kørsel — kun påmindelser)" if first_run else ""))
    for fid, (title, lines, _) in teams.items():
        print(f"  {title}: " + " · ".join(lines))
    for tid, lines in list(events.items())[:15]:
        print(f"  {tmap.get(tid, olds.get(tid, {})).get('organiser', tid)}: " + " · ".join(lines))

    url, key = os.environ.get("REG_URL", "").strip(), os.environ.get("REG_KEY", "").strip()
    if not (events or teams) or not url or not key or a.dry_run:
        print("Ingen afsendelse" + ("" if events or teams else " (intet nyt)") + ("" if url and key else " (REG_URL/REG_KEY mangler)"))
        return 0

    # Kun turneringer nogen følger — hent listen (kun id'er) fra Apps Script
    try:
        q = urllib.parse.urlencode({"action": "follows", "key": key})
        with urllib.request.urlopen(urllib.request.Request(f"{url}?{q}", headers={"User-Agent": "hoebk-notify/1.0"}), timeout=30) as r:
            fol = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"ADVARSEL: kunne ikke hente følgere: {e}", file=sys.stderr)
        return 0
    if not fol.get("ok"):
        print(f"ADVARSEL: Apps Script svarede {fol.get('error')} — er den nye version implementeret?", file=sys.stderr)
        return 0
    followed = set(fol.get("follows", []))
    inv = {}
    for o_id, n_id in alias.items():
        inv.setdefault(n_id, []).append(o_id)
    items = []
    for tid, lines in events.items():
        ids = [tid] + inv.get(tid, [])
        if not followed.intersection(ids):
            continue
        t = tmap.get(tid) or olds.get(tid) or {}
        items.append({"ids": ids, "title": t.get("organiser", "Turnering"), "when": when(t) if t.get("start") else "",
                      "lines": lines, "url": APP_URL + "#/turnering/" + tid})
    for fid, (title, lines, link) in teams.items():
        if fid in followed:
            items.append({"ids": [fid], "title": title, "when": "", "lines": lines,
                          "url": APP_URL + "#/holdid/" + fid[1:] + link})
    if not items:
        print("Ingen af holdene/turneringerne med nyt følges af nogen.")
        return 0
    body = json.dumps({"action": "notify", "key": key, "items": items}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "text/plain;charset=utf-8", "User-Agent": "hoebk-notify/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read().decode("utf-8"))
        jobs = res.pop("push", []) if isinstance(res, dict) else []
        print(f"Notifikationer: {len(items)} turneringer → {res}, {len(jobs)} push")
    except Exception as e:
        print(f"ADVARSEL: afsendelse fejlede: {e}", file=sys.stderr)
        return 0
    if jobs:
        send_push(jobs, url, key)
    return 0


def send_push(jobs, url, key):
    vapid = os.environ.get("VAPID_PRIVATE", "").strip()
    if not vapid:
        print("Push springes over: VAPID_PRIVATE er ikke sat som GitHub-secret.")
        return
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        print("ADVARSEL: pywebpush mangler (pip install pywebpush)", file=sys.stderr)
        return
    ok, gone = 0, []
    for j in jobs:
        payload = json.dumps({"title": j.get("title", "HØBK"), "body": j.get("body", ""), "url": j.get("url", APP_URL), "tag": j.get("tag")},
                             ensure_ascii=False)
        try:
            webpush({"endpoint": j["endpoint"], "keys": j["keys"]}, payload, vapid_private_key=vapid,
                    vapid_claims={"sub": "mailto:noreply@hoebk.dk"}, ttl=86400, timeout=20)
            ok += 1
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):                       # telefonen har afmeldt / appen slettet
                gone.append(j["endpoint"])
            else:
                print(f"ADVARSEL: push fejlede ({code}): {str(e)[:120]}", file=sys.stderr)
        except Exception as e:
            print(f"ADVARSEL: push fejlede: {str(e)[:120]}", file=sys.stderr)
    print(f"Push: {ok} sendt, {len(gone)} døde adresser fjernes")
    if gone:
        try:
            body = json.dumps({"action": "pushGone", "key": key, "endpoints": sorted(set(gone))}).encode("utf-8")
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "text/plain;charset=utf-8", "User-Agent": "hoebk-notify/1.0"})
            urllib.request.urlopen(req, timeout=30).read()
        except Exception as e:
            print(f"ADVARSEL: kunne ikke fjerne døde push-adresser: {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
