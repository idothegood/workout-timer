# Workout Flow, Stay-Awake, Custom Workout Fix and CSV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the between-sets loop work without touching the phone, keep the screen awake while the app is open, fix new custom workouts that won't start, and add CSV import and export.

**Architecture:**
- Everything lives in `src/ui.html` (vanilla JS, one inline `<script>`).
- One pure session engine (`newSession` / `sessTick` / `sessTap` / `sessResume`) replaces the two separate timer loops. The quick timer and the guided run both build a `steps` array and render from the engine's state.
- CSV is a set of pure functions (`parseCSV`, `csvToWorkouts`, `workoutsToCSV`) plus thin UI and file glue.
- Tests are Playwright scripts that load `src/ui.html` from disk in headless Chromium and use `page.clock` for fake time.

**Tech Stack:**
- Vanilla JS/HTML/CSS.
- pywebview, for the Windows app.
- Python build script.
- Tests: Node 22 built-in test runner (`node --test`) with the globally installed Playwright 1.56 (`NODE_PATH=$(npm root -g)`).

**Spec:** `notes/superpowers/specs/2026-10-17-workout-flow-csv-design.md`

## Global Constraints

- `src/ui.html` is shared by the web app and the Windows app. Vanilla JS only: no build step, no npm dependencies in the app.
- The web app is built with `python src/build_web.py` into `docs/`. Never hand-edit `docs/`, and never put notes or tests in `docs/` (the build deletes it).
- Keep CSP in `build_web.py` as `default-src 'self'`, with no external hosts.
- Existing saved data (`localStorage['wt-state']`, `workouts.json`) must keep loading. New settings get defaults via `DEFAULT_SETTINGS`.
- New settings: `hold: 2.5` (seconds, 0–5, step 0.5) and `keepAwake: true`.
- CSV header: `workout,exercise,type,sets,reps,set_time,rest,rest_after,notes`. Blank defaults: exercise → `Exercise N`, type → `Standard`, sets → `3`, set_time → `0`, rest → `60`, rest_after → `120`.
- Import always adds new workouts. A name clash gets ` (2)`, ` (3)`… Nothing existing is ever changed.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PuCBmDLN2MvEZ3Y9fnYnvH
  ```
- Run all tests: `NODE_PATH=$(npm root -g) node --test tests/`

## Deviations from the spec (builder calls the spec allowed)

- **No hidden-video wake fallback.**
  - Every target has the Screen Wake Lock API: iOS 18.4+ home-screen apps, WebView2 in the Windows app, and current Chrome, Edge, Firefox and Safari.
  - The spec allows dropping the fallback. Where `navigator.wakeLock` is missing, the app simply doesn't hold the screen on.
- **CSV formula-injection guard is in.**
  - On export, a text cell starting with `=`, `+`, `@` or a tab gets a leading `'`.
  - On import, a leading `'` before one of those characters is stripped.
  - `-` is left alone, since reps like `-` or notes like `- slow` are common and harmless.

## Review Focus

1. **Tapping during the 2.5 s hold.** Must advance exactly one set, never two. The auto-reset must not fire afterwards. Test: Task 3 `tap during alert advances once`.
2. **Phone locked mid-rest, back minutes later, next set timed (Plank 45 s).** Must land at the start of that timed set, with its countdown starting now, and no alert. Test: Task 3 `resume never runs through a work step`.
3. **Changing quick-timer sets or rest while resting.** `−`/`+` and preset chips mid-session must not break the loop or skip a set. Test: Task 5 `changing sets mid-rest keeps the current set`.
4. **A CSV saved by Excel**: BOM, CRLF, `;` delimiter, quoted commas, a trailing blank line. Must import exactly the rows written. Test: Task 7 `parses Excel-style file`.
5. **Export then re-import.** Must reproduce the same exercises, including `rest = 0` (which must not come back as the default 60). Test: Task 7 `round-trips including zero rest`.

---

### Task 1: Test harness + new custom workouts start

The reproduced bug:
- `commitDraft()` and `buildSteps()` drop every unnamed exercise when there's more than one.
- A new workout with unnamed exercises is saved empty.
- `startRun()` then silently returns.

**Files:**
- Create: `tests/helpers.js`, `tests/editor.test.js`
- Modify: `src/ui.html` (`commitDraft` ~line 306, `buildSteps` ~line 325, `startRun` ~line 344)
- Modify: `README.md` (add a "Tests" section with the run command)

