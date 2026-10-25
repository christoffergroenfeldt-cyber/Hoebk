# Operations

## Workflows

| Workflow | File | Schedule (UTC) | Does |
|---|---|---|---|
| **HØBK holdkampe** | `.github/workflows/holdkampe.yml` | `17 5 * * *` (≈06:17 Danish winter time) and `37 20 * * 0,6` (Sat + Sun ≈21:37) | Runs `fetch_holdkampe.py --club 1151 --pulje 19102:5 --profiles`, commits `data/holdkampe.json` + `data/spillere.json` |
| **HØBK tilmeldinger → SQLite** | `.github/workflows/tilmeldinger.yml` | `*/15 * * * *` | Runs `sync_tilmeldinger.py`, commits `data/hoebk.db` + `data/tilmeldinger.json` |
| pages build and deployment | (GitHub's own) | after every commit to `main` | Publishes the app |

Both data workflows share the concurrency group `data-commit` so they never push at the same time, and both `git pull --rebase` before pushing. GitHub may delay scheduled runs by several minutes at busy times.

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
| `REG_URL` | tilmeldinger | Apps Script web-app URL ending in `/exec` |
| `REG_KEY` | tilmeldinger | Key printed by `setup()` in Apps Script |

GitHub stores secret names in upper case — `secrets.BRUGER` reads the secret created as "Bruger".

## `fetch_holdkampe.py` options

| Option | Default | Meaning |
|---|---|---|
| `--season` | `2026` | Season start year |
| `--club` | `1151` | Club id (Hørsholm) |
| `--pulje LG:AG` | – | Extra pool to include, e.g. `19102:5` (fallback if a team is missing) |
| `--out` | `holdkampe.json` | Output; `spillere.json` is written next to it |
| `--profiles` | off | Fetch player profiles/rankings |
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

## Optional: old Joomla site

`holdkampe-widget.html` can be pasted into a Joomla *Custom* module. It reads `data/holdkampe.json` from `raw.githubusercontent.com` and shows each team's next matches and latest results.
