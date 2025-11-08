/* Specter background worker
 * Manages settings, spoofing policy, logging, allowlist logic, and popup/options messaging.
 */
const hasBrowserAPI = typeof browser !== 'undefined';
const api = hasBrowserAPI ? browser : chrome;

const LAST_ERROR_KEY = 'specter:lastError';
let lastErrorDetails = null;

const clone = typeof structuredClone === 'function'
  ? (value) => structuredClone(value)
  : (value) => JSON.parse(JSON.stringify(value));

const SETTINGS_KEY = 'settings';
const LOG_LIMIT = 600;
const API_EVENT_LIMIT = 200;
const HEATMAP_LIMIT = 400;

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
    seed: '#4ad6ff',
    dynamic: true,
    palettes: null
  },
  font: 'roboto',
  elementFocusBlocking: false,
  autoReloadOnActivation: false,
  lastSchema: 1
};

let settingsCache = null;
const tabState = new Map();
const frameRegistry = new Map();

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
  const isCromite = /Cromite/i.test(ua);
  const isChromium = /Chromium/i.test(ua) && !isCromite;
  const isChrome = /Chrome\//.test(ua) && !isChromium && !/Edg\//.test(ua) && !isCromite;
  const supportsCommandLineLoading = !isChrome;
  const guidance = isChrome && !supportsCommandLineLoading
    ? 'Chrome blocks --load-extension. Use chrome://extensions → Developer mode → Load unpacked.'
    : '';
  return {
    userAgent: ua,
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
      result.catch(() => {});
    }
  } catch (storageErr) {
    console.warn('Specter could not persist error details', storageErr);
  }
  if (options.rethrow) {
    throw error;
  }
  return details;
}

async function registerMainWorld() {
  if (!api.scripting || !api.scripting.registerContentScripts) {
    return;
  }
  try {
    await api.scripting.registerContentScripts([{
      id: 'specter-main-world',
      matches: ['<all_urls>'],
      js: ['injected/main-world.js'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
      world: 'MAIN'
    }]);
  } catch (error) {
    const msg = (error && error.message) ? error.message : String(error || '');
    if (msg.includes('already registered') || msg.includes('Duplicate script')) {
      return;
    }
    handleExtensionError(error, 'register-main-world');
  }
}

function sendTabMessage(tabId, message, options = {}) {
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
        maybePromise.catch(() => {});
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
  merged.heatmap = typeof existing.heatmap === 'object' && existing.heatmap ? existing.heatmap : {};
  merged.activityLogging = Boolean(existing.activityLogging);
  merged.telemetryEnabled = Boolean(existing.telemetryEnabled);
  merged.font = existing.font || next.font;
  merged.elementFocusBlocking = typeof existing.elementFocusBlocking === 'boolean'
    ? existing.elementFocusBlocking
    : next.elementFocusBlocking;
  merged.autoReloadOnActivation = typeof existing.autoReloadOnActivation === 'boolean'
    ? existing.autoReloadOnActivation
    : next.autoReloadOnActivation;
  merged.elementFocusBlocking = typeof existing.elementFocusBlocking === 'boolean'
    ? existing.elementFocusBlocking
    : next.elementFocusBlocking;
  merged.version = next.version;
  merged.lastSchema = next.lastSchema;
  cleanAllowlist(merged);
  return merged;
}

async function saveSettings(updater) {
  const current = await ensureSettings();
  const next = typeof updater === 'function' ? updater(clone(current)) : updater;
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
    if (entry.expiresAt && entry.expiresAt <= now) {
      return false;
    }
    return Boolean(entry.pattern);
  });
}

function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || '';
  } catch (err) {
    return '';
  }
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
  const now = Date.now();
  for (const entry of allowlist) {
    if (!entry || !entry.pattern) continue;
    if (entry.expiresAt && entry.expiresAt <= now) continue;
    const target = entry.scope === 'origin' ? url : domain;
    const testTarget = entry.scope === 'origin' ? url : domain;
    const matcherValue = entry.scope === 'origin' ? entry.pattern : entry.pattern.replace(/^https?:\/\//i, '');
    const regex = wildcardToRegex(matcherValue);
    if (regex && regex.test(testTarget || target)) {
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
    if (context.pausedReason) {
      return { text: 'P', color: '#f7b500' };
    }
    return { text: 'OFF', color: '#64748b' };
  }
  if (context.allowlisted) {
    return { text: 'WL', color: '#34d399' };
  }
  return { text: 'ON', color: '#4ad6ff' };
}

async function buildTabContext(tabId, url) {
  const settings = await ensureSettings();
  const state = tabState.get(tabId) || {};
  const allowHit = url ? matchesAllowlist(url, settings.allowlist) : null;
  const allowlisted = Boolean(allowHit);
  const pausedReason = state.pausedReason || null;
  let spoofingEnabled = Boolean(settings.globalEnabled && !pausedReason && !allowlisted);
  if (state.override === 'force-off') {
    spoofingEnabled = false;
  } else if (state.override === 'force-on') {
    spoofingEnabled = true;
  }
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
    badge
  };
  return context;
}

