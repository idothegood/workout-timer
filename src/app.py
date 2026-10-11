"""Workout Timer: a standalone window around ui.html. Workouts and history are saved to a JSON file."""
import ctypes
import json
import os
import sys
from ctypes import wintypes
from pathlib import Path

import webview

# Bundled files live in _MEIPASS when frozen by PyInstaller.
BUNDLE = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent

os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--autoplay-policy=no-user-gesture-required'


def data_dir():
    """Portable: keep data next to the exe. Fall back to AppData if that folder isn't writable."""
    for d in (APP_DIR / 'Workout Timer Data', Path(os.environ.get('APPDATA', APP_DIR)) / 'Workout Timer'):
        try:
            d.mkdir(parents=True, exist_ok=True)
            probe = d / '.write-test'
            probe.write_text('ok')
            probe.unlink()
            return d
        except OSError:
            continue
    raise SystemExit('No writable folder for Workout Timer data.')


DATA = data_dir()
STORE = DATA / 'workouts.json'


class Api:
    def load(self):
        try:
            return json.loads(STORE.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def save(self, state):
        tmp = STORE.with_suffix('.tmp')
        tmp.write_text(json.dumps(state, indent=2), encoding='utf-8')
        tmp.replace(STORE)  # atomic, so a crash mid-save can't wipe your workouts
        return True

    def data_folder(self):
        return str(DATA)

    def open_data_folder(self):
        os.startfile(DATA)

    def export_backup(self, text, name):
        path = webview.windows[0].create_file_dialog(webview.FileDialog.SAVE, save_filename=name,
                                                     file_types=('Backup (*.json)',))
        if not path:
            return False
        Path(path if isinstance(path, str) else path[0]).write_text(text, encoding='utf-8')
        return True

    def import_backup(self):
        paths = webview.windows[0].create_file_dialog(webview.FileDialog.OPEN, file_types=('Backup (*.json)',))
        return Path(paths[0]).read_text(encoding='utf-8') if paths else None

    def set_on_top(self, on):
        # pywebview's own window.on_top hangs the window (WinForms backend), so flip the flag through Win32.
        u32 = ctypes.windll.user32
        u32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND] + [ctypes.c_int] * 4 + [ctypes.c_uint]  # -1 must stay pointer-sized
        pid, found = os.getpid(), []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        def each(hwnd, _):
            owner = wintypes.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == pid and u32.IsWindowVisible(hwnd):
                found.append(hwnd)
            return True

        u32.EnumWindows(each, 0)
        for hwnd in found:  # HWND_TOPMOST / HWND_NOTOPMOST; SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            u32.SetWindowPos(hwnd, -1 if on else -2, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0010)
        return bool(found)


if __name__ == '__main__':
    webview.create_window('Workout Timer', (BUNDLE / 'ui.html').as_uri(), js_api=Api(),
                                width=480, height=860, min_size=(380, 620), background_color='#0d0f14')
    webview.start(private_mode=False, storage_path=str(DATA / 'webview'), icon=str(BUNDLE / 'icon.ico'))
