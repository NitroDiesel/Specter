const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness(storage = {}, options = {}) {
  let messageListener;
  const consoleErrors = [];
  const sentTabMessages = [];
  let unregisterCalls = 0;
  const testConsole = Object.create(console);
  testConsole.error = (...args) => {
    consoleErrors.push(args);
  };
  const event = () => ({ addListener() {} });
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: storage[key] };
          return { ...storage };
        },
        set(values, callback) {
          Object.assign(storage, values);
          callback?.();
          return Promise.resolve();
        }
      }
    },
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '1.0.0' }),
      onInstalled: event(),
      onStartup: event(),
      onSuspend: event(),
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      },
      sendMessage(_message, callback) {
        callback?.();
        return Promise.resolve();
      }
    },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      onActivated: event(),
      query: async () => options.tabs || [],
      get: async () => null,
      sendMessage(tabId, message, sendOptions, callback) {
        sentTabMessages.push({ tabId, message, options: sendOptions });
        callback?.();
        return Promise.resolve();
      }
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {}
    },
    commands: { onCommand: event() },
    scripting: {
      getRegisteredContentScripts: async () => options.registeredScripts || [],
      unregisterContentScripts: async () => {
        unregisterCalls += 1;
        if (options.unregisterError) throw options.unregisterError;
      },
      executeScript: async ({ target }) => [{
        frameId: target.frameIds[0],
        result: {
          config: 'specter:config:test-channel',
          telemetry: 'specter:telemetry:test-channel'
        }
      }]
    }
  };
  const sandbox = {
    chrome,
    console: testConsole,
    URL,
    Intl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  vm.runInContext(`${source}\n;globalThis.__specterTest = {
    matchesAllowlist,
    buildTabContext,
    saveSettings,
    ensureSettings,
    updateSettings,
    addAllowlistEntry,
    removeAllowlistEntry,
    handleExport,
    handleImport,
    sanitizeLoggedUrl,
    tabState,
    unregisterLegacyMainWorld,
    queueSettingsSave,
    flushQueuedSettings
  };`, sandbox, { filename: 'background.js' });
  return {
    api: sandbox.__specterTest,
    storage,
    consoleErrors,
    getUnregisterCalls: () => unregisterCalls,
    sentTabMessages,
    getMessageListener: () => messageListener
  };
}

test('legacy script cleanup ignores Chrome nonexistent-ID errors and only runs once', async () => {
  const harness = createHarness({}, {
    registeredScripts: [{ id: 'specter-main-world' }],
    unregisterError: new Error("Nonexistent script ID 'specter-main-world'")
  });

  await Promise.all([
    harness.api.unregisterLegacyMainWorld(),
    harness.api.unregisterLegacyMainWorld()
  ]);

  assert.equal(harness.getUnregisterCalls(), 1);
  assert.deepEqual(harness.consoleErrors, []);
});

test('explicit save supersedes a pending activity snapshot', async () => {
  const { api, storage } = createHarness();
  const original = await api.ensureSettings();
  api.queueSettingsSave(structuredClone(original));
  await api.saveSettings({ ...original, globalEnabled: false });
  api.flushQueuedSettings();
  assert.equal(storage.settings.globalEnabled, false);
});

test('invalid imports cannot partially mutate current settings', async () => {
  const { api } = createHarness();
  const before = await api.handleExport('json');
  for (const payload of [
    [], { unrelated: true }, { globalEnabled: false, allowlist: [null] },
    { globalEnabled: false, theme: { seed: '#1234' } },
    { globalEnabled: false, logs: [{ ts: 1e100, category: 'invalid' }] },
    { globalEnabled: false, heatmap: { 'example.com': null } },
    { font: 'unknown' }, { fakeActivity: { min: 'fast' } }
  ]) {
    await assert.rejects(api.handleImport(JSON.stringify(payload)));
    const after = JSON.parse(await api.handleExport('json'));
    const expected = JSON.parse(before);
    delete after.exportedAt;
    delete expected.exportedAt;
    assert.deepEqual(after, expected);
  }
});

test('new site exceptions reject malformed patterns and pause durations', async () => {
  const { api } = createHarness();
  for (const pattern of [null, {}, '', 'a b.com']) await assert.rejects(api.addAllowlistEntry(pattern, 'domain', null));
  await assert.rejects(api.addAllowlistEntry('example.com', 'domain', -1));
  assert.equal((await api.ensureSettings()).allowlist.length, 0);
});

