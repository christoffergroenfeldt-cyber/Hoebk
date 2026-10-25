#!/usr/bin/env python3
"""discover_spillere.py — afprøver kald der kan give alle spillere i en klub (navne maskeres i diag)."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_holdkampe as f
import discover_turneringer as d

d.OUT = "diag"
CLUB = "1151"

def mask_names(html):
    html = re.sub(r"(<a[^>]*VisSpiller[^>]*>)(.*?)(</a>)", r"\1[NAVN]\3", html, flags=re.S)
    html = re.sub(r"(class=['\"]name['\"][^>]*>)([^<]*)", r"\1[NAVN]", html)
    return html

def report(tag, body):
    try:
        obj = json.loads(body)
    except ValueError:
        print(f"::warning title={tag}::ikke JSON: {body[:150]!r}"); return
    dd = obj.get("d", obj)
    html = ""
    if isinstance(dd, dict):
        keys = list(dd.keys())
        html = dd.get("html") or dd.get("Html") or ""
    else:
        keys = [type(dd).__name__]
        html = dd if isinstance(dd, str) else ""
    ids = set(re.findall(r"VisSpiller/#(\d+)", html))
    classes = sorted(set(re.findall(r"class=['\"]([\w -]+)['\"]", html)))[:25]
    print(f"::warning title={tag}::nøgler={keys} længde={len(html)} spiller-id={len(ids)} klasser={classes}")
    if html:
        d.save(tag + ".html", mask_names(html))

def main():
    _, _, page = f.http(f.BASE + "/DBF/Ranglister/", extra_headers={"Accept": "text/html"})
    tok = re.search(r"SR_CallbackContext\s*=\s*'([^']*)'", page).group(1)
    for name in ["", "a", "e"]:
        report(f"search_{name or 'tom'}", d.call("SearchPlayer", {"callbackcontextkey": tok, "selectfunction": "SPSel1", "name": name,
               "clubid": CLUB, "playernumber": "", "gender": "", "agegroupid": "", "searchteam": False, "licenseonly": False,
               "agegroupcontext": 0, "tournamentdate": ""}))
    base = {"callbackcontextkey": tok, "rankinglistagegroupid": None, "rankinglistid": None, "seasonid": "2026",
            "rankinglistversiondate": "", "agegroupid": None, "classid": None, "gender": None, "clubid": CLUB, "searchall": False,
            "regionid": None, "pointsfrom": None, "pointsto": None, "rankingfrom": None, "rankingto": None,
            "birthdatefromstring": "", "birthdatetostring": "", "agefrom": None, "ageto": None, "playerid": None,
            "param": None, "pageindex": 0, "sortfield": 0, "getversions": True, "getplayer": True}
    report("rank_null", d.call("GetRankingListPlayers", base))
    for rl in ["287", "288", "289", "1", "2", "3"]:
        report(f"rank_{rl}", d.call("GetRankingListPlayers", dict(base, rankinglistid=rl)))
    report("versions", d.call("GetRankingListVersions", {"callbackcontextkey": tok, "rankinglistagegroupid": None, "rankinglistid": None, "seasonid": "2026"}))

if __name__ == "__main__":
    main()
