/* Specter background worker
 * Manages settings, spoofing policy, logging, allowlist logic, and popup/options messaging.
 */
const hasBrowserAPI = typeof browser !== 'undefined';
const api = hasBrowserAPI ? browser : chrome;

const LAST_ERROR_KEY = 'specter:lastError';
const TAB_STATE_KEY = 'specter:tabState';
let lastErrorDetails = null;

const clone = typeof structuredClone === 'function'
  ? (value) => structuredClone(value)
  : (value) => JSON.parse(JSON.stringify(value));

const SETTINGS_KEY = 'settings';
const LOG_LIMIT = 600;
const API_EVENT_LIMIT = 200;
const HEATMAP_LIMIT = 400;

/* Debug logging utility with log levels */
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let currentLogLevel = LOG_LEVELS.warn; // Default: only errors and warnings

function debugLog(level, context, message, data = null) {
  if (LOG_LEVELS[level] > currentLogLevel) return;
  const timestamp = new Date().toISOString();
  const prefix = `[Specter ${level.toUpperCase()}]`;
  const formatted = `${prefix} [${context}] ${message}`;

  switch (level) {
    case 'error':
      console.error(formatted, data || '');
      break;
    case 'warn':
      console.warn(formatted, data || '');
      break;
    case 'info':
      console.info(formatted, data || '');
      break;
    case 'debug':
      console.debug(formatted, data || '');
      break;
  }
}

/* Tab state persistence for service worker reliability.
 * Session storage survives worker restarts but not browser restarts, so a tab ID
 * reused after a browser restart cannot inherit a stale override.
 */
let tabStatePersistTimer = null;
const TAB_STATE_PERSIST_DELAY = 500;
const tabStateArea = api.storage?.session?.set ? api.storage.session : api.storage?.local;

async function persistTabState() {
  if (!tabStateArea?.set) return;
  await tabStateReady;
  const serialized = {};
  tabState.forEach((value, key) => {
    // Only persist meaningful state (overrides, not transient data)
    if (value.override || value.pausedReason) {
      serialized[key] = {
        override: value.override || null,
        pausedReason: value.pausedReason || null,
        url: value.url || null
      };
    }
  });
  try {
    await tabStateArea.set({ [TAB_STATE_KEY]: serialized });
    debugLog('debug', 'persistTabState', `Persisted ${Object.keys(serialized).length} tab states`);
  } catch (err) {
    debugLog('warn', 'persistTabState', 'Failed to persist tab state', err);
  }
}

function flushTabStatePersist() {
  if (!tabStatePersistTimer) return;
  clearTimeout(tabStatePersistTimer);
  tabStatePersistTimer = null;
  persistTabState();
}

function queueTabStatePersist() {
  if (tabStatePersistTimer) return;
  tabStatePersistTimer = setTimeout(() => {
    tabStatePersistTimer = null;
    persistTabState();
  }, TAB_STATE_PERSIST_DELAY);
}

async function restoreTabState() {
  if (!tabStateArea?.get) return;
  try {
    const stored = await tabStateArea.get(TAB_STATE_KEY);
    const data = stored?.[TAB_STATE_KEY];
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([tabId, saved]) => {
        const numericId = Number(tabId);
        if (!Number.isInteger(numericId) || numericId <= 0 || !saved) return;
        // Tab events handled while the restore was pending describe newer state.
        tabState.set(numericId, {
          override: saved.override || null,
          pausedReason: saved.pausedReason || null,
          url: saved.url || null,
          ...tabState.get(numericId)
        });
      });
      debugLog('info', 'restoreTabState', `Restored ${Object.keys(data).length} tab states`);
    }
  } catch (err) {
    debugLog('warn', 'restoreTabState', 'Failed to restore tab state', err);
  }
  if (tabStateArea !== api.storage?.local) {
    // Releases before 1.1.1 kept tab state in local storage, where it outlived the tabs.
    Promise.resolve(api.storage?.local?.remove?.(TAB_STATE_KEY)).catch(() => { });
  }
}

const DEFAULT_SETTINGS = {
  version: 1,
  globalEnabled: true,
  telemetryEnabled: false,
  activityLogging: false,
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
  allowlist: [],
  logs: [],
  apiEvents: [],
  heatmap: {},
  theme: {
    mode: 'auto',
    seed: '#1b4ed8',
    dynamic: true,
    palettes: null
  },
  font: 'system',
  elementFocusBlocking: false,
  autoReloadOnActivation: false,
  pauseInFullscreen: false,
  holdFullscreen: true,
  allowClipboard: true,
  lastSchema: 3
};

// Schema 3 replaced the Chromatic Registration defaults with the T3-style
// interface. Only untouched old defaults move; custom choices are kept.
const SCHEMA_2_DEFAULTS = { seed: '#007c91', font: 'ubuntu' };

let settingsCache = null;
const tabState = new Map();
// Every worker start, not only browser startup, must restore overrides before
// the first policy push; otherwise a suspended worker forgets per-tab choices.
const tabStateReady = restoreTabState();

function clearFullscreenPauses() {
  tabState.forEach((entry, tabId) => {
    if (entry.pausedReason === 'fullscreen') {
      entry.pausedReason = null;
      tabState.set(tabId, entry);
    }
  });
}

async function restoreLastErrorFromStorage() {
  if (!api.storage?.local?.get) return;
  await new Promise((resolve) => {
    try {
      api.storage.local.get(LAST_ERROR_KEY, (stored) => {
        if (stored && stored[LAST_ERROR_KEY]) {
          lastErrorDetails = stored[LAST_ERROR_KEY];
        }
        resolve();
      });
    } catch (err) {
      resolve();
    }
  });
}

