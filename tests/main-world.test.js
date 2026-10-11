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
  const nativeAddEventListener = LocalEventTarget.prototype.addEventListener;
  const clearedTimeouts = [];
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
    setTimeout: () => 1,
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
    DataTransfer: LocalDataTransfer,
    navigator: context.navigator,
    nativeAddEventListener,
    clearedTimeouts,
    fullscreen
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

test('leaving fullscreen stays unreported while fullscreen hold is on', async () => {
  const { window, document, fullscreen, nativeAddEventListener } = createMainWorld();
  const channels = applyMainWorldConfig(window, document, {
    spoofingEnabled: true,
    blockEvents: true,
    holdFullscreen: true,
    allowClipboard: false
  });

  const player = { id: 'player' };
  let pageEvents = 0;
  let extensionEvents = 0;
  document.addEventListener('fullscreenchange', () => {
    pageEvents += 1;
  });
  nativeAddEventListener.call(document, 'fullscreenchange', () => {
    extensionEvents += 1;
  });

  fullscreen.element = player;
  fullscreen.active = true;
  fullscreen.innerWidth = 1920;
  fullscreen.innerHeight = 1080;
  document.dispatchEvent(new FakeEvent('fullscreenchange'));
  assert.equal(pageEvents, 1);
  assert.equal(extensionEvents, 1);
  assert.equal(document.fullscreenElement, player);
  assert.equal(document.fullscreen, true);

  fullscreen.element = null;
  fullscreen.active = false;
  fullscreen.innerWidth = 800;
  fullscreen.innerHeight = 600;
  const exitEvent = new FakeEvent('fullscreenchange');
  document.dispatchEvent(exitEvent);
  assert.equal(pageEvents, 1);
  assert.equal(extensionEvents, 2);
  assert.equal(exitEvent.propagationStopped, false);
  assert.equal(document.fullscreenElement, player);
  assert.equal(document.fullscreen, true);
  assert.equal(window.innerWidth, 1920);
  assert.equal(window.innerHeight, 1080);
  const exitResult = document.exitFullscreen();
  assert.equal(fullscreen.exitCalls, 0);
  assert.equal(await exitResult, undefined);

  window.dispatchEvent(new FakeCustomEvent(channels.config, {
    detail: JSON.stringify({ spoofingEnabled: true, holdFullscreen: false, allowClipboard: false })
  }));
  document.dispatchEvent(new FakeEvent('fullscreenchange'));
  assert.equal(pageEvents, 2);
  assert.equal(document.fullscreenElement, null);
  assert.equal(document.fullscreen, false);
  assert.equal(window.innerWidth, 800);
  assert.equal(window.innerHeight, 600);
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
  assert.equal(blockedPaste.defaultPrevented, true);
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
  assert.equal(legacyPaste.returnValue, false);
  stop();

  stop = listen(document, 'keydown', block);
  const shortcut = key('v', { ctrlKey: true });
  document.dispatchEvent(shortcut);
  assert.equal(shortcut.canceled, false);
  const typing = key('a');
  document.dispatchEvent(typing);
  assert.equal(typing.canceled, true);
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