**Interfaces:**
- Produces, `tests/helpers.js`: `async function openApp({ state } = {}) -> { browser, page, errors }`.
  - Launches Chromium, opens a new context (fresh storage) with viewport 390×800, and runs `page.clock.install()`.
  - Optionally seeds `localStorage['wt-state']` via `addInitScript`.
  - Stubs `navigator.wakeLock` via `addInitScript`. The stub records calls in `window.__wake = { requests: 0, held: false }`, and `request()` resolves a sentinel that has `release()` and `addEventListener`.
  - Goes to `file://<repo>/src/ui.html` and runs `page.clock.runFor(800)` so `loadState` fires.
  - Collects `pageerror` messages into `errors`.
- Produces: `src/ui.html` `commitDraft()` keeps every exercise, and blank names become `Exercise ${index + 1}`.

- [ ] **Step 1: Write the failing tests** in `tests/editor.test.js`:

```js
test('new workout with unnamed exercises saves and starts', async () => {
  const { browser, page, errors } = await openApp();
  await page.evaluate(() => go('workouts'));
  await page.click('#newBtn'); await page.fill('#wname', 'Legs');
  await page.click('#addEx'); await page.click('#addEx');
  await page.click('#saveStart'); await page.clock.runFor(200);
  assert.equal(await page.evaluate(() => current), 'run');
  assert.deepEqual(await page.evaluate(() => state.workouts.at(-1).exercises.map(x => x.name)), ['Exercise 1', 'Exercise 2', 'Exercise 3']);
  assert.deepEqual(errors, []); await browser.close();
});
test('starting a workout with no exercises says so', async () => {
  // seed state with { workouts: [{ id: 'e', name: 'Empty', exercises: [] }], history: [] }
  // click [data-start="e"] → #confirmScrim has class "on" and #confirmMsg contains "no exercises"
});
```

- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `NODE_PATH=$(npm root -g) node --test tests/editor.test.js`
  - Expected: FAIL. `current` is `'edit'`, and the names array is `[]`.
- [ ] **Step 3: Implement the fix.**
  - In `commitDraft`, map blank names to `Exercise N` instead of filtering.
  - In `buildSteps`, drop the name filter (use `w.exercises`).
  - In `startRun`, when `!w.exercises.length`, call `ask('This workout has no exercises yet. Add one in the editor.', 'OK', null)` and return.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `tests/` + `src/ui.html` + `README.md` with the message `Fix new custom workouts saving empty; add Playwright tests`.

### Task 2: Editor keeps focus while editing

`renderEditor()` rebuilds `#exlist` on every `change` to `type`, `sets`, `work`, `rest` or `after`. On iPhone this closes the keyboard after each field.

**Files:**
- Modify: `src/ui.html` (`renderEditor` ~line 252, `#exlist` change listener ~line 281)
- Test: `tests/editor.test.js`

**Interfaces:**
- Produces:
  - `renderTotal()` updates only `#wtotal`.
  - `refreshExRow(i)` updates only row `i`: its `linked` class and its hint/link-note element. It never touches the inputs.
  - `renderEditor()` stays as is, for add, move, copy and delete.

- [ ] **Step 1: Write the failing test** `changing sets keeps focus on the next field`:
  - `fill('[data-i="0"] [data-f="sets"]', '5')`, then `press(..., 'Tab')`.
  - Assert `document.activeElement.dataset.f === 'reps'` and `draft.exercises[0].sets === 5`.
  - Also: select type `Superset` on row 0 of a two-row draft, and assert `.ex[data-i="0"]` has class `linked` and focus is still inside row 0.
- [ ] **Step 2: Run it.** Expected: FAIL. `activeElement` is `BODY`.
- [ ] **Step 3: Implement.**
  - The change listener writes the value back into the input in normalised form (`fmtField` for times, the clamped number for sets).
  - It then calls `refreshExRow(i)` and `renderTotal()` instead of `renderEditor()`.
  - `renderEditor` uses those two helpers internally so the markup has one source.
  - Note that a row's link state depends on the next row only for "is not last". Move, add and delete already do a full re-render.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `Editor: update rows in place so the keyboard stays open`.

### Task 3: Session engine (pure)

