/* Specter content script
 * Injects main-world hooks, relays configs, and manages fullscreen pauses.
 */
(function SpecterContent() {
  if (window.__specterContentLoaded) return;
  window.__specterContentLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const state = {
    config: null,
    context: null,
    ready: false,
    overlay: null,
    fullscreen: false,
    reloadScheduled: false
  };

  const usePromiseAPI = typeof browser !== 'undefined' && api === browser;

  function sendMessage(payload) {
    if (usePromiseAPI) {
      return api.runtime.sendMessage(payload);
    }
    return new Promise((resolve, reject) => {
      try {
        api.runtime.sendMessage(payload, (response) => {
          const err = api.runtime.lastError;
          if (err) {
            reject(err);
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function injectMainWorld() {
    const script = document.createElement('script');
    script.src = api.runtime.getURL('injected/main-world.js');
    script.type = 'text/javascript';
    script.dataset.specter = 'main';
    script.addEventListener('load', () => script.remove());
    (document.head || document.documentElement).appendChild(script);
  }

  function dispatchConfig() {
    if (!state.config) return;
    window.dispatchEvent(new CustomEvent('specter:update-config', {
      detail: {
        config: state.config,
        context: state.context
      }
    }));
    if (state.context?.autoReloadOnActivation && state.context.spoofingEnabled && !state.reloadScheduled) {
      state.reloadScheduled = true;
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (error) {
          /* ignore reload issues */
        }
      }, 150);
    }
  }

  function requestInitialConfig() {
    sendMessage({ type: 'specter:content-ready' }).then((payload) => {
      if (!payload || !payload.config) return;
      state.config = payload.config;
      state.context = payload.context || null;
      dispatchConfig();
      state.ready = true;
      updateOverlay();
    }).catch(() => {});
  }

  function handleBackgroundMessage(message) {
    if (!message || message.type !== 'specter:apply-config') return;
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
    const shouldShow = Boolean(state.fullscreen);
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
    }).catch(() => {});
  }

  function initFullscreenListeners() {
    document.addEventListener('fullscreenchange', handleFullscreenChange, true);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange, true);
  }

  function bridgePageEvents() {
    window.addEventListener('specter:page-event', (event) => {
      if (!event || !event.detail) return;
      sendMessage({
        type: 'specter:page-event',
        subtype: event.detail.subtype,
        detail: event.detail.detail || {}
      }).catch(() => {});
    });
  }

  function respondToPageRequests() {
    window.addEventListener('specter:request-config', () => {
      dispatchConfig();
    });
  }

  injectMainWorld();
  bridgePageEvents();
  respondToPageRequests();
  initFullscreenListeners();
  requestInitialConfig();

  api.runtime.onMessage.addListener((message) => {
    handleBackgroundMessage(message);
  });
}());
