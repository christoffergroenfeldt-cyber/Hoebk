# Login and registration (Google Sheet + Apps Script)

Players log in with a 6-digit code sent to their email, then answer *Kan spille / Måske / Kan ikke* for team matches and *Kommer / Kommer ikke* for training. A Google Apps Script receives the answers and stores them in a Google Sheet; GitHub copies them into SQLite every 15 minutes.

## Setup, step by step

Do this **once**, with the Google account the club should own the sheet with (a shared club Gmail is better than a personal one). It takes 10–15 minutes.

You can start in either of two ways — both end with the same result:

- **On a phone (recommended there):** start at **script.google.com**. Google Sheets links on iPhone keep jumping into the Sheets app, which has no Apps Script; script.google.com has no app, so it stays in Safari. The script then creates the Google Sheet for you.
- **On a computer:** create a sheet first and open Apps Script from its *Extensions* menu.

Google shows menus in your account's language — Danish names are given first, English in brackets.

### A. Open Apps Script

**Phone (Safari):**

1. Open **Safari** and *type* `script.google.com` in the address bar (typing it — rather than tapping a link — keeps it in Safari).
2. Tap **aA** in the address bar → **Anmod om computerwebsted** (Request Desktop Website). The editor is small on a phone; turn the phone sideways and zoom as needed.
3. Sign in with the club account → **Nyt projekt** (New project).

**Computer:**

1. Go to **sheets.google.com**, sign in with the club account, create a **Tom** (Blank) spreadsheet and name it **HØBK tilmeldinger**.
2. In the menu bar: **Udvidelser** (Extensions) → **Apps Script**. It sits between *Data* and *Hjælp* (Help).

### B. Name the project

4. A code editor opens with a file `Kode.gs` (`Code.gs`) containing `function myFunction() { }`.
5. Click the project title *Unavngivet projekt* (Untitled project) at the top and rename it **HØBK modtager**.

### C. Paste the code

6. In another tab, open
   `https://raw.githubusercontent.com/christoffergroenfeldt-cyber/Hoebk/main/apps-script/Code.gs`
   — it shows the code as plain text. Select all (⌘A / Ctrl+A, or long-press → *Vælg alt*) and copy.
7. Back in the Apps Script tab: click inside the editor, select all and delete the existing `myFunction`, then paste.
8. Click the **disk icon** (Gem projekt / Save project), or ⌘S / Ctrl+S.

### D. Run setup once

9. In the toolbar above the code there is a dropdown with a function name. Choose **setup**.
10. Click **▷ Kør** (Run).
11. A box says authorisation is required → **Gennemgå tilladelser** (Review permissions) → choose the club account.
12. Google warns *"Google har ikke bekræftet denne app"* (Google hasn't verified this app). That is expected for your own scripts: click **Avanceret** (Advanced) → **Gå til HØBK modtager (usikkert)** (Go to … (unsafe)) → **Tillad** (Allow).
    The permissions it asks for are: create/edit spreadsheets, and send email as you.
13. The **Udførelseslog** (Execution log) opens at the bottom and shows three lines:
    - `NØGLE til GitHub-secret REG_KEY: 3f9a…` — copy the long key after the colon.
    - `Google Sheet: https://docs.google.com/…` — the sheet with the answers. If you started from script.google.com, the script created it in the club account's Google Drive as **HØBK tilmeldinger**.
    - `E-mails tilbage i dag (Google-kvote): 100` — how many emails the script may still send today.
14. The sheet now has four tabs — *Tilmeldinger, Spillere, Koder, Sessioner*. Don't rename them. (Opening the sheet on iPhone may jump to the Sheets app — that's fine for reading it.)

### E. Publish it as a web app

15. In Apps Script, top right: **Implementer** (Deploy) → **Ny implementering** (New deployment).
16. Next to *Vælg type* (Select type) click the **gear icon ⚙** → **Webapp** (Web app).
17. Fill in:
    - *Beskrivelse* (Description): `HØBK v1`
    - *Udfør som* (Execute as): **Mig** (Me — the club account)
    - *Hvem har adgang* (Who has access): **Alle** (Anyone)
