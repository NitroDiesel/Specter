const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.detail = init.detail;
    this.target = null;
    this.currentTarget = null;
  }
}

class FakeCustomEvent extends FakeEvent {}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, options: options || {} });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.listener !== listener));
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const entries = [...(this.listeners.get(event.type) || [])];
    for (const entry of entries) {
      if (typeof entry.listener === 'function') {
        entry.listener.call(this, event);
      } else {
        entry.listener?.handleEvent?.call(entry.listener, event);
      }
      if (entry.options?.once) {
        this.removeEventListener(event.type, entry.listener);
      }
    }
    return true;
  }
}

class FakeAbortSignal extends FakeEventTarget {
  constructor() {
    super();
    this.aborted = false;
  }
}
class FakeAbortController {
  constructor() {
    this.signal = new FakeAbortSignal();
  }

  abort() {
    this.signal.aborted = true;
    this.signal.dispatchEvent(new FakeEvent('abort'));
  }
}
function createMainWorld() {
  class LocalEventTarget extends FakeEventTarget {}
  class LocalElement extends LocalEventTarget {}
  class LocalDocumentFragment extends LocalEventTarget {}
  class LocalDocument extends LocalEventTarget {
    hasFocus() {
      return false;
    }
  }

  for (const [property, value] of [
    ['hidden', true],
    ['webkitHidden', true],
    ['mozHidden', true],
    ['msHidden', true],
    ['visibilityState', 'hidden'],
    ['webkitVisibilityState', 'hidden'],
    ['mozVisibilityState', 'hidden']
  ]) {
    Object.defineProperty(LocalDocument.prototype, property, {
      configurable: true,
      enumerable: true,
      get() {
        return value;
      }
    });
  }

  for (const property of ['onvisibilitychange', 'onwebkitvisibilitychange', 'onmozvisibilitychange', 'onblur', 'onfocus']) {
    Object.defineProperty(LocalDocument.prototype, property, {
      configurable: true,
      get() {
        return this[`_${property}`] || null;
      },
      set(value) {
        this[`_${property}`] = value;
      }
    });
  }

  const window = new LocalEventTarget();
  const document = new LocalDocument();
  document.defaultView = window;
  window.window = window;
  window.document = document;

  for (const property of ['onblur', 'onfocus']) {
    Object.defineProperty(window, property, {
      configurable: true,
      get() {
        return this[`_${property}`] || null;
      },
      set(value) {
        this[`_${property}`] = value;
      }
    });
  }

  const context = vm.createContext({
    window,
    document,
    EventTarget: LocalEventTarget,
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    Element: LocalElement,
    Document: LocalDocument,
    DocumentFragment: LocalDocumentFragment,
    AbortSignal: FakeAbortSignal,
    AbortController: FakeAbortController,
    crypto: { randomUUID: () => 'test-channel' },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    Math,
    JSON,
    console
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'injected', 'main-world.js'), 'utf8');
  vm.runInContext(source, context);
  return { window, document };
}

test('document_start hooks block CodePen-style blur listeners before config arrives', () => {
  const { window, document } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  assert.match(channels.config, /^specter:config:/);
  assert.match(channels.telemetry, /^specter:telemetry:/);

  let blurEvents = 0;
  window.addEventListener('blur', () => {
    blurEvents += 1;
  });

  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 0);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  window.dispatchEvent(new FakeEvent('blur'));

  assert.equal(blurEvents, 0);
  assert.equal(document.hidden, false);
  assert.equal(document.visibilityState, 'visible');
  assert.equal(document.hasFocus(), true);
});

test('blocked listeners are restored when protection is disabled', () => {
  const { window, document } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  let blurEvents = 0;
  window.addEventListener('blur', () => {
    blurEvents += 1;
  });
  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false })
  }));
  window.dispatchEvent(new FakeEvent('blur'));

  assert.equal(blurEvents, 1);
});
