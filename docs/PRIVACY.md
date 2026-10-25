# Privacy and personal data

The repo is **public**, so everything committed to it can be read by anyone. This page lists what personal data exists, where it lives, and why.

## What is stored where

| Data | Where | Public? | Source |
|---|---|---|---|
| Player names, teams, game results, set scores | `data/holdkampe.json`, `data/spillere.json` | Yes | badmintonplayer.dk (already public there) |
| National ranking points and placements, entry level, licence status | `data/spillere.json` | Yes | badmintonplayer.dk player profiles |
| Opponents' names in lineups | `data/holdkampe.json`, `data/spillere.json` | Yes | badmintonplayer.dk |
| Who answered what for matches/training (name + answer) | Google Sheet, `data/tilmeldinger.json`, `data/hoebk.db` | Yes (in the repo and in the app) | Players themselves |
| **Email addresses** | Google Sheet tabs *Spillere*, *Koder*, *Sessioner* | **No** — never leaves Google | Players themselves |
| Login codes and session tokens | Google Sheet, as salted SHA-256 hashes only | No | Generated |
| Session token (plain) | The player's own phone (`localStorage`) | No | Generated |

## What is deliberately never stored

- **Player numbers** (e.g. `060718-01`) — they contain the date of birth. `strip_private()` removes them and any field named like player number, birth date, email or phone from profiles before saving or debugging.
- **Team leaders' contact details** shown on match pages on badmintonplayer.dk — only game rows are parsed.
- **"Linked user accounts"** section of player profiles — skipped.
- **Dates of birth** from badmintonplayer.dk's per-player season plan — that filter is never used; tournaments are fetched for the whole country and matched in the app.
- Emails in GitHub — the sync endpoint returns answers without emails.

## Children and young players

Youth players' full names, results and rankings are published by Badminton Danmark on badmintonplayer.dk; the app shows the same information in one place. The club should still decide consciously whether it wants that on its own site:

- `fetch_holdkampe.py --names first` stores first names only (add it to the workflow's command to switch).
- A parent can log in on a child's behalf with their own email — this is the recommended way for young players.
- Debug copies (`diag` branch) contain only adult divisions and adult profiles, with emails, phones and player numbers masked — and should be deleted after use.

## Retention and removal

- **Results and rankings** are rebuilt from badmintonplayer.dk on every run; they change when the source changes.
- **Registrations** stay in the Google Sheet until deleted there. Delete rows in *Tilmeldinger*; the next sync rebuilds `hoebk.db` and `tilmeldinger.json` without them. Git history still contains older versions — to remove something from history entirely, the repo history must be rewritten (ask the maintainer).
- **Emails:** delete the player's rows in *Spillere*, *Koder* and *Sessioner*.
- **A request to be removed from the app:** results come from Badminton Danmark, so a full removal must be raised with them; the club can hide a player by filtering their id in `fetch_holdkampe.py`.

## Access

| Who | Can |
|---|---|
| Anyone | Read the app and every file in the repo |
| A logged-in player | Add answers as themselves |
| Owner of the Google account | See emails and all raw answers in the Sheet |
| Repo admins | Change code and data, read GitHub secrets (not their values once saved) |

Keep the club Google account and the GitHub account protected with two-factor authentication.