function detectHeadlessEnvironment() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const webdriver = typeof navigator !== 'undefined' && Boolean(navigator.webdriver);
  const headlessHint = /HeadlessChrome|HeadlessShell/i.test(ua);
  const displayMissing = typeof screen === 'undefined';
  return Boolean(webdriver || headlessHint || displayMissing);
}

function detectBrowserEnvironment() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isGecko = typeof api?.runtime?.getBrowserInfo === 'function';
  const isCromite = /Cromite/i.test(ua);
  const isChromium = /Chromium/i.test(ua) && !isCromite;
  const isChrome = /Chrome\//.test(ua) && !isChromium && !/Edg\//.test(ua) && !isCromite;
  const supportsCommandLineLoading = !isChrome;
  const guidance = isChrome && !supportsCommandLineLoading
    ? 'Chrome blocks --load-extension. Use chrome://extensions → Developer mode → Load unpacked.'
    : '';
  return {
    userAgent: ua,
    isGecko,
    isChrome,
    isChromium,
    isCromite,
    supportsCommandLineLoading,
    headless: detectHeadlessEnvironment(),
    guidance
  };
}

function handleExtensionError(error, context = 'unknown', options = {}) {
  const message = error?.message || String(error || 'Unknown error');
  if (
    message.includes('Receiving end does not exist') ||
    message.includes('The message port closed before a response was received')
  ) {
    // Benign transient messaging error (tab/frame closed or no listener). Ignore.
    return error;
  }
  const details = {
    message,
    stack: error.stack || null,
    context,
    timestamp: new Date().toISOString(),
    environment: detectBrowserEnvironment()
  };
  lastErrorDetails = details;
  try {
    console.error('Specter error:', details.message, details);
  } catch (_) {
    // In some browsers console may stringify poorly; fall back to minimal log
    console.error('Specter error:', details.message);
  }
  try {
    const result = api.storage?.local?.set({ [LAST_ERROR_KEY]: details });
    if (result && typeof result.catch === 'function') {
      result.catch(() => { });
    }
  } catch (storageErr) {
    console.warn('Specter could not persist error details', storageErr);
  }
  if (options.rethrow) {
    throw error;
  }
  return details;
}

const LEGACY_MAIN_WORLD_ID = 'specter-main-world';
let legacyMainWorldCleanup = null;

function isMissingRegisteredScriptError(error) {
  const message = error?.message || String(error || '');
  return /nonexistent script id|not registered|no (?:registered )?script|does not exist/i.test(message);
}

function unregisterLegacyMainWorld() {
  if (legacyMainWorldCleanup) return legacyMainWorldCleanup;
  legacyMainWorldCleanup = (async () => {
    const scripting = api.scripting;
    if (!scripting?.unregisterContentScripts) return;

    if (scripting.getRegisteredContentScripts) {
      try {
        const registered = await scripting.getRegisteredContentScripts({ ids: [LEGACY_MAIN_WORLD_ID] });
        if (!registered?.some((script) => script.id === LEGACY_MAIN_WORLD_ID)) return;
      } catch (error) {
        if (isMissingRegisteredScriptError(error)) return;
        handleExtensionError(error, 'find-legacy-main-world');
        return;
      }
    }

    try {
      await scripting.unregisterContentScripts({ ids: [LEGACY_MAIN_WORLD_ID] });
    } catch (error) {
      if (!isMissingRegisteredScriptError(error)) {
        handleExtensionError(error, 'unregister-legacy-main-world');
      }
    }
  })();
  return legacyMainWorldCleanup;
}

function sendTabMessage(tabId, message, options = {}, retryCount = 0) {
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 100;

  const doSend = () => {
    if (hasBrowserAPI && api?.tabs?.sendMessage) {
      return api.tabs.sendMessage(tabId, message, options);
    }
    return new Promise((resolve, reject) => {
      try {
        api.tabs.sendMessage(tabId, message, options, (response) => {
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
  };

  return doSend().catch((err) => {
    const errMsg = err?.message || String(err || '');
    // A closed port means a listener received the message without replying.
    if (/message port closed/i.test(errMsg)) return undefined;
    const retryable = /receiving end does not exist/i.test(errMsg);
    if (retryCount < MAX_RETRIES && retryable) {
      debugLog('debug', 'sendTabMessage', `Retry ${retryCount + 1}/${MAX_RETRIES} for tab ${tabId}`);
      return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)))
        .then(() => sendTabMessage(tabId, message, options, retryCount + 1));
    }
    throw err;
  });
}

const runtimePort = {
  sendStatusUpdate(payload) {
    const msg = { type: 'specter:state-updated', payload };
    try {
      const maybePromise = api.runtime.sendMessage(msg, () => {
        // Swallow lastError if present (no listeners etc.)
        void (api.runtime && api.runtime.lastError);
      });
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => { });
      }
    } catch (err) {
      // Ignore; background may emit when no receivers exist
    }
  }
};

async function ensureSettings() {
  if (settingsCache) {
    return settingsCache;
  }
  const stored = await api.storage.local.get(SETTINGS_KEY);
  settingsCache = migrateSettings(stored[SETTINGS_KEY]);
  if (!stored[SETTINGS_KEY]) {
    await api.storage.local.set({ [SETTINGS_KEY]: settingsCache });
  }
  return settingsCache;
}

