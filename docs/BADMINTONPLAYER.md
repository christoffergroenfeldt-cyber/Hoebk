# badmintonplayer.dk integration

There is no public API. `fetch_holdkampe.py` uses the same web service the badmintonplayer.dk pages call from the browser. Everything below was confirmed against live responses in October 2026. If the site changes, start here.

## Session token

Every call needs a `callbackcontextkey`. It is embedded in any page:

```
GET https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/
→ var SR_CallbackContext = '…';
```

No login or cookie is needed for team data. The script can log in (secrets `BRUGER` → `BP_USER`, `BP_PWD`) but by default only does so if public calls return no teams (`--login auto`).

## GetLeagueStanding — team tournament data

```
POST https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding
Content-Type: application/json; charset=utf-8

{ "callbackcontextkey": "…", "subPage": "3", "seasonID": "2026", "leagueGroupID": "19102",
  "ageGroupID": "5", "regionID": "10", "leagueGroupTeamID": "124566", "leagueMatchID": "",
  "clubID": "1151", "playerID": "" }
→ { "d": { "html": "<…fragment…>" } }
```

The argument order matches the public URL hash: `#2,2026,19102,5,,,,1151,` = `subPage, seasonID, leagueGroupID, ageGroupID, regionID, leagueGroupTeamID, leagueMatchID, clubID, playerID`.

| subPage | Returns | Used for |
|---|---|---|
| 6 | All pools the club is in, **and every team in those pools** (including opponents) | Finding Hørsholm's teams |
| 2 | Pool standings (`table.groupstandings`) | `standing` |
| 3 | One team's matches (`table.matchlist`) | `matches` |
| 4 | All matches in a pool | not used |
| 5 | One match: header + lineup (`table.matchresultschema`) | `games` |
| 1 | Divisions for an age group | not used |

Links inside the HTML call `ShowStanding('3', '2026', …)` with the same argument order — the parser follows those instead of guessing ids. Note that `regionID` (e.g. `10`) must be taken from the links; it varies by division.

### Finding the club's teams (subPage 6)

The page lists pool links (no team id) and team links (with `leagueGroupTeamID`). Keep only team links whose name matches `Hørsholm|HØBK`; take the pool name from the longest pool-link text with the same `leagueGroupID`. Result in 2026/27: 13 teams.

### Match list (subPage 3)

`<table class='matchlist'>`, one `<tr>` per match, cells identified by class:

| class | Content |
|---|---|
| `time` | `lø 05‑09‑2026 13:30` — **the hyphens are U+2011 (non-breaking)** |
| `matchno` | Link with `leagueMatchID` |
| `team` ×3 | Home, away, organiser (home/away links carry `leagueGroupTeamID`) |
| `venue` | Hall — may contain soft hyphens (U+00AD) |
| `score` | `9-4`, or `-` if not played |
| `points` | League points `12-4` |
| `wo` | `Afb.` when decided without play |

### Match lineup (subPage 5)

`<table class='matchresultschema'>`: one `<tr>` per game.

| class | Content |
|---|---|
| `discipline` | `1. MD` … or `1. S` / `2. D` in 4-player divisions |
| `player` / `playerwinner` | Home cell then away cell; the winning side has `playerwinner` |
| `result` ×3 | `15&nbsp;-&nbsp;<b>8</b>` per set |
| `wo` | Walkover marker |

Player links use **single quotes**: `<a href='http://www.badmintonplayer.dk/DBF/Spiller/VisSpiller/#279971'>`. The top of the page holds team leaders' names, emails and phone numbers — the parser reads only discipline rows, so these are never stored.

### Standings (subPage 2)

`<table class='groupstandings'>`: rows start with `td.standing` (position), then `td.team1` (team link), then played, won, score, sets, points.

## GetPlayerProfile — rankings

```
POST https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetPlayerProfile
{ "callbackcontextkey": "…", "seasonid": null, "playerid": "11745",
  "getplayerdata": true, "showUserProfile": true, "showheader": false }
→ { "d": { "playerid": 11745, "playername": "…", "clubid": 1151, "clubname": "Hørsholm",
           "Html": "<h2>Tilknyttede brugerkonti</h2>…<h2>Ranglister</h2>…" } }
```

Note the capital **`Html`**. Sections in the HTML:

| Section | Parsed |
|---|---|
| Tilknyttede brugerkonti | **Skipped** (linked user accounts) |
| Ranglister | `Tilmeldingsniveau ved sæsonstart` + rows `Rangliste Single/Double/Mix`: category, points, matches, placement |
| Spillerlicens | licence text |
| Holdkampe | not used (we have richer data from lineups) |

The response may contain a player number like `060718-01`, which encodes the date of birth. `strip_private()` removes any such pattern and any field named like playernumber/birth/email/phone before anything is saved or dumped.

## Being polite

- 1.2 s pause between calls (`PAUSE`), 30 s timeout, 2 retries.
- A full run is roughly 1 + 13 teams + ~40 played matches + 13 pools + ~70 profiles ≈ 140 calls ≈ 3 minutes.
- Browser-like `User-Agent` and `Referer` headers.

## When it breaks

1. Run the workflow manually with **debug** ticked (Actions → HØBK holdkampe → Run workflow).
2. The run pushes a sanitised copy of the raw pages to the `diag` branch (club, pool and team pages, senior match pages and adult profiles only; emails, phone numbers and player numbers masked).
3. Compare the HTML with the tables above and adjust the parser (`parse_club_teams`, `parse_matches`, `parse_games`, `parse_standings`, `parse_profile`).
4. **Delete the `diag` branch afterwards** — the repo is public.

Exit codes: `2` no session token, `3` no teams found, `4` teams found but no matches recognised.
