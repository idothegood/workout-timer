const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

let app;
test.before(async () => { app = await openApp(); });
test.after(() => app.browser.close());

// steps are built inline: W = open-ended sets with a 10s rest, T = a timed second set
const defs = `
  const wk = (dur, set, of) => ({ kind: 'work', dur, ex: 'X', set, of });
  const rs = dur => ({ kind: 'rest', dur, ex: 'X' });
  const W = [wk(0, 1, 2), rs(10), wk(0, 2, 2)];
  const T = [wk(0, 1, 3), rs(10), wk(45, 2, 3), rs(30), wk(45, 3, 3)];`;
const run = fn => app.page.evaluate(`(() => { ${defs} const f = ${fn}; return f(); })()`);

test('rest end raises alert then auto-enters next after hold', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0); const o = { end: s.end };
    o.a = sessTick(s, 7000, 2.5);
    o.b = sessTick(s, 10000, 2.5); o.alert = s.alert; o.i1 = s.i;
    o.c = sessTick(s, 12400, 2.5);
    o.d = sessTick(s, 12500, 2.5); o.i2 = s.i; o.ss = s.stepStart; return o; }`),
    { end: 10000, a: ['tick'], b: ['alert'], alert: true, i1: 1, c: [], d: ['enter'], i2: 2, ss: 12500 });
});

test('tap during alert advances once', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0); sessTick(s, 10000, 2.5);
    const o = {}; o.t = sessTap(s, 11000); o.i = s.i;
    o.k = sessTick(s, 13000, 2.5); o.i2 = s.i; return o; }`),
    { t: ['enter'], i: 2, k: [], i2: 2 });
});

test('hold 0 enters immediately', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0);
    return { e: sessTick(s, 10000, 0), i: s.i }; }`), { e: ['alert', 'enter'], i: 2 });
});

test('late tick is deterministic', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0);
    const o = { a: sessTick(s, 20000, 2.5), until: s.alertUntil };
    o.b = sessTick(s, 20001, 2.5); return o; }`),
    { a: ['alert'], until: 12500, b: ['enter'] });
});

test('resume never runs through a work step', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(T, 0); sessTap(s, 0);
    const e = sessResume(s, 180000); return { e, i: s.i, end: s.end, alert: s.alert }; }`),
    { e: ['enter'], i: 2, end: 225000, alert: false });
});

test('resume mid-rest does nothing', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(T, 0); sessTap(s, 0); return { e: sessResume(s, 5000), i: s.i }; }`), { e: [], i: 1 });
});

test('resume during alert enters next without alerting', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0); sessTick(s, 10000, 2.5);
    return { e: sessResume(s, 11000), i: s.i }; }`), { e: ['enter'], i: 2 });
});

test('resume after a timed work set advances one step', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(T, 0); sessTap(s, 0); sessTap(s, 0);
    const e = sessResume(s, 500000); return { e, i: s.i, end: s.end }; }`),
    { e: ['enter'], i: 3, end: 530000 });
});

test('last tap finishes', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0); sessTap(s, 1);
    const e = sessTap(s, 2); return { e, done: s.done, again: sessTap(s, 3) }; }`),
    { e: ['enter', 'finish'], done: true, again: [] });
});

test('3-2-1 ticks once each', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(W, 0); sessTap(s, 0);
    return [7000, 7100, 8000, 9000].map(t => sessTick(s, t, 2.5)); }`),
    [['tick'], [], ['tick'], ['tick']]);
});

test('timed work end, ready end, pause', async () => {
  assert.deepEqual(await run(`() => {
    const s = newSession(T, 0); sessTap(s, 0); sessTap(s, 0);
    const o = { w: sessTick(s, 50000, 2.5), i: s.i };
    sessPause(s, 51000); o.p = sessTick(s, 99000, 2.5); sessUnpause(s, 99000); o.end = s.end;
    const r = newSession([{ kind: 'ready', dur: 5 }, wk(0, 1, 1)], 0);
    o.g = sessTick(r, 5000, 2.5); o.ri = r.i; return o; }`),
    { w: ['workEnd', 'enter'], i: 3, p: [], end: 128000, g: ['go', 'enter'], ri: 1 });
});