function migrateSettings(existing) {
  if (!existing) {
    return clone(DEFAULT_SETTINGS);
  }
  const next = clone(DEFAULT_SETTINGS);
  const merged = { ...next, ...existing };
  merged.fakeActivity = { ...next.fakeActivity, ...(existing.fakeActivity || {}) };
  merged.decoyTiming = { ...next.decoyTiming, ...(existing.decoyTiming || {}) };
  merged.theme = { ...next.theme, ...(existing.theme || {}) };
  merged.theme.palettes = existing?.theme?.palettes || null;
  merged.allowlist = Array.isArray(existing.allowlist) ? existing.allowlist : [];
  merged.logs = Array.isArray(existing.logs) ? existing.logs.slice(-LOG_LIMIT) : [];
  merged.apiEvents = Array.isArray(existing.apiEvents) ? existing.apiEvents.slice(-API_EVENT_LIMIT) : [];
  merged.heatmap = typeof existing.heatmap === 'object' && existing.heatmap ? trimHeatmap(existing.heatmap) : {};
  merged.activityLogging = Boolean(existing.activityLogging);
  merged.telemetryEnabled = Boolean(existing.telemetryEnabled);
  merged.font = existing.font || next.font;
  if (!(Number(existing.lastSchema) >= 3)) {
    if (typeof merged.theme.seed !== 'string' || merged.theme.seed.toLowerCase() === SCHEMA_2_DEFAULTS.seed) {
      merged.theme.seed = next.theme.seed;
      merged.theme.palettes = null;
    }
    if (merged.font === SCHEMA_2_DEFAULTS.font) merged.font = next.font;
  }
  merged.elementFocusBlocking = typeof existing.elementFocusBlocking === 'boolean'
    ? existing.elementFocusBlocking
    : next.elementFocusBlocking;
  merged.autoReloadOnActivation = typeof existing.autoReloadOnActivation === 'boolean'
    ? existing.autoReloadOnActivation
    : next.autoReloadOnActivation;
  merged.pauseInFullscreen = typeof existing.pauseInFullscreen === 'boolean'
    ? existing.pauseInFullscreen
    : next.pauseInFullscreen;
  merged.holdFullscreen = typeof existing.holdFullscreen === 'boolean'
    ? existing.holdFullscreen
    : next.holdFullscreen;
  merged.allowClipboard = typeof existing.allowClipboard === 'boolean'
    ? existing.allowClipboard
    : next.allowClipboard;
  merged.version = next.version;
  merged.lastSchema = next.lastSchema;
  cleanAllowlist(merged);
  return merged;
}

async function saveSettings(updater) {
  const current = await ensureSettings();
  const next = typeof updater === 'function' ? updater(clone(current)) : updater;
  // A queued activity snapshot must not overwrite this explicit user save.
  deferredPending = null;
  if (deferredTimer) {
    clearTimeout(deferredTimer);
    deferredTimer = null;
  }
  settingsCache = next;
  await api.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

let deferredTimer = null;
let deferredPending = null;
function queueSettingsSave(settings) {
  settingsCache = settings;
  deferredPending = settings;
  if (deferredTimer) {
    return;
  }
  deferredTimer = setTimeout(() => {
    flushQueuedSettings();
  }, 750);
}

function flushQueuedSettings() {
  if (!deferredPending) {
    if (deferredTimer) {
      clearTimeout(deferredTimer);
      deferredTimer = null;
    }
    return;
  }
  const snapshot = deferredPending;
  deferredPending = null;
  if (deferredTimer) {
    clearTimeout(deferredTimer);
    deferredTimer = null;
  }
  try {
    api.storage.local.set({ [SETTINGS_KEY]: snapshot }, () => {
      const err = api.runtime?.lastError;
      if (err) {
        handleExtensionError(err, 'flushQueuedSettings');
      }
    });
  } catch (err) {
    handleExtensionError(err, 'flushQueuedSettings');
  }
}

function cleanAllowlist(settings) {
  const now = Date.now();
  settings.allowlist = (settings.allowlist || []).filter((entry) => {
    if (!entry || typeof entry.pattern !== 'string') return false;
    if (entry.expiresAt && entry.expiresAt <= now) {
      return false;
    }
    return Boolean(entry.pattern);
  });
}

function isSupportedPageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
  } catch (err) {
    return false;
  }
}

function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || '';
  } catch (err) {
    return '';
  }
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (err) {
    return '';
  }
}

function sanitizeLoggedUrl(url) {
  return getOrigin(url) || '';
}

