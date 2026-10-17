# Workout flow, stay-awake, custom workout fix, CSV import/export

Date: 2026-10-17
Status: draft for approval

> Location note: specs live in `notes/`, not `docs/`. `src/build_web.py` deletes and rebuilds `docs/` (the GitHub Pages output) on every build.

## Why

The owner works out at home with an iPhone (latest iOS) lying on a desk. The app is installed to the home screen from Safari. Today three things get in the way:

1. **The phone locks between sets.** To start the next rest you have to pick up the phone and unlock it. That defeats the point of the app.
2. **New custom workouts don't start.** The default and example workouts run fine. A newly created one does nothing when started, and the screen doesn't react at all.
3. **Changing a routine means retyping it in the app's editor.** The owner wants to write or edit a whole routine in a spreadsheet, load it from a file, and share routines with other people.

They also want to trust the rest / set-done cycle. It should behave the same every time, with no touching the phone except one tap per set.

## Goals

### G1. The between-sets loop (quick timer and guided workouts)

1. Pick the rest time (quick timer) or start a workout.
2. **Work.** The phone sits there. The clock counts up so you can see how long the set took.
3. Tap once: **set done → rest countdown starts.**
4. Rest reaches 0: **time's up.** The whole screen flashes and a beep plays, big enough to notice from a few steps away. This "alert" state holds for about 2.5 s, then the app **resets itself to the next set's work state** with no tap needed. Tapping during the hold skips straight to the next set.
5. Repeat for the number of sets in the exercise.
6. After the last set:
   - **Quick timer:** finish (Done screen, as today).
   - **Guided workout:** use the exercise's "rest after" countdown if one is set, with the same alert and auto-reset, then move to the next exercise's set 1. After the last exercise, finish and log to history as today.

Keep these existing behaviours:
- Timed work sets (exercises with a "set time", e.g. plank 45 s) still count down on their own and go into rest automatically.
- The get-ready countdown at the start of a workout stays.
- Skip, ±15 s, pause, back and stop stay.
- Supersets / giant sets keep their current round-by-round order.

Hold length: a setting with a 0–5 s range, default 2.5 s.

### G2. Screen stays on while the app is open

- While the app is open and on screen, the screen does not dim or lock. The owner said this should hold whenever they're in the app; when they're done they swipe to the home screen.
- If you leave the app or press the power button, it doesn't need to keep working. Coming back must restore the stay-awake state on its own, without extra taps.
- Add a "Keep screen on" setting, default on.
- Primary mechanism: Screen Wake Lock API, which works in iOS home-screen apps on iOS 18.4 and later.
  - Request it on load and after every tap.
  - Request it again on `visibilitychange` when the app becomes visible.
  - If it gets released, request it again.
- Fallback only where Wake Lock is missing (e.g. desktop browsers): the hidden muted looping video technique. This needs `media-src` allowed in the CSP in `build_web.py`. The builder can drop the fallback if it complicates things; the owner's device has Wake Lock.

### G3. Timer reliability

- One timer engine drives both the quick timer and guided workouts. It works from end timestamps, not by counting ticks.
- On `visibilitychange` (coming back to the app), catch up immediately to the correct state: if rest ended while away, show the next set, not a stale countdown.
- Catch-up only ever finishes the rest that was running. **Every work step is a barrier.** The app never runs through a work set (timed or not) while nobody is looking. On return it lands at the start of the next work set, with its clock (count-up or timed countdown) starting from the moment you came back. It skips the beep and flash, because nobody was there to see them, and goes straight to the next set. (My call: the owner said the app needn't keep working while they're out of it.)
- Transitions must not depend on the 100 ms interval landing exactly on time. A late tick must still produce the same result, just later.
- The alert/auto-reset step must be impossible to double-fire. For example, a tap during the hold plus the auto-reset firing must not skip two sets.

### G4. Custom workouts work

Reproduced cause (Chromium, headless):
- `commitDraft()` and `buildSteps()` silently drop every exercise without a name whenever there is more than one.
- A new workout whose exercises were left unnamed is saved with **0 exercises**.
- `startRun()` then returns silently. "Save & start" leaves you on the editor, and ▶ on the list does nothing. That matches the owner's report.

Fixes:
- Never silently drop an exercise. A blank name becomes "Exercise N" on save.
- Starting a workout that somehow has no exercises shows a visible message instead of doing nothing.
- The editor must not lose focus or close the iPhone keyboard when you change Sets, Rest, Type and similar fields. Today `renderEditor()` rebuilds the whole list on every `change`.
- After the fix, the owner checks on their iPhone. It's possible they did type names and something iOS-specific also contributes, and that can't be reproduced here.

### G5. CSV import and export

Purpose: build or change a routine in a spreadsheet (Sheets, Excel, Numbers) and load the whole thing, and share routines with other people.

