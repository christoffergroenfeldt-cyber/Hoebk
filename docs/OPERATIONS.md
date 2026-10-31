# Operations

## Workflows

| Workflow | File | Schedule (UTC) | Does |
|---|---|---|---|
| **HØBK holdkampe** | `.github/workflows/holdkampe.yml` | `17 5 * * *` (≈06:17 Danish winter time) and `37 20 * * 0,6` (Sat + Sun ≈21:37) | Runs `fetch_holdkampe.py --club 1151 --pulje 19102:5 --profiles --tournaments`, looks up halls/towns and drive times (`data/steder.json`), then `notify_turneringer.py` mails followers about tournament news; commits `data/holdkampe.json`, `spillere.json`, `turneringer.json`, `steder.json`, `turnering_nyt.json`, `notifikationer.json` |
| **HØBK kampdag** | `.github/workflows/live.yml` | `7,37 8-20 * * *` (every 30 min, ≈09–22 Danish time) | `fetch_live.py`: only teams with a match today (or a recent match without result) — matches, results, lineups, standing; keeps drive times; recomputes `spillere.json` (players, stats, club ranking) fetching profiles only for new players. Then team notifications (`--only-teams`). Stops after a few seconds when no team plays today |
| Undersøg badmintonplayer.dk (diag) | `.github/workflows/discover.yml` | manual only | Saves masked raw tournament pages to the `diag` branch for parser work |
| **HØBK tilmeldinger → SQLite** | `.github/workflows/tilmeldinger.yml` | `*/15 * * * *` | Runs `sync_tilmeldinger.py`, commits `data/hoebk.db` + `data/tilmeldinger.json` |
| pages build and deployment | (GitHub's own) | after every commit to `main` | Publishes the app |

**Reliable schedule.** GitHub delays or skips scheduled runs on free repos (the 15/30-minute schedules ran only every few hours). The Apps Script therefore starts the workflows itself with a time trigger: `tick()` runs every 15 minutes and calls GitHub's `workflow_dispatch` API — `tilmeldinger.yml` every time, `live.yml` every 30 minutes 09–22, `holdkampe.yml` once in the morning (from 06) and once in the evening (from 21). It needs the script property `GH_TOKEN` (a fine-grained GitHub token for this repo with *Actions: Read and write*) and is installed by running `installTriggers()` once. `?action=version` shows `scheduler` (token set, triggers, last tick and the HTTP codes of the last dispatches — 204 = started). GitHub's own cron schedules stay as a backup. The token expires — renew it in GitHub and update `GH_TOKEN`.

Concurrency groups: `holdkampe-data` (full run and match-day run — they write the same files) and `tilmeldinger` (sync), so a queued run in one group never cancels a run in the other (GitHub keeps only one pending run per group). They write different files, and each push retries `git pull --rebase` + `git push` up to five times. GitHub may delay scheduled runs by several minutes at busy times.

### Running by hand

GitHub → **Actions** → choose the workflow → **Run workflow**.
*HØBK holdkampe* has two inputs:

- **season** — start year, default `2026`
- **debug** — uploads raw HTML as an artifact and pushes a sanitised copy to the `diag` branch (see [BADMINTONPLAYER.md](BADMINTONPLAYER.md)). Delete `diag` afterwards.

## Secrets

Settings → Secrets and variables → Actions.

| Secret | Used by | Value |
|---|---|---|
| `BRUGER` | holdkampe | badmintonplayer.dk login email (optional — only used if public data fails) |
| `BP_PWD` | holdkampe | badmintonplayer.dk password (optional) |
| `DISCORD_WEBHOOK` | holdkampe | Discord channel webhook for ✅/❌ messages (optional) |
| `REG_URL` | tilmeldinger, holdkampe (notifications) | Apps Script web-app URL ending in `/exec` |
| `REG_KEY` | tilmeldinger, holdkampe (notifications) | Key printed by `setup()` in Apps Script |
| `VAPID_PRIVATE` | holdkampe (push) | Private web-push key (base64url). The public half is `vapidPublicKey` in `config.json`. Without it only mails are sent |

GitHub stores secret names in upper case — `secrets.BRUGER` reads the secret created as "Bruger".

## `fetch_holdkampe.py` options

| Option | Default | Meaning |
|---|---|---|
| `--season` | `2026` | Season start year |
| `--club` | `1151` | Club id (Hørsholm) |
| `--pulje LG:AG` | – | Extra pool to include, e.g. `19102:5` (fallback if a team is missing) |
| `--out` | `holdkampe.json` | Output; `spillere.json` is written next to it |
| `--profiles` | off | Fetch player profiles/rankings |
| `--tournaments` | off | Fetch the national tournament season plan to `turneringer.json` |
| `--no-lineups` | off | Skip match lineups (much faster, no player stats) |
| `--names` | `full` | `first` = first names only |
| `--login` | `auto` | `always` / `never` / `auto` (only if no teams without login) |
| `--dump-dir` | – | Save raw responses for debugging |

Local run: `BP_USER=… BP_PWD=… python3 fetch_holdkampe.py --out data/holdkampe.json --profiles` (no packages to install).

## Routine tasks

### New season (August)

1. Wait until badmintonplayer.dk shows the new season's pools for Hørsholm.
2. In `.github/workflows/holdkampe.yml` change the default season `'2026'` to the new year (two places: the input default and the `--season` fallback), and update or remove `--pulje 19102:5`.
3. Update `data/traening.json`: `season.from` / `season.to`, holidays in `skip`, any changed times.
4. If a division has a new name, add its label to `ORDER` in `index.html` (and to `SHORT` for the calendar if it's long).
5. Run *HØBK holdkampe* by hand and check the app.

Old registrations stay in the Sheet and `hoebk.db`; their event ids are unique, so seasons never collide.

### Training times or holidays change

Edit `data/traening.json` on GitHub (pencil icon) and commit. The app updates within a minute. Don't rename a `group` mid-season — existing answers are tied to the name.

### A result is wrong or missing

Results are copied from badmintonplayer.dk. Correct it there; the next run picks it up. To pick it up now, run *HØBK holdkampe* by hand.

### Someone can't log in

See the troubleshooting table in [TILMELDING.md](TILMELDING.md).

## Monitoring

- **Discord:** with `DISCORD_WEBHOOK` set, every *holdkampe* run posts ✅ or ❌.
- **Actions tab:** a red ✕ on a run shows which step failed. Exit codes from `fetch_holdkampe.py`: `2` no session token, `3` no teams found, `4` no matches recognised — all mean badmintonplayer.dk changed; see [BADMINTONPLAYER.md](BADMINTONPLAYER.md).
- **App header:** every screen shows "opdateret <time>" from the data file.

## Costs

All free while the repo is **public**: GitHub Pages and Actions minutes are free for public repositories. A private repo would need GitHub Pro for Pages, and the 15-minute sync alone (~2,900 billed minutes a month) would exceed the free private allowance. Google Apps Script and Sheets are free within Google's quotas.

## hoebk.dk — new look (Joomla template)

`joomla/tpl_cassiopeia_hoebk.zip` is a Cassiopeia child template with the "HØBK Redesign" look for hoebk.dk
(Joomla 4.4.0). Installation, preview (`?templateStyle=<id>`), switching on/off and where each front-page
section gets its content: [`joomla/README.md`](../joomla/README.md). Rebuild the zip with
`python tools/build_template.py` after changing anything under `joomla/cassiopeia_hoebk/` (bump `<version>`).

The front page reads `data/hjemmeside.json` (written by `web_digest.py` in `holdkampe.yml` and `live.yml`).

## Optional: old Joomla site

`holdkampe-widget.html` can be pasted into a Joomla *Custom* module. It reads `data/holdkampe.json` from `raw.githubusercontent.com` and shows each team's next matches and latest results.
