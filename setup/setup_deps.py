"""SubSet dependency installer. Run by the Windows installer with the bundled Python.
Installs only what is missing or outdated, so updates over an existing install are fast."""
import os
import shutil
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable
TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu126"
TORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"
TORCH_PKGS = ["torch==2.11.0", "torchaudio==2.11.0"]  # torchaudio 2.11 is the newest build for py3.11/cu126


LOG_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "SubSet"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG = open(LOG_DIR / "install.log", "a", encoding="utf-8")


def say(msg):
    print(msg, flush=True)
    LOG.write(msg + "\n")
    LOG.flush()


def run(args, check=True):
    say("  > " + " ".join(str(a) for a in args[2:]))
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    for line in p.stdout:
        say("    " + line.rstrip())
    rc = p.wait()
    if check and rc != 0:
        say(f"GRESKA: komanda nije uspela (kod {rc})")
        sys.exit(rc or 1)
    return rc


def pip(*args, check=True):
    return run([PY, "-m", "pip", *args, "--disable-pip-version-check", "--no-warn-script-location",
                "--progress-bar", "off"], check=check)


def has_nvidia() -> bool:
    if shutil.which("nvidia-smi"):
        return True
    return Path(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe").exists()


def torch_state():
    r = subprocess.run([PY, "-c", "import torch;print(torch.__version__);print(torch.version.cuda)"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None, None
    lines = r.stdout.strip().splitlines()
    return lines[0], (lines[1] if len(lines) > 1 and lines[1] != "None" else None)


def main():
    import datetime
    say(f"===== SubSet setup {datetime.datetime.now():%Y-%m-%d %H:%M} =====")
    say("[1/4] pip")
    if subprocess.run([PY, "-m", "pip", "--version"], capture_output=True).returncode != 0:
        run([PY, str(HERE / "get-pip.py"), "--no-warn-script-location"])
    pip("install", "--upgrade", "pip", "setuptools", "wheel", check=False)

    say("[2/4] PyTorch")
    gpu = has_nvidia()
    ver, cuda = torch_state()
    if ver and (cuda or not gpu):
        say(f"  vec instaliran: torch {ver} ({'CUDA ' + cuda if cuda else 'CPU'}) - preskacem")
    else:
        idx = TORCH_CUDA_INDEX if gpu else TORCH_CPU_INDEX
        say(f"  skidam PyTorch za {'NVIDIA GPU (CUDA 12.6)' if gpu else 'CPU'} - prvi put ~2.5 GB, budi strpljiv...")
        extra = ["--force-reinstall"] if ver else []
        pip("install", *extra, *TORCH_PKGS, "--index-url", idx)

    say("[3/4] Biblioteke (analiza, audio, UI)")
    pip("install", "-r", str(HERE / "requirements.txt"), "--upgrade-strategy", "only-if-needed")

    say("[4/4] AI model za beatgrid (Beat This!)")
    rc = run([PY, "-c", "from beat_this.inference import load_checkpoint; load_checkpoint('final0'); print('ok')"], check=False)
    if rc != 0:
        say("  Model nije skinut sada - bice skinut pri prvoj analizi (potreban internet).")
    v = subprocess.run([PY, "-c", "import torch;print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'nema (CPU mod)')"],
                       capture_output=True, text=True)
    say("  " + v.stdout.strip())
    if gpu and "CPU" in v.stdout:
        say("  UPOZORENJE: NVIDIA kartica postoji, ali CUDA ne radi - azuriraj NVIDIA drajver (Studio/Game Ready). SubSet radi i na CPU, samo sporije.")
    say("Gotovo.")


if __name__ == "__main__":
    main()