Format:
- One file can hold many workouts, with one row per exercise. Row order is exercise order.
- Rows for the same workout are grouped by the `workout` column, in order of first appearance.
- Header row required. Match header names ignoring case and surrounding spaces:

  | column | meaning | blank means |
  |---|---|---|
  | `workout` | workout name | row is an error |
  | `exercise` | exercise name | "Exercise N" |
  | `type` | one of the app's set types (Standard, Superset, Drop set…) | Standard |
  | `sets` | 1–20 | 3 |
  | `reps` | free text ("8", "8-10", "hold") | empty |
  | `set_time` | timed set length; blank = tap when done | 0 |
  | `rest` | rest between sets | 60 |
  | `rest_after` | rest before the next exercise | 120 |
  | `notes` | free text | empty |

- Times accept `90`, `1:30` or `2m`, the same as the editor (`parseTime`).
- Parse quoted fields with commas, quotes and newlines (RFC 4180). Handle a UTF-8 BOM and CRLF line endings. Detect `;` as the delimiter when the header uses it (European Excel).

Export:
- Export all workouts from the Workouts screen, or a single workout via a per-workout button.
- On iPhone, use the share sheet (`navigator.share` with a file) so it can go to Files, AirDrop or Messages. Fall back to a download where sharing files isn't supported. In the Windows app, use a save dialog (new `app.py` methods, alongside `export_backup`).
- Write times as `m:ss` or plain seconds so the file re-imports cleanly.
- Exporting first is how a user gets a template.

Import:
- File picker (`.csv`). In the Windows app, an open dialog.
- Before anything changes, show a preview such as "3 workouts, 14 exercises". List any problem rows by row number and reason (e.g. "row 7: sets 'abc', used 3"). Bad cells fall back to the defaults above. Rows with no workout name are skipped and reported.
- Imported workouts are **always added as new**. Nothing existing is replaced or merged.
- A name that clashes with an existing workout gets " (2)", " (3)", and so on. The owner wants copies side by side for safety and will delete old ones by hand.

The existing JSON backup and restore stays as it is (full state including settings and history).

## Non-goals

- Timers running or beeping while the app is closed or the phone is locked. That isn't possible to do reliably in a web app on iOS.
- Notifications, accounts, sync across devices.
- Redesigning the app's look beyond what the flash/alert state needs.
- Changing how supersets are grouped or how history works.
- Saving an in-progress session across a reload.

## Anti-goals (failure even if it "works")

- Anything that adds a tap or an unlock to the between-sets loop.
- An import that overwrites, merges into or deletes existing workouts.
- Losing a user's data: exercises silently dropped, a bad import corrupting state.
- The alert skipping a set, double-advancing, or getting stuck so you have to touch the phone.

## Constraints

- One file app: `src/ui.html` is shared by the web app and the Windows app (`src/app.py`, pywebview). Keep it vanilla JS, with no build step or dependencies.
- The web app is built into `docs/` by `python src/build_web.py`. Rebuild and commit `docs/` with the change. The service worker cache version changes automatically.
- CSP in `build_web.py`: `default-src 'self'`, inline scripts allowed, no external hosts. Any new needs (`media-src` for the video fallback, `blob:` for share or download) must be added there.
- Existing saved data in localStorage (`wt-state`) must keep loading.
- iOS Safari specifics:
  - Sound only plays after a user tap (`unlockAudio` already handles this).
  - `navigator.vibrate` doesn't exist.
  - Wake Lock needs the page to be visible.

## Decided by the owner

- Device: iPhone, latest iOS, home-screen web app.
- Flow G1 as written, including the auto-reset after 2–3 s, for both the quick timer and guided workouts.
- Stay awake only while in the app.
- Import always adds as new. Name clashes become side-by-side copies.
- CSV for import and export, used for editing routines outside the app and for sharing.

## Calls I made (the owner can override)

- Hold length default is 2.5 s, adjustable from 0 to 5 s in Settings.
- The time's-up signal is a beep plus a full-screen flash for the hold duration.
- Clashing names get " (2)".
- There's a "Keep screen on" setting, default on.
- Blank exercise names become "Exercise N".
- The CSV column names and defaults in the table above.
- Coming back after time away never skips a set (see G3). The next set starts when you're back, with no alert.
- Sound keeps the current Web Audio behaviour. It respects the iPhone silent switch and plays over music. The flash is the signal that always works.

## Left to the builder

- How to restructure the timer engine (G3), provided both screens share it and the behaviour above holds.
- Exact flash styling, within the existing visual language.
- Where the import/export buttons sit, on the Workouts screen and/or Settings.
- How to fix editor focus: partial re-render or restoring focus.
- Whether to guard against CSV formula injection on export (cells starting with `=`, `+`, `-` or `@` when opened in Excel).
- Test approach. There's no test setup in the repo. Playwright (global install) and Chromium are available in this environment, including `page.clock` for fake time. A small committed test script is preferred. Real-device checks (Wake Lock, iOS keyboard, share sheet) are done by the owner.
