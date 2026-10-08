(function specterMainWorld() {
  if (/^(?:moz|chrome)-extension:$/.test(window.location?.protocol || '')) return null;
  if (window.__specterMainWorldInjected) return null;
  try {
    Object.defineProperty(window, '__specterMainWorldInjected', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
  } catch (err) {
    window.__specterMainWorldInjected = true;
  }

  const randomChannel = (kind) => {
    const id = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `specter:${kind}:${id}`;
  };
  const channels = Object.freeze({
    config: randomChannel('config'),
    telemetry: randomChannel('telemetry')
  });
  const BRIDGE_REQUEST_EVENT = 'specter:bridge-request';
  const BRIDGE_READY_EVENT = 'specter:bridge-ready';

  const VISIBILITY_EVENTS = new Set([
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
  ]);
  const ELEMENT_FOCUS_EVENTS = new Set(['focus', 'blur', 'focusin', 'focusout']);
  const FULLSCREEN_CHANGE_EVENTS = new Set([
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'msfullscreenchange'
  ]);
  const CLIPBOARD_EVENTS = new Set(['copy', 'cut', 'paste']);
  const CLIPBOARD_KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress']);
  const CLIPBOARD_GUARDED_EVENTS = new Set([
    'copy',
    'cut',
    'paste',
    'beforeinput',
    'contextmenu',
    'keydown',
    'keyup',
    'keypress'
  ]);
  const elementListenerStore = new WeakMap();
  const clipboardListenerStore = new WeakMap();
  const handlerStore = new WeakMap();
  const nativeGetters = new Map();
  const nativeToString = Function.prototype.toString;
  const maskedFns = new WeakSet();

  const handlerPatches = [];
  VISIBILITY_EVENTS.forEach((type) => {
    handlerPatches.push({ target: Document.prototype, prop: `on${type}`, type, block: () => shouldBlock(type) });
    handlerPatches.push({ target: window, prop: `on${type}`, type, block: () => shouldBlock(type) });
  });
  const elementHandlerTargets = [
    typeof HTMLElement === 'undefined' ? null : HTMLElement.prototype,
    typeof SVGElement === 'undefined' ? null : SVGElement.prototype,
    Element.prototype
  ].filter((target, index, targets) => target && targets.indexOf(target) === index);
  elementHandlerTargets.forEach((target) => {
    ELEMENT_FOCUS_EVENTS.forEach((type) => {
      handlerPatches.push({ target, prop: `on${type}`, type, block: () => state.elementBlocking });
    });
  });
  [Document.prototype, window].forEach((target) => {
    FULLSCREEN_CHANGE_EVENTS.forEach((type) => {
      handlerPatches.push({ target, prop: `on${type}`, type, block: () => shouldBlockFullscreenChange() });
    });
  });
  [Document.prototype, window, ...elementHandlerTargets].forEach((target) => {
    ['copy', 'cut', 'paste', 'beforeinput', 'contextmenu', 'keydown', 'keyup', 'keypress'].forEach((type) => {
      handlerPatches.push({ target, prop: `on${type}`, type, block: (event) => shouldBlockClipboard(type, event) });
    });
  });

  const visibilityDescriptorTargets = [
    { target: Document.prototype, prop: 'hidden', value: false },
    { target: Document.prototype, prop: 'webkitHidden', value: false },
    { target: Document.prototype, prop: 'mozHidden', value: false },
    { target: Document.prototype, prop: 'msHidden', value: false },
    { target: Document.prototype, prop: 'visibilityState', value: 'visible' },
    { target: Document.prototype, prop: 'webkitVisibilityState', value: 'visible' },
    { target: Document.prototype, prop: 'mozVisibilityState', value: 'visible' }
  ];

  const defaults = {
    spoofingEnabled: false,
    blockEvents: false,
    loggingEnabled: false,
    elementFocusBlocking: false,
    fakeActivity: {
      enabled: false,
      min: 1000,
      max: 4000,
      jitter: 0.25,
      moveRadius: 12
    },
    decoyTiming: {
      enabled: true,
      min: 800,
      max: 2500
    },
    allowlisted: false,
    pausedReason: null,
    holdFullscreen: false,
    allowClipboard: false
  };

  const state = {
    config: defaults,
    blockEvents: false,
    awaitingConfig: true,
    listenersBlocked: {
      window: new Map(),
      document: new Map()
    },
    elementBlocking: false,
    fullscreenHold: {
      engaged: false,
      element: null,
      viewport: null
    },
    metrics: {
      blockedListeners: 0,
      blockedHandlers: 0,
      syntheticBursts: 0
    },
    fakeTimer: null,
    lifetime: new AbortController()
  };

  const originalAddEvent = EventTarget.prototype.addEventListener;
  const originalRemoveEvent = EventTarget.prototype.removeEventListener;
  const originalHasFocus = Document.prototype.hasFocus;
  const isElementTarget = (target) => target instanceof Element || target instanceof DocumentFragment;

  function setupBridgeHandshake() {
    originalAddEvent.call(document, BRIDGE_REQUEST_EVENT, () => {
      document.dispatchEvent(new CustomEvent(BRIDGE_READY_EVENT, {
        detail: JSON.stringify(channels)
      }));
    });
  }

  function emit(subtype, detail) {
    window.dispatchEvent(new CustomEvent(channels.telemetry, {
      detail: JSON.stringify({ subtype, detail })
    }));
  }

  function shouldBlock(type) {
    if (!VISIBILITY_EVENTS.has(type)) {
      return false;
    }
    return state.blockEvents || state.awaitingConfig;
  }

  function bucketKeyFor(target) {
    if (target === window) return 'window';
    return 'document';
  }

  function normalizeListenerOptions(options) {
    const isObject = Boolean(options && typeof options === 'object');
    const capture = typeof options === 'boolean' ? options : Boolean(isObject && options.capture);
    return {
      capture,
      once: Boolean(isObject && options.once),
      signal: isObject && options.signal instanceof AbortSignal ? options.signal : null,
      nativeOptions: isObject ? { ...options, once: false } : capture
    };
  }

  function invokeListener(entry, event) {
    if (typeof entry.listener === 'function') {
      return entry.listener.call(entry.target, event);
    }
    if (entry.listener && typeof entry.listener.handleEvent === 'function') {
      return entry.listener.handleEvent.call(entry.listener, event);
    }
    return undefined;
  }

  function removeManagedEntry(entries, entry) {
    entries.delete(entry);
    originalRemoveEvent.call(entry.target, entry.type, entry.wrapped, entry.capture);
    if (entry.signal && entry.abortListener) {
      originalRemoveEvent.call(entry.signal, 'abort', entry.abortListener, false);
      entry.abortListener = null;
    }
  }

  function addManagedListener(target, type, listener, options, entries, isBlocked) {
    if (!listener) return;
    const normalized = normalizeListenerOptions(options);
    for (const entry of entries) {
      if (entry.listener === listener && entry.capture === normalized.capture) return;
    }
    if (normalized.signal?.aborted) return;

    const entry = {
      listener,
      target,
      type,
      capture: normalized.capture,
      once: normalized.once,
      signal: normalized.signal,
      abortListener: null,
      wrapped: null
    };
    entry.wrapped = function specterManagedListener(event) {
      // Only gate the page listener. Never cancel the native event: isolated
      // extension worlds (including browser-control tools) must still receive it.
      if (isBlocked(event)) {
        state.metrics.blockedListeners += 1;
        return undefined;
      }
      if (!entry.once) return invokeListener(entry, event);
      try {
        return invokeListener(entry, event);
      } finally {
        removeManagedEntry(entries, entry);
      }
    };
    entries.add(entry);
    originalAddEvent.call(target, type, entry.wrapped, normalized.nativeOptions);
    if (entry.signal) {
      entry.abortListener = () => {
        removeManagedEntry(entries, entry);
      };
      originalAddEvent.call(entry.signal, 'abort', entry.abortListener, { once: true });
    }
  }

  function storeBlockedListener(target, type, listener, options) {
    const key = bucketKeyFor(target);
    const bucket = state.listenersBlocked[key];
    const entries = bucket.get(type) || new Set();
    bucket.set(type, entries);
    addManagedListener(target, type, listener, options, entries, () => blockPageSignal(type));
  }

  function removeBlockedListener(target, type, listener, options) {
    const bucket = state.listenersBlocked[bucketKeyFor(target)];
    const entries = bucket.get(type);
    if (!entries) return;
    const { capture } = normalizeListenerOptions(options);
    for (const entry of entries) {
      if (entry.listener === listener && entry.capture === capture) {
        removeManagedEntry(entries, entry);
        break;
      }
    }
    if (!entries.size) bucket.delete(type);
  }

  function storeElementListener(target, type, listener, options) {
    const typeMap = elementListenerStore.get(target) || new Map();
    const entries = typeMap.get(type) || new Set();
    typeMap.set(type, entries);
    elementListenerStore.set(target, typeMap);
    addManagedListener(target, type, listener, options, entries, () => state.elementBlocking);
  }

  function removeElementListener(target, type, listener, options) {
    const typeMap = elementListenerStore.get(target);
    const entries = typeMap?.get(type);
    if (!entries) return;
    const { capture } = normalizeListenerOptions(options);
    for (const entry of entries) {
      if (entry.listener === listener && entry.capture === capture) {
        removeManagedEntry(entries, entry);
        break;
      }
    }
    if (!entries.size) typeMap.delete(type);
    if (!typeMap.size) elementListenerStore.delete(target);
  }

  function clipboardEntries(target, type) {
    const typeMap = clipboardListenerStore.get(target) || new Map();
    const entries = typeMap.get(type) || new Set();
    typeMap.set(type, entries);
    clipboardListenerStore.set(target, typeMap);
    return entries;
  }

  function storeClipboardListener(target, type, listener, options) {
    addManagedListener(
      target,
      type,
      listener,
      options,
      clipboardEntries(target, type),
      (event) => shouldBlockClipboard(type, event)
    );
  }

  function removeClipboardListener(target, type, listener, options) {
    const typeMap = clipboardListenerStore.get(target);
    const entries = typeMap?.get(type);
    if (!entries) return;
    const { capture } = normalizeListenerOptions(options);
    for (const entry of entries) {
      if (entry.listener === listener && entry.capture === capture) {
        removeManagedEntry(entries, entry);
        break;
      }
    }
    if (!entries.size) typeMap.delete(type);
    if (!typeMap.size) clipboardListenerStore.delete(target);
  }

  function invokeBlockedListeners(type) {
    ['window', 'document'].forEach((key) => {
      const bucket = state.listenersBlocked[key];
      const entries = bucket.get(type);
      if (!entries || !entries.size) return;
      entries.forEach((entry) => {
        try {
          const event = new Event(type, { bubbles: true });
          invokeListener(entry, event);
        } catch (err) {
          // ignored
        } finally {
          if (entry.once) removeManagedEntry(entries, entry);
        }
      });
    });
  }

  function wrapEventListeners() {
    if (EventTarget.prototype.__specterPatched) return;
    Object.defineProperty(EventTarget.prototype, '__specterPatched', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    EventTarget.prototype.addEventListener = function specterAddEventListener(type, listener, options) {
      const normalized = String(type || '').toLowerCase();
      const pageTarget = this === window || this === document.defaultView ? window : this;
      if ((VISIBILITY_EVENTS.has(normalized) || FULLSCREEN_CHANGE_EVENTS.has(normalized))
        && (this === document || this === window || this === document.defaultView)) {
        storeBlockedListener(this === window || this === document.defaultView ? window : document, normalized, listener, options);
        return;
      }
      if (CLIPBOARD_GUARDED_EVENTS.has(normalized)) {
        storeClipboardListener(pageTarget, normalized, listener, options);
        return;
      }
      if (ELEMENT_FOCUS_EVENTS.has(normalized) && isElementTarget(this)) {
        storeElementListener(this, normalized, listener, options);
        return;
      }
      return originalAddEvent.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function specterRemoveEventListener(type, listener, options) {
      const normalized = String(type || '').toLowerCase();
      const pageTarget = this === window || this === document.defaultView ? window : this;
      if ((VISIBILITY_EVENTS.has(normalized) || FULLSCREEN_CHANGE_EVENTS.has(normalized))
        && (this === document || this === window || this === document.defaultView)) {
        removeBlockedListener(this === window || this === document.defaultView ? window : document, normalized, listener, options);
        return;
      }
      if (CLIPBOARD_GUARDED_EVENTS.has(normalized)) {
        removeClipboardListener(pageTarget, normalized, listener, options);
        return;
      }
      if (ELEMENT_FOCUS_EVENTS.has(normalized) && isElementTarget(this)) {
        removeElementListener(this, normalized, listener, options);
        return;
      }
      return originalRemoveEvent.call(this, type, listener, options);
    };
    maskNative(EventTarget.prototype.addEventListener);
    maskNative(EventTarget.prototype.removeEventListener);
  }

  function makeDescriptor(target, prop, forcedValue) {
    const descriptor = Object.getOwnPropertyDescriptor(target, prop) || {};
    const readValue = function readSpecterValue() {
      if (state.config?.spoofingEnabled || state.awaitingConfig) {
        return typeof forcedValue === 'function' ? forcedValue() : forcedValue;
      }
      if (descriptor.get) return descriptor.get.call(this);
      return descriptor.value;
    };
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: readValue,
        set(value) {
          if (descriptor.set) {
            descriptor.set.call(this, value);
          }
        }
      });
    } catch (err) {
      try {
        const instance = target === Document.prototype ? document : null;
        if (instance) {
          Object.defineProperty(instance, prop, {
            configurable: true,
            enumerable: false,
            get: readValue,
            set(value) {
              if (descriptor.set) descriptor.set.call(this, value);
            }
          });
        }
      } catch (e) {
        // If both attempts fail, continue without crashing.
      }
    }
  }

  function findPropertyDescriptor(target, prop) {
    let current = target;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, prop);
      if (descriptor) return descriptor;
      current = Object.getPrototypeOf(current);
    }
    return null;
  }

  function patchHandlerProperties() {
    handlerPatches.forEach(({ target, prop, block }) => {
      const descriptor = findPropertyDescriptor(target, prop);
      if (!descriptor || !descriptor.configurable) return;
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          const stored = handlerStore.get(this)?.get(prop);
          if (stored) return stored.handler;
          if (descriptor.get) {
            return descriptor.get.call(this);
          }
          return null;
        },
        set(handler) {
          const handlers = handlerStore.get(this) || new Map();
          if (typeof handler !== 'function') {
            handlers.delete(prop);
            if (handlers.size) handlerStore.set(this, handlers);
            else handlerStore.delete(this);
            if (descriptor.set) descriptor.set.call(this, handler);
            return handler;
          }
          const wrapped = function specterManagedHandler(event) {
            if (block(event)) {
              state.metrics.blockedHandlers += 1;
              return undefined;
            }
            return handler.call(this, event);
          };
          handlers.set(prop, { handler, wrapped });
          handlerStore.set(this, handlers);
          if (descriptor.set) descriptor.set.call(this, wrapped);
          return handler;
        }
      });
    });
  }

  function spoofHasFocus() {
    if (!originalHasFocus) return;
    Document.prototype.hasFocus = function specterHasFocus() {
      if (state.config?.spoofingEnabled || state.awaitingConfig) {
        return true;
      }
      return originalHasFocus.call(this);
    };
    maskNative(Document.prototype.hasFocus);
  }

  function maskNative(fn) {
    if (typeof fn === 'function') maskedFns.add(fn);
    return fn;
  }

  function installToStringMask() {
    const specterToString = function toString() {
      if (maskedFns.has(this)) {
        const name = this.name ? ` ${this.name}` : '';
        return `function${name}() { [native code] }`;
      }
      return nativeToString.call(this);
    };
    maskNative(specterToString);
    try {
      Function.prototype.toString = specterToString;
    } catch (err) {
      // Keep going if the engine rejects the replacement.
    }
  }

  function featureEnabled(flag) {
    if (state.awaitingConfig) return true;
    return Boolean(state.config?.[flag]);
  }

  function blockPageSignal(type) {
    if (VISIBILITY_EVENTS.has(type)) return shouldBlock(type);
    if (FULLSCREEN_CHANGE_EVENTS.has(type)) return shouldBlockFullscreenChange();
    return false;
  }

  function isClipboardShortcut(event) {
    if (!event) return false;
    const key = String(event.key || event.code || '').toLowerCase();
    const command = Boolean(event.ctrlKey || event.metaKey);
    if (command && (key === 'c' || key === 'v' || key === 'x' || key === 'insert')) return true;
    if (event.shiftKey && (key === 'insert' || key === 'delete')) return true;
    return false;
  }

  function isEditableTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (typeof HTMLInputElement === 'function' && target instanceof HTMLInputElement) return true;
    if (typeof HTMLTextAreaElement === 'function' && target instanceof HTMLTextAreaElement) return true;
    if (target.isContentEditable) return true;
    const name = target.tagName ? String(target.tagName).toLowerCase() : '';
    return name === 'input' || name === 'textarea';
  }

  function shouldBlockClipboard(type, event) {
    if (!featureEnabled('allowClipboard')) return false;
    if (CLIPBOARD_EVENTS.has(type)) return true;
    if (type === 'beforeinput') {
      const inputType = String(event?.inputType || '');
      return inputType === 'insertFromPaste' || inputType === 'insertFromPasteAsQuotation' || inputType === 'deleteByCut';
    }
    if (CLIPBOARD_KEY_EVENTS.has(type)) return isClipboardShortcut(event);
    if (type === 'contextmenu') return isEditableTarget(event?.target);
    return false;
  }

  function readSavedGetter(kind, receiver, prop) {
    const saved = nativeGetters.get(`${kind}:${prop}`);
    if (!saved) return undefined;
    if (saved.get) return saved.get.call(receiver);
    return saved.value;
  }

  function readNativeFullscreenElement(doc) {
    return readSavedGetter('document', doc, 'fullscreenElement')
      || readSavedGetter('document', doc, 'webkitFullscreenElement')
      || readSavedGetter('document', doc, 'mozFullScreenElement')
      || readSavedGetter('document', doc, 'msFullscreenElement')
      || null;
  }

  function captureViewport() {
    const viewport = {};
    ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].forEach((prop) => {
      const value = readSavedGetter('window', window, prop);
      if (typeof value === 'number') viewport[prop] = value;
    });
    return viewport;
  }

  function rememberFullscreen(doc) {
    const native = readNativeFullscreenElement(doc || document);
    if (!native) return false;
    state.fullscreenHold.engaged = true;
    state.fullscreenHold.element = native;
    state.fullscreenHold.viewport = captureViewport();
    return true;
  }

  function clearFullscreenHold() {
    state.fullscreenHold.engaged = false;
    state.fullscreenHold.element = null;
    state.fullscreenHold.viewport = null;
  }

  function shouldBlockFullscreenChange() {
    if (!featureEnabled('holdFullscreen')) return false;
    if (rememberFullscreen(document)) return false;
    return Boolean(state.fullscreenHold.engaged);
  }

  function installForcedGetter(target, kind, prop, read) {
    const found = findPropertyDescriptor(target, prop);
    if (found && found.configurable === false) return;
    const descriptor = found || { configurable: true, enumerable: true };
    nativeGetters.set(`${kind}:${prop}`, found || null);
    const getter = function specterRead() {
      return read(this, found);
    };
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get: getter,
        set(value) {
          if (found?.set) found.set.call(this, value);
        }
      });
    } catch (err) {
      // A non-configurable browser property stays native.
    }
  }

  function nativeValue(receiver, found) {
    if (!found) return undefined;
    if (found.get) return found.get.call(receiver);
    return found.value;
  }

  function installFullscreenHold() {
    ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'].forEach((prop) => {
      installForcedGetter(Document.prototype, 'document', prop, (receiver, found) => {
        const native = nativeValue(receiver, found);
        if (!featureEnabled('holdFullscreen')) return native;
        if (native) {
          rememberFullscreen(receiver);
          return native;
        }
        if (state.fullscreenHold.engaged && state.fullscreenHold.element) return state.fullscreenHold.element;
        return native;
      });
    });
    ['fullscreen', 'webkitIsFullScreen', 'mozFullScreen'].forEach((prop) => {
      installForcedGetter(Document.prototype, 'document', prop, (receiver, found) => {
        const native = nativeValue(receiver, found);
        if (!featureEnabled('holdFullscreen')) return native;
        if (native) {
          rememberFullscreen(receiver);
          return true;
        }
        if (state.fullscreenHold.engaged) return true;
        return native;
      });
    });
    ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].forEach((prop) => {
      if (!findPropertyDescriptor(window, prop)) return;
      installForcedGetter(window, 'window', prop, (receiver, found) => {
        const native = nativeValue(receiver, found);
        if (!featureEnabled('holdFullscreen') || !state.fullscreenHold.engaged) return native;
        if (readNativeFullscreenElement(document)) return native;
        const held = state.fullscreenHold.viewport?.[prop];
        return typeof held === 'number' ? held : native;
      });
    });
    ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach((prop) => {
      const found = findPropertyDescriptor(Document.prototype, prop);
      if (typeof found?.value !== 'function' || found.configurable === false) return;
      const original = found.value;
      const wrapped = function specterExitFullscreen(...args) {
        if (featureEnabled('holdFullscreen') && state.fullscreenHold.engaged) {
          return Promise.resolve();
        }
        return original.apply(this, args);
      };
      maskNative(wrapped);
      try {
        Object.defineProperty(Document.prototype, prop, {
          configurable: true,
          enumerable: found.enumerable,
          writable: true,
          value: wrapped
        });
      } catch (err) {
        // Leave the browser method in place.
      }
    });
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function scheduleFakeActivity() {
    if (state.fakeTimer) {
      clearTimeout(state.fakeTimer);
      state.fakeTimer = null;
    }
    if (!state.config?.spoofingEnabled || !state.config?.fakeActivity?.enabled) {
      return;
    }
    const fake = state.config.fakeActivity;
    const decoy = state.config.decoyTiming;
    const baseDelay = randomBetween(fake.min, fake.max);
    const decoyDelay = decoy?.enabled ? randomBetween(decoy.min, decoy.max) * 0.2 : 0;
    const delay = baseDelay + decoyDelay;
    state.fakeTimer = setTimeout(() => {
      runFakeBurst();
      scheduleFakeActivity();
    }, delay);
  }

  function dispatchSyntheticEvent(type) {
    invokeBlockedListeners(type);
    try {
      const event = new Event(type, { bubbles: true });
      if (type === 'focus') {
        window.dispatchEvent(event);
        document.dispatchEvent(event);
      } else if (type === 'blur') {
        window.dispatchEvent(event);
      } else {
        document.dispatchEvent(event);
      }
    } catch (err) {
      // ignore
    }
  }

  function runFakeBurst() {
    const focusFirst = Math.random() > 0.5;
    if (focusFirst) {
      dispatchSyntheticEvent('focus');
      dispatchSyntheticEvent('visibilitychange');
    } else {
      dispatchSyntheticEvent('visibilitychange');
      dispatchSyntheticEvent('focus');
    }
    const mouseEvent = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: false,
      clientX: randomBetween(10, window.innerWidth - 10),
      clientY: randomBetween(10, window.innerHeight - 10),
      movementX: randomBetween(-state.config.fakeActivity.moveRadius, state.config.fakeActivity.moveRadius),
      movementY: randomBetween(-state.config.fakeActivity.moveRadius, state.config.fakeActivity.moveRadius)
    });
    document.dispatchEvent(mouseEvent);
    state.metrics.syntheticBursts += 1;
    emit('spoof-log', {
      category: 'fake-activity',
      data: { type: 'burst', events: ['focus', 'visibilitychange', 'mousemove'] }
    });
  }

  function applyConfig(payload) {
    state.config = {
      ...defaults,
      ...(payload || {})
    };
    state.awaitingConfig = false;
    state.blockEvents = Boolean(state.config.blockEvents && state.config.spoofingEnabled);
    state.elementBlocking = Boolean(state.config.spoofingEnabled && state.config.elementFocusBlocking);
    if (!state.config.holdFullscreen) clearFullscreenHold();
    else rememberFullscreen(document);
    scheduleFakeActivity();
  }

  function flushMetrics() {
    if (!state.config?.loggingEnabled) return;
    if (!state.metrics.blockedListeners && !state.metrics.syntheticBursts && !state.metrics.blockedHandlers) {
      return;
    }
    emit('spoof-log', {
      category: 'metrics',
      data: { ...state.metrics }
    });
    emit('metrics', {
      blocked: state.metrics.blockedListeners,
      synthetic: state.metrics.syntheticBursts,
      handlers: state.metrics.blockedHandlers
    });
    state.metrics.blockedListeners = 0;
    state.metrics.syntheticBursts = 0;
    state.metrics.blockedHandlers = 0;
  }

  function setupLifecycle() {
    originalAddEvent.call(window, 'focus', () => {
      if (state.config?.spoofingEnabled) {
        emit('spoof-log', {
          category: 'focus-sync',
          data: { value: document.visibilityState }
        });
      }
    });
    state.lifetime.signal.addEventListener('abort', () => {
      if (state.fakeTimer) {
        clearTimeout(state.fakeTimer);
        state.fakeTimer = null;
      }
    });
    // Internal cleanup must bypass Specter's page-listener gate so it still
    // runs while protection is active and the document is being destroyed.
    originalAddEvent.call(window, 'pagehide', () => state.lifetime.abort(), { once: true });
  }

  function init() {
    installToStringMask();
    setupBridgeHandshake();
    wrapEventListeners();
    patchHandlerProperties();
    visibilityDescriptorTargets.forEach(({ target, prop, value }) => makeDescriptor(target, prop, value));
    installFullscreenHold();
    spoofHasFocus();
    setupLifecycle();
    window.addEventListener(channels.config, (event) => {
      if (!event || !event.detail) return;
      try {
        applyConfig(JSON.parse(event.detail));
      } catch (error) {
        // Ignore malformed bridge payloads.
      }
    });
    setInterval(flushMetrics, 5000);
  }

  init();
  return channels;
}());
