const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

let app;
test.before(async () => { app = await openApp(); });
test.after(() => app.browser.close());
const run = (fn, arg) => app.page.evaluate(fn, arg);
const strip = ws => ws.map(w => ({ name: w.name, exercises: w.exercises.map(({ id, ...r }) => r) }));

test('parses Excel-style file', async () => {
  const r = await run(() => csvToWorkouts('﻿workout;exercise;sets;rest\r\nPush;"Bench; flat";4;1:30\r\nPush;Fly;3;45\r\n\r\n', []));
  assert.equal(r.error, null);
  assert.deepEqual(r.problems, []);
  assert.equal(r.workouts.length, 1);
  assert.equal(r.workouts[0].name, 'Push');
  const [a, b] = r.workouts[0].exercises;
  assert.deepEqual([a.name, a.sets, a.rest], ['Bench; flat', 4, 90]);
  assert.deepEqual([b.name, b.sets, b.rest], ['Fly', 3, 45]);
});

test('parseCSV handles quotes, newlines and blank rows', async () => {
  const rows = await run(() => parseCSV('a,b\n"x ""q"", y","l1\nl2"\n,\n'));
  assert.deepEqual(rows, [['a', 'b'], ['x "q", y', 'l1\nl2']]);
});

test('defaults and problems', async () => {
  const r = await run(() => csvToWorkouts('workout,exercise,sets,type\nA,,abc,Foo\n,X,3,\n', []));
  assert.equal(r.workouts.length, 1);
  const e = r.workouts[0].exercises[0];
  assert.deepEqual([e.name, e.sets, e.type, e.reps, e.work, e.rest, e.after, e.notes], ['Exercise 1', 3, 'Standard', '', 0, 60, 120, '']);
  assert.deepEqual(r.problems, ['row 2: sets "abc" isn\'t a number, used 3', 'row 2: unknown type "Foo", used Standard', 'row 3: no workout name, skipped']);
});

test('sets out of range', async () => {
  const r = await run(() => csvToWorkouts('workout,sets\nA,40\nA,0\n', []));
  assert.deepEqual(r.workouts[0].exercises.map(e => e.sets), [20, 1]);
  assert.deepEqual(r.problems, ['row 2: sets 40 out of range, used 20', 'row 3: sets 0 out of range, used 1']);
});

test('missing workout column', async () => {
  const r = await run(() => csvToWorkouts('name,sets\nA,3', []));
  assert.equal(r.error, "No 'workout' column in the header.");
});

test('name clash', async () => {
  const csv = 'workout,exercise\nPush,A\nPush,B\n';
  const one = await run(csv => csvToWorkouts(csv, []), csv);
  assert.equal(one.workouts.length, 1);
  assert.equal(one.workouts[0].exercises.length, 2);
  const two = await run(csv => csvToWorkouts(csv, ['Push']), csv);
  assert.deepEqual(two.workouts.map(w => w.name), ['Push (2)']);
  assert.equal(await run(() => uniqueName('Push', new Set(['Push', 'Push (2)']))), 'Push (3)');
});

test('round-trips including zero rest', async () => {
  const sample = [{ name: 'Day, 1', exercises: [
    { name: 'Squat', type: 'Superset', sets: 5, reps: '5', work: 45, rest: 0, after: 0, notes: 'a, "b"\nline2' },
    { name: 'Plank', type: 'Standard', sets: 3, reps: '', work: 90, rest: 60, after: 120, notes: '' },
  ] }];
  const out = await run(s => {
    const ws = s.map(w => ({ id: 'w', name: w.name, exercises: w.exercises.map(e => ex(e)) }));
    return csvToWorkouts(workoutsToCSV(ws), []);
  }, sample);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(strip(out.workouts), sample);
});

test('export format', async () => {
  const csv = await run(() => workoutsToCSV([{ id: 'w', name: 'A', exercises: [ex({ name: 'X', work: 90, rest: 0, reps: '8' })] }]));
  assert.equal(csv, '﻿workout,exercise,type,sets,reps,set_time,rest,rest_after,notes\r\nA,X,Standard,3,8,1:30,0,2:00,\r\n');
});

test('formula guard', async () => {
  const csv = await run(() => workoutsToCSV([{ id: 'w', name: 'A', exercises: [ex({ name: '=SUM(A1)', notes: '- slow' })] }]));
  assert.ok(csv.includes(",'=SUM(A1),"));
  assert.ok(csv.includes(',- slow'));
  const r = await run(c => csvToWorkouts(c, []), csv);
  assert.equal(r.workouts[0].exercises[0].name, '=SUM(A1)');
  assert.equal(r.workouts[0].exercises[0].notes, '- slow');
});

test('inherited Object.prototype names are not valid types', async () => {
  const r = await run(() => csvToWorkouts('workout,type\nA,constructor\nA,__proto__\n', []));
  assert.deepEqual(r.workouts[0].exercises.map(e => e.type), ['Standard', 'Standard']);
  assert.deepEqual(r.problems, ['row 2: unknown type "constructor", used Standard', 'row 3: unknown type "__proto__", used Standard']);
});

test('bad time cells fall back to column defaults with a problem', async () => {
  const r = await run(() => csvToWorkouts('workout,set_time,rest,rest_after\nA,abc,1 min,-30\nA,45,1:30,2m\nA, 1.5M ,90,0\n', []));
  assert.deepEqual(r.workouts[0].exercises.map(e => [e.work, e.rest, e.after]), [[0, 60, 120], [45, 90, 120], [90, 90, 0]]);
  assert.deepEqual(r.problems, ['row 2: set_time "abc" not understood, used 0', 'row 2: rest "1 min" not understood, used 1:00', 'row 2: rest_after "-30" not understood, used 2:00']);
});

test('type matches case-insensitively and stores the canonical name', async () => {
  const r = await run(() => csvToWorkouts('workout,type\nA,superset\nA, GIANT SET \nA,toString\n', []));
  assert.deepEqual(r.workouts[0].exercises.map(e => e.type), ['Superset', 'Giant set', 'Standard']);
  assert.deepEqual(r.problems, ['row 4: unknown type "toString", used Standard']);
});
