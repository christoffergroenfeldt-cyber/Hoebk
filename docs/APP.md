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
| `#/tilmeld` | **Start page.** Min side (login flow when logged out): notifications, followed teams/tournaments, tournaments for your level, training, and at the bottom upcoming matches of the teams you follow (with availability buttons) |
| `#/rangliste` | Club ranking with metric and All/Senior/Youth filters |
| `#/spillere` | Player search with filter chips *Alle / Har spillet / Har rangering / Uden rangering* (remembered, `hoebk_pf`) |
| `#/spiller/<id>` | Player profile (`id` = badmintonplayer.dk player id), incl. *Turneringer for dit niveau* |
| `#/turneringer` | All upcoming individual tournaments, chips per age group, sections per level (Elite, Mester, A–D) |
| `#/turnering/<id>` | One tournament: dates, entry deadline, classes per day, Hørsholm players whose level fits |
| `#/udtag[/<i>/<m>]` | Leaders: pick players for a team's upcoming match |
| `#/opstilling/<i>/<m>` | Leaders: lineup per game with rule warnings and status |
| `#/eksport/<i>/<m>` | Leaders: lineup ready to enter on badmintonplayer.dk |
| `#/holdleder` | Team leaders: next match per team (sorted by date) with selection status; opened from Min side. Administrators also get the link to `#/ledere` |
| `#/ledere` | Administrator: appoint/remove team leaders, user statistics |
| `#/snak` | All chat rooms the player is in (teams + training groups), newest activity first |
| `#/snak/<room>` | One chat room (`h:<leagueGroupTeamID>` or `g:<group>`, URL-encoded): messages, composer, *Lydløs* |
| `#/nyheder` | News from the club (logged out: only news for everyone). Administrators get *+ Skriv en nyhed* |
| `#/nyhed/<id>` | One news item; administrators can delete it |
| `#/nyheder/ny` | Administrator: write news to everyone, chosen teams and/or training groups, optionally as push |
| `#/notifikationer` | Push notifications on this phone and mail on/off; Min side only shows a one-line status card |

Team order is fixed in `ORDER` at the top of the script (seniors, motion, youth). A team not listed there goes last — add new team labels to `ORDER` when a new division appears.

## Snak (chat) and news

**Rooms.** Every team has a room (`h:<leagueGroupTeamID>`) and every training group has one (`g:Senior` …). The server decides who is in a room: a team room is for players who have played for the team (from `data/holdkampe.json`), people who follow the team, its leaders and administrators; a training-group room is for everyone who picked that group under *Træning* on Min side (the app sends the chosen groups with every `rooms` call). Following a team is how parents and new players get in.

**Where it shows.** Min side has *Nyheder fra klubben* (unread first, *Ny* tag) and *Snak* (4 most recent rooms with unread badges); the team page has a *💬 Holdets snak* button; the *Min side* tab gets a red dot when there's something unread. Unread is tracked per phone in `localStorage` (`hoebk_seen` = last seen message time per room, `hoebk_nseen` = news ids read). A room you see for the first time starts as read.

**Chat.** Messages load when a room opens and every 15 s while it is open and the app is in front. Links become clickable, line breaks are kept, max 1000 characters, max 10 messages a minute per person. You can delete your own messages; administrators and the team's leaders can delete any message in a team room. *🔔 Modtager nyt* (green) / *🔕 Lydløs* (red) switches push for that room on this account.

**News.** Administrators write news on `#/nyheder/ny` (also linked from *Holdleder → Administrator*): title, text and recipients — *Alle i klubben*, or any mix of training groups and teams. News for everyone is visible before login too. *Send også som notifikation* pushes it to members' phones that have notifications on. News older than 120 days drops off the lists.

## Calendar

