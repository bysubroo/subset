"""Start SubSet: local server + desktop window (pywebview / Edge WebView2), browser as fallback."""
import logging
import os
import socket
import sys
import threading
import time
import webbrowser

if sys.stdout is None:  # pythonw.exe (no console)
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _setup_logging():
    from subset.core.db import data_dir
    handlers = [logging.FileHandler(data_dir() / "subset.log", encoding="utf-8")]
    handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s", handlers=handlers)


_setup_logging()


def free_port(preferred=47321):
    for p in (preferred, 0):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            port = s.getsockname()[1]
            s.close()
            return port
        except OSError:
            s.close()
    return preferred


def _already_running(port=47321) -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/meta", timeout=1.5) as r:
            return b"transition_types" in r.read()
    except Exception:
        return False


def _msg(text):
    if os.name == "nt":
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, "SubSet", 0x40)
    else:
        print(text)


def main():
    if _already_running():
        _msg("SubSet je vec otvoren.")
        return
    import uvicorn
    from subset import server
    from subset.core.db import data_dir
    (data_dir() / "subset.pid").write_text(str(os.getpid()))

    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    cfg = uvicorn.Config(server.app, host="127.0.0.1", port=port, log_level="warning")
    srv = uvicorn.Server(cfg)
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)

    if "--headless" in sys.argv:  # server only (CI smoke test)
        print(f"SubSet headless na {url}", flush=True)
        while True:
            time.sleep(3600)
    if "--browser" in sys.argv:
        webbrowser.open(url)
        print(f"SubSet radi na {url}  (Ctrl+C za izlaz)")
        while True:
            time.sleep(3600)
    try:
        import webview
    except Exception:
        webbrowser.open(url)
        print(f"SubSet radi na {url}  (Ctrl+C za izlaz)")
        while True:
            time.sleep(3600)

    from subset import __version__
    win = webview.create_window(f"SubSet {__version__}", url, width=1500, height=920, min_size=(1100, 700), background_color="#111214")

    def pick():
        res = win.create_file_dialog(webview.FOLDER_DIALOG)
        return res[0] if res else None

    server.picker["fn"] = pick
    webview.start()
    try:
        (data_dir() / "subset.pid").unlink()
    except Exception:
        pass
    os._exit(0)


if __name__ == "__main__":
    main()