function registerFrame(tabId, frameId = 0) {
  if (!tabId || tabId < 0) return;
  const frames = frameRegistry.get(tabId) || new Set();
  frames.add(typeof frameId === 'number' ? frameId : 0);
  frameRegistry.set(tabId, frames);
}

function getFrames(tabId) {
  const frames = frameRegistry.get(tabId);
  if (!frames || !frames.size) {
    return [0];
  }
  return Array.from(frames);
}

function pruneFrames(tabId) {
  frameRegistry.delete(tabId);
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
  const frames = getFrames(tabId);
  await Promise.all(frames.map(async (frameId) => {
    try {
      await sendTabMessage(tabId, { type: 'specter:apply-config', config, context }, { frameId });
    } catch (err) {
      const message = err?.message || '';
      if (api.runtime.lastError || message.includes('Receiving end does not exist')) {
        return;
      }
      if (message.includes('The frame')) {
        return;
      }
      handleExtensionError(err, 'push-config');
    }
  }));
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

async function refreshAllTabs() {
  if (!api.tabs?.query) return;
  const tabs = await api.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.id < 0) continue;
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
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
  registerFrame(tabId, sender?.frameId ?? 0);
  if (message.subtype === 'metrics') {
    recordApiEvent(settings, domain, message.detail);
    queueSettingsSave(settings);
    return { ok: true };
  }
  if (message.subtype === 'spoof-log') {
    updateHeatmap(settings, domain, {
      hits: 1,
      blockedEvents: message.detail.blocked ? 1 : 0,
      fakeBursts: message.detail.synthetic ? 1 : 0
    });
    const next = logEvent(settings, {
      tabId,
      domain,
      url,
      category: message.detail.category,
      data: message.detail.data
    });
    queueSettingsSave(next);
    return { ok: true };
  }
  if (message.subtype === 'fullscreen') {
    const entry = tabState.get(tabId) || {};
    entry.pausedReason = message.detail.paused ? 'fullscreen' : null;
    tabState.set(tabId, entry);
    await pushConfigToTab(tabId);
    if (message.detail.paused) {
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
  return entry;
}

async function removeAllowlistEntry(entryId) {
  const settings = await ensureSettings();
  settings.allowlist = settings.allowlist.filter((item) => item.id !== entryId);
  await saveSettings(settings);
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
  if (activeTab?.id && activeTab.url) {
    tabState.set(activeTab.id, { ...(tabState.get(activeTab.id) || {}), url: activeTab.url });
    tabContext = await buildTabContext(activeTab.id, activeTab.url);
  }
  return {
    globalEnabled: settings.globalEnabled,
    allowlistSize: settings.allowlist.length,
    heatmapDomains: Object.keys(settings.heatmap || {}).length,
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
    return [header, ...rows].join('\\n');
  }
  return '';
}

async function handleImport(data) {
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new Error('Invalid JSON import');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Malformed import payload');
  }
  const settings = await ensureSettings();
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
    settings.heatmap = parsed.heatmap;
  }
  await saveSettings(settings);
  await refreshAllTabs();
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
  registerMainWorld();
  ensureSettings().then(() => refreshAllTabs());
});

api.runtime.onStartup?.addListener(() => {
  registerMainWorld();
  ensureSettings().then(() => refreshAllTabs());
});

api.tabs?.onRemoved?.addListener((tabId) => {
  tabState.delete(tabId);
  pruneFrames(tabId);
});

api.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (!tabId || tabId < 0) return;
  if (changeInfo.status === 'loading' || changeInfo.url) {
    const url = changeInfo.url || tab?.url;
    if (!url) {
      tabState.delete(tabId);
      pruneFrames(tabId);
      return;
    }
    if (changeInfo.status === 'loading') {
      pruneFrames(tabId);
    }
    tabState.set(tabId, { ...(tabState.get(tabId) || {}), url });
    pushConfigToTab(tabId);
  }
});

api.tabs?.onActivated?.addListener(({ tabId }) => {
  if (!tabId || tabId < 0) return;
  pushConfigToTab(tabId);
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
    case 'specter:toggle-tab':
      if (sender?.tab?.id) {
        respond(toggleTabOverride(sender.tab.id, message.mode || 'cycle', message.enabled));
      } else if (message.tabId) {
        respond(toggleTabOverride(message.tabId, message.mode || 'cycle', message.enabled));
      }
      return true;
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
      registerFrame(tabId, sender?.frameId ?? 0);
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

refreshAllTabs();
registerMainWorld();
restoreLastErrorFromStorage();
api.runtime.onSuspend?.addListener(() => {
  flushQueuedSettings();
});
