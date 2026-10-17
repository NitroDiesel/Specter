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
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }
}

class FakeCustomEvent extends FakeEvent {}

test('main-world hooks skip extension-owned documents', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'injected', 'main-world.js'), 'utf8');
  for (const protocol of ['chrome-extension:', 'moz-extension:']) {
    const window = { location: { protocol } };
    const context = vm.createContext({ window });
    vm.runInContext(source, context, { filename: 'main-world.js' });
    assert.equal(window.__specterMainWorldInjected, undefined, protocol);
  }
});

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
      if (event.immediatePropagationStopped) break;
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
  // The native page state: hidden and unfocused unless a test brings it forward.
  const page = { hidden: true, focused: false };
  class LocalDocument extends LocalEventTarget {
    hasFocus() {
      return page.focused;
    }
  }

  for (const [property, read] of [
    ['hidden', () => page.hidden],
    ['webkitHidden', () => page.hidden],
    ['mozHidden', () => page.hidden],
    ['msHidden', () => page.hidden],
    ['visibilityState', () => (page.hidden ? 'hidden' : 'visible')],
    ['webkitVisibilityState', () => (page.hidden ? 'hidden' : 'visible')],
    ['mozVisibilityState', () => (page.hidden ? 'hidden' : 'visible')]
  ]) {
    Object.defineProperty(LocalDocument.prototype, property, {
      configurable: true,
      enumerable: true,
      get: read
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
  const nativeAddEventListener = LocalEventTarget.prototype.addEventListener;
  const clearedTimeouts = [];
  const timers = [];
  const fullscreen = {
    element: null,
    active: false,
    innerWidth: 800,
    innerHeight: 600,
    exitCalls: 0
  };
  document.defaultView = window;
  window.window = window;
  window.document = document;
  Object.defineProperty(LocalDocument.prototype, 'fullscreenElement', {
    configurable: true,
    enumerable: true,
    get() {
      return fullscreen.element;
    }
  });
  Object.defineProperty(LocalDocument.prototype, 'fullscreen', {
    configurable: true,
    enumerable: true,
    get() {
      return fullscreen.active;
    }
  });
  LocalDocument.prototype.exitFullscreen = function exitFullscreen() {
    fullscreen.exitCalls += 1;
    return Promise.resolve('native');
  };
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    enumerable: true,
    get() {
      return fullscreen.innerWidth;
    }
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    enumerable: true,
    get() {
      return fullscreen.innerHeight;
    }
  });

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

  class LocalEvent extends FakeEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.isTrusted = init.trusted !== false;
      this.canceled = false;
    }

    preventDefault() {
      this.canceled = true;
    }

    get defaultPrevented() {
      return this.canceled;
    }

    get returnValue() {
      return !this.canceled;
    }

    set returnValue(value) {
      if (!value) this.canceled = true;
    }
  }

  class LocalDataTransfer {
    constructor(data = {}, files = []) {
      this.data = { ...data };
      this.fileList = files;
    }

    get types() {
      return [...Object.keys(this.data), ...(this.fileList.length ? ['Files'] : [])];
    }

    get items() {
      return [];
    }

    get files() {
      return this.fileList;
    }

    getData(type) {
      return this.data[type] || '';
    }

    setData(type, value) {
      this.data[type] = String(value);
    }
  }

  class LocalInputEvent extends LocalEvent {
    get data() {
      return this._data ?? null;
    }
  }

  class LocalClipboard {
    readText() {
      return Promise.resolve('');
    }

    writeText() {
      return Promise.resolve();
    }
  }

  const clipboardHandlers = ['oncopy', 'oncut', 'onpaste', 'onbeforeinput', 'oncontextmenu', 'onkeydown'];
  for (const target of [LocalDocument.prototype, LocalElement.prototype]) {
    for (const property of clipboardHandlers) {
      Object.defineProperty(target, property, {
        configurable: true,
        get() {
          return this[`_${property}`] || null;
        },
        set(value) {
          this[`_${property}`] = value;
        }
      });
    }
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
    Event: LocalEvent,
    InputEvent: LocalInputEvent,
    CustomEvent: FakeCustomEvent,
    DataTransfer: LocalDataTransfer,
    Clipboard: LocalClipboard,
    navigator: { clipboard: new LocalClipboard() },
    Element: LocalElement,
    HTMLElement: LocalElement,
    SVGElement: LocalElement,
    Document: LocalDocument,
    DocumentFragment: LocalDocumentFragment,
    AbortSignal: FakeAbortSignal,
    AbortController: FakeAbortController,
    crypto: { randomUUID: () => 'test-channel' },
    setTimeout: (callback) => {
      timers.push(callback);
      return 1;
    },
    clearTimeout: (id) => { clearedTimeouts.push(id); },
    setInterval: () => 1,
    Math,
    JSON,
    console
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'injected', 'main-world.js'), 'utf8');
  vm.runInContext(source, context);
  return {
    window,
    document,
    Element: LocalElement,
    Event: LocalEvent,
    InputEvent: LocalInputEvent,
    DataTransfer: LocalDataTransfer,
    navigator: context.navigator,
    nativeAddEventListener,
    clearedTimeouts,
    timers,
    fullscreen,
    page
  };
}

