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
        },
        async remove(key) {
          delete storage[key];
        }
      },
      ...(options.session ? {
        session: {
          async get(key) {
            return { [key]: options.session[key] };
          },
          async set(values) {
            Object.assign(options.session, values);
          }
        }
      } : {})
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
        // Chrome reports a listener that does not reply as a closed message port.
        chrome.runtime.lastError = options.tabMessageError || null;
        callback?.();
        chrome.runtime.lastError = null;
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
    flushQueuedSettings,
    flushTabStatePersist,
    toggleTabOverride,
    pushConfigToTab,
    tabStateReady
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

function sendRuntimeMessage(harness, message, sender) {
  return new Promise((resolve, reject) => {
    const keepChannel = harness.getMessageListener()(message, sender, resolve);
    if (!keepChannel) reject(new Error('Message channel closed before async response'));
  });
}

test('page-forged metrics are ignored while activity logging is off', async () => {
  const harness = createHarness();
  await harness.api.ensureSettings();
  const sender = { tab: { id: 3, url: 'https://example.com/' }, frameId: 0 };
  await sendRuntimeMessage(harness, {
    type: 'specter:page-event',
    subtype: 'metrics',
    detail: { padding: 'x'.repeat(100000) }
  }, sender);
  harness.api.flushQueuedSettings();
  assert.equal(harness.storage.settings.apiEvents.length, 0);
});

test('logged page telemetry is truncated and counted from metrics entries', async () => {
  const harness = createHarness();
  await harness.api.updateSettings({ activityLogging: true });
  const sender = { tab: { id: 3, url: 'https://example.com/' }, frameId: 0 };
  await sendRuntimeMessage(harness, {
    type: 'specter:page-event',
    subtype: 'metrics',
    detail: { padding: 'x'.repeat(100000) }
  }, sender);
  await sendRuntimeMessage(harness, {
    type: 'specter:page-event',
    subtype: 'spoof-log',
    detail: { category: 'c'.repeat(500), data: { padding: 'x'.repeat(100000) } }
  }, sender);
  await sendRuntimeMessage(harness, {
    type: 'specter:page-event',
    subtype: 'spoof-log',
    detail: { category: 'metrics', data: { blockedListeners: 2, blockedHandlers: 1, syntheticBursts: 1e12 } }
  }, sender);
  harness.api.flushQueuedSettings();
  const { apiEvents, logs, heatmap } = harness.storage.settings;
  assert.equal(JSON.stringify(apiEvents.at(-1).detail), JSON.stringify({ truncated: true, size: 100014 }));
  assert.equal(logs.at(-2).category.length, 64);
  assert.equal(logs.at(-2).data.truncated, true);
  assert.equal(heatmap['example.com'].blockedEvents, 3);
  assert.equal(heatmap['example.com'].fakeBursts, 10000);
  assert.ok(JSON.stringify(harness.storage.settings).length < 10000);
});

test('config pushes reach every frame once, even when listeners do not reply', async () => {
  const harness = createHarness({}, {
    tabMessageError: new Error('The message port closed before a response was received.')
  });
  harness.api.tabState.set(5, { url: 'https://example.com/' });
  await harness.api.pushConfigToTab(5);
  const pushes = harness.sentTabMessages.filter((entry) => entry.tabId === 5);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].options?.frameId, undefined);
  assert.deepEqual(harness.consoleErrors, []);
});

test('a restarted worker restores per-tab overrides from session storage', async () => {
  const session = {};
  const first = createHarness({}, { session });
  await first.api.tabStateReady;
  await first.api.toggleTabOverride(9, 'explicit', false);
  first.api.flushTabStatePersist();
  await first.api.tabStateReady;
  await new Promise((resolve) => setTimeout(resolve, 0));

  const storage = { 'specter:tabState': { 4: { override: 'force-off' } } };
  const restarted = createHarness(storage, {
    session,
    tabs: [{ id: 9, url: 'https://example.com/' }]
  });
  const context = await restarted.api.buildTabContext(9, 'https://example.com/');
  assert.equal(context.override, 'force-off');
  assert.equal(context.spoofingEnabled, false);
  assert.equal(restarted.api.tabState.has(4), false);
  assert.equal(Object.hasOwn(storage, 'specter:tabState'), false);
});

test('popup tab toggles target the named tab rather than the sender tab', async () => {
  const harness = createHarness();
  harness.api.tabState.set(12, { url: 'https://example.com/' });
  await sendRuntimeMessage(harness, {
    type: 'specter:toggle-tab',
    tabId: 12,
    mode: 'explicit',
    enabled: false
  }, { tab: { id: 99, url: 'chrome-extension://specter/popup/popup.html' } });
  assert.equal(harness.api.tabState.get(12).override, 'force-off');
  assert.equal(harness.api.tabState.has(99), false);
});

test('schema 2 defaults migrate to the new interface defaults while custom choices stay', async () => {
  const untouched = createHarness({ settings: { lastSchema: 2, theme: { mode: 'auto', seed: '#007C91' }, font: 'ubuntu' } });
  const migrated = await untouched.api.ensureSettings();
  assert.equal(migrated.theme.seed, '#1b4ed8');
  assert.equal(migrated.font, 'system');
  assert.equal(migrated.lastSchema, 3);

  const custom = createHarness({ settings: { lastSchema: 2, theme: { mode: 'dark', seed: '#ff0066' }, font: 'mono' } });
  const kept = await custom.api.ensureSettings();
  assert.equal(kept.theme.seed, '#ff0066');
  assert.equal(kept.theme.mode, 'dark');
  assert.equal(kept.font, 'mono');

  const current = createHarness({ settings: { lastSchema: 3, theme: { seed: '#007c91' }, font: 'ubuntu' } });
  const chosen = await current.api.ensureSettings();
  assert.equal(chosen.theme.seed, '#007c91');
  assert.equal(chosen.font, 'ubuntu');
});
