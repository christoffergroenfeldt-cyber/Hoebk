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