test('internal pagehide cleanup bypasses protected page listeners', () => {
  const { window, document, clearedTimeouts } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));
  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({
      spoofingEnabled: true,
      blockEvents: true,
      fakeActivity: { enabled: true, min: 1000, max: 1000, jitter: 0, moveRadius: 12 },
      decoyTiming: { enabled: false, min: 800, max: 2500 }
    })
  }));

  let pagehideEvents = 0;
  window.addEventListener('pagehide', () => {
    pagehideEvents += 1;
  });
  window.dispatchEvent(new FakeEvent('pagehide'));

  assert.equal(pagehideEvents, 0);
  assert.deepEqual(clearedTimeouts, [1]);
});

test('protection leaves lifecycle events available to isolated extension observers', () => {
  const { window, document, nativeAddEventListener } = createMainWorld();
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));

  let pageEvents = 0;
  let extensionEvents = 0;
  window.addEventListener('blur', () => {
    pageEvents += 1;
  });
  nativeAddEventListener.call(window, 'blur', () => {
    extensionEvents += 1;
  });

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, blockEvents: true })
  }));
  const event = new FakeEvent('blur');
  window.dispatchEvent(event);

  assert.equal(pageEvents, 0);
  assert.equal(extensionEvents, 1);
  assert.equal(event.propagationStopped, false);
  assert.equal(event.immediatePropagationStopped, false);
});

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

function applyMainWorldConfig(window, document, config) {
  let channels;
  document.addEventListener('specter:bridge-ready', (event) => {
    channels = JSON.parse(event.detail);
  });
  document.dispatchEvent(new FakeCustomEvent('specter:bridge-request'));
  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify(config)
  }));
  return channels;
}

function fullscreenWorld() {
  const world = createMainWorld();
  world.channels = applyMainWorldConfig(world.window, world.document, {
    spoofingEnabled: true,
    blockEvents: true,
    holdFullscreen: true,
    allowClipboard: false
  });
  const { window, document, fullscreen, page, nativeAddEventListener } = world;
  page.hidden = false;
  page.focused = true;
  world.player = { id: 'player' };
  world.pageEvents = [];
  world.extensionEvents = 0;
  document.addEventListener('fullscreenchange', (event) => {
    world.pageEvents.push(document.fullscreenElement);
  });
  nativeAddEventListener.call(document, 'fullscreenchange', () => {
    world.extensionEvents += 1;
  });
  world.enter = () => {
    fullscreen.element = world.player;
    fullscreen.active = true;
    fullscreen.innerWidth = 1920;
    fullscreen.innerHeight = 1080;
    const event = new FakeEvent('fullscreenchange');
    document.dispatchEvent(event);
    return event;
  };
  world.exit = () => {
    fullscreen.element = null;
    fullscreen.active = false;
    fullscreen.innerWidth = 800;
    fullscreen.innerHeight = 600;
    const event = new FakeEvent('fullscreenchange');
    document.dispatchEvent(event);
    return event;
  };
  world.leave = (how) => {
    if (how === 'tab') {
      page.hidden = true;
      page.focused = false;
      document.dispatchEvent(new FakeEvent('visibilitychange'));
    } else {
      page.focused = false;
      window.dispatchEvent(new FakeEvent('blur'));
    }
  };
  world.comeBack = (how) => {
    page.hidden = false;
    page.focused = true;
    if (how === 'tab') document.dispatchEvent(new FakeEvent('visibilitychange'));
    else window.dispatchEvent(new FakeEvent('focus'));
  };
  return world;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a user exit from fullscreen reaches the page and allows re-entry', () => {
  const { window, document, player, pageEvents, enter, exit } = fullscreenWorld();

  enter();
  assert.deepEqual(pageEvents, [player]);
  assert.equal(document.fullscreenElement, player);
  assert.equal(document.fullscreen, true);

  // Esc or the page's own exit button, with the page visible and focused.
  const exitEvent = exit();
  assert.deepEqual(pageEvents, [player, null]);
  assert.equal(exitEvent.propagationStopped, false);
  assert.equal(document.fullscreenElement, null);
  assert.equal(document.fullscreen, false);
  assert.equal(window.innerWidth, 800);
  assert.equal(window.innerHeight, 600);

  enter();
  assert.deepEqual(pageEvents, [player, null, player]);
  exit();
  assert.deepEqual(pageEvents, [player, null, player, null]);
  assert.equal(document.fullscreenElement, null);
});

