const api = typeof browser !== 'undefined' ? browser : chrome;
const usePromiseAPI = typeof browser !== 'undefined' && api === browser;
const state = {
  dashboard: null,
  refreshTimer: null
};

const COLOR_KEYS = ['--accent', '--accent-strong', '--accent-soft', '--accent-ink', '--focus', '--selection'];

function sendMessage(message) {
  if (usePromiseAPI) {
    return api.runtime.sendMessage(message).then((response) => {
      if (!response) throw new Error('No response');
      if (response.ok) return response.result;
      throw new Error(response.error || 'Request failed');
    });
  }
  return new Promise((resolve, reject) => {
    try {
      api.runtime.sendMessage(message, (response) => {
        const err = api.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        if (!response) {
          reject(new Error('No response'));
          return;
        }
        if (response.ok) {
          resolve(response.result);
        } else {
          reject(new Error(response.error || 'Request failed'));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function toast(message, timeout = 2400) {
  const el = document.getElementById('popupToast');
  if (!el) return;
  el.textContent = message;
  el.dataset.visible = 'true';
  setTimeout(() => {
    el.dataset.visible = 'false';
  }, timeout);
}

function injectPalette(palettes) {
  const id = 'specter-dynamic-theme';
  let style = document.getElementById(id);
  if (!palettes) {
    if (style) style.remove();
    return;
  }
  const light = palettes.light || {};
  const dark = palettes.dark || {};
  const serialize = (set) => COLOR_KEYS.map((key) => {
    if (!set[key]) return '';
    return `${key}:${set[key]};`;
  }).join('');
  const sheet = [`:root{${serialize(light)}}`, `:root[data-theme='dark']{${serialize(dark)}}`, `@media(prefers-color-scheme: dark){:root:not([data-theme='light']){${serialize(dark)}}}`].join('');
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = sheet;
}

function normalizeHex(color) {
  const fallback = '#2449d8';
  if (!/^#?[0-9a-f]{3,6}$/i.test(String(color || ''))) return fallback;
  let hex = String(color).replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((value) => value + value).join('');
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

function mix(colorA, colorB, ratio) {
  const parse = (hex) => {
    const value = parseInt(normalizeHex(hex).slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = parse(colorA);
  const b = parse(colorB);
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * ratio).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function onColor(hex) {
  const value = parseInt(normalizeHex(hex).slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.5 ? '#101820' : '#ffffff';
}

function buildPalette(seedColor) {
  const seed = normalizeHex(seedColor);
  return {
    light: {
      '--accent': seed,
      '--accent-strong': mix(seed, '#000000', .24),
      '--accent-soft': mix(seed, '#ffffff', .84),
      '--accent-ink': onColor(seed),
      '--focus': seed,
      '--selection': mix(seed, '#ffffff', .72)
    },
    dark: {
      '--accent': mix(seed, '#ffffff', .48),
      '--accent-strong': mix(seed, '#ffffff', .68),
      '--accent-soft': mix(seed, '#111820', .66),
      '--accent-ink': '#0c1830',
      '--focus': '#b8f33d',
      '--selection': mix(seed, '#111820', .48)
    }
  };
}

function applyTheme(theme, font) {
  const root = document.documentElement;
  if (theme?.mode && theme.mode !== 'auto') {
    root.dataset.theme = theme.mode;
  } else {
    root.removeAttribute('data-theme');
  }
  root.dataset.font = ['ubuntu', 'system', 'mono'].includes(font) ? font : 'ubuntu';
  injectPalette(buildPalette(theme?.seed || '#2449d8'));
}

function formatDomain(url) {
  if (!url) return 'Unknown origin';
  try {
    const { hostname } = new URL(url);
    return hostname;
  } catch (err) {
    return url;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function updateUI() {
  const data = state.dashboard;
  const tab = data?.tab;
  const globalSwitch = document.getElementById('globalSwitch');
  const tabSwitch = document.getElementById('tabSwitch');
  const tabTitle = document.getElementById('tabTitle');
  const tabUrl = document.getElementById('tabUrl');
  const stateChipLabel = document.getElementById('stateChipLabel');
  const activityChip = document.getElementById('activityChip');
  const globalStatusText = document.getElementById('globalStatusText');
  const tabStateLabel = document.getElementById('tabStateLabel');
  const quickFacts = document.getElementById('quickFacts');
  const allowButton = document.getElementById('allowButton');
  const statusDot = document.getElementById('statusDot');
  const reloadBanner = document.getElementById('reloadBanner');
  const factTrackers = document.getElementById('factTrackers');
  const factRequests = document.getElementById('factRequests');
  const factData = document.getElementById('factData');

  const globalEnabled = Boolean(data?.globalEnabled);
  document.documentElement.dataset.protection = tab?.spoofingEnabled ? 'active' : (tab?.allowlisted ? 'paused' : 'off');
  globalSwitch.setAttribute('aria-checked', String(globalEnabled));
  if (globalStatusText) {
    globalStatusText.textContent = globalEnabled ? 'Protection on' : 'Protection off';
  }

  if (tab?.spoofingEnabled) {
    statusDot.dataset.state = 'active';
  } else if (tab?.allowlisted) {
    statusDot.dataset.state = 'paused';
  } else {
    statusDot.dataset.state = 'off';
  }

  if (tab) {
    tabTitle.textContent = tab.domain || 'Active tab';
    tabUrl.textContent = tab.url || formatDomain(tab.url);
    if (tab.allowlisted) {
      stateChipLabel.textContent = 'Protection paused';
    } else if (tab.pausedReason) {
      stateChipLabel.textContent = `Paused: ${tab.pausedReason}`;
    } else if (tab.spoofingEnabled) {
      stateChipLabel.textContent = 'Protection active';
    } else {
      stateChipLabel.textContent = globalEnabled ? 'Protection off for tab' : 'Protection off';
    }
    tabStateLabel.textContent = tab.spoofingEnabled
      ? 'Keeps this page active when you switch tabs.'
      : 'This page can detect when you switch away.';
    tabSwitch.removeAttribute('disabled');
    tabSwitch.setAttribute('aria-checked', String(Boolean(tab.spoofingEnabled)));
    allowButton.disabled = Boolean(tab.allowlisted);
    const allowButtonLabel = allowButton.querySelector('span:last-child');
    if (allowButtonLabel) {
      allowButtonLabel.textContent = tab.allowlisted ? 'Site is paused' : 'Pause on this site';
    }
  } else {
    tabTitle.textContent = 'No active tab';
    tabUrl.textContent = 'Open a supported page to begin.';
    stateChipLabel.textContent = 'Waiting for a page';
    tabStateLabel.textContent = 'Waiting for an active tab.';
    tabSwitch.setAttribute('aria-checked', 'false');
    tabSwitch.setAttribute('disabled', 'true');
    allowButton.disabled = true;
  }

  const heatmapDomains = data?.heatmapDomains || 0;
  const logTotal = typeof data?.logCount === 'number' ? data.logCount : (data?.logs?.length || 0);
  const allowlistSize = data?.allowlistSize || 0;
  if (activityChip) {
    activityChip.textContent = heatmapDomains ? `${formatNumber(heatmapDomains)} sites observed` : 'No activity yet';
  }
  if (quickFacts) {
    quickFacts.dataset.ready = 'true';
  }
  if (factTrackers) {
    factTrackers.textContent = formatNumber(heatmapDomains);
  }
  if (factRequests) {
    factRequests.textContent = formatNumber(logTotal);
  }
  if (factData) {
    factData.textContent = formatNumber(allowlistSize);
  }

  if (reloadBanner) {
    const shouldShowReloadHint = Boolean(tab?.autoReloadOnActivation && tab?.spoofingEnabled && tab?.allowlisted === false);
    reloadBanner.hidden = !shouldShowReloadHint;
  }
}

async function loadDashboard() {
  try {
    const result = await sendMessage({ type: 'specter:get-dashboard' });
    state.dashboard = result || {};
    applyTheme(state.dashboard.theme, state.dashboard.font);
    updateUI();
  } catch (error) {
    toast(error.message || 'Unable to load state');
  }
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(loadDashboard, 250);
}

async function toggleGlobal() {
  const enabled = !(state.dashboard?.globalEnabled);
  try {
    await sendMessage({ type: 'specter:toggle-global', enabled });
    toast(enabled ? 'Specter enabled' : 'Specter disabled');
    scheduleRefresh();
  } catch (error) {
    toast(error.message || 'Unable to toggle Specter');
  }
}

async function toggleTab() {
  const tab = state.dashboard?.tab;
  if (!tab?.tabId) {
    toast('No tab available');
    return;
  }
  const baseEnabled = Boolean(state.dashboard.globalEnabled && !tab.pausedReason && !tab.allowlisted);
  const desired = !tab.spoofingEnabled;
  let mode = 'explicit';
  let enabled = desired;

  if (desired === baseEnabled) {
    mode = 'clear';
    enabled = undefined;
  } else if (!desired && tab.override === 'force-on' && !baseEnabled) {
    mode = 'clear';
    enabled = undefined;
  }

  try {
    const payload = {
      type: 'specter:toggle-tab',
      tabId: tab.tabId,
      mode
    };
    if (typeof enabled === 'boolean') {
      payload.enabled = enabled;
    }
    await sendMessage(payload);
    toast('Updated tab protection');
    scheduleRefresh();
  } catch (error) {
    toast(error.message || 'Unable to update tab');
  }
}

function computeAllowPattern() {
  const tab = state.dashboard?.tab;
  if (!tab?.domain) return null;
  return tab.domain;
}

async function allowCurrentSite(durationMinutes) {
  const pattern = computeAllowPattern();
  if (!pattern) {
    toast('Unable to detect domain');
    return;
  }
  try {
    await sendMessage({
      type: 'specter:allow-site',
      pattern,
      scope: 'domain',
      durationMinutes: durationMinutes ? Number(durationMinutes) : null
    });
    toast('Protection paused for this site');
    scheduleRefresh();
  } catch (error) {
    toast(error.message || 'Allowlist failed');
  }
}

function openOptions() {
  if (typeof api.runtime.openOptionsPage === 'function') {
    api.runtime.openOptionsPage();
  } else {
    const url = api.runtime.getURL('options/options.html');
    api.tabs.create({ url });
  }
}

function isGeckoFamily() {
  return typeof api.runtime?.getBrowserInfo === 'function';
}

function openShortcuts() {
  const ua = navigator.userAgent || '';
  let url = 'chrome://extensions/shortcuts';
  if (isGeckoFamily()) {
    url = 'about:addons';
  } else if (/edg\//i.test(ua)) {
    url = 'edge://extensions/shortcuts';
  } else if (/opr\//i.test(ua)) {
    url = 'opera://extensions/shortcuts';
  }

  const handleError = () => toast('Open shortcuts page manually');
  try {
    const result = api.tabs.create({ url });
    if (result && typeof result.catch === 'function') {
      result.catch(handleError);
    }
  } catch (error) {
    handleError(error);
  }
}

function focusActiveTab() {
  const tab = state.dashboard?.tab;
  if (!tab?.tabId || !api.tabs?.update) return;
  try {
    api.tabs.update(tab.tabId, { active: true });
  } catch (error) {
    toast('Unable to focus tab');
  }
}

function initEvents() {
  document.getElementById('globalSwitch').addEventListener('click', toggleGlobal);
  document.getElementById('tabSwitch').addEventListener('click', toggleTab);
  document.getElementById('allowForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = form.duration.value;
    allowCurrentSite(value || null);
  });
  document.getElementById('openOptions').addEventListener('click', openOptions);
  document.getElementById('openShortcuts').addEventListener('click', openShortcuts);
  document.getElementById('popupMenu')?.addEventListener('click', openOptions);
  document.getElementById('activeTabOpen')?.addEventListener('click', focusActiveTab);
  api.runtime.onMessage.addListener((message) => {
    if (message?.type === 'specter:state-updated') {
      scheduleRefresh();
    }
  });
}

initEvents();
loadDashboard();
