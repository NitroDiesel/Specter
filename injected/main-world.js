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
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email', 'password', 'number']);
  const CLIPBOARD_GUARDED_EVENTS = [
    'copy',
    'cut',
    'paste',
    'beforeinput',
    'contextmenu'
  ];
  const elementListenerStore = new WeakMap();
  // The clipboard data each pending cancel waits on.
  const clipboardWaits = new WeakMap();
  const readTransfers = new WeakSet();
  const writtenTransfers = new WeakSet();
  // Paste events whose text the page read from InputEvent.data (text fields).
  const readInputEvents = new WeakSet();
  // Clipboard work tied to the event being dispatched, not only to its DataTransfer
  // object, so detection does not depend on the engine returning the same wrapper.
  const readEvents = new WeakSet();
  const writtenEvents = new WeakSet();
  const activeClipboardEvents = new Set();
  // The DataTransfer that owns each item list, so items.add() counts as copy data.
  const itemListOwners = new WeakMap();
  const handlerStore = new WeakMap();
  const nativeGetters = new Map();
  // Fullscreen events Specter has judged, and the exits it keeps from page listeners.
  const observedFullscreenEvents = new WeakSet();
  const maskedFullscreenEvents = new WeakSet();
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
  // fullscreenchange fires at the element that enters or leaves fullscreen and
  // bubbles through the document to the window, so every level is judged alike.
  [Document.prototype, window, ...elementHandlerTargets].forEach((target) => {
    FULLSCREEN_CHANGE_EVENTS.forEach((type) => {
      handlerPatches.push({ target, prop: `on${type}`, type, block: (event) => shouldBlockFullscreenChange(event) });
    });
  });
  [Document.prototype, window, ...elementHandlerTargets].forEach((target) => {
    CLIPBOARD_GUARDED_EVENTS.forEach((type) => {
      handlerPatches.push({ target, prop: `on${type}`, type, block: () => false, result: clipboardHandlerResult });
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
    // Clipboard events with a pending cancel. More than one only while one
    // event's handler starts another, such as execCommand inside a paste.
    clipboardWaits: new Set(),
    windowBlurred: false,
    fullscreenHold: {
      engaged: false,
      element: null,
      // The real fullscreen element, which differs from element inside shadow DOM.
      target: null,
      viewport: null,
      masking: false,
      exitRequested: false,
      suppressed: new Set()
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
  const nativeVisibilityState = findPropertyDescriptor(Document.prototype, 'visibilityState');
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
    addManagedListener(target, type, listener, options, entries, (event) => blockPageSignal(type, event));
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
    const isBlocked = FULLSCREEN_CHANGE_EVENTS.has(type)
      ? (event) => shouldBlockFullscreenChange(event)
      : () => state.elementBlocking;
    addManagedListener(target, type, listener, options, entries, isBlocked);
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
      if ((VISIBILITY_EVENTS.has(normalized) || FULLSCREEN_CHANGE_EVENTS.has(normalized))
        && (this === document || this === window || this === document.defaultView)) {
        storeBlockedListener(this === window || this === document.defaultView ? window : document, normalized, listener, options);
        return;
      }
      if ((ELEMENT_FOCUS_EVENTS.has(normalized) || FULLSCREEN_CHANGE_EVENTS.has(normalized)) && isElementTarget(this)) {
        storeElementListener(this, normalized, listener, options);
        return;
      }
      return originalAddEvent.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function specterRemoveEventListener(type, listener, options) {
      const normalized = String(type || '').toLowerCase();
      if ((VISIBILITY_EVENTS.has(normalized) || FULLSCREEN_CHANGE_EVENTS.has(normalized))
        && (this === document || this === window || this === document.defaultView)) {
        removeBlockedListener(this === window || this === document.defaultView ? window : document, normalized, listener, options);
        return;
      }
      if ((ELEMENT_FOCUS_EVENTS.has(normalized) || FULLSCREEN_CHANGE_EVENTS.has(normalized)) && isElementTarget(this)) {
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
    handlerPatches.forEach(({ target, prop, block, result }) => {
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
            const value = handler.call(this, event);
            return result ? result(event, value) : value;
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

  function blockPageSignal(type, event) {
    if (VISIBILITY_EVENTS.has(type)) return shouldBlock(type);
    if (FULLSCREEN_CHANGE_EVENTS.has(type)) return shouldBlockFullscreenChange(event);
    return false;
  }

  // Text fields only: a page's own menu on a button, checkbox, or slider stays the page's.
  // Tag names, not instanceof, so fields from another same-origin frame count too.
  function isEditableTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.isContentEditable) return true;
    if (target.ownerDocument?.designMode === 'on') return true;
    const name = target.tagName ? String(target.tagName).toLowerCase() : '';
    if (name === 'textarea') return true;
    return name === 'input' && TEXT_INPUT_TYPES.has(String(target.type || '').toLowerCase());
  }

  // The innermost node the event reached. event.target is retargeted to a shadow
  // host for listeners outside the shadow tree.
  function originalTarget(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    return path && path.length ? path[0] : event.target;
  }

  // A page may cancel a clipboard action only while doing that action itself:
  // reading the pasted data, writing the copied data, or using the async clipboard.
  // A cancel with no clipboard work (a paste or copy blocker) is ignored, so the
  // browser's own copy, cut, paste, and edit menu still happen. Shortcut keys are
  // left to the page: an app that cancels Ctrl+V or Ctrl+C usually handles the
  // clipboard itself, and the browser must not repeat that work.
  function clipboardPolicy(event) {
    if (!event || event.isTrusted !== true || !featureEnabled('allowClipboard')) return null;
    const type = event.type;
    if (type === 'paste') return 'read';
    if (type === 'copy' || type === 'cut') return 'write';
    if (type === 'beforeinput') {
      const inputType = String(event.inputType || '');
      return inputType === 'insertFromPaste' || inputType === 'insertFromPasteAsQuotation' ? 'read' : null;
    }
    if (type === 'contextmenu') return isEditableTarget(originalTarget(event)) ? 'ignore' : null;
    return null;
  }

  function transferOf(event) {
    return event.clipboardData || event.dataTransfer || null;
  }

  function clipboardWorkDone(event, policy) {
    const transfer = transferOf(event);
    if (policy === 'read') {
      return Boolean((transfer && readTransfers.has(transfer)) || readInputEvents.has(event) || readEvents.has(event));
    }
    if (policy === 'write') return Boolean((transfer && writtenTransfers.has(transfer)) || writtenEvents.has(event));
    return false;
  }

  function endClipboardWait(event) {
    const transfer = transferOf(event);
    if (transfer && clipboardWaits.get(transfer) === event) clipboardWaits.delete(transfer);
    state.clipboardWaits.delete(event);
  }

  // An event's cancel is moot once its dispatch ends.
  function stillDispatching(event) {
    return typeof event.eventPhase === 'number' && event.eventPhase !== 0;
  }

  // Without an eventPhase (older engines, tests) the event counts as dispatching
  // until the zero-delay cleanup removes it.
  function mayStillDispatch(event) {
    return typeof event.eventPhase !== 'number' || event.eventPhase !== 0;
  }

  function trackClipboardEvent(event, policy) {
    if ((policy !== 'read' && policy !== 'write') || activeClipboardEvents.has(event)) return;
    activeClipboardEvents.add(event);
    setTimeout(() => activeClipboardEvents.delete(event), 0);
  }

  function honorClipboardCancel(event) {
    endClipboardWait(event);
    nativeClipboardApis.preventDefault.call(event);
  }

  function requestClipboardCancel(event, policy) {
    if (policy === 'ignore') return;
    trackClipboardEvent(event, policy);
    if (clipboardWorkDone(event, policy)) {
      honorClipboardCancel(event);
      return;
    }
    if (state.clipboardWaits.has(event)) return;
    const transfer = transferOf(event);
    if (transfer) clipboardWaits.set(transfer, event);
    state.clipboardWaits.add(event);
    // The browser acts on the event right after dispatch, so a later cancel is moot.
    setTimeout(() => endClipboardWait(event), 0);
  }

  function noteClipboardWork(transfer, kind) {
    (kind === 'read' ? readTransfers : writtenTransfers).add(transfer);
    const event = clipboardWaits.get(transfer);
    if (event && clipboardPolicy(event) === kind) {
      clipboardWaits.delete(transfer);
      honorClipboardCancel(event);
    }
    activeClipboardEvents.forEach((active) => {
      if (!mayStillDispatch(active)) {
        activeClipboardEvents.delete(active);
        return;
      }
      if (clipboardPolicy(active) !== kind) return;
      (kind === 'read' ? readEvents : writtenEvents).add(active);
      if (state.clipboardWaits.has(active)) honorClipboardCancel(active);
    });
  }

  // In text fields, beforeinput carries the pasted text in data, not a DataTransfer.
  function noteInputEventRead(event) {
    readInputEvents.add(event);
    if (state.clipboardWaits.has(event)) honorClipboardCancel(event);
  }

  function noteAsyncClipboard(kind) {
    state.clipboardWaits.forEach((event) => {
      if (clipboardPolicy(event) === kind) honorClipboardCancel(event);
    });
  }

  function clipboardHandlerResult(event, value) {
    if (value !== false || !clipboardPolicy(event)) return value;
    event.preventDefault();
    return undefined;
  }

  // Inline attributes such as onpaste="return false" compile without the property
  // setter. Route them through it before they run so they are judged too.
  function adoptInlineHandlers(event) {
    const prop = `on${String(event.type).toLowerCase()}`;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    path.forEach((node) => {
      if (!node || handlerStore.get(node)?.has(prop)) return;
      try {
        const handler = node[prop];
        if (typeof handler === 'function') node[prop] = handler;
      } catch (err) {
        // Cross-origin or exotic targets keep their native handler.
      }
    });
  }

  function adoptInlineClipboardHandlers(event) {
    // A nested event, such as execCommand inside a paste handler, keeps the outer wait.
    state.clipboardWaits.forEach((pending) => {
      if (pending !== event && !stillDispatching(pending)) endClipboardWait(pending);
    });
    const policy = clipboardPolicy(event);
    if (!policy) return;
    trackClipboardEvent(event, policy);
    adoptInlineHandlers(event);
  }

  function patchClipboardMethod(target, name, wrap) {
    const native = target?.[name];
    if (typeof native !== 'function') return null;
    target[name] = wrap(native);
    return native;
  }

  function patchClipboardAccessor(target, prop, wrap) {
    const descriptor = target && Object.getOwnPropertyDescriptor(target, prop);
    if (!descriptor || !descriptor.configurable) return null;
    Object.defineProperty(target, prop, { ...wrap(descriptor), configurable: true, enumerable: descriptor.enumerable });
    return descriptor;
  }

  const nativeClipboardApis = {};

  function installClipboardGuard() {
    if (typeof Event !== 'function' || typeof Event.prototype?.preventDefault !== 'function') return;
    const eventProto = Event.prototype;
    nativeClipboardApis.preventDefault = patchClipboardMethod(eventProto, 'preventDefault', (native) => function preventDefault() {
      const policy = clipboardPolicy(this);
      if (!policy) return native.call(this);
      requestClipboardCancel(this, policy);
      return undefined;
    });
    // defaultPrevented and returnValue report the truth, so an editor that sees an
    // ignored cancel still does its own insert instead of skipping it.
    patchClipboardAccessor(eventProto, 'returnValue', (descriptor) => ({
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (!value && clipboardPolicy(this)) {
          this.preventDefault();
          return;
        }
        descriptor.set.call(this, value);
      }
    }));

    const transferProto = typeof DataTransfer === 'function' ? DataTransfer.prototype : null;
    patchClipboardMethod(transferProto, 'getData', (native) => function getData(...args) {
      noteClipboardWork(this, 'read');
      return native.apply(this, args);
    });
    patchClipboardMethod(transferProto, 'setData', (native) => function setData(...args) {
      if (args[1] != null && String(args[1]) !== '') noteClipboardWork(this, 'write');
      return native.apply(this, args);
    });
    patchClipboardAccessor(transferProto, 'files', (descriptor) => ({
      get() {
        noteClipboardWork(this, 'read');
        return descriptor.get.call(this);
      }
    }));
    patchClipboardAccessor(transferProto, 'items', (descriptor) => ({
      get() {
        noteClipboardWork(this, 'read');
        const list = descriptor.get.call(this);
        if (list && typeof list === 'object') itemListOwners.set(list, this);
        return list;
      }
    }));
    // A copy handler may write through clipboardData.items.add() instead of setData().
    const itemListProto = typeof DataTransferItemList === 'function' ? DataTransferItemList.prototype : null;
    patchClipboardMethod(itemListProto, 'add', (native) => function add(...args) {
      const transfer = itemListOwners.get(this);
      if (transfer && args[0] != null && args[0] !== '') noteClipboardWork(transfer, 'write');
      return native.apply(this, args);
    });
    const inputEventProto = typeof InputEvent === 'function' ? InputEvent.prototype : null;
    patchClipboardAccessor(inputEventProto, 'data', (descriptor) => ({
      get() {
        if (clipboardPolicy(this) === 'read') noteInputEventRead(this);
        return descriptor.get.call(this);
      }
    }));

    const clipboardProto = typeof Clipboard === 'function' ? Clipboard.prototype : null;
    [['read', 'read'], ['readText', 'read'], ['write', 'write'], ['writeText', 'write']].forEach(([name, kind]) => {
      patchClipboardMethod(clipboardProto, name, (native) => function clipboardCall(...args) {
        noteAsyncClipboard(kind);
        return native.apply(this, args);
      });
    });

    // Specter's own capture listener runs before page listeners on every path.
    CLIPBOARD_GUARDED_EVENTS.forEach((type) => {
      originalAddEvent.call(window, type, adoptInlineClipboardHandlers, true);
    });
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
    const hold = state.fullscreenHold;
    if (!hold.engaged || hold.masking) {
      hold.exitRequested = false;
      hold.suppressed.clear();
    }
    hold.engaged = true;
    hold.masking = false;
    hold.element = native;
    hold.viewport = captureViewport();
    return true;
  }

  function clearFullscreenHold() {
    const hold = state.fullscreenHold;
    hold.engaged = false;
    hold.element = null;
    hold.viewport = null;
    hold.masking = false;
    hold.exitRequested = false;
    hold.suppressed.clear();
  }

  // The user is away when the document is hidden, or the window lost focus and
  // no frame of this document has it back.
  function pageAway() {
    if (nativeVisibilityState?.get && nativeVisibilityState.get.call(document) === 'hidden') return true;
    if (!state.windowBlurred) return false;
    return !(originalHasFocus && originalHasFocus.call(document));
  }

  // Tell page listeners about an exit they missed while the hold masked it.
  function announceFullscreenExit(types) {
    types.forEach((type) => {
      try {
        const event = new Event(type, { bubbles: true, composed: true });
        observedFullscreenEvents.add(event);
        document.dispatchEvent(event);
      } catch (err) {
        // ignore
      }
    });
  }

  function releaseFullscreenHold(deferAnnounce) {
    const hold = state.fullscreenHold;
    const missed = hold.masking ? [...hold.suppressed] : [];
    clearFullscreenHold();
    if (!missed.length) return;
    if (deferAnnounce) Promise.resolve().then(() => announceFullscreenExit(missed));
    else announceFullscreenExit(missed);
  }

  // The hold masks only an exit that happens while the user is away, such as a
  // tab or window switch. A deliberate exit (Esc, the page's exit button, or a
  // page call to exitFullscreen) clears it, and so does the user's return.
  function syncFullscreenHold(deferAnnounce) {
    const hold = state.fullscreenHold;
    if (!featureEnabled('holdFullscreen')) return false;
    if (rememberFullscreen(document)) return false;
    if (!hold.engaged) return false;
    if (!hold.exitRequested && pageAway()) {
      hold.masking = true;
      return true;
    }
    releaseFullscreenHold(deferAnnounce);
    return false;
  }

  function observeFullscreenEvent(event) {
    if (!event || event.isTrusted === false || observedFullscreenEvents.has(event)) return;
    observedFullscreenEvents.add(event);
    if (!syncFullscreenHold(false)) return;
    maskedFullscreenEvents.add(event);
    state.fullscreenHold.suppressed.add(String(event.type).toLowerCase());
  }

  function shouldBlockFullscreenChange(event) {
    if (!event) return false;
    observeFullscreenEvent(event);
    return maskedFullscreenEvents.has(event);
  }

  function heldFullscreenElement(doc) {
    if (doc !== document || !state.fullscreenHold.engaged) return null;
    return syncFullscreenHold(true) ? state.fullscreenHold.element : null;
  }

  function watchPagePresence() {
    const recheck = (event) => {
      if (event?.isTrusted === false || !state.fullscreenHold.engaged) return;
      syncFullscreenHold(false);
    };
    originalAddEvent.call(window, 'blur', (event) => {
      if (event?.isTrusted !== false && event?.target === window) state.windowBlurred = true;
    }, true);
    originalAddEvent.call(window, 'focus', (event) => {
      if (event?.isTrusted === false) return;
      state.windowBlurred = false;
      recheck(event);
    }, true);
    originalAddEvent.call(window, 'visibilitychange', recheck, true);
    originalAddEvent.call(document, 'visibilitychange', recheck, true);
    FULLSCREEN_CHANGE_EVENTS.forEach((type) => {
      originalAddEvent.call(window, type, observeFullscreenEvent, true);
      originalAddEvent.call(document, type, observeFullscreenEvent, true);
    });
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
        return heldFullscreenElement(receiver) || native;
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
        return heldFullscreenElement(receiver) ? true : native;
      });
    });
    ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight'].forEach((prop) => {
      if (!findPropertyDescriptor(window, prop)) return;
      installForcedGetter(window, 'window', prop, (receiver, found) => {
        const native = nativeValue(receiver, found);
        if (!featureEnabled('holdFullscreen') || !state.fullscreenHold.engaged) return native;
        if (readNativeFullscreenElement(document) || !heldFullscreenElement(document)) return native;
        const held = state.fullscreenHold.viewport?.[prop];
        return typeof held === 'number' ? held : native;
      });
    });
    ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach((prop) => {
      const found = findPropertyDescriptor(Document.prototype, prop);
      if (typeof found?.value !== 'function' || found.configurable === false) return;
      const original = found.value;
      const wrapped = function specterExitFullscreen(...args) {
        const hold = state.fullscreenHold;
        if (this === document && featureEnabled('holdFullscreen') && hold.engaged) {
          // A page exit is deliberate. If only the hold still reports fullscreen,
          // end that report; otherwise let the browser exit and keep the hold out of it.
          if (!readNativeFullscreenElement(document)) {
            const reported = hold.masking;
            releaseFullscreenHold(true);
            if (reported) return prop === 'exitFullscreen' ? Promise.resolve() : undefined;
          } else {
            hold.exitRequested = true;
          }
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
    if (!state.config.holdFullscreen) releaseFullscreenHold(false);
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
    watchPagePresence();
    installClipboardGuard();
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