test('a page call to exitFullscreen really exits', async () => {
  const { document, fullscreen, player, pageEvents, enter, exit, leave } = fullscreenWorld();

  enter();
  assert.equal(await document.exitFullscreen(), 'native');
  assert.equal(fullscreen.exitCalls, 1);
  exit();
  assert.deepEqual(pageEvents, [player, null]);
  assert.equal(document.fullscreenElement, null);

  // A page exit stays deliberate even if the browser finishes it while the tab is hidden.
  enter();
  document.exitFullscreen();
  assert.equal(fullscreen.exitCalls, 2);
  leave('tab');
  exit();
  assert.deepEqual(pageEvents, [player, null, player, null]);
  assert.equal(document.fullscreenElement, null);
  assert.equal(document.fullscreen, false);
});

test('fullscreen hold masks an exit during a tab switch and clears on return', async () => {
  const world = fullscreenWorld();
  const { window, document, fullscreen, player, pageEvents, enter, exit, leave, comeBack } = world;

  enter();
  leave('tab');
  const exitEvent = exit();
  assert.deepEqual(pageEvents, [player]);
  assert.equal(world.extensionEvents, 2);
  assert.equal(exitEvent.propagationStopped, false);
  assert.equal(document.fullscreenElement, player);
  assert.equal(document.fullscreen, true);
  assert.equal(window.innerWidth, 1920);
  assert.equal(window.innerHeight, 1080);

  comeBack('tab');
  assert.deepEqual(pageEvents, [player, null]);
  assert.equal(document.fullscreenElement, null);
  assert.equal(document.fullscreen, false);
  assert.equal(window.innerWidth, 800);
  assert.equal(window.innerHeight, 600);

  // A window switch is held the same way.
  enter();
  leave('window');
  exit();
  assert.deepEqual(pageEvents, [player, null, player]);
  assert.equal(document.fullscreenElement, player);
  comeBack('window');
  assert.deepEqual(pageEvents, [player, null, player, null]);
  assert.equal(document.fullscreenElement, null);

  // An exit the browser reports only after the return is not held either.
  enter();
  leave('tab');
  fullscreen.element = null;
  fullscreen.active = false;
  assert.equal(document.fullscreenElement, player);
  comeBack('tab');
  assert.equal(document.fullscreenElement, null);
  document.dispatchEvent(new FakeEvent('fullscreenchange'));
  assert.deepEqual(pageEvents, [player, null, player, null, player, null]);

  // A page that asks to exit while the hold masks fullscreen gets a real exit report.
  enter();
  leave('tab');
  exit();
  const exitCalls = fullscreen.exitCalls;
  assert.equal(await document.exitFullscreen(), undefined);
  assert.equal(fullscreen.exitCalls, exitCalls);
  await tick();
  assert.equal(document.fullscreenElement, null);
  assert.equal(document.fullscreen, false);
  assert.deepEqual(pageEvents.slice(6), [player, null]);
  comeBack('tab');
  assert.deepEqual(pageEvents.slice(6), [player, null]);

  // Focus can come back inside a child frame without a focus event here; the next read releases the hold.
  enter();
  leave('window');
  exit();
  assert.equal(document.fullscreenElement, player);
  world.page.focused = true;
  assert.equal(document.fullscreenElement, null);
  assert.equal(window.innerWidth, 800);
  await tick();
  assert.deepEqual(pageEvents.slice(8), [player, null]);
});

test('turning fullscreen hold off reports a masked exit at once', () => {
  const { window, document, channels, fullscreen, player, pageEvents, enter, exit, leave } = fullscreenWorld();

  enter();
  leave('tab');
  exit();
  assert.equal(document.fullscreenElement, player);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, holdFullscreen: false, allowClipboard: false })
  }));
  assert.deepEqual(pageEvents, [player, null]);
  assert.equal(document.fullscreenElement, null);
  assert.equal(document.fullscreen, false);
  assert.equal(window.innerWidth, 800);
  document.exitFullscreen();
  assert.equal(fullscreen.exitCalls, 1);
});

