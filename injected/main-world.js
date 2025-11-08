(function specterMainWorld() {
  if (window.__specterMainWorldInjected) return;
  window.__specterMainWorldInjected = true;

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
  const elementListenerStore = new Map();

  const HANDLER_PROPS = [
    { target: Document.prototype, prop: 'onvisibilitychange', type: 'visibilitychange' },
    { target: Document.prototype, prop: 'onwebkitvisibilitychange', type: 'webkitvisibilitychange' },
    { target: Document.prototype, prop: 'onmozvisibilitychange', type: 'mozvisibilitychange' },
    { target: Document.prototype, prop: 'onblur', type: 'blur' },
    { target: Document.prototype, prop: 'onfocus', type: 'focus' },
    { target: window, prop: 'onblur', type: 'blur' },
    { target: window, prop: 'onfocus', type: 'focus' }
  ];

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
    handlerBlocked: {
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

  function emit(subtype, detail) {
    window.dispatchEvent(new CustomEvent('specter:page-event', {
      detail: { subtype, detail }
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

  function storeBlockedListener(target, type, listener, options) {
    if (!listener) return;
    const key = bucketKeyFor(target);
    const bucket = state.listenersBlocked[key];
    const entries = bucket.get(type) || new Set();
    const entry = { listener, options: options || {}, target };
    entries.add(entry);
    bucket.set(type, entries);
    if (entry.options && entry.options.signal instanceof AbortSignal) {
      if (entry.options.signal.aborted) {
        entries.delete(entry);
      } else {
        entry.options.signal.addEventListener('abort', () => {
          entries.delete(entry);
        }, { once: true });
      }
    }
    state.metrics.blockedListeners += 1;
  }

  function removeBlockedListener(target, type, listener) {
    const key = bucketKeyFor(target);
    const bucket = state.listenersBlocked[key];
    const entries = bucket.get(type);
    if (!entries || !entries.size) return;
    for (const entry of entries) {
      if (entry.listener === listener) {
        entries.delete(entry);
        break;
      }
    }
  }

  function storeElementListener(target, type, listener, options) {
    if (!listener) return;
    const typeMap = elementListenerStore.get(target) || new Map();
    const set = typeMap.get(type) || new Set();
    const entry = { listener, options: options || {} };
    set.add(entry);
    typeMap.set(type, set);
    elementListenerStore.set(target, typeMap);
    if (entry.options.signal instanceof AbortSignal) {
      if (entry.options.signal.aborted) {
        set.delete(entry);
      } else {
        entry.options.signal.addEventListener('abort', () => set.delete(entry), { once: true });
      }
    }
  }

  function removeElementListener(target, type, listener) {
    const typeMap = elementListenerStore.get(target);
    if (!typeMap) return;
    const set = typeMap.get(type);
    if (!set) return;
    for (const entry of set) {
      if (entry.listener === listener) {
        set.delete(entry);
        break;
      }
    }
    if (!set.size) {
      typeMap.delete(type);
    }
    if (!typeMap.size) {
      elementListenerStore.delete(target);
    }
  }

  function flushElementListenersToNative() {
    elementListenerStore.forEach((typeMap, target) => {
      typeMap.forEach((set, type) => {
        set.forEach((entry) => {
          try {
            originalAddEvent.call(target, type, entry.listener, entry.options);
          } catch (err) {
            // ignore flush failures
          }
        });
      });
    });
    elementListenerStore.clear();
  }

  function invokeBlockedListeners(type) {
    ['window', 'document'].forEach((key) => {
      const bucket = state.listenersBlocked[key];
      const entries = bucket.get(type);
      if (!entries || !entries.size) return;
      entries.forEach((entry) => {
        try {
          const event = new Event(type, { bubbles: true });
          if (typeof entry.listener === 'function') {
            entry.listener.call(entry.target, event);
          } else if (entry.listener && typeof entry.listener.handleEvent === 'function') {
            entry.listener.handleEvent.call(entry.listener, event);
          }
        } catch (err) {
          // ignored
        }
        if (entry.options && entry.options.once) {
          entries.delete(entry);
        }
      });
    });
  }

  function storeBlockedHandler(targetKey, prop, handler) {
    if (typeof handler !== 'function') return;
    const bucket = state.handlerBlocked[targetKey];
    bucket.set(prop, handler);
    state.metrics.blockedHandlers += 1;
  }

  function restoreBlockedHandlers() {
    HANDLER_PROPS.forEach(({ target, prop }) => {
      const refObject = target === window ? window : document;
      const targetKey = bucketKeyFor(refObject);
      const stored = state.handlerBlocked[targetKey].get(prop);
      if (!stored) return;
      const descriptor = handlerDescriptors.get(`${targetKey}:${prop}`);
      if (descriptor && descriptor.set) {
        try {
          descriptor.set.call(refObject, stored);
        } catch (err) {
          // ignore
        }
      }
    });
    state.handlerBlocked.window.clear();
    state.handlerBlocked.document.clear();
  }

  function flushBlockedListenersToNative() {
    ['window', 'document'].forEach((key) => {
      const bucket = state.listenersBlocked[key];
      bucket.forEach((entries, type) => {
        entries.forEach((entry) => {
          try {
            originalAddEvent.call(entry.target, type, entry.listener, entry.options);
          } catch (err) {
            // ignore
          }
        });
      });
      bucket.clear();
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
      if (shouldBlock(normalized) && (this === document || this === window || this === document.defaultView)) {
        storeBlockedListener(this === window ? window : document, normalized, listener, options);
        return;
      }
      if (state.elementBlocking && ELEMENT_FOCUS_EVENTS.has(normalized) && isElementTarget(this)) {
        storeElementListener(this, normalized, listener, options);
        return;
      }
      return originalAddEvent.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function specterRemoveEventListener(type, listener, options) {
      const normalized = String(type || '').toLowerCase();
      if (shouldBlock(normalized) && (this === document || this === window || this === document.defaultView)) {
        removeBlockedListener(this === window ? window : document, normalized, listener, options);
        return;
      }
      if (state.elementBlocking && ELEMENT_FOCUS_EVENTS.has(normalized) && isElementTarget(this)) {
        removeElementListener(this, normalized, listener);
        return;
      }
      return originalRemoveEvent.call(this, type, listener, options);
    };
  }

  function makeDescriptor(target, prop, forcedValue) {
    const descriptor = Object.getOwnPropertyDescriptor(target, prop) || {};
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          if (state.config?.spoofingEnabled || state.awaitingConfig) {
            return typeof forcedValue === 'function' ? forcedValue() : forcedValue;
          }
          if (descriptor.get) return descriptor.get.call(this);
          return descriptor.value;
        },
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
            get() { return typeof forcedValue === 'function' ? forcedValue() : forcedValue; }
          });
        }
      } catch (e) {
        // If both attempts fail, continue without crashing.
      }
    }
  }

  const handlerDescriptors = new Map();

  function patchHandlerProperties() {
    HANDLER_PROPS.forEach(({ target, prop, type }) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      if (!descriptor || !descriptor.configurable) return;
      const refObject = target === window ? window : document;
      const descriptorKey = `${bucketKeyFor(refObject)}:${prop}`;
      handlerDescriptors.set(descriptorKey, descriptor);
      Object.defineProperty(target, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          if (descriptor.get) {
            return descriptor.get.call(this);
          }
          return null;
        },
        set(handler) {
          const targetKey = bucketKeyFor(refObject);
          if (shouldBlock(type)) {
            storeBlockedHandler(targetKey, prop, handler);
            if (descriptor.set) descriptor.set.call(this, null);
            return handler;
          }
          if (descriptor.set) return descriptor.set.call(this, handler);
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
    const previousBlocking = state.blockEvents || state.awaitingConfig;
    const previousElementBlocking = state.config?.elementFocusBlocking;
    state.config = {
      ...defaults,
      ...(payload || {})
    };
    state.awaitingConfig = false;
    state.blockEvents = Boolean(state.config.blockEvents && state.config.spoofingEnabled);
    state.elementBlocking = Boolean(state.config.elementFocusBlocking);
    if (!state.blockEvents && previousBlocking) {
      flushBlockedListenersToNative();
      restoreBlockedHandlers();
    }
    if (previousElementBlocking && !state.elementBlocking) {
      flushElementListenersToNative();
    }
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
    window.addEventListener('pageshow', () => {
      window.dispatchEvent(new CustomEvent('specter:request-config'));
    });
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
    wrapEventListeners();
    patchHandlerProperties();
    visibilityDescriptorTargets.forEach(({ target, prop, value }) => makeDescriptor(target, prop, value));
    spoofHasFocus();
    setupLifecycle();
    window.addEventListener('specter:update-config', (event) => {
      if (!event || !event.detail) return;
      applyConfig(event.detail.config || {});
    });
    window.dispatchEvent(new CustomEvent('specter:request-config'));
    setInterval(flushMetrics, 5000);
  }

  init();
}());