**Files:**
- Modify: `src/ui.html`. Add a `// ---------- session engine ----------` block after the time helpers.
- Test: `tests/engine.test.js`. Call the functions through `page.evaluate`, passing explicit `now` values. No clock is needed.

**Interfaces:**
- Produces:
  - A **step** is `{ kind: 'ready'|'work'|'rest', dur: seconds (0 = open-ended, tap when done), ex?, set?, of?, between? }`. This is the existing `buildSteps` shape.
  - `newSession(steps, now) -> sess` with fields:
    - `steps`, `i`, `alert: false`, `alertUntil: 0`, `stepStart`, `end` (ms; 0 if open), `paused: false`, `pausedLeft`, `pausedElapsed`, `lastBeep: null`, `started: now`, `done: false`.
  - `sessEnter(sess, i, now) -> void`.
    - Sets `i`, `stepStart = now`, `end = dur ? now + dur*1000 : 0`, `alert = false`, `lastBeep = null`.
    - If `i >= steps.length`, sets `done = true`.
  - `sessTick(sess, now, holdSec) -> string[]`, which returns events.
  - `sessTap(sess, now) -> string[]`, the main button.
  - `sessResume(sess, now) -> string[]`, for catch-up on return to the app.
  - `sessPause(sess, now)` / `sessUnpause(sess, now)`.
  - Event names: `'tick'` (each of 3-2-1 once), `'alert'` (rest finished: beep and flash), `'go'` (ready finished), `'workEnd'` (a timed work set finished), `'enter'` (entered a new step), `'finish'` (the session is done).

`sessTick` rules, in order (the algorithm the tests pin):
1. If `done` or `paused`, return `[]`.
2. If `alert`: when `now >= alertUntil`, `sessEnter(i+1)` and return `['enter']` plus `'finish'` if done. Otherwise return `[]`.
3. If the step has `dur` and `now >= end`:
   - `rest`: set `alert = true` and `alertUntil = end + holdSec*1000`. Return `['alert']`. If `holdSec === 0`, also enter the next step immediately and append `'enter'`.
   - `ready`: enter the next step and return `['go', 'enter']`.
   - `work`: enter the next step and return `['workEnd', 'enter']` (plus `'finish'` if done).
4. If the step has `dur`, `sec = ceil((end-now)/1000)` and `1 <= sec <= 3` and `sec !== lastBeep`: set `lastBeep = sec` and return `['tick']`.
5. Return `[]`.

`sessTap`:
- During alert, enter `i+1`.
- Otherwise enter `i+1` from any step: set done, skip rest, skip a timed set, start now.
- Return `['enter']`, plus `'finish'` if done.

`sessResume`:
- Only acts when the current step is `rest` or `ready` and has ended (`now >= end`), or when `alert` is set.
- It then enters the next step at `now`, so a work set's clock starts on return.
- It returns `['enter']` with no `'alert'`.
- A timed `work` step that ended while away also advances one step, to whatever follows, starting at `now`.
- It never advances more than one step.

Pause during alert is ignored (`sessPause` is a no-op when `alert`).

- [ ] **Step 1: Write the failing tests** in `tests/engine.test.js`. Use steps `W` = `[work(dur 0, set 1/2), rest(dur 10), work(dur 0, set 2/2)]` and `T` = `[work 0, rest 10, work(dur 45), rest 30, work 45]`.
  - `rest end raises alert then auto-enters next after hold`:
    - Tap at t=0, so `i=1` and `end=10000`.
    - `sessTick(s, 7000, 2.5)` → `['tick']`.
    - `sessTick(s, 10000, 2.5)` → `['alert']`, with `s.alert === true` and `s.i === 1`.
    - `sessTick(s, 12400, 2.5)` → `[]`.
    - `sessTick(s, 12500, 2.5)` → `['enter']`, with `s.i === 2` and `s.stepStart === 12500`.
  - `tap during alert advances once`:
    - After the alert at 10000, `sessTap(s, 11000)` gives `s.i === 2`.
    - Then `sessTick(s, 13000, 2.5)` → `[]`, with `s.i === 2`.
  - `hold 0 enters immediately`: `sessTick(s, 10000, 0)` → `['alert', 'enter']`, with `s.i === 2`.
  - `late tick is deterministic`:
    - With no ticks between 0 and 20000, `sessTick(s, 20000, 2.5)` → `['alert']` and `alertUntil === 12500`.
    - The next tick enters.
  - `resume never runs through a work step`:
    - Using `T`, tap at 0 so the step is rest, ending at 10000.
    - `sessResume(s, 180000)` → `['enter']`, with `s.i === 2`, `s.end === 225000` and `s.alert === false`.
  - `resume mid-rest does nothing`: `sessResume(s, 5000)` → `[]`, with `s.i === 1`.
  - `last tap finishes`: on the final work step, `sessTap` → `['enter', 'finish']`, with `s.done === true`.
  - `3-2-1 ticks once each`: ticks at 7000, 7100, 8000 and 9000 give `['tick']`, `[]`, `['tick']` and `['tick']`.
