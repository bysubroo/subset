import os, sys, time, json
os.environ["SUBSET_DATA"] = "/tmp/subset_test"
import shutil; shutil.rmtree("/tmp/subset_test", ignore_errors=True)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from subset.core.db import DB
from subset.core.library import Library
from subset.core import playlist, harmonize, mixer, export_rekordbox

db = DB(); lib = Library(db)
print(lib.scan("/home/claude/testmusic"))
while lib.q.qsize() or lib.current is not None:
    time.sleep(0.5)
tracks = db.tracks()
for t in tracks: print(t["id"], t["artist"], "-", t["title"], t["bpm"], t["camelot"], t["energy"], t["status"], t["error"])

items = playlist.parse_text("""Artist Two - Sunrise
Artist One - Night Drive
Artist Three - Gold
Artist Two - Sunrise""")
m = playlist.match(items, tracks)
for x in m: print(x["pos"], x["title"], x["note"], x["track_id"], x["score"])
s = {"name": "Test set", "items": [{"track_id": x["track_id"], "note": x["note"]} for x in m], "settings": {}}
full = {t["id"]: db.track(t["id"]) for t in tracks}
pl = mixer.plan(s, full)
for e in pl["entries"]: print("E", e["title"], round(e["t_start"],2), round(e["t_end"],2), e["in_src"], e["out_src"], e["speed_pts"])
for t in pl["transitions"]: print("T", t)
print("total", pl["total"])
print("order", harmonize.order([full[i["track_id"]] | {"camelot": full[i["track_id"]]["camelot"]} for i in s["items"]]))
t0 = time.time()
mixer.render(pl, "/tmp/mix.mp3"); print("render", time.time() - t0)
mixer.render_transition_preview(pl, 0, "/tmp/prev.wav")
pl2 = mixer.plan({**s, "settings": {"trans_type": "echo"}}, full); mixer.render(pl2, "/tmp/mix_echo.wav")
pl3 = mixer.plan({**s, "settings": {"trans_type": "cut", "intro_mode": "full", "outro_mode": "full"}}, full); mixer.render(pl3, "/tmp/mix_cut.wav")
print(mixer.export_daw(pl, "/tmp/daw"))
xml = export_rekordbox.build("Test set", [full[i["track_id"]] for i in s["items"]])
open("/tmp/set.xml", "wb").write(xml)
print(xml[:1500].decode())
