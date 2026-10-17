const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

const seed = { state: { workouts: [], history: [], settings: { rest: 10, qSets: 2 } } };
async function open(t) {
  const app = await openApp(seed); t.after(() => app.browser.close());
  return app;
}
const setVis = (page, v) => page.evaluate(v => {
  window.__vis = v;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis || 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => (window.__vis || 'visible') === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);

test('requests wake lock on load with no timer running', async t => {
  const { page, errors } = await open(t);
  assert.ok(await page.evaluate(() => window.__wake.requests) >= 1);
  assert.equal(await page.textContent('#qMain'), 'Start ▶');
  assert.deepEqual(errors, []);
});

test('turning the setting off releases', async t => {
  const { page } = await open(t);
  await page.evaluate(() => { $('#sAwake').checked = false; $('#sAwake').dispatchEvent(new Event('change')); });
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(() => window.__wake.held), false);
});

test('re-requests after release', async t => {
  const { page } = await open(t);
  const before = await page.evaluate(() => window.__wake.requests);
  await page.evaluate(() => window.__wake.sentinel._fire('release'));
  await page.clock.runFor(1100);
  assert.ok(await page.evaluate(() => window.__wake.requests) > before);
  assert.equal(await page.evaluate(() => window.__wake.held), true);
});

test('return after a long rest lands on next set without alert', async t => {
  const { page, errors } = await open(t);
  await page.click('#qMain'); await page.click('#qMain'); await page.clock.runFor(100);   // set 1 done: rest
  assert.match(await page.evaluate(() => $('#timer').className), /p-rest/);
  await setVis(page, 'hidden');
  await page.clock.setSystemTime(await page.evaluate(() => Date.now()) + 180000);
  await setVis(page, 'visible');
  assert.equal(await page.textContent('#qSet'), '2');
  const c = await page.evaluate(() => $('#timer').className);
  assert.match(c, /p-work/); assert.doesNotMatch(c, /alert/);
  assert.deepEqual(errors, []);
});

test('hidden: rest-end alert still fires, but the next set waits for return', async t => {
  const { page, errors } = await open(t);
  await page.click('#qMain'); await page.click('#qMain'); await page.clock.runFor(100);   // rest
  await page.evaluate(() => { window.__beeps = 0; const b = beep; beep = (...a) => { window.__beeps++; return b(...a); }; });
  await setVis(page, 'hidden');
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => qt.sess.alert), true);
  assert.ok(await page.evaluate(() => window.__beeps) >= 1);
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => qt.sess.alert), true);
  assert.equal(await page.textContent('#qSet'), '1');
  await setVis(page, 'visible');
  assert.equal(await page.textContent('#qSet'), '2');
  assert.match(await page.evaluate(() => $('#timer').className), /p-work/);
  assert.deepEqual(errors, []);
});
