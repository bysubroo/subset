"""End-to-end smoke test (used by CI on Windows with the installed runtime, also runs on Linux/Mac).
Generates structured test tracks, analyzes them, builds a set, renders a transition and exports rekordbox XML."""
import os
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import tempfile
import time
import xml.etree.ElementTree as ET

tmp = tempfile.mkdtemp(prefix="subset_smoke_")
os.environ["SUBSET_DATA"] = os.path.join(tmp, "data")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if "--repo" in sys.argv:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import make_tracks  # noqa: E402
from subset import __version__  # noqa: E402
from subset.core import export_rekordbox, mixer, playlist  # noqa: E402
from subset.core.db import DB  # noqa: E402
from subset.core.library import Library  # noqa: E402

fails = []


def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        fails.append(msg)


music = os.path.join(tmp, "music")
os.makedirs(music)
make_tracks.make(os.path.join(music, "Artist One - Night Drive.wav"), 126, "A", True, 1, lead_in=0.3)
make_tracks.make(os.path.join(music, "Artist Two - Sunrise.wav"), 124, "E", True, 2)
make_tracks.make(os.path.join(music, "Artist Two - Sunrise (Club Remix).wav"), 127, "E", True, 4)
print("SubSet", __version__, "python", sys.version.split()[0], flush=True)

db = DB()
lib = Library(db)
r = lib.scan(music)
check(r["found"] == 3, f"scan pronasao {r['found']} pesme")
t0 = time.time()
while (lib.q.qsize() or lib.current is not None) and time.time() - t0 < 900:
    time.sleep(1)
tracks = db.tracks()
print("beat engine:", lib.status().get("engine"), flush=True)
expect = {"Night Drive": 126, "Sunrise": 124, "Sunrise (Club Remix)": 127}
first_db = {"Night Drive": 0.3, "Sunrise": 0.0, "Sunrise (Club Remix)": 0.0}
for t in tracks:
    check(t["status"] == "ok", f"analiza {t['title']}: {t['status']} {t['error'] or ''}")
    if t["bpm"]:
        check(abs(t["bpm"] - expect[t["title"]]) < 1.0, f"BPM {t['title']} = {t['bpm']} (ocekivano {expect[t['title']]})")
    a = db.track(t["id"])["analysis"] or {}
    if a:
        fd = a["grid"]["first_downbeat"]
        check(abs(fd - first_db[t["title"]]) < 0.03, f"prvi downbeat {t['title']} = {fd:.3f}s (ocekivano {first_db[t['title']]})")
    labels = [p["label"] for p in a.get("phrases", [])]
    check("intro" in labels and "outro" in labels, f"fraze {t['title']}: {labels}")

items = playlist.parse_text("Artist Two - Sunrise\nArtist One - Night Drive\nArtist Two - Sunrise")
m = playlist.match(items, tracks)
check(all(x["track_id"] for x in m), "uparivanje tracklist")
check(m[2]["note"] == "remix" and m[2]["track_id"] != m[0]["track_id"], "duplikat -> remix")
s = {"name": "Smoke", "items": [{"track_id": x["track_id"], "note": x["note"]} for x in m], "settings": {}}
full = {t["id"]: db.track(t["id"]) for t in tracks}
pl = mixer.plan(s, full)
check(len(pl["transitions"]) == 2 and pl["total"] > 300, f"plan: {len(pl['transitions'])} prelaza, {pl['total']:.0f}s")
out = os.path.join(tmp, "prev.wav")
mixer.render_transition_preview(pl, 0, out)
check(os.path.getsize(out) > 1_000_000, "render prelaza")
xml = export_rekordbox.build("Smoke", [full[i["track_id"]] for i in s["items"]])
root = ET.fromstring(xml)
marks = root.findall(".//POSITION_MARK")
check(len(root.findall("./COLLECTION/TRACK")) == 3 and any(mk.get("Num") == "0" for mk in marks), "rekordbox XML")
print("\nREZULTAT:", "PROSAO" if not fails else f"{len(fails)} gresaka", flush=True)
sys.exit(1 if fails else 0)
