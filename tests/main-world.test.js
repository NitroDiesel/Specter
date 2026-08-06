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
    const handler = this[`_on${event.type}`];
    if (typeof handler === 'function') {
      handler.call(this, event);
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

  const visibilityEvents = [
    'visibilitychange',
    'webkitvisibilitychange',
    'mozvisibilitychange',
    'blur',
    'focus',
    'focusin',
    'focusout',
    'pageshow',
    'pagehide',
    'freeze',
    'resume'
  ];

  for (const property of visibilityEvents.map((type) => `on${type}`)) {
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

  for (const property of visibilityEvents.map((type) => `on${type}`)) {
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

  for (const property of ['onblur', 'onfocus', 'onfocusin', 'onfocusout']) {
    Object.defineProperty(LocalElement.prototype, property, {
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
    HTMLElement: LocalElement,
    SVGElement: LocalElement,
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
  return { window, document, Element: LocalElement };
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

  let repeatedChannels;
  document.addEventListener('specter:bridge-ready', (event) => {
    repeatedChannels = JSON.parse(event.detail);
  }, { once: true });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));
  assert.deepEqual(repeatedChannels, channels);

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

test('window listeners follow repeated protection toggles without a reload', () => {
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
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 0);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 1);

  let listenerAddedWhileOff = 0;
  window.addEventListener('blur', () => {
    listenerAddedWhileOff += 1;
  });
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 2);
  assert.equal(listenerAddedWhileOff, 1);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 2);
  assert.equal(listenerAddedWhileOff, 1);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 3);
  assert.equal(listenerAddedWhileOff, 2);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(blurEvents, 3);
  assert.equal(listenerAddedWhileOff, 2);
});

test('all supported window and document lifecycle listeners follow live protection state', () => {
  const { window, document } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  const eventTypes = [
    'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange',
    'blur', 'focus', 'focusin', 'focusout', 'pageshow', 'pagehide', 'freeze', 'resume'
  ];
  const counts = new Map(eventTypes.map((type) => [type, { window: 0, document: 0 }]));
  eventTypes.forEach((type) => {
    window.addEventListener(type, () => { counts.get(type).window += 1; });
    document.addEventListener(type, () => { counts.get(type).document += 1; });
  });

  const dispatchEveryEvent = () => {
    eventTypes.forEach((type) => {
      window.dispatchEvent(new FakeEvent(type));
      document.dispatchEvent(new FakeEvent(type));
    });
  };

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  dispatchEveryEvent();
  eventTypes.forEach((type) => assert.deepEqual(counts.get(type), { window: 0, document: 0 }));

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false })
  }));
  dispatchEveryEvent();
  eventTypes.forEach((type) => assert.deepEqual(counts.get(type), { window: 1, document: 1 }));

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  dispatchEveryEvent();
  eventTypes.forEach((type) => assert.deepEqual(counts.get(type), { window: 1, document: 1 }));
});

test('property handlers follow repeated protection toggles without a reload', () => {
  const { window, document } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  let blurEvents = 0;
  let visibilityEvents = 0;
  window.onblur = () => {
    blurEvents += 1;
  };
  document.onvisibilitychange = () => {
    visibilityEvents += 1;
  };

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  document.dispatchEvent(new FakeEvent('visibilitychange'));
  assert.equal(blurEvents, 1);
  assert.equal(visibilityEvents, 1);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  window.dispatchEvent(new FakeEvent('blur'));
  document.dispatchEvent(new FakeEvent('visibilitychange'));
  assert.equal(blurEvents, 1);
  assert.equal(visibilityEvents, 1);
});

test('element focus listeners follow focus-blocking toggles without a reload', () => {
  const { window, document, Element } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  const input = new Element();
  let focusEvents = 0;
  input.addEventListener('focus', () => {
    focusEvents += 1;
  });
  let propertyFocusEvents = 0;
  input.onfocus = () => {
    propertyFocusEvents += 1;
  };

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false, elementFocusBlocking: true })
  }));
  input.dispatchEvent(new FakeEvent('focus'));
  assert.equal(focusEvents, 1);
  assert.equal(propertyFocusEvents, 1);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true, elementFocusBlocking: true })
  }));
  input.dispatchEvent(new FakeEvent('focus'));
  assert.equal(focusEvents, 1);
  assert.equal(propertyFocusEvents, 1);
});

test('visibility and focus APIs restore native values whenever protection is off', () => {
  const { window, document } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  const apply = (enabled) => window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: enabled, blockEvents: enabled })
  }));

  apply(false);
  assert.equal(document.hidden, true);
  assert.equal(document.visibilityState, 'hidden');
  assert.equal(document.hasFocus(), false);

  apply(true);
  assert.equal(document.hidden, false);
  assert.equal(document.visibilityState, 'visible');
  assert.equal(document.hasFocus(), true);

  apply(false);
  assert.equal(document.hidden, true);
  assert.equal(document.visibilityState, 'hidden');
  assert.equal(document.hasFocus(), false);
});

test('managed listeners preserve removal, once, and abort behavior', () => {
  const { window, document } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));
  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: false, blockEvents: false })
  }));

  let removedEvents = 0;
  const removedListener = () => {
    removedEvents += 1;
  };
  window.addEventListener('blur', removedListener);
  window.removeEventListener('blur', removedListener);
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(removedEvents, 0);

  let onceEvents = 0;
  window.addEventListener('blur', () => {
    onceEvents += 1;
  }, { once: true });
  window.dispatchEvent(new FakeEvent('blur'));
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(onceEvents, 1);

  const controller = new FakeAbortController();
  let abortedEvents = 0;
  window.addEventListener('blur', () => {
    abortedEvents += 1;
  }, { signal: controller.signal });
  controller.abort();
  window.dispatchEvent(new FakeEvent('blur'));
  assert.equal(abortedEvents, 0);
});