18. Click **Implementer** (Deploy). If asked to authorise again, repeat step 12.
19. Copy the **Webapp-URL** — it starts with `https://script.google.com/macros/s/` and ends with **`/exec`**.

### F. Connect GitHub

20. In the Hoebk repo on github.com: **Settings → Secrets and variables → Actions → New repository secret**:
    - Name `REG_URL`, value: the web-app URL from step 19.
    - Name `REG_KEY`, value: the key from step 13.
21. Edit `config.json` in the repo (pencil icon) so it reads:
    ```json
    { "registrationUrl": "https://script.google.com/macros/s/…/exec" }
    ```
    and commit. Within a minute **Min side** in the app shows the login.
22. Test: log in with your own email, answer one match, and check that a row appears in the *Tilmeldinger* tab. Within 15 minutes `data/hoebk.db` and `data/tilmeldinger.json` appear in the repo.

## Team leaders and lineups

### Roles

| Role | Who | Can |
|---|---|---|
| **Administrator** | Anders Vedsted Nørrelund (player id `12813`, set in `ADMIN_PLAYER_IDS` at the top of `Code.gs`) | Appoint and remove team leaders in the app (*Min side → Udnævn holdledere*); also acts as leader for all teams |
| **Team leader** | Anyone the administrator appoints (row in the *Ledere* tab) | Pick players and make lineups for their teams |
| Player | Everyone logged in | Answer availability, see the selected team |

The administrator role belongs to the **first email that confirmed that player** (the earliest row for `12813` in the *Spillere* tab). Someone picking Anders' name later with another email does not become administrator. If the wrong email got there first, delete that row in *Spillere* and have Anders log in again.

To change the administrator, edit `ADMIN_PLAYER_IDS` in `Code.gs` and publish a new version.

### The *Ledere* tab

One row per leader: `email`, `navn`, `hold` — team labels separated by commas (`U15 B, U13 B`) or `*` for all teams. Normally the administrator manages it from the app; editing the tab by hand works too. The leader must log in with exactly that email.

### Lineup flow

1. **Udtag spillere** (*Min side → Holdleder*, or *Spillere → Udtag spillere til næste holdkamp*): choose team and match (defaults to the next), tick players. Each player shows their answer (*Kan / Måske / Kan ikke / Intet svar*), teams and level. *Kun holdets spillere* limits the list to players who played for the team (for youth teams: the whole age group) and anyone who answered. **Kun spilleberettigede** (on by default) hides players not eligible by age, based on their ranking category: youth teams accept that age group and younger (a U13 player may play up in U15), senior/motion/veteran teams accept seniors and U17/U19. Players without a ranking category are kept and marked "?". **Skjul dem der ikke kan** hides players who answered *Kan ikke*. A warning appears if a selected player looks ineligible. Point limits in a division name (e.g. "6200") and veteran age rules are not checked.
2. **Holdopstilling:** one row per game in the team's format (taken from the team's last played match, else a Hørsholm team in the same format). Warnings, not blocks: a player on more than 2 games, the same player twice in a double, a lower-numbered game with fewer ranking points than the next (single/double/mix points), empty games. Status: *Udkast / Klar / Indtastet*.
3. **Til badmintonplayer:** the lineup in order with badmintonplayer player ids, *Kopiér opstilling*, a link to the match on badmintonplayer.dk and step-by-step instructions. The leader enters it there (the official registration) and taps **Marker som indtastet**.

Everyone sees the selected team and the status on the match page. Lineups are stored in the *Opstillinger* tab (latest per match wins) and synced to `data/hoebk.db` → table `lineups`.

## Following tournaments (e-mail notifications)

Logged-in players can tap **☆ Følg turneringen** on any tournament. Follows are stored in the sheet tab **Følger** (email, player, tournament id). After every data run (`holdkampe.yml`: daily ~07:17 and Sat/Sun ~21:37 Danish time) `notify_turneringer.py` compares the season plan with the previous run and sends what's new to the script (`action: notify`, protected by REG_KEY). The script mails each follower **one** summary per run and logs it in the tab **Notifikationer**.

