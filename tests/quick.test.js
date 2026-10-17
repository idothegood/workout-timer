const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

const seed = { state: { workouts: [], history: [], settings: { rest: 10, qSets: 2 } } };
const cls = page => page.evaluate(() => $('#timer').className);
const txt = (page, sel) => page.textContent(sel);
async function open(t) {
  const app = await openApp(seed); t.after(() => app.browser.close());
  return app;
}

test('start → set done → rest → alert → set 2, untouched', async t => {
  const { page, errors } = await open(t);
  assert.equal(await txt(page, '#qMain'), 'Start ▶');
  await page.click('#qMain'); await page.clock.runFor(100);
  assert.equal(await txt(page, '#timer .phase'), 'Working');
  assert.equal(await txt(page, '#qSet'), '1');
  assert.equal(await txt(page, '#qMain'), 'Set done · rest 10');
  await page.click('#qMain'); await page.clock.runFor(100);         // set 1 done: rest
  assert.match(await cls(page), /p-rest/);
  assert.equal(await txt(page, '#qMain'), 'Skip rest ⏭');
  await page.clock.runFor(10000);
  assert.match(await cls(page), /p-alert alerting/);
  await page.clock.runFor(2600);                                    // hold ends on its own
  assert.equal(await txt(page, '#qSet'), '2');
  assert.match(await cls(page), /p-work/);
  assert.doesNotMatch(await cls(page), /alert/);
  assert.equal(await txt(page, '#qMain'), 'Last set done ✓');
  await page.click('#qMain'); await page.clock.runFor(100);
  assert.equal(await txt(page, '#timer .phase'), 'Done');
  assert.equal(await txt(page, '#qMain'), 'Start over ↺');
  assert.deepEqual(errors, []);
});

test('changing sets mid-rest keeps the current set', async t => {
  const { page, errors } = await open(t);
  await page.click('#qMain'); await page.click('#qMain'); await page.clock.runFor(100);   // rest after set 1
  await page.click('#qMore'); await page.clock.runFor(100);
  assert.equal(await txt(page, '#qOf'), '3');
  assert.equal(await txt(page, '#qSet'), '1');
  assert.match(await cls(page), /p-rest/);
  await page.clock.runFor(12700);
  assert.equal(await txt(page, '#qSet'), '2');
  await page.click('#qLess'); await page.click('#qLess'); await page.clock.runFor(100);
  assert.equal(await txt(page, '#qOf'), '1');
  assert.equal(await txt(page, '#qSet'), '1');
  await page.click('#qMain'); await page.clock.runFor(100);
  assert.equal(await txt(page, '#timer .phase'), 'Done');
  assert.deepEqual(errors, []);
});

test('rest chip mid-rest changes the countdown', async t => {
  const { page, errors } = await open(t);
  await page.click('#qMain'); await page.click('#qMain');
  await page.clock.runFor(2000);
  await page.click('[data-preset="0"]'); await page.clock.runFor(100);
  assert.equal(await txt(page, '#timer .clock'), '58');
  assert.match(await cls(page), /p-rest/);
  assert.deepEqual(errors, []);
});

test('bad saved hold falls back to the default and never stalls', async t => {
  const app = await openApp({ state: { workouts: [], history: [], settings: { rest: 10, qSets: 2, hold: null } } }); t.after(() => app.browser.close());
  const { page, errors } = app;
  assert.equal(await page.evaluate(() => S().hold), 2.5);
  await page.click('#qMain'); await page.click('#qMain');
  await page.clock.runFor(10100);
  assert.match(await cls(page), /p-alert/);
  await page.clock.runFor(2600);
  assert.equal(await txt(page, '#qSet'), '2');
  assert.match(await cls(page), /p-work/);
  assert.deepEqual(errors, []);
});

test('shortening the rest below the elapsed time still gets the full hold', async t => {
  const { page, errors } = await open(t);
  await page.click('#qMain'); await page.click('#qMain');
  await page.clock.runFor(8000);
  await page.evaluate(() => setQRest(5)); await page.clock.runFor(200);
  assert.match(await cls(page), /p-alert alerting/);
  await page.clock.runFor(1500);
  assert.match(await cls(page), /p-alert/);
  assert.equal(await txt(page, '#qSet'), '1');
  await page.clock.runFor(1200);
  assert.equal(await txt(page, '#qSet'), '2');
  assert.deepEqual(errors, []);
});
