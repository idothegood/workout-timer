# Workout Timer

Rest timer and workout runner: set counter, rest countdowns, saved workouts with set types (standard, drop set, superset, pyramid...).

- **Web app:** https://timer.ricardocarmona.io (add it to your home screen; works offline; workouts stay on your device)
- **Windows app:** `Workout Timer.exe`, a single portable file built from the same UI

## CSV
Workouts > Export / Import (or the share button on a card) use one row per exercise with the columns `workout,exercise,type,sets,reps,set_time,rest,rest_after,notes`; blank cells take defaults. Import always adds new workouts (a name clash becomes `Name (2)`) and never changes existing ones.

## Layout
- `src/ui.html`: the whole app (shared by web and desktop)
- `src/app.py`: desktop window (pywebview) that saves to `Workout Timer Data/` next to the exe
- `src/build.bat`: builds `Workout Timer.exe`
- `src/build_web.py`: builds the web app into `docs/` (served by GitHub Pages)
- `src/make_icon.py`: draws all icons

## Tests
Playwright tests drive `src/ui.html` in headless Chromium (needs `npm i -g playwright`):
```
NODE_PATH=$(npm root -g) node --test "tests/*.test.js"
```

## Update the web app
```
python src/make_icon.py   # only if the icon changed
python src/build_web.py
git add -A && git commit -m "Update" && git push
```
