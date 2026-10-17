const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

// one open-ended exercise, 2 sets with a 10s rest, no get-ready countdown
const seed = (settings = {}) => ({ state: {
  workouts: [{ id: 'w', name: 'Test', exercises: [{ id: 'a', name: 'Squat', type: 'Standard', sets: 2, reps: '5', work: 0, rest: 10, after: 0, notes: '' }] }],
  history: [], settings: { ready: 0, ...settings },
} });
const cls = page => page.evaluate(() => $('#run').className);
const phase = page => page.textContent('#run .phase');
async function start(t, settings) {
  const app = await openApp(seed(settings)); t.after(() => app.browser.close());
  await app.page.evaluate(() => go('workouts'));
  await app.page.click('[data-start="w"]');
  await app.page.clock.runFor(100);
  return app;
}

test('set done → rest → alert → auto next set', async t => {
  const { page, errors } = await start(t);
  await page.click('#rMain');                      // set 1 done
  await page.clock.runFor(100);
  assert.match(await cls(page), /p-rest/);
  await page.clock.runFor(10000);
  assert.match(await cls(page), /p-alert alerting/);
  assert.equal(await phase(page), "Time's up");
  assert.equal(await page.textContent('#rMain'), 'Start now ⏭');
  await page.clock.runFor(2600);                   // hold (2.5s default) ends on its own
  assert.match(await cls(page), /p-work/);
  assert.doesNotMatch(await cls(page), /alert/);
  assert.equal(await phase(page), 'Go');
  assert.match(await page.textContent('#badges'), /Set 2 \/ 2/);
  assert.deepEqual(errors, []);
});

test('hold setting is respected', async t => {
  const { page, errors } = await start(t, { hold: 0 });
  await page.click('#rMain');
  await page.clock.runFor(10100);
  assert.match(await cls(page), /p-work/);
  assert.match(await page.textContent('#badges'), /Set 2 \/ 2/);
  assert.deepEqual(errors, []);
});

test('last set finishes the workout', async t => {
  const { page, errors } = await start(t);
  await page.click('#rMain'); await page.clock.runFor(12700);   // rest, alert, set 2
  assert.match(await page.textContent('#badges'), /Set 2 \/ 2/);
  await page.click('#rMain');
  assert.equal(await page.evaluate(() => current), 'done');
  assert.equal(await page.evaluate(() => state.history.length), 1);
  assert.deepEqual(errors, []);
});

test('tap during the alert starts the next set once', async t => {
  const { page, errors } = await start(t);
  await page.click('#rMain'); await page.clock.runFor(10100);
  assert.match(await cls(page), /p-alert/);
  await page.click('#rMain'); await page.clock.runFor(3000);
  assert.match(await cls(page), /p-work/);
  assert.match(await page.textContent('#badges'), /Set 2 \/ 2/);
  assert.equal(await page.evaluate(() => current), 'run');
  assert.deepEqual(errors, []);
});

test('pause, ±15s and back still work in rest', async t => {
  const { page, errors } = await start(t);
  await page.click('#rMain'); await page.clock.runFor(1000);
  await page.click('#rAdjust [data-adj="15"]'); await page.clock.runFor(100);
  assert.equal(await page.textContent('#run .clock'), '24');
  await page.click('#pauseBtn'); await page.clock.runFor(30000);
  assert.match(await cls(page), /p-rest paused/);
  await page.click('#pauseBtn'); await page.clock.runFor(100);
  assert.equal(await page.textContent('#run .clock'), '24');
  await page.clock.runFor(3000); await page.click('#prevBtn'); await page.clock.runFor(100);   // >2.5s in: restart rest
  assert.equal(await page.textContent('#run .clock'), '25');
  await page.click('#prevBtn'); await page.clock.runFor(100);                                  // <2.5s in: back to set 1
  assert.match(await cls(page), /p-work/);
  assert.match(await page.textContent('#badges'), /Set 1 \/ 2/);
  assert.deepEqual(errors, []);
});

test('hold setting clamps to 0–5 in half seconds', async t => {
  const { browser, page, errors } = await openApp(); t.after(() => browser.close());
  assert.equal(await page.evaluate(() => S().hold), 2.5);
  await page.evaluate(() => go('settings'));
  assert.equal(await page.inputValue('#sHold'), '2.5');
  for (const [v, want] of [['9', 5], ['-1', 0], ['1.3', 1.5], ['', 0]]) {
    await page.fill('#sHold', v); await page.dispatchEvent('#sHold', 'change');
    assert.equal(await page.evaluate(() => S().hold), want);
  }
  assert.deepEqual(errors, []);
});