function wildcardToRegex(pattern) {
  if (!pattern) {
    return null;
  }
  const safe = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${safe.replace(/\\\*/g, '.*')}$`, 'i');
}

function matchesAllowlist(url, allowlist) {
  const domain = getDomain(url);
  const origin = getOrigin(url);
  const now = Date.now();
  for (const entry of allowlist) {
    if (!entry || !entry.pattern) continue;
    if (entry.expiresAt && entry.expiresAt <= now) continue;
    const isOrigin = entry.scope === 'origin';
    const testTarget = isOrigin ? origin : domain;
    let matcherValue = isOrigin
      ? getOrigin(entry.pattern) || entry.pattern.replace(/\/$/, '')
      : entry.pattern.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (!isOrigin && matcherValue.startsWith('*.')) {
      const rootDomain = matcherValue.slice(2).toLowerCase();
      if (domain.toLowerCase() === rootDomain || domain.toLowerCase().endsWith(`.${rootDomain}`)) {
        return { entry, domain };
      }
      continue;
    }
    const regex = wildcardToRegex(matcherValue);
    if (regex && regex.test(testTarget)) {
      return { entry, domain };
    }
  }
  return null;
}

function clamp(value, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.min(Math.max(num, min), max);
}

function computeBadge(context) {
  if (!context.spoofingEnabled) {
    if (context.pausedReason || context.allowlisted) {
      return { text: 'P', color: '#806000' };
    }
    return { text: 'OFF', color: '#50575c' };
  }
  return { text: 'ON', color: '#00785f' };
}

async function buildTabContext(tabId, url) {
  await tabStateReady;
  const settings = await ensureSettings();
  const state = tabState.get(tabId) || {};
  const allowHit = url ? matchesAllowlist(url, settings.allowlist) : null;
  const allowlisted = Boolean(allowHit);
  const pausedReason = state.pausedReason || null;
  let spoofingEnabled = Boolean(settings.globalEnabled && !pausedReason && !allowlisted);
  if (state.override === 'force-off') {
    spoofingEnabled = false;
  } else if (state.override === 'force-on' && settings.globalEnabled && !pausedReason && !allowlisted) {
    spoofingEnabled = true;
  }
  // Fullscreen hold and clipboard stay available while the only pause is fullscreen.
  let surfaceChannels = Boolean(settings.globalEnabled && !allowlisted && state.override !== 'force-off');
  if (pausedReason && pausedReason !== 'fullscreen') surfaceChannels = false;
  const domain = url ? getDomain(url) : '';
  const badge = computeBadge({ spoofingEnabled, allowlisted, pausedReason });
  const context = {
    tabId,
    url,
    domain,
    spoofingEnabled,
    pausedReason,
    allowlisted,
    allowEntry: allowHit?.entry || null,
    override: state.override || null,
    heatmapCount: (settings.heatmap[domain]?.hits) || 0,
    fakeActivity: settings.fakeActivity,
    decoyTiming: settings.decoyTiming,
    loggingEnabled: settings.activityLogging,
    telemetryEnabled: settings.telemetryEnabled,
    elementFocusBlocking: settings.elementFocusBlocking,
    autoReloadOnActivation: settings.autoReloadOnActivation,
    globalEnabled: settings.globalEnabled,
    holdFullscreen: Boolean(settings.holdFullscreen && surfaceChannels),
    allowClipboard: Boolean(settings.allowClipboard && surfaceChannels),
    badge
  };
  return context;
}

async function tabConfigForContent(tabId, url) {
  const context = await buildTabContext(tabId, url);
  const settings = await ensureSettings();
  const config = {
    spoofingEnabled: context.spoofingEnabled,
    blockEvents: !context.allowlisted && context.spoofingEnabled,
    fakeActivity: settings.fakeActivity,
    decoyTiming: settings.decoyTiming,
    loggingEnabled: settings.activityLogging,
    heatmapEnabled: true,
    elementFocusBlocking: settings.elementFocusBlocking,
    autoReloadOnActivation: settings.autoReloadOnActivation,
    holdFullscreen: context.holdFullscreen,
    allowClipboard: context.allowClipboard,
    tabId,
    pausedReason: context.pausedReason,
    allowlisted: context.allowlisted
  };
  return { config, context };
}

async function pushConfigToTab(tabId) {
  const state = tabState.get(tabId);
  if (!state || !state.url) return;
  const { config, context } = await tabConfigForContent(tabId, state.url);
  try {
    // Omitting frameId reaches every frame in the tab, including frames that
    // loaded before this worker instance started.
    await sendTabMessage(tabId, { type: 'specter:apply-config', config, context });
  } catch (err) {
    const message = err?.message || '';
    if (!/receiving end does not exist|the frame/i.test(message)) {
      handleExtensionError(err, 'push-config');
    }
  }
  updateBadge(tabId, context.badge);
  runtimePort.sendStatusUpdate({ tabId, context });
}

function updateBadge(tabId, badge) {
  try {
    api.action.setBadgeText({ tabId, text: badge.text });
    api.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  } catch (err) {
    /* ignore */
  }
}

function getDiagnosticsSnapshot() {
  return {
    tabCount: tabState.size,
    environment: detectBrowserEnvironment(),
    lastError: lastErrorDetails
  };
}

async function forgetTab(tabId) {
  await tabStateReady;
  tabState.delete(tabId);
  updateBadge(tabId, { text: '', color: '#64748b' });
}

async function refreshAllTabs() {
  if (!api.tabs?.query) return;
  await tabStateReady;
  const tabs = await api.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.id < 0) continue;
    if (!isSupportedPageUrl(tab.url)) {
      await forgetTab(tab.id);
      continue;
    }
    tabState.set(tab.id, { ...(tabState.get(tab.id) || {}), url: tab.url });
    await pushConfigToTab(tab.id);
  }
}

function logEvent(settings, payload) {
  if (!settings.activityLogging) {
    return settings;
  }
  const next = { ...settings };
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    ...payload
  };
  next.logs = [...(next.logs || []), entry].slice(-LOG_LIMIT);
  return next;
}

function updateHeatmap(settings, domain, delta) {
  if (!domain) return;
  const map = settings.heatmap || {};
  const existing = map[domain] || { hits: 0, blockedEvents: 0, fakeBursts: 0, lastEvent: 0 };
  map[domain] = {
    hits: existing.hits + (delta.hits || 0),
    blockedEvents: existing.blockedEvents + (delta.blockedEvents || 0),
    fakeBursts: existing.fakeBursts + (delta.fakeBursts || 0),
    lastEvent: Date.now()
  };
  const domains = Object.keys(map);
  if (domains.length > HEATMAP_LIMIT) {
    domains
      .sort((a, b) => (map[a].lastEvent || 0) - (map[b].lastEvent || 0))
      .slice(0, domains.length - HEATMAP_LIMIT)
      .forEach((key) => delete map[key]);
  }
  settings.heatmap = map;
}

function trimHeatmap(map) {
  const domains = Object.keys(map || {});
  if (domains.length <= HEATMAP_LIMIT) return map || {};
  const copy = { ...(map || {}) };
  domains
    .sort((a, b) => (copy[a].lastEvent || 0) - (copy[b].lastEvent || 0))
    .slice(0, domains.length - HEATMAP_LIMIT)
    .forEach((key) => delete copy[key]);
  return copy;
}

const TELEMETRY_DETAIL_LIMIT = 2048;
const TELEMETRY_COUNT_LIMIT = 10000;

// Page scripts can forge telemetry, so stored details and counters stay bounded.
function boundTelemetryDetail(detail) {
  let serialized;
  try {
    serialized = JSON.stringify(detail ?? null);
  } catch (err) {
    return { truncated: true };
  }
  if (serialized === undefined || serialized.length <= TELEMETRY_DETAIL_LIMIT) return detail ?? null;
  return { truncated: true, size: serialized.length };
}

function boundTelemetryCount(value) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) ? clamp(num, 0, TELEMETRY_COUNT_LIMIT) : 0;
}

function recordApiEvent(settings, domain, detail) {
  const payload = {
    domain,
    detail,
    ts: Date.now()
  };
  settings.apiEvents = [...(settings.apiEvents || []), payload].slice(-API_EVENT_LIMIT);
}

async function handleContentEvent(message, sender) {
  const settings = await ensureSettings();
  const tabId = sender?.tab?.id;
  const url = sender?.tab?.url || '';
  const domain = getDomain(url);
  if (!tabId) {
    return { ok: false };
  }
  await tabStateReady;
  const detail = message.detail && typeof message.detail === 'object' ? message.detail : {};
  if (message.subtype === 'metrics') {
    if (!settings.activityLogging) return { ok: true };
    recordApiEvent(settings, domain, boundTelemetryDetail(detail));
    queueSettingsSave(settings);
    return { ok: true };
  }
  if (message.subtype === 'spoof-log') {
    // The main world reports blocked and synthetic totals in periodic metrics entries.
    const counts = detail.category === 'metrics' && detail.data && typeof detail.data === 'object' ? detail.data : {};
    updateHeatmap(settings, domain, {
      hits: 1,
      blockedEvents: boundTelemetryCount(counts.blockedListeners) + boundTelemetryCount(counts.blockedHandlers),
      fakeBursts: boundTelemetryCount(counts.syntheticBursts)
    });
    const next = logEvent(settings, {
      tabId,
      domain,
      url: sanitizeLoggedUrl(url),
      category: String(detail.category ?? '').slice(0, 64),
      data: boundTelemetryDetail(detail.data)
    });
    queueSettingsSave(next);
    return { ok: true };
  }
  if (message.subtype === 'fullscreen') {
    if (!settings.pauseInFullscreen) {
      const entry = tabState.get(tabId) || {};
      if (!detail.paused && entry.pausedReason === 'fullscreen') {
        entry.pausedReason = null;
        tabState.set(tabId, entry);
        queueTabStatePersist();
        await pushConfigToTab(tabId);
      }
      debugLog('debug', 'handleContentEvent', 'Fullscreen pause disabled, ignoring fullscreen event');
      return { ok: true };
    }
    const entry = tabState.get(tabId) || {};
    entry.pausedReason = detail.paused ? 'fullscreen' : null;
    tabState.set(tabId, entry);
    queueTabStatePersist();
    await pushConfigToTab(tabId);
    if (detail.paused) {
      const next = logEvent(settings, {
        tabId,
        domain,
        category: 'pause',
        data: { reason: 'fullscreen' }
      });
      queueSettingsSave(next);
    }
    return { ok: true };
  }
  return { ok: false };
}

async function addAllowlistEntry(pattern, scope, durationMinutes) {
  if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 2048 || /\s/.test(pattern.trim())) {
    throw new Error('Enter a site pattern without spaces (up to 2048 characters).');
  }
  if (scope && !['domain', 'origin', 'pattern'].includes(scope)) throw new Error('Choose a valid exception scope.');
  if (durationMinutes != null && (!Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) <= 0)) throw new Error('Choose a positive pause duration.');
  pattern = pattern.trim();
  const settings = await ensureSettings();
  const expiresAt = durationMinutes
    ? Date.now() + Number(durationMinutes) * 60 * 1000
    : null;
  const entry = {
    id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pattern,
    scope: scope || 'domain',
    createdAt: Date.now(),
    expiresAt
  };
  settings.allowlist.push(entry);
  cleanAllowlist(settings);
  await saveSettings(settings);
  await refreshAllTabs();
  return entry;
}

async function removeAllowlistEntry(entryId) {
  const settings = await ensureSettings();
  settings.allowlist = settings.allowlist.filter((item) => item.id !== entryId);
  await saveSettings(settings);
  await refreshAllTabs();
}

async function toggleGlobal(enabled) {
  const settings = await ensureSettings();
  settings.globalEnabled = Boolean(enabled);
  await saveSettings(settings);
  await refreshAllTabs();
  runtimePort.sendStatusUpdate({ globalEnabled: settings.globalEnabled });
  return settings.globalEnabled;
}

async function toggleTabOverride(tabId, mode, desiredEnabled) {
  if (!tabId || tabId < 0) return null;
  await tabStateReady;
  const entry = tabState.get(tabId) || {};
  if (mode === 'explicit' && typeof desiredEnabled === 'boolean') {
    entry.override = desiredEnabled ? 'force-on' : 'force-off';
  } else if (mode === 'clear') {
    entry.override = null;
  } else if (mode === 'cycle') {
    entry.override = entry.override === 'force-off' ? null : 'force-off';
  } else {
    entry.override = mode;
  }
  tabState.set(tabId, entry);
  queueTabStatePersist();
  await pushConfigToTab(tabId);
  return entry.override;
}

async function getDashboardState() {
  const [settings, tabs] = await Promise.all([
    ensureSettings(),
    api.tabs?.query ? api.tabs.query({ active: true, currentWindow: true }) : []
  ]);
  const activeTab = tabs && tabs[0] ? tabs[0] : null;
  let tabContext = null;
  if (activeTab?.id && activeTab.url && isSupportedPageUrl(activeTab.url)) {
    tabState.set(activeTab.id, { ...(tabState.get(activeTab.id) || {}), url: activeTab.url });
    tabContext = await buildTabContext(activeTab.id, activeTab.url);
  }
  return {
    globalEnabled: settings.globalEnabled,
    activityLogging: settings.activityLogging,
    pageUnavailable: Boolean(activeTab && !tabContext),
    allowlistSize: settings.allowlist.length,
    heatmapDomains: Object.keys(settings.heatmap || {}).length,
    logCount: settings.activityLogging ? (settings.logs?.length || 0) : 0,
    logs: settings.activityLogging ? settings.logs.slice(-5) : [],
    tab: tabContext,
    fakeActivity: settings.fakeActivity,
    decoyTiming: settings.decoyTiming,
    theme: settings.theme,
    font: settings.font,
    diagnostics: getDiagnosticsSnapshot()
  };
}

async function getFullSettings() {
  const settings = await ensureSettings();
  return {
    settings,
    diagnostics: getDiagnosticsSnapshot()
  };
}

async function updateSettings(partial) {
  validateSettingsPayload(partial);
  const settings = await ensureSettings();
  if (partial.fakeActivity) {
    const next = partial.fakeActivity;
    settings.fakeActivity = {
      enabled: Boolean(next.enabled),
      min: clamp(next.min, 250, 15000),
      max: clamp(next.max, 250, 15000),
      jitter: clamp(next.jitter, 0, 0.9),
      moveRadius: clamp(next.moveRadius, 4, 64)
    };
    if (settings.fakeActivity.min > settings.fakeActivity.max) {
      [settings.fakeActivity.min, settings.fakeActivity.max] = [settings.fakeActivity.max, settings.fakeActivity.min];
    }
  }
  if (partial.decoyTiming) {
    const next = partial.decoyTiming;
    settings.decoyTiming = {
      enabled: Boolean(next.enabled),
      min: clamp(next.min, 250, 15000),
      max: clamp(next.max, 250, 15000)
    };
    if (settings.decoyTiming.min > settings.decoyTiming.max) {
      [settings.decoyTiming.min, settings.decoyTiming.max] = [settings.decoyTiming.max, settings.decoyTiming.min];
    }
  }
  if (typeof partial.activityLogging === 'boolean') {
    settings.activityLogging = partial.activityLogging;
  }
  if (typeof partial.telemetryEnabled === 'boolean') {
    settings.telemetryEnabled = partial.telemetryEnabled;
  }
  if (partial.theme) {
    settings.theme = { ...settings.theme, ...partial.theme };
  }
  if (partial.font) {
    settings.font = partial.font;
  }
  if (typeof partial.elementFocusBlocking === 'boolean') {
    settings.elementFocusBlocking = partial.elementFocusBlocking;
  }
  if (typeof partial.autoReloadOnActivation === 'boolean') {
    settings.autoReloadOnActivation = partial.autoReloadOnActivation;
  }
  if (typeof partial.pauseInFullscreen === 'boolean') {
    settings.pauseInFullscreen = partial.pauseInFullscreen;
    if (!settings.pauseInFullscreen) {
      clearFullscreenPauses();
      queueTabStatePersist();
    }
  }
  if (typeof partial.holdFullscreen === 'boolean') {
    settings.holdFullscreen = partial.holdFullscreen;
  }
  if (typeof partial.allowClipboard === 'boolean') {
    settings.allowClipboard = partial.allowClipboard;
  }
  await saveSettings(settings);
  await refreshAllTabs();
  return settings;
}

async function handleExport(kind) {
  const settings = await ensureSettings();
  if (kind === 'json') {
    return JSON.stringify({
      version: settings.version,
      exportedAt: new Date().toISOString(),
      schema: settings.lastSchema,
      globalEnabled: settings.globalEnabled,
      activityLogging: settings.activityLogging,
      telemetryEnabled: settings.telemetryEnabled,
      fakeActivity: settings.fakeActivity,
      decoyTiming: settings.decoyTiming,
      theme: settings.theme,
      font: settings.font,
      elementFocusBlocking: settings.elementFocusBlocking,
      autoReloadOnActivation: settings.autoReloadOnActivation,
      pauseInFullscreen: settings.pauseInFullscreen,
      holdFullscreen: settings.holdFullscreen,
      allowClipboard: settings.allowClipboard,
      allowlist: settings.allowlist,
      logs: settings.logs,
      heatmap: settings.heatmap
    }, null, 2);
  }
  if (kind === 'csv') {
    const header = 'timestamp,category,domain,url,details';
    const rows = (settings.logs || []).map((entry) => {
      const payload = JSON.stringify(entry.data || {});
      return [
        new Date(entry.ts).toISOString(),
        entry.category || '',
        entry.domain || '',
        entry.url || '',
        payload.replace(/\"/g, '\"\"')
      ].map((value) => `"${value}"`).join(',');
    });
    return [header, ...rows].join('\n');
  }
  return '';
}

async function handleImport(data) {
  if (typeof data !== 'string' || data.length > 5 * 1024 * 1024) throw new Error('Choose a Specter JSON file smaller than 5 MB.');
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new Error('Invalid JSON import');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Malformed import payload');
  }
  validateSettingsPayload(parsed);
  const known = ['allowlist', 'logs', 'heatmap', 'globalEnabled', 'activityLogging', 'telemetryEnabled', 'fakeActivity', 'decoyTiming', 'theme', 'font', 'elementFocusBlocking', 'autoReloadOnActivation', 'pauseInFullscreen', 'holdFullscreen', 'allowClipboard'];
  if (!known.some((key) => Object.hasOwn(parsed, key))) throw new Error('This file contains no Specter settings.');
  // Validate before touching the cached settings so a rejected import is atomic.
  const settings = clone(await ensureSettings());
  if (Array.isArray(parsed.allowlist)) {
    settings.allowlist = parsed.allowlist.map((entry) => ({
      id: entry.id || `wl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pattern: entry.pattern,
      scope: entry.scope || 'domain',
      createdAt: entry.createdAt || Date.now(),
      expiresAt: entry.expiresAt || null
    }));
  }
  if (Array.isArray(parsed.logs)) {
    settings.logs = parsed.logs.slice(-LOG_LIMIT);
  }
  if (parsed.heatmap) {
    settings.heatmap = trimHeatmap(parsed.heatmap);
  }
  if (typeof parsed.globalEnabled === 'boolean') {
    settings.globalEnabled = parsed.globalEnabled;
  }
  if (typeof parsed.activityLogging === 'boolean') {
    settings.activityLogging = parsed.activityLogging;
  }
  if (typeof parsed.telemetryEnabled === 'boolean') {
    settings.telemetryEnabled = parsed.telemetryEnabled;
  }
  if (typeof parsed.elementFocusBlocking === 'boolean') {
    settings.elementFocusBlocking = parsed.elementFocusBlocking;
  }
  if (typeof parsed.autoReloadOnActivation === 'boolean') {
    settings.autoReloadOnActivation = parsed.autoReloadOnActivation;
  }
  if (typeof parsed.pauseInFullscreen === 'boolean') {
    settings.pauseInFullscreen = parsed.pauseInFullscreen;
    if (!settings.pauseInFullscreen) {
      clearFullscreenPauses();
      queueTabStatePersist();
    }
  }
  if (typeof parsed.holdFullscreen === 'boolean') {
    settings.holdFullscreen = parsed.holdFullscreen;
  }
  if (typeof parsed.allowClipboard === 'boolean') {
    settings.allowClipboard = parsed.allowClipboard;
  }
  if (parsed.fakeActivity) {
    const next = parsed.fakeActivity;
    settings.fakeActivity = {
      enabled: Boolean(next.enabled),
      min: clamp(next.min, 250, 15000),
      max: clamp(next.max, 250, 15000),
      jitter: clamp(next.jitter, 0, 0.9),
      moveRadius: clamp(next.moveRadius, 4, 64)
    };
    if (settings.fakeActivity.min > settings.fakeActivity.max) {
      [settings.fakeActivity.min, settings.fakeActivity.max] = [settings.fakeActivity.max, settings.fakeActivity.min];
    }
  }
  if (parsed.decoyTiming) {
    const next = parsed.decoyTiming;
    settings.decoyTiming = {
      enabled: Boolean(next.enabled),
      min: clamp(next.min, 250, 15000),
      max: clamp(next.max, 250, 15000)
    };
    if (settings.decoyTiming.min > settings.decoyTiming.max) {
      [settings.decoyTiming.min, settings.decoyTiming.max] = [settings.decoyTiming.max, settings.decoyTiming.min];
    }
  }
  if (parsed.theme) {
    settings.theme = { ...settings.theme, ...parsed.theme };
  }
  if (typeof parsed.font === 'string') {
    settings.font = parsed.font;
  }
  await saveSettings(settings);
  await refreshAllTabs();
}

