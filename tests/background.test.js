const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness(storage = {}) {
  let messageListener;
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
      query: async () => [],
      get: async () => null,
      sendMessage: async () => undefined
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {}
    },
    commands: { onCommand: event() },
    scripting: {
      unregisterContentScripts: async () => undefined,
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
    console,
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
    handleExport,
    handleImport,
    sanitizeLoggedUrl,
    tabState
  };`, sandbox, { filename: 'background.js' });
  return { api: sandbox.__specterTest, storage, getMessageListener: () => messageListener };
}

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
