"""Download the build-time vendor files (not stored in git):
- Python 3.11 embeddable runtime (with site-packages enabled) -> installer/vendor/python
- get-pip.py -> setup/get-pip.py
"""
import io
import shutil
import urllib.request
import zipfile
from pathlib import Path

PY_VER = "3.11.9"
ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "installer" / "vendor" / "python"


def get(url: str) -> bytes:
    print("download", url, flush=True)
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def main():
    if not (VENDOR / "python.exe").exists():
        shutil.rmtree(VENDOR, ignore_errors=True)
        VENDOR.mkdir(parents=True)
        data = get(f"https://www.python.org/ftp/python/{PY_VER}/python-{PY_VER}-embed-amd64.zip")
        zipfile.ZipFile(io.BytesIO(data)).extractall(VENDOR)
        (VENDOR / "python311._pth").write_text("python311.zip\r\n.\r\n..\\..\\app\r\nLib\\site-packages\r\nimport site\r\n")
        (VENDOR / "Lib" / "site-packages").mkdir(parents=True, exist_ok=True)
        (VENDOR / "Lib" / "site-packages" / ".keep").write_text("")
    gp = ROOT / "setup" / "get-pip.py"
    if not gp.exists():
        gp.write_bytes(get("https://bootstrap.pypa.io/get-pip.py"))
    shutil.copy(ROOT / "requirements.txt", ROOT / "setup" / "requirements.txt")
    print("vendor ok")


if __name__ == "__main__":
    main()