function clipboardWorld(config = { spoofingEnabled: true, blockEvents: true, allowClipboard: true }) {
  const world = createMainWorld();
  if (config) applyMainWorldConfig(world.window, world.document, config);
  const { Event, DataTransfer } = world;
  world.paste = (text = 'hello', files = []) => {
    const event = new Event('paste');
    event.clipboardData = new DataTransfer(text ? { 'text/plain': text } : {}, files);
    return event;
  };
  world.copy = (type = 'copy') => {
    const event = new Event(type);
    event.clipboardData = new DataTransfer();
    return event;
  };
  world.key = (key, modifiers = {}) => Object.assign(new Event('keydown'), { key }, modifiers);
  return world;
}

function listen(target, type, listener) {
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

test('clipboard blockers cannot cancel copy, cut, paste, or the edit menu', () => {
  const { document, Element, Event, paste, copy, key } = clipboardWorld();
  const calls = [];
  const block = (event) => {
    calls.push(event.type);
    event.preventDefault();
  };

  let stop = listen(document, 'paste', block);
  const blockedPaste = paste();
  document.dispatchEvent(blockedPaste);
  assert.deepEqual(calls, ['paste']);
  assert.equal(blockedPaste.canceled, false);
  assert.equal(blockedPaste.defaultPrevented, false);
  stop();

  for (const type of ['copy', 'cut']) {
    stop = listen(document, type, block);
    const event = copy(type);
    document.dispatchEvent(event);
    assert.equal(event.canceled, false, type);
    stop();
  }

  document.onpaste = () => false;
  const inlinePaste = paste();
  document.dispatchEvent(inlinePaste);
  assert.equal(inlinePaste.canceled, false);
  document.onpaste = null;

  stop = listen(document, 'paste', (event) => {
    event.returnValue = false;
  });
  const legacyPaste = paste();
  document.dispatchEvent(legacyPaste);
  assert.equal(legacyPaste.canceled, false);
  assert.equal(legacyPaste.returnValue, true);
  stop();

  const field = new Element();
  field.tagName = 'INPUT';
  const label = new Element();
  label.tagName = 'SPAN';
  listen(field, 'contextmenu', block);
  listen(label, 'contextmenu', block);
  const fieldMenu = new Event('contextmenu');
  field.dispatchEvent(fieldMenu);
  assert.equal(fieldMenu.canceled, false);
  const labelMenu = new Event('contextmenu');
  label.dispatchEvent(labelMenu);
  assert.equal(labelMenu.canceled, true);

  stop = listen(document, 'paste', block);
  const scripted = new Event('paste', { trusted: false });
  document.dispatchEvent(scripted);
  assert.equal(scripted.canceled, true);
  stop();
});

test('pages that handle the clipboard themselves keep their cancel', () => {
  const { document, Event, DataTransfer, navigator, paste, copy, key } = clipboardWorld();

  let stop = listen(document, 'paste', (event) => {
    event.preventDefault();
    event.clipboardData.getData('text/plain');
  });
  const editorPaste = paste();
  document.dispatchEvent(editorPaste);
  assert.equal(editorPaste.canceled, true);
  stop();

  stop = listen(document, 'paste', (event) => {
    if (event.clipboardData.getData('text/plain')) event.preventDefault();
  });
  const sanitizedPaste = paste();
  document.dispatchEvent(sanitizedPaste);
  assert.equal(sanitizedPaste.canceled, true);
  stop();

  stop = listen(document, 'paste', (event) => {
    event.preventDefault();
    Array.from(event.clipboardData.files);
  });
  const imagePaste = paste('', [{ type: 'image/png' }]);
  document.dispatchEvent(imagePaste);
  assert.equal(imagePaste.canceled, true);
  stop();

  stop = listen(document, 'copy', (event) => {
    event.clipboardData.setData('text/plain', 'rich copy');
    event.preventDefault();
  });
  const editorCopy = copy();
  document.dispatchEvent(editorCopy);
  assert.equal(editorCopy.canceled, true);
  stop();

  stop = listen(document, 'cut', (event) => {
    event.preventDefault();
    event.clipboardData.setData('text/plain', 'cut text');
  });
  const editorCut = copy('cut');
  document.dispatchEvent(editorCut);
  assert.equal(editorCut.canceled, true);
  stop();

  stop = listen(document, 'copy', (event) => {
    event.clipboardData.setData('text/plain', '');
    event.preventDefault();
  });
  const blankedCopy = copy();
  document.dispatchEvent(blankedCopy);
  assert.equal(blankedCopy.canceled, false);
  stop();

  stop = listen(document, 'keydown', (event) => {
    event.preventDefault();
    navigator.clipboard.readText();
  });
  const appShortcut = key('v', { metaKey: true });
  document.dispatchEvent(appShortcut);
  assert.equal(appShortcut.canceled, true);
  stop();

  stop = listen(document, 'beforeinput', (event) => {
    event.preventDefault();
    event.dataTransfer.getData('text/plain');
  });
  const beforePaste = Object.assign(new Event('beforeinput'), {
    inputType: 'insertFromPaste',
    dataTransfer: new DataTransfer({ 'text/plain': 'hi' })
  });
  document.dispatchEvent(beforePaste);
  assert.equal(beforePaste.canceled, true);
  stop();
});

// Runs a clipboard shortcut the way the browser does: the keydown first, then,
// unless the page cancelled it, the clipboard event and its default action.
function pressShortcut(world, keyName, clipboardEvent, defaultAction) {
  const keydown = world.key(keyName, { ctrlKey: true });
  world.document.dispatchEvent(keydown);
  if (keydown.canceled) return { keydown };
  world.document.dispatchEvent(clipboardEvent);
  if (!clipboardEvent.canceled) defaultAction();
  return { keydown, clipboardEvent };
}

test('clipboard shortcut keys follow the page, so an app paste or copy happens once', async () => {
  const world = clipboardWorld();
  const { document, navigator, paste, copy } = world;
  const inserted = [];

  let stop = listen(document, 'keydown', (event) => {
    if (event.key !== 'v' || !event.ctrlKey) return;
    event.preventDefault();
    Promise.resolve()
      .then(() => navigator.clipboard.readText())
      .then(() => inserted.push('app'));
  });
  const pasted = pressShortcut(world, 'v', paste(), () => inserted.push('browser'));
  await tick();
  assert.equal(pasted.keydown.canceled, true);
  assert.equal(pasted.keydown.defaultPrevented, true);
  assert.deepEqual(inserted, ['app']);
  stop();

  let clipboard = '';
  stop = listen(document, 'keydown', (event) => {
    if (event.key !== 'c' || !event.ctrlKey) return;
    event.preventDefault();
    // Stands in for copying custom text through a helper field and execCommand('copy').
    clipboard = 'custom text';
  });
  const copied = pressShortcut(world, 'c', copy(), () => { clipboard = 'native selection'; });
  assert.equal(copied.keydown.canceled, true);
  assert.equal(clipboard, 'custom text');
  stop();

  stop = listen(document, 'keydown', (event) => event.preventDefault());
  const typing = world.key('a');
  document.dispatchEvent(typing);
  assert.equal(typing.canceled, true);
  stop();
});

test('blocker-only pages still get native paste and copy', () => {
  const world = clipboardWorld();
  const { document, paste, copy } = world;
  const inserted = [];
  let clipboard = '';

  listen(document, 'paste', (event) => event.preventDefault());
  listen(document, 'copy', (event) => event.preventDefault());
  document.onpaste = () => false;
  document.oncopy = () => false;

  const pasted = pressShortcut(world, 'v', paste(), () => inserted.push('browser'));
  assert.equal(pasted.keydown.canceled, false);
  assert.equal(pasted.clipboardEvent.canceled, false);
  assert.deepEqual(inserted, ['browser']);

  const copied = pressShortcut(world, 'c', copy(), () => { clipboard = 'native selection'; });
  assert.equal(copied.clipboardEvent.canceled, false);
  assert.equal(clipboard, 'native selection');

  // An editor behind the blocker sees the truth and does its own single insert.
  listen(document, 'paste', (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    inserted.push(`editor:${event.clipboardData.getData('text/plain')}`);
  });
  const edited = pressShortcut(world, 'v', paste('hi'), () => inserted.push('browser'));
  assert.equal(edited.clipboardEvent.canceled, true);
  assert.deepEqual(inserted, ['browser', 'editor:hi']);
});

test('a waiting clipboard cancel ends with its event', () => {
  const { document, navigator, timers, paste } = clipboardWorld();
  const stop = listen(document, 'paste', (event) => event.preventDefault());
  const blocked = paste();
  document.dispatchEvent(blocked);
  stop();
  timers.splice(0).forEach((callback) => callback());

  // A later clipboard call, such as a paste button, must not reach the old event.
  navigator.clipboard.readText();
  blocked.clipboardData.getData('text/plain');
  assert.equal(blocked.canceled, false);
});

test('inline clipboard attributes are judged like other handlers', () => {
  const { window, Element, paste } = clipboardWorld();
  const field = new Element();
  field.tagName = 'TEXTAREA';
  // Simulates onpaste="return false", which the parser compiles without the setter.
  field._onpaste = () => false;
  const event = paste();
  event.composedPath = () => [field, window];
  window.dispatchEvent(event);
  field.dispatchEvent(event);
  assert.equal(event.canceled, false);
  assert.equal(typeof field.onpaste, 'function');
});

test('clipboard cancels follow live protection changes', () => {
  const world = clipboardWorld(null);
  const { window, document, paste } = world;
  listen(document, 'paste', (event) => event.preventDefault());

  const beforeConfig = paste();
  document.dispatchEvent(beforeConfig);
  assert.equal(beforeConfig.canceled, false);

  for (const allowClipboard of [false, true, false, true]) {
    applyMainWorldConfig(window, document, { spoofingEnabled: true, blockEvents: true, allowClipboard });
    const event = paste();
    document.dispatchEvent(event);
    assert.equal(event.canceled, !allowClipboard, `allowClipboard ${allowClipboard}`);
  }
});

test('element-level fullscreenchange listeners follow the same hold rules', () => {
  const world = fullscreenWorld();
  const { Element, document, fullscreen, leave, comeBack } = world;
  const player = new Element();
  const seen = [];
  player.addEventListener('fullscreenchange', () => seen.push(document.fullscreenElement));
  const fire = (element) => {
    fullscreen.element = element;
    fullscreen.active = Boolean(element);
    const event = new FakeEvent('fullscreenchange');
    player.dispatchEvent(event);
    return event;
  };

  fire(player);
  assert.deepEqual(seen, [player]);
  // A user exit while visible and focused reaches element listeners.
  fire(null);
  assert.deepEqual(seen, [player, null]);
  assert.equal(document.fullscreenElement, null);

  // An exit during a tab switch is held for element listeners too.
  fire(player);
  leave('tab');
  fire(null);
  assert.deepEqual(seen, [player, null, player]);
  assert.equal(document.fullscreenElement, player);
  comeBack('tab');
  assert.equal(document.fullscreenElement, null);
});

test('the edit menu override covers only text fields, including inside shadow DOM', () => {
  const { Element, Event } = clipboardWorld();
  const block = (event) => event.preventDefault();
  const make = (tagName, type) => {
    const element = new Element();
    element.tagName = tagName;
    if (type !== undefined) element.type = type;
    element.addEventListener('contextmenu', block);
    return element;
  };

  const textField = make('INPUT', 'text');
  const textMenu = new Event('contextmenu');
  textField.dispatchEvent(textMenu);
  assert.equal(textMenu.canceled, false);

  // A page's own menu on a checkbox stays the page's.
  const checkbox = make('INPUT', 'checkbox');
  const checkboxMenu = new Event('contextmenu');
  checkbox.dispatchEvent(checkboxMenu);
  assert.equal(checkboxMenu.canceled, true);

  // A shadow host sees the event retargeted; the real target is the inner field.
  const inner = new Element();
  inner.tagName = 'TEXTAREA';
  const host = make('DIV');
  const shadowMenu = new Event('contextmenu');
  shadowMenu.composedPath = () => [inner, host];
  host.dispatchEvent(shadowMenu);
  assert.equal(shadowMenu.canceled, false);
});

test('a text-field paste handler that reads beforeinput data keeps its cancel', () => {
  const { document, InputEvent } = clipboardWorld();
  const pasteInput = () => Object.assign(new InputEvent('beforeinput'), { inputType: 'insertFromPaste', _data: 'hi' });

  const reader = (event) => {
    event.preventDefault();
    assert.equal(event.data, 'hi');
  };
  document.addEventListener('beforeinput', reader);
  const handled = pasteInput();
  document.dispatchEvent(handled);
  assert.equal(handled.canceled, true);
  document.removeEventListener('beforeinput', reader);

  // A blocker that never reads the text still gets the native paste.
  const blocker = (event) => event.preventDefault();
  document.addEventListener('beforeinput', blocker);
  const blocked = pasteInput();
  document.dispatchEvent(blocked);
  assert.equal(blocked.canceled, false);
});