function validateSettingsPayload(payload) {
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!record(payload)) throw new Error('Settings must be a JSON object.');
  for (const key of ['globalEnabled', 'activityLogging', 'telemetryEnabled', 'elementFocusBlocking', 'autoReloadOnActivation', 'pauseInFullscreen', 'holdFullscreen', 'allowClipboard']) {
    if (Object.hasOwn(payload, key) && typeof payload[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  }
  for (const key of ['fakeActivity', 'decoyTiming', 'theme']) {
    if (Object.hasOwn(payload, key) && !record(payload[key])) throw new Error(`${key} must be an object.`);
  }
  for (const key of ['fakeActivity', 'decoyTiming']) {
    const value = payload[key];
    if (!value) continue;
    if (Object.hasOwn(value, 'enabled') && typeof value.enabled !== 'boolean') throw new Error(`${key}.enabled must be true or false.`);
    for (const field of ['min', 'max', 'jitter', 'moveRadius']) {
      if (Object.hasOwn(value, field) && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) throw new Error(`${key}.${field} must be a finite number.`);
    }
  }
  if (payload.theme) {
    if (Object.hasOwn(payload.theme, 'seed') && (typeof payload.theme.seed !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(payload.theme.seed))) throw new Error('Theme accent must be a three- or six-digit hex color.');
    if (Object.hasOwn(payload.theme, 'mode') && !['auto', 'light', 'dark'].includes(payload.theme.mode)) throw new Error('Choose a system, light, or dark theme.');
  }
  if (Object.hasOwn(payload, 'font') && !['ubuntu', 'system', 'mono'].includes(payload.font)) throw new Error('Choose a supported interface typeface.');
  if (Object.hasOwn(payload, 'allowlist')) {
    if (!Array.isArray(payload.allowlist)) throw new Error('Site exceptions must be a list.');
    payload.allowlist.forEach((entry, index) => {
      if (!record(entry) || typeof entry.pattern !== 'string' || !entry.pattern.trim() || entry.pattern.length > 2048 || /\s/.test(entry.pattern.trim())) throw new Error(`Site exception ${index + 1} needs a valid pattern.`);
      if (entry.scope && !['domain', 'origin', 'pattern'].includes(entry.scope)) throw new Error(`Site exception ${index + 1} has an invalid scope.`);
      for (const key of ['createdAt', 'expiresAt']) {
        if (entry[key] != null && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || entry[key] < 0)) throw new Error(`Site exception ${index + 1} has an invalid date.`);
      }
    });
  }
  if (Object.hasOwn(payload, 'logs')) {
    if (!Array.isArray(payload.logs) || payload.logs.some((entry) => !record(entry) || !Number.isFinite(entry.ts) || !Number.isFinite(new Date(entry.ts).getTime()) || typeof entry.category !== 'string')) throw new Error('Event records need a valid timestamp and category.');
  }
  if (Object.hasOwn(payload, 'heatmap')) {
    if (!record(payload.heatmap)) throw new Error('Site activity must be an object.');
    for (const [domain, entry] of Object.entries(payload.heatmap)) {
      if (['__proto__', 'prototype', 'constructor'].includes(domain) || !record(entry)) throw new Error('Site activity contains an invalid domain or record.');
      for (const key of ['hits', 'blockedEvents', 'fakeBursts', 'lastEvent']) {
        if (entry[key] != null && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || entry[key] < 0)) throw new Error(`Site activity ${key} must be a nonnegative number.`);
      }
    }
  }
}

