const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

// t.after closes the browser even when an assertion throws, so a failing test can't hang the run
test('new workout with unnamed exercises saves and starts', async t => {
  const { browser, page, errors } = await openApp(); t.after(() => browser.close());
  await page.evaluate(() => go('workouts'));
  await page.click('#newBtn'); await page.fill('#wname', 'Legs');
  await page.click('#addEx'); await page.click('#addEx');
  await page.click('#saveStart'); await page.clock.runFor(200);
  assert.equal(await page.evaluate(() => current), 'run');
  assert.deepEqual(await page.evaluate(() => state.workouts.at(-1).exercises.map(x => x.name)), ['Exercise 1', 'Exercise 2', 'Exercise 3']);
  assert.deepEqual(errors, []);
});

test('starting a workout with no exercises says so', async t => {
  const { browser, page, errors } = await openApp({ state: { workouts: [{ id: 'e', name: 'Empty', exercises: [] }], history: [] } });
  t.after(() => browser.close());
  await page.evaluate(() => go('workouts'));
  await page.click('[data-start="e"]');
  assert.ok(await page.evaluate(() => $('#confirmScrim').classList.contains('on')));
  assert.match(await page.textContent('#confirmMsg'), /no exercises/);
  assert.deepEqual(errors, []);
});
