(function specterMainWorld() {
  if (/^(?:moz|chrome)-extension:$/.test(window.location?.protocol || '')) return null;
  if (window.__specterMainWorldInjected) return null;
  window.__specterMainWorldInjected = true;

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
  const elementListenerStore = new WeakMap();
  const handlerStore = new WeakMap();

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
    pausedReason: null
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
      if (isBlocked()) {
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
    addManagedListener(target, type, listener, options, entries, () => shouldBlock(type));
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
      if (VISIBILITY_EVENTS.has(normalized) && (this === document || this === window || this === document.defaultView)) {
        storeBlockedListener(this === window ? window : document, normalized, listener, options);
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
      if (VISIBILITY_EVENTS.has(normalized) && (this === document || this === window || this === document.defaultView)) {
        removeBlockedListener(this === window ? window : document, normalized, listener, options);
        return;
      }
      if (ELEMENT_FOCUS_EVENTS.has(normalized) && isElementTarget(this)) {
        removeElementListener(this, normalized, listener, options);
        return;
      }
      return originalRemoveEvent.call(this, type, listener, options);
    };
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
            if (block()) {
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
    window.addEventListener('focus', () => {
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
    window.addEventListener('pagehide', () => state.lifetime.abort(), { once: true });
  }

  function init() {
    setupBridgeHandshake();
    wrapEventListeners();
    patchHandlerProperties();
    visibilityDescriptorTargets.forEach(({ target, prop, value }) => makeDescriptor(target, prop, value));
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
