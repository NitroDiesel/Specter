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
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  for (const protocol of ['chrome-extension:', 'moz-extension:']) {
    const window = { location: { protocol } };
    const context = vm.createContext({ window });
    vm.runInContext(source, context, { filename: 'content.js' });
    assert.equal(window.__specterContentLoaded, undefined, protocol);
  }
});

function createContentHarness(options = {}) {
  const window = new FakeEventTarget();
  const document = new FakeEventTarget();
  const timers = new Map();
  const dispatchedConfigs = [];
  let nextTimer = 1;
  let contentReadyCallback;
  let backgroundMessageListener;
  let browserSendCalls = 0;
  let callbackPromiseCatchCalls = 0;
  let callbackSendCalls = 0;
  let sessionStorageGetCalls = 0;
  const sentMessages = [];

  window.location = { href: 'https://example.com/test', reload() {} };
  window.top = options.embedded ? {} : window;
  window.document = document;
  document.readyState = options.readyState || 'complete';
  document.documentElement = { appendChild(node) { this.lastChild = node; } };
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
        callbackSendCalls += 1;
        sentMessages.push(message);
        if (message.type === 'specter:content-ready') contentReadyCallback = callback;
        else callback?.({ ok: true, result: { ok: true } });
        if (options.callbackReturnsPromise) {
          return {
            catch(handler) {
              callbackPromiseCatchCalls += 1;
              handler(new Error('Actor destroyed during frame teardown'));
            }
          };
        }
      },
      onMessage: {
        addListener(listener) {
          backgroundMessageListener = listener;
        }
      }
    }
  };
  const browser = options.includeBrowser ? {
    runtime: {
      sendMessage() {
        browserSendCalls += 1;
        return Promise.reject(new Error('Promise API should not be used when callback API exists'));
      },
      onMessage: chrome.runtime.onMessage
    }
  } : undefined;

  const context = vm.createContext({
    window,
    document,
    chrome,
    browser,
    CustomEvent: FakeEvent,
    history: {
      pushState() {},
      replaceState() {}
    },
    sessionStorage: {
      getItem() { sessionStorageGetCalls += 1; return null; },
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
    sentMessages,
    getBrowserSendCalls: () => browserSendCalls,
    getCallbackPromiseCatchCalls: () => callbackPromiseCatchCalls,
    getCallbackSendCalls: () => callbackSendCalls,
    getSessionStorageGetCalls: () => sessionStorageGetCalls,
    getContentReadyCallback: () => contentReadyCallback,
    getBackgroundMessageListener: () => backgroundMessageListener
  };
}

test('Firefox-family bridge prefers the callback runtime to avoid unload rejections', () => {
  const harness = createContentHarness({ includeBrowser: true });
  assert.equal(harness.getBrowserSendCalls(), 0);
  assert.equal(typeof harness.getContentReadyCallback(), 'function');
});

test('Firefox-family bridge observes a Promise returned by the callback runtime', () => {
  const harness = createContentHarness({ callbackReturnsPromise: true });
  assert.equal(harness.getCallbackPromiseCatchCalls(), 1);
  assert.equal(typeof harness.getContentReadyCallback(), 'function');
});

test('embedded Firefox-family documents wait until DOMContentLoaded before requesting config', () => {
  const harness = createContentHarness({ embedded: true, readyState: 'loading' });
  assert.equal(harness.getCallbackSendCalls(), 0);
  harness.document.dispatchEvent(new FakeEvent('DOMContentLoaded'));
  assert.equal(harness.getCallbackSendCalls(), 1);
  assert.equal(typeof harness.getContentReadyCallback(), 'function');
});

test('destroyed Firefox-family frames stop bridge retries without throwing', () => {
  const harness = createContentHarness({ failBridgeDispatch: true });
  assert.equal(harness.timers.size, 0);
});

test('fullscreen notice reflects the resolved pause policy, not protection being enabled', () => {
  const harness = createContentHarness();
  harness.document.fullscreenElement = {};
  harness.document.dispatchEvent(new FakeEvent('fullscreenchange'));
  const apply = (spoofingEnabled, pausedReason) => harness.getBackgroundMessageListener()({
    type: 'specter:apply-config',
    config: { spoofingEnabled },
    context: { pausedReason }
  });
  apply(true, null);
  assert.equal(harness.document.documentElement.lastChild.dataset.state, 'hidden');
  apply(false, 'fullscreen');
  assert.equal(harness.document.documentElement.lastChild.dataset.state, 'visible');
  apply(true, null);
  assert.equal(harness.document.documentElement.lastChild.dataset.state, 'hidden');
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
  assert.equal(harness.getSessionStorageGetCalls(), 0);
});

test('isolated bridge drops oversized page telemetry', () => {
  const harness = createContentHarness();
  const channels = {
    config: 'specter:config:size-test',
    telemetry: 'specter:telemetry:size-test'
  };
  harness.document.dispatchEvent(new FakeEvent('specter:bridge-ready', { detail: JSON.stringify(channels) }));
  const send = (detail) => harness.window.dispatchEvent(new FakeEvent(channels.telemetry, {
    detail: JSON.stringify({ subtype: 'spoof-log', detail })
  }));
  send({ category: 'focus-sync', data: { value: 'visible' } });
  send({ category: 'focus-sync', data: { padding: 'x'.repeat(10000) } });
  const relayed = harness.sentMessages.filter((message) => message.type === 'specter:page-event');
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].detail.data.value, 'visible');
});