What triggers a mail: entry deadline or dates changed, classes added/removed, tournament renamed/cancelled/removed, sign-up opened/closed, invitation, participant list, program or results published, and reminders 7 and 2 days before the entry deadline (each sent once — remembered in `data/notifikationer.json`).

Gmail accounts can send ~100 mails a day from Apps Script; login codes and notifications share that quota. If it runs out, notifications for the day are skipped (counted as `skipped`).

### Following teams

The team page has **☆ Følg holdet**. Team follows live in the same **Følger** tab with id `f<leagueGroupTeamID>` (e.g. `f124566`; tournaments are numeric or `x…`), so the script needs no change for teams. `notify_turneringer.py --old-hold` compares the previous `holdkampe.json` and sends: a reminder 3 days before each match and one on match day (time, hall, drive time), the result with the team's placing, and changes to date/time/hall of upcoming matches. Links use `#/holdid/<teamID>/kamp/<matchID>`, which the app resolves. The workflow *Send testnotifikation* sends a test to the first followed team/tournament.

### Push notifications on the phone

Min side → **Notifikationer** → *🔔 Slå notifikationer til*. On iPhone this only works when HØBK is added to the home screen (iOS 16.4+) and opened from the icon — the app explains this when opened in Safari. The phone's push address is stored in the sheet tab **Push** (email, player, endpoint, keys, device); *Send også en mail* is stored in **Indstillinger** (default on).

How it's sent: the script can't sign web-push messages, so `notify` answers GitHub with a list of push jobs and `notify_turneringer.py` sends them with `pywebpush`, signed with the VAPID key pair (public key in `config.json` → `vapidPublicKey`, private key in the GitHub secret `VAPID_PRIVATE`). Addresses that the push service reports as gone (404/410 — app deleted or notifications switched off) are removed via `pushGone`. Logging out also switches notifications off on that phone. `sw.js` is the service worker; it only shows notifications and never caches anything.

To replace the key pair: generate a new P-256 key, put the public key (base64url, uncompressed point) in `config.json` and the private key (base64url, 32 bytes) in `VAPID_PRIVATE`. Everyone must then switch notifications on again.

## Parents

On the login screen, **Forælder til en spiller?** lets a parent sign up with their *own* name (id `p:<name>`) and pick one or more children from the player list; the code goes to the parent's own email. The children are stored in the tab **Forældre** (one row per child) and can be changed later under *Min side → Mine børn* (`action: children`).

A parent is automatically in the chat rooms of their children's teams (and gets push and news for them), can follow any team, pick training groups and chat there like everyone else. Parents have a dark Ungdom-green circle (`PARENT` in `index.html`) and their messages show *Forælder til <child>*. The button only appears once the script reports version `2026-10-31.2` or later. The older way — logging in under the child's name with a parent's email — still works.

## Snak and news — notifications

New chat messages and news marked *Send også som notifikation* are pushed, never mailed (the ~100 mails/day quota is kept for login codes and match/tournament mails).

1. The script works out the recipients (room members with push switched on, minus the author and anyone who muted the room; for news, everyone the news is for) and writes one row per phone to **PushKø**.
2. It starts the workflow **push.yml** at once via `GH_TOKEN` (at most once a minute). `tick()` starts it again every 15 minutes while something is still waiting, and `push.yml` also has its own schedule as a fallback.
3. `push_ko.py` fetches and empties the queue (`?action=pushqueue`), sends with the VAPID key like the other notifications, waits a minute and checks once more.

Tapping the notification opens the room or the news item. Messages themselves stay in the Google Sheet; only the push text (first 140 characters) passes through GitHub Actions, and it isn't written to the repo or the log.

**Setup after updating `Code.gs`:** paste the new code, run **setup** once (creates the new tabs *Beskeder, Nyheder, Grupper, Lydløs, PushKø*), then *Implementer → Administrer implementeringer → Ny version*. The script now also calls `UrlFetchApp` to read `holdkampe.json` from GitHub Pages, so Google asks for one extra permission (*connect to an external service*) — approve it. Check with *Tjek Apps Script-version*: it should say `2026-10-31.2` (parents) or later.

