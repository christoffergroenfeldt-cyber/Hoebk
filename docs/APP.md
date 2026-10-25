# The app (`index.html`)

One self-contained file: HTML, CSS and vanilla JavaScript, no build step and no libraries. Fonts (Archivo, Inter) load from Google Fonts. It runs on GitHub Pages at `https://christoffergroenfeldt-cyber.github.io/Hoebk/`.

## Files it reads

| File | Used for | Required |
|---|---|---|
| `data/holdkampe.json` | Teams, matches, lineups, standings | yes |
| `data/spillere.json` | Players, stats, rankings, club ranking | yes |
| `data/traening.json` | Weekly training in calendar and Min side | no (calendar shows matches only) |
| `config.json` | `registrationUrl` — turns login on | no (Min side shows "Login åbner snart") |
| `data/turneringer.json` | Individual tournaments | no (tournament screens say it isn't fetched yet) |
| Apps Script `?action=status` | Who's coming (live) | falls back to `data/tilmeldinger.json` |

Requests add `?t=<minute>` so phones never show data older than a minute.

**App updates.** Phones (especially the iPhone home-screen app) keep `index.html` cached and resume it without reloading. The app therefore compares a fingerprint of its own code (all `<style>` + the main `<script>`) with a fresh `index.html?t=…` from the server — 1.5 s after start, every time the app comes back to the foreground, and when the refresh button is pressed. If they differ it reloads via `?v=<timestamp>` (removed from the address bar afterwards) and keeps the current screen. Returning to the app after 10+ minutes also refetches the data. A guard in `sessionStorage` stops reload loops while GitHub Pages is still rolling out.

## Screens and routes

Navigation uses the URL hash, so the browser's back button works and every screen can be shared as a link.

| Route | Screen |
|---|---|
| `#/hold` | Team list (latest result or next match per team) |
| `#/hold/<i>` | Team: tabs *Kampe / Stilling / Spillere* (`<i>` = position in the sorted team list) |
| `#/hold/<i>/kamp/<m>` | Played match: score, every game with players and sets. Upcoming match: details + availability buttons + who's coming |
| `#/kalender/<view>/<YYYY-MM-DD>` | Calendar; `view` = `dag`, `uge`, `maaned`, `aar` |
| `#/tilmeld` | Min side (login flow when logged out): notifications, followed teams/tournaments, tournaments for your level, training, and at the bottom upcoming matches of the teams you follow (with availability buttons) |
| `#/rangliste` | Club ranking with metric and All/Senior/Youth filters |
| `#/spillere` | Player search |
| `#/spiller/<id>` | Player profile (`id` = badmintonplayer.dk player id), incl. *Turneringer for dit niveau* |
| `#/turneringer` | All upcoming individual tournaments, chips per age group, sections per level (Elite, Mester, A–D) |
| `#/turnering/<id>` | One tournament: dates, entry deadline, classes per day, Hørsholm players whose level fits |
| `#/udtag[/<i>/<m>]` | Leaders: pick players for a team's upcoming match |
| `#/opstilling/<i>/<m>` | Leaders: lineup per game with rule warnings and status |
| `#/eksport/<i>/<m>` | Leaders: lineup ready to enter on badmintonplayer.dk |
| `#/ledere` | Administrator: appoint/remove team leaders |

Team order is fixed in `ORDER` at the top of the script (seniors, motion, youth). A team not listed there goes last — add new team labels to `ORDER` when a new division appears.

## Calendar

- Events are built once after load (`buildEvents()`): every match from every team, plus each training session in `data/traening.json` for every matching weekday between `season.from` and `season.to`, skipping `skip` periods.
- Colours by division: Senior blue `#2F6FB3`, 4-player light blue `#7FD3F7`, Motion orange `#E58A2E`, Youth lime `#D4F25A`, training dashed grey.
- Month cells use short labels (`SHORT` map: DS, S2, 4S, MOT E…) and show training as `3×` (three groups train that day).
- Year view runs August–July (the badminton season).
- **Turneringer** toggle (off by default) adds individual tournaments in purple (`--tour #7A4FC9`) on every day they run; a level filter (e.g. *SEN A*) and a link to the tournament list appear when it's on. *Kun turneringer* in the team filter hides everything else.

## Drive time and directions

- Upcoming away matches show *ca. 35 min i bil* in the team list, calendar and Min side; the match page shows the drive time from Hørsholm and a **Rutevejledning i Google Maps** button.
- The button opens `https://www.google.com/maps/dir/?api=1&destination=<hall, town>&travelmode=driving` without a start point, so the phone routes from where you are.
- Tournament filters: region chips (pick one or more; *Hele landet* clears) and a distance select, remembered per phone (`hoebk_tf`).
- Tournaments show drive time instead of straight-line km once looked up; the tournament page has the same button (destination = organiser club + town — check the invitation for the exact hall).
- Wrong place? Add the organiser/venue to `data/steder_rettelser.json` (see [DATA.md](DATA.md)).

## Individual tournaments

- The list (`#/turneringer`) shows upcoming tournaments for one age group at a time, grouped by level; a tournament with classes on several levels appears under each. *Vis afholdte* includes past ones.
- The player profile and Min side show upcoming tournaments matching the player's level, taken from their ranking category (see [DATA.md](DATA.md)); the matching classes are highlighted.
- The entry deadline shows as *Frist 12. nov* while open and *Lukket* after.

## Following tournaments

- Tournament page: **☆ Følg turneringen** / **★ Følger** (needs login). Stored in Apps Script (`action: follow`), mirrored in `hoebk_me.follows`.
- Followed tournaments get a ★ in every list and their own section on Min side.
- Cards show the latest news from `data/turnering_nyt.json` (last 14 days) or what's published (*Program klar · Deltagerliste*); the tournament page lists all news.
- Mails are sent by the data workflow — see [TILMELDING.md](TILMELDING.md).

## Club ranking

Computed from team-match lineups (all teams, current season):

- **Vundne kampe** — games won (default sort)
- **Sejr %** — games won ÷ games played
- **Point i alt** — rally points won across all sets
- **Snit pr. kamp** — points won ÷ games with set scores (walkovers excluded)

Ties break on games won, then win %, then points, then name. Point totals favour divisions with longer sets (21 vs 15/11) — the *Senior/Ungdom* filter makes comparisons fair.

## Login state

Stored in `localStorage` under `hoebk_me`: `{id, name, email, token, groups}`. `groups` are the training groups the player follows on Min side (defaulted from their teams, editable with chips). *Log ud* revokes the session on the server and clears it locally.

## Player colours

A player's circle has the colour of the division they've played most team matches in — the same colours as the calendar (`teamColor()`): Senior blue, 4 players light blue, Motion orange, Youth lime. People without team matches (parents, coming later) are grey (`PARENT`). The legend is shown above the player list.

## Design tokens

Defined as CSS variables at the top: ink `#0E2236`, ground `#F7F7F2`, accent (lime) `#D4F25A`, loss `#F3D6D2`. Archivo for headings and numbers, Inter for text. Touch targets are at least 40–44 px; layout is phone-first, max width 560 px.

## Changing the app

1. Edit `index.html` (GitHub web editor works).
2. Commit to `main` — Pages republishes in about a minute.
3. Test on a phone, including *Add to Home Screen* if you touched `manifest.webmanifest` or icons.

To test locally: `python3 -m http.server` in the repo folder and open `http://localhost:8000`. Login needs the real Apps Script URL in `config.json` (or a local stand-in).
