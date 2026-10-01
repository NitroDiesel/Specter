// Optional integration suite: install Playwright externally and its Chromium browser.
// Run with SPECTER_CAPTURE=1 to save the visual review under .codex-qa/revision-review.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'specter-ui-'));
  const captures = path.join(root, '.codex-qa', 'revision-review');
  if (process.env.SPECTER_CAPTURE) fs.mkdirSync(captures, { recursive: true });
  const server = http.createServer((_request, response) => response.end('<!doctype html><title>Specter test</title><h1>Browser test page</h1>'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const settle = (page) => page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  const send = (page, message) => page.evaluate((payload) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError || !response?.ok) reject(new Error(chrome.runtime.lastError?.message || response?.error));
      else resolve(response.result);
    });
  }), message);
  const capture = async (page, name) => {
    if (!process.env.SPECTER_CAPTURE) return;
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(captures, `${name}.png`), animations: 'disabled' });
  };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${server.address().port}/`);
    const options = await context.newPage();
    await options.setViewportSize({ width: 1440, height: 960 });
    await options.goto(`${base}/options/options.html#protection`);
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    await options.waitForFunction((expected) => document.getElementById('aboutVersion').textContent === expected, version);
    await options.locator('[data-mode-value="advanced"]').click();
    await options.locator('#fakeMin').fill('1750');
    await options.locator('#loggingSwitch').click();
    await settle(options);
    assert.equal(await options.locator('#fakeMin').inputValue(), '1750', 'an unrelated setting must preserve a draft');
    assert.match(await options.locator('#fakeActivityForm .save-state').textContent(), /Unsaved/);
    await options.locator('#fakeActivityForm button[type="submit"]').click();
    await settle(options);
    assert.equal((await send(options, { type: 'specter:get-settings' })).settings.fakeActivity.min, 1750);
    assert.match(await options.locator('#fakeActivityForm .save-state').textContent(), /Saved/);
    await options.locator('#fakeMin').fill('2100');
    await options.locator('#fakeActivityForm [data-discard]').click();
    assert.equal(await options.locator('#fakeMin').inputValue(), '1750');

    const fixture = { logs: Array.from({ length: 65 }, (_, index) => ({ ts: Date.now(), category: `event-${index}`, domain: `site-${index}.example`, data: {} })), heatmap: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`site-${index}.example`, { hits: index, blockedEvents: 0, lastEvent: Date.now() }])) };
    await send(options, { type: 'specter:import', data: JSON.stringify(fixture) });
    await options.reload();
    await options.locator('[data-section-target="logs"]').first().click();
    await options.waitForFunction(() => document.querySelectorAll('#logList > li').length === 50);
    await options.locator('#moreLogs').click();
    assert.equal(await options.locator('#logList > li').count(), 65);
    await options.locator('#logSearch').fill('event-0');
    assert.equal(await options.locator('#logList > li').count(), 1);
    await capture(options, 'logs-desktop');
    await options.locator('[data-mode-value="basic"]').click();
    assert.equal(new URL(options.url()).hash, '#overview');
    await options.locator('[data-section-target="heatmap"]').first().click();
    await options.locator('#siteSearch').fill('site-64');
    assert.equal(await options.locator('#heatmapTable tbody tr').count(), 1);

    for (const width of [1440, 1100, 720, 390]) {
      await options.setViewportSize({ width, height: 960 });
      await options.locator('[data-section-target="overview"]').first().click();
      assert.ok(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
      await capture(options, `overview-${width}`);
    }
    await options.setViewportSize({ width: 1440, height: 960 });
    await options.locator('[data-section-target="appearance"]').first().click();
    await options.locator('#themeMode').selectOption('dark');
    await options.locator('#seedColor').fill('#000000');
    await options.locator('#appearanceForm button[type="submit"]').click();
    await settle(options);
    await options.locator('[data-section-target="overview"]').first().click();
    await capture(options, 'overview-dark');

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 660 });
    const reloadPopup = async () => {
      await target.bringToFront();
      await popup.goto(`${base}/popup/popup.html`);
      await popup.waitForFunction(() => !document.getElementById('globalSwitch').disabled);
    };
    await reloadPopup();
    await capture(popup, 'popup-active-dark');
    await popup.locator('#allowButton').click();
    await popup.waitForFunction(() => document.getElementById('allowButton').textContent.includes('Resume'));
    assert.equal(await popup.locator('#tabSwitch').isDisabled(), true);
    await capture(popup, 'popup-paused-dark');
    await popup.locator('#allowButton').click();
    await popup.waitForFunction(() => document.getElementById('tabSwitch').getAttribute('aria-checked') === 'true' && !document.getElementById('tabSwitch').disabled);
    await popup.locator('#globalSwitch').click();
    await popup.waitForFunction(() => document.getElementById('globalSwitch').getAttribute('aria-checked') === 'false');
    assert.equal(await popup.locator('#tabSwitch').isDisabled(), true);
    await popup.locator('#globalSwitch').click();
    await popup.waitForFunction(() => !document.getElementById('tabSwitch').disabled);
    await send(options, { type: 'specter:update-settings', payload: { theme: { mode: 'light', seed: '#1b4ed8' } } });
    await reloadPopup();
    await capture(popup, 'popup-active-light');
    await target.goto('chrome://extensions');
    await reloadPopup();
    assert.match(await popup.locator('#stateChipLabel').textContent(), /unavailable/);
    assert.equal(await popup.locator('#tabSwitch').isDisabled(), true);
    await capture(popup, 'popup-restricted');
    assert.deepEqual(errors, []);
    if (process.env.SPECTER_LIVE_CODEPEN === '1') {
      const pen = await context.newPage();
      await pen.goto('https://codepen.io/calebnance/full/nXPaKN', { waitUntil: 'domcontentloaded' });
      let result;
      const deadline = Date.now() + 30000;
      while (!result && Date.now() < deadline) {
        for (const frame of pen.frames()) {
          if (frame === pen.mainFrame()) continue;
          if (await frame.locator('body').innerText({ timeout: 500 }).catch(() => '').then((text) => text.includes('Focus/Click on page first'))) result = frame;
        }
        if (!result) await pen.waitForTimeout(250);
      }
      if (!result) {
        console.error('CodePen did not expose the expected result:', {
          title: await pen.title(),
          frames: pen.frames().map((frame) => frame.url()),
          body: (await pen.locator('body').innerText()).slice(0, 500)
        });
      }
      assert.ok(result, 'Exact CodePen result iframe loaded');
      for (const enabled of [true, false, true, false, true]) {
        await send(options, { type: 'specter:toggle-global', enabled });
        await pen.waitForTimeout(300);
        const changed = await result.evaluate(() => {
          const before = document.body.innerText;
          window.dispatchEvent(new Event('blur'));
          window.dispatchEvent(new Event('focus'));
          return document.body.innerText !== before;
        });
        assert.equal(changed, !enabled, `CodePen event delivery with protection ${enabled}`);
      }
      console.log('PASS: exact CodePen iframe on/off/on/off/on without reloading.');
    }
    console.log('PASS: drafts, save/discard, record search, pagination, deep links, responsive layouts, themes, popup pause/resume, global precedence, restricted pages.');
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