- [ ] **Step 2: Run them.** Expected: FAIL, because `newSession is not defined`.
- [ ] **Step 3: Implement** the functions above as plain top-level functions (globals, like the rest of the file).
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `Add shared session engine for set/rest/alert timing`.

### Task 4: Guided run uses the engine and adds the alert state and hold setting

**Files:**
- Modify: `src/ui.html`:
  - The RUN section, ~lines 342–447: `startRun`, `enterStep`, `nextStep`, `prevStep`, `togglePause`, `finish`, `rAdjust`, `renderRun`, `runDraw`.
  - The `setInterval` loop, ~line 451.
  - CSS, ~lines 100–115.
  - The settings HTML (~line 349) and JS (~line 465).
  - `DEFAULT_SETTINGS`.
- Test: `tests/run.test.js`, using `page.clock`.

**Interfaces:**
- Consumes: the Task 3 engine.
- Produces:
  - `run` becomes `{ w, sess }`.
  - `handleEvents(screen, events)` plays sounds and effects for an event list:
    - `tick` → `tick()`.
    - `alert` → `beep([0, .22, .44], 990, .3)` and adds class `alerting` to `#<screen>`.
    - `go` → `beep([0, .22], 990, .3)`.
    - `enter` into a work step → `flash(screen)` only, with no beep. The alert or the user's own tap already signalled it.
    - `workEnd` → `beep([0], 520, .45)`.
    - `finish` → the caller's finish handler.
  - Settings `S().hold` and `S().keepAwake` exist in `DEFAULT_SETTINGS`.
  - A `#sHold` number input (0–5, step 0.5) under "Get-ready countdown", labelled "Time's up hold", with the hint "Seconds the screen flashes before the next set".

