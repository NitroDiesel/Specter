const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: Boolean(options?.once) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.listener !== listener));
  }

  dispatchEvent(event) {
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      entry.listener.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
  }
}

test('isolated bridge skips extension-owned documents', () => {
  const window = { location: { protocol: 'moz-extension:' } };
  const context = vm.createContext({ window });
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'content.js' });
  assert.equal(window.__specterContentLoaded, undefined);
});

function createContentHarness(options = {}) {
  const window = new FakeEventTarget();
  const document = new FakeEventTarget();
  const timers = new Map();
  const dispatchedConfigs = [];
  let nextTimer = 1;
  let contentReadyCallback;
  let backgroundMessageListener;

  window.location = { href: 'https://example.com/test', reload() {} };
  window.document = document;
  document.documentElement = { appendChild() {} };
  document.createElement = () => ({
    className: '',
    textContent: '',
    dataset: {},
    setAttribute() {}
  });
  document.fullscreenElement = null;
  document.webkitFullscreenElement = null;
  if (options.failBridgeDispatch) {
    const nativeDispatch = document.dispatchEvent.bind(document);
    document.dispatchEvent = (event) => {
      if (event.type === 'specter:bridge-request') throw new Error('destroyed frame');
      return nativeDispatch(event);
    };
  }

  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === 'specter:content-ready') contentReadyCallback = callback;
        else callback?.({ ok: true, result: { ok: true } });
      },
      onMessage: {
        addListener(listener) {
          backgroundMessageListener = listener;
        }
      }
    }
  };

  const context = vm.createContext({
    window,
    document,
    chrome,
    CustomEvent: FakeEvent,
    history: {
      pushState() {},
      replaceState() {}
    },
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    JSON,
    Promise,
    console
  });

  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'content.js' });

  return {
    window,
    document,
    timers,
    dispatchedConfigs,
    getContentReadyCallback: () => contentReadyCallback,
    getBackgroundMessageListener: () => backgroundMessageListener
  };
}

test('destroyed Firefox-family frames stop bridge retries without throwing', () => {
  const harness = createContentHarness({ failBridgeDispatch: true });
  assert.equal(harness.timers.size, 0);
});

test('bridge retry applies the latest live config and ignores a stale startup response', async () => {
  const harness = createContentHarness();
  const channels = {
    config: 'specter:config:retry-test',
    telemetry: 'specter:telemetry:retry-test'
  };

  harness.window.addEventListener(channels.config, (event) => {
    harness.dispatchedConfigs.push(JSON.parse(event.detail));
  });

  const liveConfig = {
    spoofingEnabled: false,
    blockEvents: false,
    elementFocusBlocking: true,
    autoReloadOnActivation: false
  };
  harness.getBackgroundMessageListener()({
    type: 'specter:apply-config',
    config: liveConfig,
    context: { tabId: 7, allowlisted: false, pausedReason: null }
  });

  harness.document.addEventListener('specter:bridge-request', () => {
    harness.document.dispatchEvent(new FakeEvent('specter:bridge-ready', {
      detail: JSON.stringify(channels)
    }));
  });
  const retry = harness.timers.values().next().value;
  assert.equal(typeof retry, 'function');
  retry();

  assert.equal(harness.dispatchedConfigs.length, 1);
  assert.deepEqual(harness.dispatchedConfigs[0], liveConfig);

  harness.getContentReadyCallback()({
    ok: true,
    result: {
      config: { spoofingEnabled: true, blockEvents: true },
      context: { tabId: 7, allowlisted: false, pausedReason: null }
    }
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(harness.dispatchedConfigs.length, 1);
  assert.equal(harness.dispatchedConfigs[0].spoofingEnabled, false);
});