async function resetHeatmap() {
  const settings = await ensureSettings();
  settings.heatmap = {};
  await saveSettings(settings);
}

async function clearLogs() {
  const settings = await ensureSettings();
  settings.logs = [];
  settings.apiEvents = [];
  await saveSettings(settings);
}

api.runtime.onInstalled.addListener(() => {
  unregisterLegacyMainWorld();
  ensureSettings().then(() => refreshAllTabs());
});

api.runtime.onStartup?.addListener(() => {
  unregisterLegacyMainWorld();
  ensureSettings().then(() => refreshAllTabs());
});

api.tabs?.onRemoved?.addListener((tabId) => {
  tabStateReady.then(() => {
    tabState.delete(tabId);
    queueTabStatePersist();
  });
});

api.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (!tabId || tabId < 0) return;
  if (changeInfo.status === 'loading' || changeInfo.url) {
    const url = changeInfo.url || tab?.url;
    if (!url || !isSupportedPageUrl(url)) {
      forgetTab(tabId);
      return;
    }
    tabState.set(tabId, { ...(tabState.get(tabId) || {}), url });
    pushConfigToTab(tabId);
  }
});

api.tabs?.onActivated?.addListener(async ({ tabId }) => {
  if (!tabId || tabId < 0) return;
  try {
    const tab = await api.tabs.get(tabId);
    if (!tab?.url || !isSupportedPageUrl(tab.url)) {
      await forgetTab(tabId);
      return;
    }
    tabState.set(tab.id, { ...(tabState.get(tab.id) || {}), url: tab.url });
    pushConfigToTab(tab.id);
  } catch (error) {
    // tab can disappear quickly when switching; ignore transient failures
  }
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (promise) => {
    promise
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        handleExtensionError(error, 'runtime-message');
        sendResponse({ ok: false, error: error.message || 'Unknown error' });
      });
  };

  switch (message?.type) {
    case 'specter:get-dashboard':
      respond(getDashboardState());
      return true;
    case 'specter:get-settings':
      respond(getFullSettings());
      return true;
    case 'specter:toggle-global':
      respond(toggleGlobal(message.enabled));
      return true;
    case 'specter:toggle-tab': {
      // The popup names its target tab; sender.tab is the popup itself when it is opened as a tab.
      const tabId = Number.isInteger(message.tabId) && message.tabId > 0 ? message.tabId : sender?.tab?.id;
      if (tabId) {
        respond(toggleTabOverride(tabId, message.mode || 'cycle', message.enabled));
      } else {
        sendResponse({ ok: false, error: 'Missing tab id' });
      }
      return true;
    }
    case 'specter:allow-site':
      respond(addAllowlistEntry(message.pattern, message.scope, message.durationMinutes));
      return true;
    case 'specter:remove-allow':
      respond(removeAllowlistEntry(message.id));
      return true;
    case 'specter:update-settings':
      respond(updateSettings(message.payload || {}));
      return true;
    case 'specter:export':
      respond(handleExport(message.format));
      return true;
    case 'specter:import':
      respond(handleImport(message.data));
      return true;
    case 'specter:reset-heatmap':
      respond(resetHeatmap());
      return true;
    case 'specter:clear-logs':
      respond(clearLogs());
      return true;
    case 'specter:content-ready': {
      const tabId = sender?.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false });
        return false;
      }
      const url = sender.tab.url;
      tabState.set(tabId, { ...(tabState.get(tabId) || {}), url });
      respond((async () => {
        const { config, context } = await tabConfigForContent(tabId, url);
        return { config, context };
      })());
      return true;
    }
    case 'specter:page-event':
      respond(handleContentEvent(message, sender));
      return true;
    default:
      break;
  }
  return false;
});

