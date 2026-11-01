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

**Own start page.** Logged-in users see a ☆ in the top bar on most screens; tapping it (*Gør til min forside*) makes that screen the one the app opens on (stored per phone, `hoebk_home`; for the calendar the view, not the date). Tap the filled ★ again to go back to Nyt. Logging out clears it.

**App updates.** Phones (especially the iPhone home-screen app) keep `index.html` cached and resume it without reloading. The app therefore compares a fingerprint of its own code (all `<style>` + the main `<script>`) with a fresh `index.html?t=…` from the server — 1.5 s after start, every time the app comes back to the foreground, and when the refresh button is pressed. If they differ it reloads via `?v=<timestamp>` (removed from the address bar afterwards) and keeps the current screen. Returning to the app after 10+ minutes also refetches the data. A guard in `sessionStorage` stops reload loops while GitHub Pages is still rolling out.

## Screens and routes

Navigation uses the URL hash, so the browser's back button works and every screen can be shared as a link.

| Route | Screen |
|---|---|
| `#/hold` | Team list (latest result or next match per team) |
| `#/hold/<i>` | Team: tabs *Kampe / Stilling / Spillere* (`<i>` = position in the sorted team list) |
| `#/hold/<i>/kamp/<m>` | Played match: score, every game with players and sets. Upcoming match: details, availability buttons (team members/selected players, and parents for their children), who's coming, **Samkørsel** (car pool) and the selected squad |
| `#/kalender/<view>/<YYYY-MM-DD>` | Calendar; `view` = `liste`, `dag`, `uge`, `maaned`, `aar`. Month and year views list their events under the grid |
| `#/nyt` | **Start page** and first tab (*Nyt*): latest news, matches and activities in the next 14 days, and results from the last 30 days |
| `#/tilmeld` | Min side → **Program** (login flow when logged out). Tabs at the top: *Program* and *Chat* for everyone, then one per role the person has — *Spiller* (not for parent logins), *Forælder* (parents and players with children), *Holdleder*, *Admin*. Program covers the next month and shows only: matches of teams you follow, matches you are selected for (in the saved squad), all matches of your children's teams, tournaments you follow, your training groups/teams, and the app's activities aimed at your teams/groups or where you took a task — each tagged with why it's there. Children's training (Ungdom, and all training for parent logins) shows without *Kommer / Kommer ikke* (not mandatory for now). Parent logins follow no training until they choose it: the *Vælg træning du vil følge* card goes to Forælder → *Træning jeg følger*. Logged out: *Registrér dig som forælder* at the top, *Har du en kode fra en anden enhed?*, then the player name list |
| `#/tilmeld/snak` | Min side → **Chat** |
| `#/tilmeld/spiller` | Your player card, training groups/teams, teams and tournaments you follow, *Turneringer for dit niveau*, *Er du også forælder?*, *Spiller du ikke i Hørsholm?* (players with children/administrators: become parent-only), settings (notifications, shop, *Log ind på en anden enhed*, log out) |
| `#/tilmeld/foraelder` | Each child with their next match and whether they're selected, *+ Tilføj barn*, the children's team chats; for parent logins also your name (editable), *Træning jeg følger* (group + the child's team), follows and settings |
| `#/tilmeld/holdleder` | Next match per team you lead with replies (*kan / måske / kan ikke*) and *Udtag spillere* / *Opstilling*; badge = matches missing a selection |
| `#/tilmeld/admin` | Administrators: news, activities, admin chat, administrators and team leaders. The shield in the top bar opens this tab (team leaders: the Holdleder tab). `#/admin` and `#/holdleder` redirect here |
| `#/brugere` | Administrators: all registered users (players get *Gør til forælder* — for a parent who registered as their child) — search (name, email, child, team), filters *Alle / Spillere / Forældre / Holdledere / Admin*, role badges, children, last active, push devices. Opened from Min side → Admin → *Registrerede brugere* |
| `#/rangliste` | Club ranking with metric and All/Senior/Youth filters — opened from the top of *Spillere* (no tab of its own) |
| `#/spillere` | Player search with filter chips *Alle / Har spillet / Har rangering / Uden rangering* (remembered, `hoebk_pf`) |
| `#/spiller/<id>` | Player profile (`id` = badmintonplayer.dk player id), incl. *Turneringer for dit niveau* |
| `#/turneringer` | All upcoming individual tournaments, chips per age group, sections per level (Elite, Mester, A–D) |
| `#/turnering/<id>` | One tournament: dates, entry deadline, follow, news, classes per day, **Samkørsel** (until it ends), Hørsholm players whose level fits |
| `#/udtag[/<i>/<m>]` | Leaders: pick players for a team's upcoming match |
| `#/opstilling/<i>/<m>` | Leaders: lineup per game with rule warnings and status |
| `#/eksport/<i>/<m>` | Leaders: lineup ready to enter on badmintonplayer.dk |
| `#/admin` (also `#/holdleder`) | **Administration** — opened with the shield button in the top bar, which is only shown to team leaders and administrators. Administrators: *Skriv en nyhed*, *Alle nyheder*, *Ny aktivitet*, *Oversigt over opgaver*, *Alle aktiviteter*, *Administratorer og holdledere*. Everyone with the shield: next match per team with selection status (*Udtag spillere* / *Holdopstilling*) |
| `#/ledere` | Administrator: appoint/remove team leaders, user statistics |
| `#/aktiviteter` | All upcoming activities in date order, grouped by month: the app's own activities (with tasks) plus the club activities shown in the calendar (hoebk.dk/Conventus and `traening.json` events); *Afholdte* below. Opened from the top of every calendar view and from Min side |
| `#/aktivitet/<id>` | One activity: time, description, who it's for, tasks with *Tag opgaven* / *✓ Din opgave* and who has taken them |
| `#/aktiviteter/oversigt` | Overview of every upcoming activity's tasks: time, who took it, *n/need* coloured full / missing some / none yet; filters *Alle opgaver*, *Mangler folk*, *Mine* |
| `#/aktiviteter/ny`, `#/aktivitet/<id>/ret` | Administrator: create/edit an activity — name, description, start/end, *Vis i kalenderen*, recipients, tasks with a number needed (0 = unlimited) |
| `#/boern` | Parents: choose/change which players are your children |
| `#/snak` | All chat rooms the player is in (teams + training groups), newest activity first |
| `#/snak/<room>` | One chat room (`h:<leagueGroupTeamID>` or `g:<group>`, URL-encoded): messages, composer, *Lydløs* |
| `#/nyheder` | News from the club (logged out: only news for everyone). Administrators get *+ Skriv en nyhed* |
| `#/nyhed/<id>` | One news item; administrators can delete it |
| `#/nyheder/ny` | Administrator: write news to everyone, chosen teams and/or training groups, optionally as push |
| `#/notifikationer` | Push notifications on this phone and mail on/off; Min side only shows a one-line status card |

Team order is fixed in `ORDER` at the top of the script (seniors, motion, youth). A team not listed there goes last — add new team labels to `ORDER` when a new division appears.

## Chat and news

**Rooms.** Every team has a room (`h:<leagueGroupTeamID>`) and every training group has one (`g:Senior` …). The server decides who is in a room: a team room is for players who have played for the team (from `data/holdkampe.json`), people who follow the team, its leaders and administrators; a training-group room is for everyone who picked that group under *Træning* on Min side (the app sends the chosen groups with every `rooms` call). Following a team is how parents and new players get in.

**Where it shows.** Min side has *Nyheder fra klubben* (unread first, *Ny* tag) and *Chat* (4 most recent rooms with unread badges); the team page has a *💬 Holdets snak* button; the *Min side* tab gets a red dot when there's something unread. Unread is tracked per phone in `localStorage` (`hoebk_seen` = last seen message time per room, `hoebk_nseen` = news ids read). A room you see for the first time starts as read.

**Chat.** Messages load when a room opens and every 15 s while it is open and the app is in front. Links become clickable, line breaks are kept, max 1000 characters, max 10 messages a minute per person. You can delete your own messages; administrators and the team's leaders can delete any message in a team room. *🔔 Modtager nyt* (green) / *🔕 Lydløs* (red) switches push for that room on this account.

**News.** Administrators write news on `#/nyheder/ny` (also linked from *Holdleder → Administrator*): title, text and recipients — *Alle i klubben*, or any mix of training groups and teams. News for everyone is visible before login too. *Send også som notifikation* pushes it to members' phones that have notifications on. News older than 120 days drops off the lists.

## Activity planner

Administrators create activities from *Min side → Aktiviteter → + Ny aktivitet* (or *Holdleder → Administrator → Ny aktivitet*): name, description, start and end (local Danish time), whether it should appear in the calendar, who it's for (*Alle i klubben*, training groups and/or teams — same rules as news) and a list of tasks, each with how many people are needed and an optional start/end time (a time of day for one-day activities, date + time for multi-day ones; it must lie within the activity). Tasks with a time are listed in time order, tasks without after them. Optionally a push notification goes to those it's for.

**Søger hjælp** (checkbox in the form, needs at least one task): the activity is shown at the top of the front page (*Nyt*) as *Vi søger hjælp til <name>* with a progress bar, until every task has a helper; tapping it opens the activity. Every activity with tasks shows at the top *x ud af y opgaver har en hjælper* (orange, with progress bar) or *Alle opgaver har en hjælper* (green). A task counts as having a helper when it has the number of people needed (unlimited tasks: at least one).

Players and parents who can see the activity tap **Tag opgaven** on a task (and tap **✓ Din opgave** to withdraw). A task stops at its number (*Fuld*); 0 means unlimited. Everyone logged in sees who has taken each task (parents in dark green). Activities for everyone are visible before login too, but only with counts, not names. Activities are coloured by who they're for, with the player/team colours (`actColor()`: a team → its colour; training groups Ungdom → youth lime, Senior/Senior2 → senior blue, Voksenfjer → motion orange, Veteran → 4-player light blue); for everyone or a mix of colours they're raspberry (`--plan #C2255C`). A ◆ before the title marks them as the app's own, so team-coloured activities aren't mistaken for matches. With *Vis i kalenderen* the activity shows (kind `plan`, toggle *Appens aktiviteter*, option *Kun appens aktiviteter*) on each day it runs — separate from the purple activities that come from hoebk.dk/Conventus (kind `akt`, toggle *Fra hoebk.dk*) — with free task places, and opens the activity in the app. Editing keeps the tasks people have taken (matched by task id); deleting hides it everywhere.

Stored in the sheet tabs **Aktiviteter** (tasks as JSON in the last column) and **Opgavetilmeldinger** (one row per take/withdraw — latest per person and task wins).

## Car pool (samkørsel)

Every upcoming team match (*Hold → kamp*) and every tournament that hasn't ended (*Kalender → turnering*) has a **Samkørsel** section for logged-in users (logged out: *Log ind for at køre med eller tilbyde et lift*). Each person chooses one of:

- **Jeg kører**: number of free seats (1–8, not counting yourself and your own children), pick-up (**Henter alle på vejen** or **Mødested** + text) and an optional departure time. Pressing *Jeg kører* again opens the form to change it; *Træk tilbud tilbage* withdraws.
- **Jeg mangler et lift**: you can then press **+ Kør med** on any car with free seats, until it is *Fuld*. You can optionally write where you can be picked up (shown next to your name when the driver picks everyone up on the way). *Jeg kører ikke med alligevel* frees the seat, and *Skift til denne bil* moves you.
- **Jeg kører selv**.

Parents answer for each of their children on the team (all children on tournaments) with **Mangler lift / Kommer selv** and **+ <name> kører med**, and can offer seats themselves. Children can't be drivers. Tapping the chosen option again removes it.

**Youth matches** (U-teams) **and youth tournaments** (every class is U…): the parents arrange it. A parent sees only **Jeg kører og har plads til flere** for themselves, plus the choices for each child. Youth players (only on U-teams, not parent/team leader/admin) see the car pool but can't choose. They get a note to ask a parent to register as a parent. The server enforces this from the match's team, not from the app. On senior matches, players choose for themselves, youth players included.

**Who is whose:** a parent is shown as *Per Hansen · forælder til Oliver* (children on that team, or all children on tournaments). A child the parent registered is shown as *Oliver Nørrelund (Per Hansen)*, also in the driver's push notification (*Oliver Nørrelund (Per Hansen) kører med dig*).

At the top: *x biler · y ledige pladser · z mangler lift*. Each car shows the driver, *n af m ledige* / *Fuld*, the pick-up point and departure, its passengers (yours in dark) and the empty seats.

Push notifications (to the person who registered, so parents get them for their children): the driver is told when someone takes or frees a seat (*Oliver kører med dig · 2 af 3 pladser taget*). Passengers are told when the driver changes pick-up or time, or stops driving, in which case they are back on *Mangler lift*. A driver can't lower seats below the number of passengers.

Stored in the sheet tab **Kørsel**: one row per person per match/tournament (`m:<matchID>` / `t:<turneringId>`), with choice (drive/need/own), seats, pick-up (`vej` = on the way), departure, the chosen driver's id and a note.

## Calendar

- **Views:** *Liste* (everything from today, 60 days, compact rows grouped by day), *Uge*, *Måned*, *År*; *Dag* opens from "Hele dagen ›" or a day in week/year view. `#/kalender/<liste|uge|maaned|aar|dag>/<YYYY-MM-DD>`.
- **Month view:** each day shows coloured **dots** — matches in their team colour, ◆-ringed dot for the app's activities, purple for hoebk.dk, green for tournaments, a dashed ring for training; holiday days are tinted. Tapping a day selects it (`#/kalender/maaned/<date>`) and lists that day's events below the grid.
- **Filter:** one button opens a bottom sheet with every option — presets *Alt* (default, the whole club) and *Mit* (my teams = played on, followed, leading, children's teams; my training teams; the app's activities; no hoebk.dk), the five types with on/off and their colours, *Holdkampe for* (Alle / Mine hold / Senior / 4 spillere / Motion / Ungdom / one team), training group and team (Bredde/Øvede/Elite), tournament level and region when tournaments are on, and the full colour key. The button reads **Filter** until the user picks something; then *Filter · Mit* or *Filter · n*, and the active choices show as removable chips. Stored per phone in `localStorage` `hoebk_calf`. *Alt* resets it.
- **Colour key** under the toolbar for the types shown (needed because *Mine hold* can mix youth and senior colours): Senior blue `#2F6FB3`, 4 players light blue `#7FD3F7`, Motion orange `#E58A2E`, Youth lime `#D4F25A`, training dashed grey, app activities raspberry `--plan` (or the team colour with ◆), hoebk.dk purple `--akt`, tournaments green `--tour`.
- Events are built once after load (`buildEvents()`): every match, each training session in `data/traening.json` for every matching weekday in the season (minus `skip` periods, shown as holidays), events from `traening.json`, the app's activities with *Vis i kalenderen*, and tournaments.
- **Aktiviteter fra hoebk.dk** come from Conventus (`kalender.php?…foreningsid=6493`, a `document.write` script), loaded on the phone and cached in `localStorage` (`hoebk_akt`, hourly). Only club activities are kept (`ACT_KEEP`), private hall rentals and team-match bookings dropped (`ACT_DROP`).


**Lists under the views:**
- **Måned:** the month's events are listed under the grid, grouped by day with the same rows as *Liste*. The current month starts from today, with a *Vis også tidligere i …* link to show the earlier days. Tapping a day highlights it in the list and scrolls down to it.
- **År:** the rest of the season is listed under the month grids by month, without training. *Vis også tidligere i sæsonen* shows the earlier part.
- **Uge:** is already a list of the week's days.

All the lists follow the filter.
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

Computed from team-match lineups (all teams, current season), one fixed order (`rankCmp()`; `fetch_holdkampe.py` writes the same order to `clubRanking`):

1. **Share of matches won** (won ÷ played)
2. if tied: **share of sets won** (sets won ÷ sets played)
3. if tied: **share of rally points won** (points won ÷ points played)
4. then most matches played, then name

Shares instead of totals, so divisions with 3-set matches or longer sets (21 vs 15/11) get no advantage. The *Alle / Senior / Ungdom* filter remains.

## Login state

Stored in `localStorage` under `hoebk_me`: `{id, name, email, token, groups}`. `groups` are the training groups the player follows on Min side (defaulted from their teams, editable with chips). *Log ud* revokes the session on the server and clears it locally.


**Log ind på en anden enhed** (Min side → Spiller/Forælder → Indstillinger): *Lav kode* gives a one-time code like `98RF-EVQB` (8 characters, no 0/O/1/I, valid 10 minutes, only the newest code works). On the other device: Min side → *Har du en kode fra en anden enhed?* → type it (case and dash don't matter) → logged in as the same person, without an email code. Both devices stay logged in. Stored in the sheet tab **Koder** with email `enhed:<email>`; after 30 wrong codes in 10 minutes, device login pauses for 10 minutes.
## Player colours

A player's circle has the colour of the division they've played most team matches in — the same colours as the calendar (`teamColor()`): Senior blue, 4 players light blue, Motion orange, Youth lime. Parents (logged in as `p:…`) are dark Ungdom-green (`PARENT`); players without team matches or a level are grey (`NOLEVEL`). The legend is shown above the player list.

## Layout

The page is a fixed frame: `html, body` have no height or overflow rules (iOS would clip the frame at the too-small reported height) and no content in the flow; `.app` is `position: fixed; top: 0; bottom: 0` with header, `main` (the only scrolling element, `overflow-y: auto`) and the tab bar as normal flex children. This avoids iOS home-screen apps placing a `position: fixed` tab bar in the middle of the screen after resuming. The status bar style is `black` (not `black-translucent`): with a translucent status bar newer iOS versions make the web view shorter than the screen and leave a strip at the bottom. Changing this meta tag only takes effect after the app is removed from and re-added to the home screen. Scroll position is `$main.scrollTop`, not `window.scrollY`.

## Design tokens

Defined as CSS variables at the top: ink `#0E2236`, ground `#F7F7F2`, accent (lime) `#D4F25A`, loss `#F3D6D2`. Archivo for headings and numbers, Inter for text. Touch targets are at least 40–44 px; layout is phone-first, max width 560 px.

## Changing the app

1. Edit `index.html` (GitHub web editor works).
2. Commit to `main` — Pages republishes in about a minute.
3. Test on a phone, including *Add to Home Screen* if you touched `manifest.webmanifest` or icons.

To test locally: `python3 -m http.server` in the repo folder and open `http://localhost:8000`. Login needs the real Apps Script URL in `config.json` (or a local stand-in).
