#!/usr/bin/env python3
"""
discover_turneringer.py — undersøgelse af badmintonplayer.dk's turneringsdel (sæsonplan).
Kalder GetSeasonPlan på et par måder og gemmer svarene i diag/ (maskeret), så parseren
til individuelle turneringer kan skrives mod rigtige data.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_holdkampe as f  # genbruger http(), cookies og headers

OUT = "diag"
EP = f.BASE + "/SportsResults/Components/WebService1.asmx/"
MASK = [(re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "[EMAIL]"),
        (re.compile(r"(?<!\d)(?:\+45\s?)?(?:\d{2}\s?){3}\d{2}(?!\d)"), "[TLF]"),
        (re.compile(r"\b\d{6}-\d{2}\b"), "[SPILLERNR]"),
        (re.compile(r"params=[^'\"\\]*"), "params=[FJERNET]"),       # print-link kan indeholde fødselsdato
        (re.compile(r"\b\d{2}-\d{2}-(?:19|20)\d{2}\b"), "[DATO]")]


def save(name, text):
    for rx, rep in MASK:
        text = rx.sub(rep, text)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"  gemt {name} ({len(text)} tegn)")


def call(method, payload):
    data = json.dumps(payload).encode("utf-8")
    try:
        status, final, body = f.http(EP + method, data=data, extra_headers={
            "Content-Type": "application/json; charset=utf-8", "X-Requested-With": "XMLHttpRequest",
            "Referer": f.BASE + "/DBF/Turnering/SaesonPlan/"})
        return body
    except Exception as e:  # noqa
        return json.dumps({"error": str(e), "body": getattr(e, "read", lambda: b"")().decode("utf-8", "replace")[:3000]})


def seasonplan(token, **kw):
    p = {"callbackcontextkey": token, "seasonid": "2026", "regionids": None, "agegroupids": None, "classids": None,
         "strfrom": "", "strto": "", "strweekno": "", "strweekno2": "", "georegionids": None, "clubid": None,
         "disciplines": None, "playerid": None, "birthdate": None, "age": None, "points": None, "gender": None,
         "publicseasonplan": True, "showleague": False, "selectclientfunction": None, "page": 0}
    p.update(kw)
    return call("GetSeasonPlan", p)


def main():
    _, final, page = f.http(f.BASE + "/DBF/Turnering/SaesonPlan/", extra_headers={"Accept": "text/html"})
    save("saesonplan_page.html", page)
    m = re.search(r"SR_CallbackContext\s*=\s*'([^']*)'", page)
    token = m.group(1) if m else f.get_token()

    # Ét voksen-spiller-id fra vores egne data (kun voksne gemmes i diag)
    adult = ""
    try:
        sp = json.load(open("data/spillere.json", encoding="utf-8"))
        adult = next(p["id"] for p in sp["players"] if p.get("adult") and p["id"])
    except Exception as e:  # noqa
        print("ingen spillere.json:", e)

    tests = [
        ("all_2026", {}),
        ("all_2026_page1", {"page": 1}),
        ("club_1151", {"clubid": "1151"}),
        ("dates", {"strfrom": "01-11-2026", "strto": "31-12-2026"}),
    ]
    for name, kw in tests:
        if kw is None:
            continue
        time.sleep(1.2)
        save(f"seasonplan_{name}.json", seasonplan(token, **kw))


if __name__ == "__main__":
    main()
