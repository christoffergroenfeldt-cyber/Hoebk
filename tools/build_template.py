#!/usr/bin/env python3
"""
Pakker Joomla-skabelonen joomla/cassiopeia_hoebk til en zip, der kan installeres på hoebk.dk:
Systemet → Installer → Udvidelser → Upload pakkefil.

  python tools/build_template.py         # → joomla/tpl_cassiopeia_hoebk.zip

Versionen i templateDetails.xml skal sættes op ved hver ny udgave, så Joomla opdaterer i stedet for at afvise.
"""
import os
import re
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "joomla")
SRC = os.path.join(ROOT, "cassiopeia_hoebk")
OUT = os.path.join(ROOT, "tpl_cassiopeia_hoebk.zip")


def main():
    xml = open(os.path.join(SRC, "templateDetails.xml"), encoding="utf-8").read()
    version = re.search(r"<version>(.*?)</version>", xml).group(1)
    n = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(SRC):
            dirs.sort()
            for f in sorted(files):
                if f.startswith("."):
                    continue
                full = os.path.join(base, f)
                arc = os.path.relpath(full, SRC).replace(os.sep, "/")
                info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))   # faste datoer → samme zip ved samme indhold
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                z.writestr(info, open(full, "rb").read())
                n += 1
    print(f"{OUT}: {n} filer, version {version}, {os.path.getsize(OUT) // 1024} kB")


if __name__ == "__main__":
    main()
