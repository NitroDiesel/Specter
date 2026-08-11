/* Specter content script
 * Connects to main-world hooks, relays configs, and manages fullscreen pauses.
 */
(function SpecterContent() {
  if (/^(?:moz|chrome)-extension:$/.test(window.location?.protocol || '')) return;
  if (window.__specterContentLoaded) return;
  window.__specterContentLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const BRIDGE_REQUEST_EVENT = 'specter:bridge-request';
  const BRIDGE_READY_EVENT = 'specter:bridge-ready';
  const state = {
    config: null,
    context: null,
    channels: null,
    bridgeRetryTimer: null,
    bridgeRetryDelay: 25,
    ready: false,
    overlay: null,
    fullscreen: false,
    reloadScheduled: false,
    configOperation: 0,
    lastUrl: window.location.href,
    telemetryListener: null
  };

  function reloadStorageKey() {
    const tabId = state.context?.tabId;
    return tabId ? `__specterReloaded_${tabId}` : null;
  }

  function hasReloadedThisSession() {
    const key = reloadStorageKey();
    if (!key) return false;
    try {
      return sessionStorage.getItem(key) === '1';
    } catch (err) {
      return state.reloadScheduled;
    }
  }

  function setReloadedFlag(value) {
    const key = reloadStorageKey();
    state.reloadScheduled = value;
    if (!key) return;
    try {
      if (value) {
        sessionStorage.setItem(key, '1');
      } else {
        sessionStorage.removeItem(key);
      }
    } catch (err) {
      /* ignore storage issues */
    }
  }

  const callbackRuntime = typeof chrome !== 'undefined' && chrome.runtime?.sendMessage
    ? chrome.runtime
    : null;

  function unwrapResponse(response) {
    if (!response || typeof response.ok !== 'boolean') return response;
    if (!response.ok) throw new Error(response.error || 'Specter request failed');
    return response.result;
  }

  function sendMessage(payload) {
    if (!callbackRuntime) {
      return api.runtime.sendMessage(payload).then(unwrapResponse);
    }
    return new Promise((resolve, reject) => {
      try {
        callbackRuntime.sendMessage(payload, (response) => {
          const err = callbackRuntime.lastError;
          if (err) {
            reject(err);
            return;
          }
          try {
            resolve(unwrapResponse(response));
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function dispatchConfig() {
    if (!state.config || !state.channels?.config) return;
    window.dispatchEvent(new CustomEvent(state.channels.config, {
      detail: JSON.stringify(state.config)
    }));
    const shouldReload =
      state.config?.spoofingEnabled &&
      state.context?.autoReloadOnActivation &&
      !state.context.allowlisted &&
      !state.context.pausedReason;
    const managesReloadState = Boolean(state.context?.autoReloadOnActivation || state.reloadScheduled);

    if (shouldReload && !hasReloadedThisSession()) {
      setReloadedFlag(true);
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (error) {
          /* ignore reload issues */
        }
      }, 150);
    } else if (managesReloadState && !shouldReload && hasReloadedThisSession()) {
      // Reset flag when spoofing is disabled or allowlisted so we can reload next time.
      setReloadedFlag(false);
    }
  }

  function setBridgeChannels(channels) {
    if (!channels || typeof channels.config !== 'string' || typeof channels.telemetry !== 'string') {
      return false;
    }
    if (!channels.config.startsWith('specter:config:') || !channels.telemetry.startsWith('specter:telemetry:')) {
      return false;
    }
    if (state.telemetryListener && state.channels?.telemetry) {
      window.removeEventListener(state.channels.telemetry, state.telemetryListener);
    }
    state.channels = channels;
    state.telemetryListener = (event) => {
      let payload;
      try {
        payload = JSON.parse(event?.detail || '');
      } catch (error) {
        return;
      }
      const subtype = payload?.subtype;
      if (!['metrics', 'spoof-log'].includes(subtype)) return;
      sendMessage({
        type: 'specter:page-event',
        subtype,
        detail: payload.detail || {}
      }).catch(() => { });
    };
    window.addEventListener(state.channels.telemetry, state.telemetryListener);
    return true;
  }

  function connectMainWorldBridge() {
    const handleBridgeReady = (event) => {
      try {
        if (!setBridgeChannels(JSON.parse(event?.detail || ''))) return;
        document.removeEventListener(BRIDGE_READY_EVENT, handleBridgeReady);
        if (state.bridgeRetryTimer) {
          clearTimeout(state.bridgeRetryTimer);
          state.bridgeRetryTimer = null;
        }
        dispatchConfig();
      } catch (error) {
        // Ignore malformed bridge handshakes.
      }
    };
    const requestBridge = () => {
      if (state.channels) return;
      try {
        document.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT));
      } catch (error) {
        // A frame can be destroyed while a Firefox-family browser initializes it.
        return;
      }
      if (!state.channels) {
        state.bridgeRetryTimer = setTimeout(requestBridge, state.bridgeRetryDelay);
        state.bridgeRetryDelay = Math.min(state.bridgeRetryDelay * 2, 1000);
      }
    };
    document.addEventListener(BRIDGE_READY_EVENT, handleBridgeReady);
    requestBridge();
  }

  function requestInitialConfig() {
    const operation = ++state.configOperation;
    sendMessage({ type: 'specter:content-ready' }).then((payload) => {
      if (operation !== state.configOperation) return;
      if (!payload || !payload.config) return;
      if (!state.channels && payload.channels) {
        setBridgeChannels(payload.channels);
      }
      state.config = payload.config;
      state.context = payload.context || null;
      dispatchConfig();
      state.ready = true;
      updateOverlay();
    }).catch(() => {
      // Config request failed - main-world script will default to spoofing enabled
    });
  }

  function handleBackgroundMessage(message) {
    if (!message || message.type !== 'specter:apply-config') return;
    state.configOperation += 1;
    if (message.config) {
      state.config = message.config;
    }
    if (message.context) {
      state.context = message.context;
    }
    dispatchConfig();
    updateOverlay();
  }

  function createOverlay() {
    if (state.overlay || !document.documentElement) return;
    const chip = document.createElement('div');
    chip.className = 'specter-overlay-chip';
    chip.textContent = 'Specter paused in fullscreen';
    document.documentElement.appendChild(chip);
    state.overlay = chip;
  }

  function updateOverlay() {
    createOverlay();
    if (!state.overlay) return;
    const shouldShow = Boolean(state.fullscreen && state.config?.spoofingEnabled);
    state.overlay.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    state.overlay.dataset.state = shouldShow ? 'visible' : 'hidden';
  }

  function handleFullscreenChange() {
    const currentlyFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (state.fullscreen === currentlyFullscreen) return;
    state.fullscreen = currentlyFullscreen;
    updateOverlay();
    sendMessage({
      type: 'specter:page-event',
      subtype: 'fullscreen',
      detail: { paused: currentlyFullscreen }
    }).catch(() => { });
  }

  function initFullscreenListeners() {
    document.addEventListener('fullscreenchange', handleFullscreenChange, true);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange, true);
  }

  /* SPA navigation detection - monitors URL changes without page reload */
  function initSPANavigationDetection() {
    const checkUrlChange = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== state.lastUrl) {
        state.lastUrl = currentUrl;
        // Re-request config on SPA navigation
        requestInitialConfig();
      }
    };

    // Monitor popstate (browser back/forward)
    window.addEventListener('popstate', checkUrlChange);

    // Intercept pushState and replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(checkUrlChange, 0);
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(checkUrlChange, 0);
    };
  }

  connectMainWorldBridge();
  initFullscreenListeners();
  initSPANavigationDetection();
  requestInitialConfig();

  api.runtime.onMessage.addListener((message) => {
    handleBackgroundMessage(message);
  });
}());