async function handleCommand(command) {
  try {
    if (command === 'toggle-global') {
      const settings = await ensureSettings();
      await toggleGlobal(!settings.globalEnabled);
      return;
    }
    if (command === 'toggle-tab') {
      if (!api.tabs?.query) return;
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (!activeTab?.id || !activeTab.url || !isSupportedPageUrl(activeTab.url)) {
        return;
      }
      tabState.set(activeTab.id, { ...(tabState.get(activeTab.id) || {}), url: activeTab.url });
      const context = await buildTabContext(activeTab.id, activeTab.url);
      if (!context.globalEnabled || context.allowlisted || context.pausedReason) {
        return;
      }
      const baseEnabled = Boolean(context.globalEnabled && !context.pausedReason && !context.allowlisted);
      const desired = !context.spoofingEnabled;
      let mode = 'explicit';
      let enabled = desired;
      if (desired === baseEnabled) {
        mode = 'clear';
        enabled = undefined;
      }
      await toggleTabOverride(activeTab.id, mode, enabled);
    }
  } catch (error) {
    handleExtensionError(error, 'command-handler');
  }
}

api.commands?.onCommand?.addListener((command) => {
  handleCommand(command);
});

refreshAllTabs();
unregisterLegacyMainWorld();
restoreLastErrorFromStorage();
api.runtime.onSuspend?.addListener(() => {
  flushQueuedSettings();
  flushTabStatePersist();
});