test('legacy script cleanup skips unregister when the script is absent', async () => {
  const harness = createHarness();
  await harness.api.unregisterLegacyMainWorld();
  assert.equal(harness.getUnregisterCalls(), 0);
  assert.deepEqual(harness.consoleErrors, []);
});

test('allowlist matches wildcard roots, subdomains, and normalized origins', () => {
  const { api } = createHarness();
  const wildcard = [{ pattern: '*.example.com', scope: 'domain' }];
  assert.ok(api.matchesAllowlist('https://example.com/path', wildcard));
  assert.ok(api.matchesAllowlist('https://docs.example.com/path', wildcard));
  assert.equal(api.matchesAllowlist('https://example.net/path', wildcard), null);

  const origin = [{ pattern: 'https://example.com/saved/path', scope: 'origin' }];
  assert.ok(api.matchesAllowlist('https://example.com/another/path?secret=1', origin));
  assert.equal(api.matchesAllowlist('http://example.com/another/path', origin), null);
});

test('pausing and resuming a site immediately updates open tabs', async () => {
  const harness = createHarness({}, {
    tabs: [{ id: 12, url: 'https://example.com/test' }]
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.sentTabMessages.length = 0;

  const entry = await harness.api.addAllowlistEntry('example.com', 'domain');
  assert.ok(harness.sentTabMessages.length >= 1);
  assert.equal(harness.sentTabMessages.at(-1).message.config.spoofingEnabled, false);

  harness.sentTabMessages.length = 0;
  await harness.api.removeAllowlistEntry(entry.id);
  assert.ok(harness.sentTabMessages.length >= 1);
  assert.equal(harness.sentTabMessages.at(-1).message.config.spoofingEnabled, true);
});

test('global disable, exceptions, and pauses take precedence over force-on', async () => {
  const { api } = createHarness();
  const settings = await api.ensureSettings();
  settings.globalEnabled = false;
  await api.saveSettings(settings);
  api.tabState.set(7, { override: 'force-on' });
  assert.equal((await api.buildTabContext(7, 'https://example.com')).spoofingEnabled, false);

  settings.globalEnabled = true;
  settings.allowlist = [{ pattern: 'example.com', scope: 'domain' }];
  await api.saveSettings(settings);
  assert.equal((await api.buildTabContext(7, 'https://example.com')).spoofingEnabled, false);

  settings.allowlist = [];
  await api.saveSettings(settings);
  api.tabState.set(7, { override: 'force-on', pausedReason: 'fullscreen' });
  assert.equal((await api.buildTabContext(7, 'https://example.com')).spoofingEnabled, false);
});

test('disabling fullscreen pause clears existing fullscreen state', async () => {
  const { api } = createHarness();
  api.tabState.set(9, { pausedReason: 'fullscreen', url: 'https://example.com' });
  await api.updateSettings({ pauseInFullscreen: false });
  assert.equal(api.tabState.get(9).pausedReason, null);
});

test('settings export and import include fullscreen pause', async () => {
  const { api } = createHarness();
  await api.updateSettings({ pauseInFullscreen: false });
  const exported = JSON.parse(await api.handleExport('json'));
  assert.equal(exported.pauseInFullscreen, false);
  await api.handleImport(JSON.stringify({ pauseInFullscreen: true }));
  assert.equal((await api.ensureSettings()).pauseInFullscreen, true);
});

test('dark appearance persists through extension storage', async () => {
  const storage = {};
  const first = createHarness(storage);
  await first.api.updateSettings({ theme: { mode: 'dark' }, font: 'ubuntu' });

  const second = createHarness(storage);
  const restored = await second.api.ensureSettings();
  assert.equal(restored.theme.mode, 'dark');
  assert.equal(restored.font, 'ubuntu');
});

test('activity logging strips paths, queries, and fragments', () => {
  const { api } = createHarness();
  assert.equal(
    api.sanitizeLoggedUrl('https://example.com/private/path?token=secret#details'),
    'https://example.com'
  );
});

test('content-ready response includes config for the statically injected bridge', async () => {
  const harness = createHarness();
  const listener = harness.getMessageListener();
  const response = await new Promise((resolve, reject) => {
    const keepChannel = listener(
      { type: 'specter:content-ready' },
      { tab: { id: 3, url: 'https://example.com/path' }, frameId: 0 },
      resolve
    );
    if (!keepChannel) reject(new Error('Message channel closed before async response'));
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.config.spoofingEnabled, true);
  assert.equal(response.result.channels, undefined);
});
