# Data formats

All generated files are UTF-8 JSON with Danish names unescaped. Dates are `YYYY-MM-DD`, times `HH:MM` (Danish local time as shown on badmintonplayer.dk), `updated` is an ISO timestamp in UTC.

## `data/holdkampe.json` — teams, matches, lineups, standings

Written by `fetch_holdkampe.py`.

```jsonc
{
  "updated": "2026-10-25T13:14:08+00:00",
  "season": "2026",              // season start year (2026 = 2026/27)
  "clubID": "1151",              // Hørsholm on badmintonplayer.dk
  "source": "badmintonplayer.dk",
  "teams": [ Team, … ]           // 13 teams in 2026/27
}
```

**Team**

| Field | Example | Notes |
|---|---|---|
| `name` | `"Hørsholm 2"` | Team name — **not unique** (five teams are "Hørsholm 2") |
| `label` | `"U15 B"` | Short division label — use this in UI |
| `pulje` | `"U15 B, 6200 (4 spillere) Pulje 2"` | Full division/pool name |
| `position` | `"4"` | Current placing in the pool |
| `standing` | `[Row, …]` | Full pool table, see below |
| `leagueGroupID` | `"19102"` | Pool id |
| `ageGroupID` | `"5"` | 1 = SEN, 9 = SEN+40, 16 = MOT, 3/4/5 = U11/U13/U15 |
| `leagueGroupTeamID` | `"124566"` | Team id — unique |
| `url`, `standingUrl` | | badmintonplayer.dk links (kept for reference, not shown in the app) |
| `matches` | `[Match, …]` | Sorted by date/time |
| `players` | `[{id, name, games, won, disciplines, url}]` | Players who played for this team, most games first |

**Standing row:** `pos, team, teamID, isUs, played, won, score` (games, e.g. `"42-10"`), `sets` (e.g. `"81-26"`), `points` — all values as strings, exactly as published.

**Match**

| Field | Example | Notes |
|---|---|---|
| `date`, `time` | `"2026-11-15"`, `"10:00"` | |
| `home`, `away` | `"Hørsholm 2"`, `"Lillerød 1"` | As published |
| `isHome` | `true` | Decided by team id, not by name |
| `opponent` | `"Lillerød 1"` | Convenience |
| `organiser`, `venue` | `"Hørsholm"`, `"Hørsholm Badminton Hal 2-5"` | |
| `played` | `false` | |
| `result` | `"9-4"` or `null` | Games, **home–away order** |
| `points` | `"12-4"` or `null` | League points, home–away order |
| `outcome` | `"V"`, `"T"`, `"U"` or `null` | Win/loss/draw **from Hørsholm's side** |
| `walkover` | `"Afb."` or `""` | Decided without play |
| `matchID` | `"514330"` | Unique match id — also used for registrations (`m:514330`) |
| `games` | `[Game, …]` | Empty until played |
| `travel` | `{"min": 34, "km": 41.2, "precision": "hal", "lat": …, "lon": …, "query": "Lillerød Hallen, Lillerød"}` | Drive from Hørsholm Badminton Hal (Stadion Allé 7D). `precision`: `hal` (hall found), `by` (town of organiser/opponent), `rettet` (manual override), `ukendt` (no lookup yet — `min` missing). `query` is the destination sent to Google Maps |

**Game** (one individual match within the team match)

```jsonc
{ "discipline": "1. MD",                       // HS DS HD DD MD, or S/D in 4-player divisions
  "home": [{"id":"279971","name":"…"}, …],     // 1 player (single) or 2 (double)
  "away": [ … ],
  "sets": [[5,15],[5,15]],                     // home–away per set
  "winner": "away",                            // "home" | "away" | null
  "walkover": "" }
```

## `data/spillere.json` — players and club ranking

Written by `fetch_holdkampe.py --profiles`. Includes every Hørsholm player who has played at least one team match this season.

```jsonc
{
  "updated": "…", "season": "2026",
  "clubRanking": [ {rank, id, name, teams, played, won, winPct, pointsFor, avgPoints, avgDiff}, … ],
  "players": [ Player, … ]        // sorted by name
}
```

**Player**

| Field | Notes |
|---|---|
| `id` | badmintonplayer.dk player id |
| `name`, `teams` | Teams as labels, e.g. `["Serie 2", "Danmarksserien"]` |
| `adult` | `true` if they played in a senior/motion division (used by the Senior/Ungdom filter) |
| `played`, `won`, `lost`, `winPct` | Individual games in team matches |
| `pointsFor`, `pointsAgainst` | Rally points over all sets (walkovers excluded) |
| `avgPoints`, `avgDiff` | Per game with set scores |
| `setsWon`, `setsLost` | |
| `byDiscipline` | `{"MD": {"played": 3, "won": 2}, …}` — discipline without number |
| `games` | Every game, newest first: `date, team, teamName, opponentTeam, matchID, discipline, partner[], opponents[], sets (player's side first), won, walkover` |
| `profile.level` | Entry level at season start ("Tilmeldingsniveau") |
| `profile.rankings` | `[{list: "Single"/"Double"/"Mix", category: "SEN A", points, matches, placement}]` — placement is national |
| `profile.license` | Player licence status |

`clubRanking` is sorted by games won, then win %, then points, then name.

## `data/turneringer.json` — individual tournaments (whole country)

Written by `fetch_holdkampe.py --tournaments` from badmintonplayer.dk's season plan. Contains no player data.

