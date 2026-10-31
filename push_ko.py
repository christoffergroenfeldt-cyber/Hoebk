#!/usr/bin/env python3
"""
push_ko.py — sender push-notifikationer for nyheder og snak-beskeder.

Apps Script kan ikke selv underskrive web-push. Når en nyhed udgives eller nogen skriver i snakken,
lægger scriptet notifikationerne i fanen PushKø og starter workflowet push.yml. Dette script henter
køen (GET ?action=pushqueue&key=…, som tømmer den) og sender med pywebpush — samme kode som
notify_turneringer.py bruger. Døde adresser (404/410) meldes tilbage og slettes.

Kører to runder med et minuts mellemrum, så beskeder skrevet lige efter hinanden også kommer med.

Miljø: REG_URL, REG_KEY, VAPID_PRIVATE (samme secrets som de andre workflows).
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from notify_turneringer import send_push


def fetch_queue(url, key):
    q = url + ("&" if "?" in url else "?") + urllib.parse.urlencode({"action": "pushqueue", "key": key})
    req = urllib.request.Request(q, headers={"User-Agent": "hoebk-push/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.loads(r.read().decode("utf-8"))
    if not res.get("ok"):
        raise RuntimeError(res.get("error") or "ukendt fejl")
    return res.get("push", [])


def ensure_pywebpush():
    try:
        import pywebpush  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pywebpush"], check=False)


def main():
    url, key = os.environ.get("REG_URL", "").strip(), os.environ.get("REG_KEY", "").strip()
    if not url or not key:
        print("REG_URL/REG_KEY er ikke sat — intet at gøre.")
        return 0
    rounds = int(os.environ.get("PUSH_ROUNDS", "2"))
    for i in range(rounds):
        try:
            jobs = fetch_queue(url, key)
        except Exception as e:
            print(f"ADVARSEL: kunne ikke hente push-køen: {e}", file=sys.stderr)
            return 0
        print(f"Runde {i + 1}: {len(jobs)} notifikationer i køen")
        if jobs:
            ensure_pywebpush()
            send_push(jobs, url, key)
        if i + 1 < rounds:
            time.sleep(60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