- Events are built once after load (`buildEvents()`): every match from every team, plus each training session in `data/traening.json` for every matching weekday between `season.from` and `season.to`, skipping `skip` periods.
- Colours by division: Senior blue `#2F6FB3`, 4-player light blue `#7FD3F7`, Motion orange `#E58A2E`, Youth lime `#D4F25A`, training dashed grey.
- Month cells use short labels (`SHORT` map: DS, S2, 4S, MOT E…) and show training as `3×` (three groups train that day).
- Year view runs August–July (the badminton season).
- **Klubaktiviteter** (purple `--akt`, toggle *Aktiviteter*, option *Kun klubaktiviteter*): the activity calendar from hoebk.dk/kalender, which comes from Conventus (`kalender.php?…foreningsid=6493`, a `document.write` script). Conventus only answers Danish connections, so the app loads it on the phone (captures `document.write`, parses the 5-cell rows date/time/title/place) and caches it in `localStorage` (`hoebk_akt`, refreshed hourly and on the refresh button) — nothing is stored on GitHub. Only club activities are kept (`ACT_KEEP` keywords: miniton, træning, camp, jul, klubmesterskab …); private hall rentals with people's names and hall bookings for team matches (already shown as matches) are dropped (`ACT_DROP`). Add a keyword to `ACT_KEEP` if a new kind of club activity doesn't show up. Min side shows the next 3.
- With *Træning* on, group chips filter training: *Alle grupper*, *Mine grupper* (the groups chosen on Min side) or one group such as *Senior* (remembered, `hoebk_trg`).
- **Turneringer** toggle (off by default) adds individual tournaments in dark green (`--tour #1E6B3A`) on every day they run; a level filter (e.g. *SEN A*) and a link to the tournament list appear when it's on. *Kun turneringer* in the team filter hides everything else.

## Drive time and directions

- Upcoming away matches show *ca. 35 min i bil* in the team list, calendar and Min side; the match page shows the drive time from Hørsholm and a **Rutevejledning i Google Maps** button.
- The button opens `https://www.google.com/maps/dir/?api=1&destination=<hall, town>&travelmode=driving` without a start point, so the phone routes from where you are.
- Level chips under the age chips (*Alle niveauer*, Elite, Mester, A–D with counts) — pick one or more; remembered per age group (`hoebk_tf.lv`).
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

## Sider (content from hoebk.dk)

`fetch_sider.py` reads the club website's menu (and pages linked from menu pages, one level down), keeps only the content of `<main>` through a whitelist sanitizer (text, headings, lists, tables, images, links; scripts, menus, forms, cookie banner and sponsor-banner redirects removed; iframes become a link) and writes `data/sider.json` with a hash and `changed`/`added` dates per page. It runs once a day (step in the full run with `--once-a-day`, plus `sider.yml`). Links to other hoebk.dk pages become `#/side/<id>` (id = path with `/` → `~`). Joomla's spam-protected e-mails are kept base64-encoded (`a.hmail`, the repo is public) and decoded only when a page is shown.

The *Sider* tab groups pages by what members look for (`SIDE_GROUPS`: Nyheder, Bliv medlem & praktisk, Træning & trænere, Ungdom & forældre, Senior/Voksenfjer/Veteran, Om klubben, Historie, Sponsorer); new pages on hoebk.dk land in *Øvrige* until they're added to a group. Search covers titles and text; *Senest opdateret* lists pages changed within 14 days. `sideShortcuts()` adds links to the app's own live screens (calendar, teams, tournaments) on the matching pages.

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

## Layout

The page is a fixed frame: `html, body` have no height or overflow rules (iOS would clip the frame at the too-small reported height) and no content in the flow; `.app` is `position: fixed; top: 0; bottom: 0` with header, `main` (the only scrolling element, `overflow-y: auto`) and the tab bar as normal flex children. This avoids iOS home-screen apps placing a `position: fixed` tab bar in the middle of the screen after resuming. The status bar style is `black` (not `black-translucent`): with a translucent status bar newer iOS versions make the web view shorter than the screen and leave a strip at the bottom. Changing this meta tag only takes effect after the app is removed from and re-added to the home screen. Scroll position is `$main.scrollTop`, not `window.scrollY`.

## Design tokens

Defined as CSS variables at the top: ink `#0E2236`, ground `#F7F7F2`, accent (lime) `#D4F25A`, loss `#F3D6D2`. Archivo for headings and numbers, Inter for text. Touch targets are at least 40–44 px; layout is phone-first, max width 560 px.

## Changing the app

1. Edit `index.html` (GitHub web editor works).
2. Commit to `main` — Pages republishes in about a minute.
3. Test on a phone, including *Add to Home Screen* if you touched `manifest.webmanifest` or icons.

To test locally: `python3 -m http.server` in the repo folder and open `http://localhost:8000`. Login needs the real Apps Script URL in `config.json` (or a local stand-in).
