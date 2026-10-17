const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

const seed = { workouts: [{ id: 'p1', name: 'Push', exercises: [{ id: 'x1', name: 'Bench', type: 'Standard', sets: 3, reps: '8', work: 0, rest: 60, after: 120, notes: '' }] }], history: [] };
const CSV = 'workout,exercise\nPush,A\nPush,B\nPull,C\n';

async function importCsv(page, buffer = Buffer.from(CSV)) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#csvImport')]);
  await fc.setFiles({ name: 'r.csv', mimeType: 'text/csv', buffer });
  await page.waitForFunction(() => document.querySelector('#confirmScrim').classList.contains('on'));
}

test('import adds new workouts beside existing', async () => {
  const { browser, page, errors } = await openApp({ state: seed });
  try {
    await page.evaluate(() => go('workouts'));
    await importCsv(page);
    assert.match(await page.textContent('#confirmMsg'), /Add 2 workouts \(3 exercises\)\?/);
    await page.click('#confirmYes');
    const ws = await page.evaluate(() => state.workouts);
    assert.deepEqual(ws.map(w => w.name), ['Push', 'Push (2)', 'Pull']);
    assert.equal(ws[0].id, 'p1');
    assert.equal(ws[0].exercises.length, 1);
    assert.equal(ws[0].exercises[0].id, 'x1');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('cancel import changes nothing', async () => {
  const { browser, page } = await openApp({ state: seed });
  try {
    await page.evaluate(() => go('workouts'));
    await importCsv(page);
    await page.click('#confirmNo');
    assert.equal(await page.evaluate(() => state.workouts.length), 1);
  } finally { await browser.close(); }
});

test('export all downloads csv', async () => {
  const { browser, page } = await openApp({ state: seed,
    init: () => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }) });
  try {
    await page.evaluate(() => go('workouts'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvExport')]);
    assert.match(dl.suggestedFilename(), /^workouts-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = require('node:fs').readFileSync(await dl.path(), 'utf8');
    assert.ok(text.startsWith('﻿workout,exercise,'));
  } finally { await browser.close(); }
});

test('non-UTF-8 (Excel cp1252) file still imports', async () => {
  const { browser, page, errors } = await openApp({ state: seed });
  try {
    await page.evaluate(() => go('workouts'));
    await importCsv(page, Buffer.from('workout,exercise\nPress\xF3n,A\n', 'latin1'));
    await page.click('#confirmYes');
    assert.equal(await page.evaluate(() => state.workouts[1].name), 'Pressón');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('nothing to import shows the problems, not an empty add', async () => {
  const { browser, page, errors } = await openApp({ state: seed });
  try {
    await page.evaluate(() => go('workouts'));
    await importCsv(page, Buffer.from('workout,exercise\n,X\n'));
    assert.equal(await page.textContent('#confirmMsg'), 'Nothing to import.\n\nrow 2: no workout name, skipped');
    assert.equal(await page.textContent('#confirmYes'), 'OK');
    await page.click('#confirmYes');
    assert.equal(await page.evaluate(() => state.workouts.length), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
