# Login and registration (Google Sheet + Apps Script)

Players log in with a 6-digit code sent to their email, then answer *Kan spille / Måske / Kan ikke* for team matches and *Kommer / Kommer ikke* for training. A Google Apps Script receives the answers and stores them in a Google Sheet; GitHub copies them into SQLite every 15 minutes.

## Setup, step by step

Do this **once**, with the Google account the club should own the sheet with (a shared club Gmail is better than a personal one). It takes 10–15 minutes.

> **Use a computer if you can.** The *Extensions* menu and the Apps Script editor do not exist in the Google Sheets app for iPhone/Android. On a phone, open Safari and switch to the desktop site (below).

Google shows menus in your account's language — Danish names are given first, English in brackets.

### A. Create the sheet

1. Go to **sheets.google.com** and sign in with the club account.
   *On iPhone:* open it in **Safari** (not the Sheets app), tap **aA** in the address bar → **Anmod om computerwebsted** (Request Desktop Website).
2. Tap **+ / Tom** (Blank) to create a new spreadsheet.
3. Click the title *Unavngivet regneark* (Untitled spreadsheet) top left and rename it **HØBK tilmeldinger**.

### B. Open Apps Script

4. In the menu bar at the top of the sheet: **Udvidelser** (Extensions) → **Apps Script**.
   It sits between *Data* and *Hjælp* (Help). If you don't see a menu bar, you are in mobile view — see step 1.
5. A new tab opens with a code editor and a file called `Kode.gs` (`Code.gs`) containing `function myFunction() { }`.
6. Click the project title *Unavngivet projekt* (Untitled project) at the top and rename it **HØBK modtager**.

### C. Paste the code

7. In another tab, open
   `https://raw.githubusercontent.com/christoffergroenfeldt-cyber/Hoebk/main/apps-script/Code.gs`
   — it shows the code as plain text. Select all (⌘A / Ctrl+A, or long-press → *Vælg alt*) and copy.
8. Back in the Apps Script tab: click inside the editor, select all and delete the existing `myFunction`, then paste.
9. Click the **disk icon** (Gem projekt / Save project), or ⌘S / Ctrl+S.

### D. Run setup once

10. In the toolbar above the code there is a dropdown with a function name. Choose **setup**.
11. Click **▷ Kør** (Run).
12. A box says authorisation is required → **Gennemgå tilladelser** (Review permissions) → choose the club account.
13. Google warns *"Google har ikke bekræftet denne app"* (Google hasn't verified this app). That is expected for your own scripts: click **Avanceret** (Advanced) → **Gå til HØBK modtager (usikkert)** (Go to … (unsafe)) → **Tillad** (Allow).
    The permissions it asks for are: edit this spreadsheet, and send email as you.
14. The **Udførelseslog** (Execution log) opens at the bottom and shows two lines:
    - `NØGLE til GitHub-secret REG_KEY: 3f9a…` — copy the long key after the colon.
    - `E-mails tilbage i dag (Google-kvote): 100` — how many emails the script may still send today.
15. Go back to the sheet tab: four new tabs have appeared — *Tilmeldinger, Spillere, Koder, Sessioner*. Don't rename them.

### E. Publish it as a web app

16. In Apps Script, top right: **Implementer** (Deploy) → **Ny implementering** (New deployment).
17. Next to *Vælg type* (Select type) click the **gear icon ⚙** → **Webapp** (Web app).
18. Fill in:
    - *Beskrivelse* (Description): `HØBK v1`
    - *Udfør som* (Execute as): **Mig** (Me — the club account)
    - *Hvem har adgang* (Who has access): **Alle** (Anyone)
19. Click **Implementer** (Deploy). If asked to authorise again, repeat step 13.
20. Copy the **Webapp-URL** — it starts with `https://script.google.com/macros/s/` and ends with **`/exec`**.

### F. Connect GitHub

21. In the Hoebk repo on github.com: **Settings → Secrets and variables → Actions → New repository secret**:
    - Name `REG_URL`, value: the web-app URL from step 20.
    - Name `REG_KEY`, value: the key from step 14.
22. Edit `config.json` in the repo (pencil icon) so it reads:
    ```json
    { "registrationUrl": "https://script.google.com/macros/s/…/exec" }
    ```
    and commit. Within a minute **Min side** in the app shows the login.
23. Test: log in with your own email, answer one match, and check that a row appears in the *Tilmeldinger* tab. Within 15 minutes `data/hoebk.db` and `data/tilmeldinger.json` appear in the repo.

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

Trainers can sort and filter the *Tilmeldinger* tab directly, or use the SQLite database (see [DATA.md](DATA.md)).

## How the script works

| Call | Purpose |
|---|---|
| `POST {action:"request", email, playerId, playerName}` | Emails a 6-digit code (15 min validity, max 4 codes per email per hour) |
| `POST {action:"verify", email, code}` | Checks the code (max 5 tries), returns a session token valid for 365 days |
| `POST {action:"register", token, type, eventId, status, label}` | Saves an answer for the player behind the token |
| `POST {action:"me" / "logout", token}` | Check / end a session |
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
| Sync workflow says `REG_URL/REG_KEY er ikke sat` | Add both secrets (step 21) |
| Sync workflow: `Forkert nøgle` | `REG_KEY` doesn't match the key from `setup` — run `setup` again to see it |