Alert UI:
- While `sess.alert` is set, call `setPhase('run', 'alert')`.
- Draw with phase `"Time's up"`, clock `GO`, sub `next: set N` (or the next exercise's name) and `frac: 0`.
- `#rMain` reads `Start now ⏭`.
- CSS: `.screen.p-alert` animates the whole screen background between `var(--ready)` at 35% alpha and `var(--bg)`, at 0.5 s per cycle, repeating for the hold. Phase and clock text are `var(--ready)`.

Behaviour:
- Pause, ±15 s and back work as today, through the engine.
- `prevStep` calls `sessEnter` with the same 2.5 s rule as today.

- [ ] **Step 1: Write the failing tests** in `tests/run.test.js`. Seed a workout: one exercise, `sets: 2`, `rest: 10`, `work: 0`, and `S().ready = 0`.
  - `set done → rest → alert → auto next set`:
    - Start the workout, then click `#rMain`, so the rest step is `p-rest`.
    - `runFor(10000)`, so `#run` has class `p-alert` and `.phase` reads `Time's up`.
    - `runFor(2600)`, so `#run` has class `p-work`, `.phase` reads `Go`, and `#badges` contains `Set 2 / 2`.
    - No taps between rest start and set 2.
  - `hold setting is respected`: set `S().hold = 0`. After `runFor(10100)`, the screen is already `p-work`.
  - `last set finishes the workout`: from set 2, click `#rMain`, so `current === 'done'` and `state.history.length === 1`.
- [ ] **Step 2: Run them.** Expected: FAIL, because there is no `p-alert`.
- [ ] **Step 3: Implement.**
  - Rewire the RUN section onto `run.sess`.
  - The interval loop calls `handleEvents('run', sessTick(run.sess, Date.now(), S().hold))`, then `runDraw()`.
  - Add the CSS, the setting and the alert drawing.
- [ ] **Step 4: Run all tests.** Expected: PASS, including Tasks 1–3.
- [ ] **Step 5: Commit** with the message `Guided workouts: time's-up alert with auto-reset to next set`.

### Task 5: Quick timer uses the engine

**Files:**
- Modify: `src/ui.html`, the QUICK TIMER section (~lines 102–178) and the keyboard handler (~line 548).
- Test: `tests/quick.test.js`

**Interfaces:**
- Consumes: the engine and `handleEvents` (Task 4).
- Produces:
  - `stepsQuick(sets, rest) -> step[]` returns `[work 1/sets, rest, work 2/sets, …, work sets/sets]`. Work steps have `dur 0` and `ex: null`. Rest steps have `dur: rest`.
  - `qt` becomes `{ rest, sess: null | sess, finished }`.
  - Idle means `qt.sess === null`. Done means `qt.sess.done`.

Behaviour changes:
- **Idle:** the main button reads `Start ▶`. Tapping it starts the session at set 1 work, with the count-up clock running. Today the first tap means "set 1 done".
- **Work:** the button reads `Set done · rest 1:30`, or `Last set done ✓` on the last set.
- **Rest:** the button reads `Skip rest ⏭`.
- **Alert:** as in Task 4, but on `#timer`.
- **Done:** as today, with a `Start over ↺` button.
- **`setQRest(s)` mid-session:** rewrite `dur` on all rest steps. If the current step is rest, move `end` to `stepStart + s*1000`, the same as today.
- **`qChangeSets(d)` mid-session:**
  - Rebuild the steps with `stepsQuick(newSets, qt.rest)`, keeping `i`. The index layout doesn't depend on the set count.
  - If `i` lands beyond the new last work index, enter the last work step.
  - Then rewrite `of` in the steps.

- [ ] **Step 1: Write the failing tests** in `tests/quick.test.js`. Seed with `settings: { rest: 10, qSets: 2 }`.
  - `start → set done → rest → alert → set 2, untouched`:
    - Click `#qMain`, so `.phase` reads `Working` and `#qSet` reads `1`.
    - Click `#qMain` again to start the rest, then `runFor(10000)`, so the screen is `p-alert`.
    - `runFor(2600)`, so `#qSet` reads `2` and the screen is `p-work`.
    - Click `#qMain`, and `.phase` reads `Done`.
  - `changing sets mid-rest keeps the current set`:
    - In the rest after set 1, click `#qMore`, so `#qOf` reads `3` and `#qSet` reads `1`.
    - Let the rest finish and the hold pass, and `#qSet` reads `2`.
    - Click `#qLess` twice, so `#qOf` reads `1` and `#qSet` reads `1`, then tap to finish.
  - `rest chip mid-rest changes the countdown`: during rest, click a 60 s preset, and `.clock` shows about `60` minus the elapsed time.
- [ ] **Step 2: Run them.** Expected: FAIL. The first tap starts a rest instead of `Working`.
- [ ] **Step 3: Implement** the changes above. Update the `.keys` hint text to `SPACE = start / set done / skip`.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `Quick timer: start, set done, rest, auto-reset loop on the shared engine`.

### Task 6: Stay awake while the app is open, and catch up on return

**Files:**
- Modify: `src/ui.html`:
  - The wake lock section (~line 508).
  - Settings HTML/JS: a `#sAwake` switch labelled "Keep screen on", with the hint "While the app is open".
  - Add a `visibilitychange` listener.
- Test: `tests/wake.test.js`

**Interfaces:**
- Consumes: `sessResume`, `handleEvents`, `S().keepAwake`.
- Produces:
  - `updateWake()` requests when `S().keepAwake && document.visibilityState === 'visible' && !wake`, and releases when `!S().keepAwake`.
  - It is called on load, on every `pointerdown`, on `visibilitychange` and on the lock's `release` event, and it keeps the 1 s retry interval.
  - The old "only while a timer runs" condition is removed.
  - `onVisible()`: when visible, for each live session (`run?.sess`, `qt.sess`), call `handleEvents(screen, sessResume(sess, Date.now()))`, then redraw and run `updateWake()`.

- [ ] **Step 1: Write the failing tests:**
  - `requests wake lock on load with no timer running`: after `openApp()`, `window.__wake.requests >= 1`, with the quick timer idle.
  - `turning the setting off releases`: uncheck `#sAwake`, and `window.__wake.held === false`.
  - `re-requests after release`: in the page, fire the stub sentinel's `release` listener, then `runFor(1100)`, and `requests` has increased.
  - `return after a long rest lands on next set without alert`:
    - Quick timer with `rest: 10`. Start, set done.
    - Use `page.evaluate` to override `document.visibilityState` to `'hidden'`.
    - `page.clock.setSystemTime(Date.now() + 180000)` (jumps the clock with no interval ticks).
    - Set the state back to `'visible'` and dispatch `visibilitychange`.
    - `#qSet` reads `2`, the screen is `p-work` and not `p-alert`.
- [ ] **Step 2: Run them.** Expected: FAIL. `requests` is 0 while idle.
- [ ] **Step 3: Implement** the changes above.
  - The interval loop must skip `sessTick` while `document.visibilityState === 'hidden'`, so `onVisible` owns catch-up.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `Keep the screen awake whenever the app is open; catch up cleanly on return`.

### Task 7: CSV parse and serialize (pure)

**Files:**
- Modify: `src/ui.html`. Add a `// ---------- CSV ----------` block after the backup section.
- Test: `tests/csv.test.js`, through `page.evaluate`.

**Interfaces:**
- Produces:
  - `parseCSV(text) -> string[][]`.
    - RFC 4180: quoted fields can hold commas, `""` and newlines.
    - Strips a leading BOM and accepts CRLF/LF.
    - Delimiter: `;` if the first line has more unquoted `;` than `,`, otherwise `,`.
    - Drops rows whose cells are all blank.
  - `CSV_COLS = ['workout','exercise','type','sets','reps','set_time','rest','rest_after','notes']`.
  - `csvToWorkouts(text, takenNames: string[]) -> { workouts, problems: string[], error: string|null }`.
    - Header names are normalised as lowercase, trimmed, with spaces turned into `_`. Unknown columns are ignored.
    - A missing `workout` column gives `error: "No 'workout' column in the header."`.
    - Rows are grouped by workout name in order of first appearance. Each exercise is built with `ex({...})`, using the defaults from Global Constraints and `parseTime` for the three time columns.
    - Problem messages are `row N: …`, where N is the 1-based line number in the file, header = row 1:
      - `row N: no workout name, skipped`
      - `row N: sets "abc" isn't a number, used 3`
      - `row N: sets 40 out of range, used 20`
      - `row N: unknown type "Foo", used Standard`
    - Workout names get `uniqueName` against `takenNames` plus names already produced in this import.
  - `uniqueName(name, taken: Set<string>) -> string` returns `name`, `name (2)`, `name (3)`, and so on.
  - `workoutsToCSV(workouts) -> string`.
    - BOM, header row, `\r\n` line endings, `,` delimiter.
    - Quote a cell when it contains `,`, `"` or a newline.
    - Times are written as `fmtTime(s)` (`0` → `"0"`, `90` → `"1:30"`).
    - Apply the formula guard from the Deviations section.

- [ ] **Step 1: Write the failing tests:**
  - `parses Excel-style file`:
    - Input: `'﻿workout;exercise;sets;rest\r\nPush;"Bench; flat";4;1:30\r\nPush;Fly;3;45\r\n\r\n'`.
    - Result: one workout `Push`, with exercises `Bench; flat` (sets 4, rest 90) and `Fly` (sets 3, rest 45).
  - `defaults and problems`:
    - Input: `'workout,exercise,sets,type\nA,,abc,Foo\n,X,3,\n'`.
    - Result: exercise `Exercise 1`, with sets 3 and type Standard.
    - `problems` is `['row 2: sets "abc" isn\'t a number, used 3', 'row 2: unknown type "Foo", used Standard', 'row 3: no workout name, skipped']`.
  - `missing workout column`: `csvToWorkouts('name,sets\nA,3', [])` gives `error === "No 'workout' column in the header."`.
  - `name clash`: importing `Push` twice in one file is a single workout. With `takenNames = ['Push']` it becomes `Push (2)`.
  - `round-trips including zero rest`:
    - `csvToWorkouts(workoutsToCSV([sample with rest 0, after 0, notes 'a, "b"', work 45]), [])` returns exercises equal to the originals on every `CSV_COLS` field (ignoring ids).
  - `formula guard`: an exercise named `=SUM(A1)` exports as `'=SUM(A1)` and re-imports as `=SUM(A1)`.
- [ ] **Step 2: Run them.** Expected: FAIL, because `parseCSV is not defined`.
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `Add CSV parse/serialize for workouts`.

### Task 8: CSV import and export UI, the Windows app, and web build

**Files:**
- Modify: `src/ui.html`:
  - The Workouts appbar (~line 258): add `Import` and `Export` text buttons (`#csvImport`, `#csvExport`).
  - `renderWorkouts` (~line 212): add a share button `data-share` per card (title "Export CSV", glyph `⇪`).
  - The backup section (~line 486): extract the download code into a helper.
  - `.dialog p` CSS: add `white-space: pre-line`.
- Modify: `src/app.py`: add `export_csv(self, text, name)` and `import_csv(self)`, mirroring `export_backup` / `import_backup` with `file_types=('CSV (*.csv)',)`.
- Modify: `README.md`: one paragraph on the CSV format (the columns, and that import always adds new workouts).
- Rebuild: `docs/`, via `python src/build_web.py`.
- Test: `tests/csv-ui.test.js`

**Interfaces:**
- Consumes: `csvToWorkouts`, `workoutsToCSV`, `ask`, `persist`, `renderWorkouts`.
- Produces:
  - `downloadFile(text, name, type)`. This is the existing anchor/blob code, and `#backupBtn` now uses it.
  - `async shareFile(text, name, type)`, tried in this order:
    1. `api()?.export_csv`.
    2. Otherwise, if `navigator.canShare?.({ files: [file] })`, call `navigator.share({ files: [file], title: name })`. An `AbortError` is ignored; any other error falls back to download.
    3. Otherwise `downloadFile`.
  - `async pickTextFile(accept) -> string|null`, using `api()?.import_csv()` or a hidden `<input type=file>`.
  - Export file names: `workouts-YYYY-MM-DD.csv` for all, `<workout name>.csv` for one (unsafe filename characters replaced with `-`).
  - The import confirm message is `Add 3 workouts (14 exercises)?`, with problems appended after a blank line, at most 8 then `…and N more`. The button reads `Add`.
  - On `error`, show `ask(error, 'OK', null)`. On Add, push the workouts, `persist()` and `renderWorkouts()`.

- [ ] **Step 1: Write the failing tests:**
  - `import adds new workouts beside existing`:
    - Seed one workout `Push`.
    - Stub the file input: `page.setInputFiles` on the hidden input via `page.on('filechooser')`, with a CSV of `Push` (2 rows) and `Pull` (1 row).
    - `#confirmMsg` contains `Add 2 workouts (3 exercises)?`. Click `#confirmYes`.
    - `state.workouts.map(w => w.name)` equals `['Push', 'Push (2)', 'Pull']`, and the original `Push` still has its id and exercises.
  - `cancel import changes nothing`: click `#confirmNo`, and `state.workouts.length === 1`.
  - `export all downloads csv`:
    - With `navigator.canShare` undefined, click `#csvExport` and capture `page.waitForEvent('download')`.
    - The file name matches `/^workouts-\d{4}-\d{2}-\d{2}\.csv$/`, and the content starts with `﻿workout,exercise,`.
- [ ] **Step 2: Run them.** Expected: FAIL, because there is no `#csvImport`.
- [ ] **Step 3: Implement** the UI, the helpers, the `app.py` methods and the README paragraph.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Build the web app.**
  - Run `python src/build_web.py`. Expected: `web app built in …/docs (version …)`.
  - Check that `git diff --stat docs/` shows `index.html` and `sw.js` changed and `CNAME` unchanged.
- [ ] **Step 6: Commit** `src/`, `docs/` and `README.md` with the message `CSV import/export of workouts; rebuild web app`.

### Task 9: Hand-off checklist for the owner (no code)

- [ ] **Step 1:** Push the branch.
- [ ] **Step 2:** List the on-iPhone checks the tests can't do:
  - The screen stays on through a 2-minute idle between sets.
  - The keyboard stays open while editing fields.
  - The share sheet opens on Export.
  - The file picker opens on Import.
  - Beeps play after the first tap.
