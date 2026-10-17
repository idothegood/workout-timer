const { chromium } = require('playwright');
const path = require('node:path');

const APP = 'file://' + path.resolve(__dirname, '..', 'src', 'ui.html');

// Stand-in for the Screen Wake Lock API: records calls and lets tests simulate the OS releasing the lock.
function wakeStub() {
  window.__wake = { requests: 0, held: false, sentinel: null };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request() {
      window.__wake.requests++; window.__wake.held = true;
      const ls = {};
      const fire = type => (ls[type] || []).slice().forEach(f => f({ type }));
      const sentinel = {
        addEventListener(type, fn) { (ls[type] ||= []).push(fn); },
        release() { window.__wake.held = false; fire('release'); return Promise.resolve(); },
        _fire(type) { if (type === 'release') window.__wake.held = false; fire(type); },
      };
      window.__wake.sentinel = sentinel;
      return Promise.resolve(sentinel);
    },
  } });
}

// Fresh browser + page with a fake clock; optionally seeds localStorage['wt-state'] with `state`.
async function openApp({ state, init } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install();
  if (state) await page.addInitScript(s => localStorage.setItem('wt-state', s), JSON.stringify(state));
  await page.addInitScript(wakeStub);
  if (init) await page.addInitScript(init);
  await page.goto(APP);
  await page.clock.runFor(800);   // fires the loadState fallback timeout
  return { browser, page, errors };
}

module.exports = { openApp, APP };