## Lineup rules in the app

`lineupWarnings()` in `index.html` checks a lineup against the 2026/27 rules ([youth](https://badminton.dk/wp-content/uploads/2026/07/Faelles-reglement-for-ungdomsholdturneringen-endeligt-300626-1.pdf), [senior DH](https://badminton.dk/wp-content/uploads/2026/07/Holdturneringsreglement-for-badminton-i-Danmark-DH-reglementet-2026-07-01-endeligt-med-bilag-3-1.pdf)) and shows *Regelbrud* (red), warnings (orange) and notes:

| Team type | Checked |
|---|---|
| Youth (U9–U19) | matches per player by format (4 players 8-game format: 1 single + 2 doubles with different partners, 2nd/3rd double four different players; 2+2: max 3, one per category; 4+2: max 2, one HD/DD), order by today's ranking points (no tolerance; C/D/C-D/Dx may use judged strength → note), points ceiling §9 from *tilmeldingsniveau* at season start (best 4 / 2+2 / 4+2, missing player = 20 %, best-player cap from skema 1/1A — tables `SK1`/`SK1A`), max 1 player from the age group above (§8), deadline 15 min before start |
| Danmarksserien | max 2 matches, never two in the same category, at least 6 men + 4 women, gender per category, order with 50 (single) / 100 (double) point tolerance (§38), deadline 1 hour before |
| Serie 2, 4 Spillere, Motion | kreds tournaments with their own rules (not known yet): only gender per category, a player twice in one double, and same round on several teams |
| All | a player also used on another team the same weekend (youth: allowed as reserve, must be on the team sheet; senior: not allowed except §43) |

Gender comes from the player search (`gender` in `spillere.json`). Players without points are reported as notes, not errors.

**Transfer to badmintonplayer.dk** (*Til badmintonplayer*): the button *Åbn kampen til indtastning* opens `https://www.badmintonplayer.dk/DBF/User/IndberetResultat/Kamp?match=<kamp-id>&clubId=1151`, where the team leader logs in and enters the lineup; the app shows it in the same order with player ids, plus *Kopiér opstilling*. Fully automatic transfer would use badmintonplayer.dk's internal `PUT /api/LeagueMatch/{kamp-id}/{password}` and is not built — awaiting permission from Badminton Danmark.

## Administrators

Two ways, both in `Code.gs`: `ADMIN_PLAYER_IDS` (badmintonplayer id — the first email that confirmed that player owns the role; Anders Vedsted Nørrelund) and `ADMIN_EMAIL_SHA256` (SHA-256 of the lowercase login email, so the address isn't readable in the public repo — Christoffer, who isn't a team player). Add one: `printf '%s' 'name@example.dk' | sha256sum`. Administrators are leaders for all teams, appoint leaders and see user statistics.

## User statistics

`stats_()` in the script counts users — numbers only, never emails: players with a confirmed profile, emails, active sessions, active last 7/30 days (by "sidst brugt"), followers, push devices, mail switched off, leaders. It's returned with `?action=all` (GitHub sync) and to the administrator (`leaders`). `sync_tilmeldinger.py` writes `data/statistik.json` with the latest numbers and one line per day (`history`). The administrator sees them at the top of *Holdledere*. `?action=version` returns `SCRIPT_VERSION` so a deployment can be checked from GitHub (workflow *Tjek Apps Script-version*).

## Changing the script later

Saving the code is not enough — the live web app keeps running the old version until you publish a new one:

**Implementer → Administrer implementeringer** (Manage deployments) → pencil icon → *Version*: **Ny version** → **Implementer**. The URL stays the same, so nothing in GitHub changes.

## What the sheet tabs contain

| Tab | Content | Leaves Google? |
|---|---|---|
| **Tilmeldinger** | One row per answer: time, type, event id, player id, name, status, label | Yes — synced to GitHub (no emails) |
| **Spillere** | Which email has confirmed which player, first and last seen | No |
| **Koder** | Login codes — stored only as a hash, with attempts and used flag | No |
| **Sessioner** | Logged-in phones — token stored only as a hash; set *aktiv* to FALSE to log someone out | No |
| **Ledere** | Team leaders: email, name, teams | No (emails stay in Google) |
| **Beskeder** | Chat messages: id, time, room, player, email, text, deleted | **No** — never synced to GitHub |
| **Nyheder** | News: id, time, title, text, recipients (`*`, `h:<teamID>`, `g:<group>`), author, deleted | No (shown in the app through the script) |
| **Grupper** | Which training groups each email has chosen (decides who is in a training-group room) | No |
| **Lydløs** | Rooms someone has muted | No |
| **PushKø** | Push notifications waiting for GitHub to send them (emptied every run) | Only to the `push.yml` workflow |
| **Opstillinger** | Every saved squad/lineup: time, match, team, status, saved by, data (JSON) | Yes — latest per match, synced without emails |

Trainers can sort and filter the *Tilmeldinger* tab directly, or use the SQLite database (see [DATA.md](DATA.md)).

## How the script works

| Call | Purpose |
|---|---|
| `POST {action:"request", email, playerId, playerName}` | Emails a 6-digit code (15 min validity, max 4 codes per email per hour) |
| `POST {action:"verify", email, code}` | Checks the code (max 5 tries), returns a session token valid for 365 days |
| `POST {action:"register", token, type, eventId, status, label}` | Saves an answer for the player behind the token |
| `POST {action:"me" / "logout", token}` | Check / end a session; `me` and `verify` also return the role `{leader, all, admin, teams}` |
| `POST {action:"lineup", token, eventId, team, status, squad[], games[], note}` | Save a squad/lineup — only leaders for that team |
| `POST {action:"leaders" / "setLeader", token, …}` | List / set team leaders — administrator only |
| `POST {action:"rooms", token, groups[]}` | My chat rooms with latest activity, and news for me; saves my training groups (tab *Grupper*) |
| `POST {action:"messages" / "post" / "delMsg" / "mute", token, room, …}` | Read / write / delete messages in a room; push on/off per room — members only |
| `POST {action:"newsSave" / "newsDel" / "newsList", token, …}` | Write / delete / list news — administrator only |
| `GET ?action=news` | News for everyone — public, used before login |
| `GET ?action=pushqueue&key=…` | Push notifications waiting to be sent — only with `REG_KEY`; the call empties the queue |
| `GET ?action=status` | Latest answer per player and event — public, no emails |
| `GET ?action=all&key=…` | Every answer — only with `REG_KEY`, used by the GitHub sync |

Safeguards: codes and tokens are stored as salted SHA-256 hashes; a script lock prevents simultaneous writes clashing; text starting with `= + - @` is escaped so it can't become a spreadsheet formula; status and type values are validated.

## Known limits

- **Email quota:** about 100 emails per day on a normal Gmail account (Google Workspace: more). Setup logs the current number. If it runs out, login codes wait until the next day.
- **Who can claim a name:** the code proves the person owns the email, not that they are the player they picked. Several emails can confirm the same player (useful for parents). Check the *Spillere* tab if something looks wrong; deactivate a session in *Sessioner*.
- **New players** not yet on the list type their own name; they get an id like `n:anna-hansen`.
- **Spam:** the web app is public. Codes are rate-limited per email; answers require a valid session.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Login åbner snart" in the app | `config.json` has no `registrationUrl`, or the commit hasn't published yet |
| "Kunne ikke sende kode" | Check the quota in the setup log; check the deployment has access **Alle** |
| Code email never arrives | Spam folder; wait a minute; the sender is the club account |
| "Log ind igen" after answering | Session expired or deactivated — log in again |
| Changes to the script have no effect | Publish a **new version** (see above) |
| Sync workflow says `REG_URL/REG_KEY er ikke sat` | Add both secrets (step 20) |
| Sync workflow: `Forkert nøgle` | `REG_KEY` doesn't match the key from `setup` — run `setup` again to see it |
