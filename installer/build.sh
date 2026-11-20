#!/bin/sh
# Linux build: dist/SubSet-Setup-<version>.exe  (needs: python3, makensis)
set -e
cd "$(dirname "$0")"
python3 fetch_vendor.py
VER=$(python3 -c "import re;print(re.search(r'\"(.+)\"',open('../subset/__init__.py').read()).group(1))")
find .. -name __pycache__ -prune -exec rm -rf {} +
mkdir -p ../dist
makensis -V2 -DVERSION=$VER launcher.nsi
makensis -V2 -DVERSION=$VER installer.nsi
ls -la ../dist/