```jsonc
{
  "updated": "…", "season": "2026", "source": "badmintonplayer.dk sæsonplan",
  "levels": ["E", "M", "A", "B", "C", "D"],        // Elite, Mester, A … D
  "tournaments": [
    { "id": "115651",                               // tournament id on badmintonplayer.dk
      "start": "2026-08-15", "end": "2026-08-16", "week": "33",
      "deadline": "2026-07-30",                     // entry deadline
      "organiser": "Hørsholm",                      // organising club / tournament name
      "classes": [
        { "raw": "U15 A,B,C", "ages": ["U15"], "levels": ["A","B","C"], "days": "lø 15-sø 16" },
        { "raw": "U17/U19 B,C,D", "ages": ["U17","U19"], "levels": ["B","C","D"], "days": "lø 15" } ] } ]
}
```

Since the location filters were added each tournament also has `entryOpen`, `hasResults` and `place`:

```jsonc
"place": { "name": "Lillerød", "region": "Region Hovedstaden", "km": 12.4,   // straight line from Hørsholm
           "min": 18, "roadKm": 15.1,                                      // drive (OSRM), when looked up
           "precision": "by" }                                             // or {"abroad": true} / {"ukendt": true}
```

Tournaments without a badmintonplayer.dk id get a synthetic id `x<sha1>` built from start date and organiser.

## `data/steder.json` and `data/steder_rettelser.json` — place lookups

`steder.json` is a cache written by the fetcher: one entry per tournament organiser, and per team-match venue under the key `hal|<venue>|<organiser>`. Lookups use DAWA (api.dataforsyningen.dk) for coordinates and region and the public OSRM server for drive time. Entries are kept between runs, so each place is looked up once; delete an entry to force a new lookup. Each run has a time budget (8 min for tournaments, at least 3 min for match venues); what doesn't fit is looked up on the next run.

`steder_rettelser.json` is edited by hand and wins over the cache — use it when a place lands wrong:

```json
{ "Denmark Open": "Odense", "Skovbakken": "Aarhus" }
```

Classes the parser can't split (e.g. `E-M*-række`, `Andet X`) keep only `raw` with empty `ages`/`levels`; they are shown but never matched to a level. The season plan has no venue or address — only the organiser.

**Level matching** happens in the app: a player's level comes from the category of their national rankings in `spillere.json` (`"SEN C-D"` → `SEN C` and `SEN D`; `"U15 M"` → `U15 M`). A tournament fits when one of its classes has the same age group and one of those levels.

## `data/traening.json` — training schedule (edited by hand)

```jsonc
{
  "venue": "Hørsholm Badminton Hal, Stadion Allé 7D",
  "season": { "from": "2026-08-10", "to": "2027-04-30" },
  "skip": [ { "from": "2026-10-12", "to": "2026-10-18", "reason": "Efterårsferie" } ],
  "sessions": [ { "group": "Ungdom", "weekday": 1, "start": "15:30", "end": "19:15" }, … ]
}
```

`weekday`: 1 = Monday … 7 = Sunday. `group` must be one of `Ungdom, Senior, Senior2, Voksenfjer, Veteran` to appear as a choice on Min side (the list is `GROUPS` in `index.html`). Training registrations use the id `t:<date>:<group>` — renaming a group after people have answered orphans those answers.

## `config.json`

```json
{ "registrationUrl": "https://script.google.com/macros/s/…/exec" }
```

Empty string = login switched off.

## `data/tilmeldinger.json` — current answers

Written by `sync_tilmeldinger.py`; the app reads it when the live Apps Script status is unavailable.

```jsonc
{ "updated": "…",
  "status": [ { "e": "m:514330", "p": "13008", "n": "Anders Frewald", "s": "ja", "ts": "…" }, … ] }
```

Since lineups were added the file also has `"lineups": [{ "e": "m:514330", "team": "U15 B", "status": "klar", "squad": [{id, name}], "games": [{"k": "1. S", "p": ["324936"]}], "note": "", "by": "…", "t": <ms> }]`.

`e` = event id (`m:<matchID>` or `t:<date>:<group>`), `p` = player id (badmintonplayer id, or `n:<name-slug>` for players typing their own name), `s` = `ja` / `maaske` / `nej`. Latest answer per (event, player) only. **No emails.**

## `data/hoebk.db` — SQLite

Rebuilt from the full answer log on every sync.

```sql
CREATE TABLE registrations (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,              -- ISO UTC from the Google Sheet
  type TEXT NOT NULL,            -- 'match' | 'training'
  event_id TEXT NOT NULL,        -- m:<matchID> | t:<date>:<group>
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  status TEXT NOT NULL,          -- ja | maaske | nej
  label TEXT                     -- human-readable event, e.g. "U15 B mod Lillerød 1 2026-11-15"
);
CREATE VIEW latest AS …          -- newest row per (event_id, player_id)

CREATE TABLE lineups (            -- latest squad/lineup per match
  event_id TEXT PRIMARY KEY, team TEXT, status TEXT,   -- udkast | klar | indtastet
  saved_by TEXT, saved_at TEXT, squad_json TEXT, games_json TEXT, note TEXT
);
```

Useful queries:

```sql
-- Who can play a given match
SELECT player_name, status FROM latest WHERE event_id = 'm:514330' ORDER BY status, player_name;

-- Training attendance per group over the season
SELECT substr(event_id, 14) AS grp, count(*) FROM latest
WHERE type = 'training' AND status = 'ja' GROUP BY grp;

-- How often each player changed their mind
SELECT player_name, count(*) - count(DISTINCT event_id) AS changes
FROM registrations GROUP BY player_id ORDER BY changes DESC;
```
