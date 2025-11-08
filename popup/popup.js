const api = typeof browser !== 'undefined' ? browser : chrome;
const usePromiseAPI = typeof browser !== 'undefined' && api === browser;
const state = {
  dashboard: null,
  refreshTimer: null
};

const COLOR_KEYS = [
  '--md3-primary',
  '--md3-on-primary',
  '--md3-primary-container',
  '--md3-on-primary-container',
  '--md3-secondary',
  '--md3-on-secondary',
  '--md3-secondary-container',
  '--md3-on-secondary-container',
  '--md3-tertiary',
  '--md3-on-tertiary',
  '--md3-tertiary-container',
  '--md3-on-tertiary-container',
  '--md3-surface',
  '--md3-surface-container',
  '--md3-surface-container-low',
  '--md3-surface-container-high',
  '--md3-surface-container-highest',
  '--md3-surface-tint',
  '--md3-on-surface',
  '--md3-on-surface-variant',
  '--md3-outline',
  '--md3-outline-variant',
  '--md3-error',
  '--md3-on-error',
  '--md3-error-container',
  '--md3-on-error-container',
  '--md3-inverse-surface',
  '--md3-inverse-on-surface',
  '--md3-inverse-primary'
];

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

function applyTheme(theme, font) {
  const root = document.documentElement;
  if (theme?.mode && theme.mode !== 'auto') {
    root.dataset.theme = theme.mode;
  } else {
    root.removeAttribute('data-theme');
  }
  root.dataset.font = font || 'roboto';
  injectPalette(theme?.palettes || null);
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

function updateUI() {
  const data = state.dashboard;
  const tab = data?.tab;
  const globalSwitch = document.getElementById('globalSwitch');
  const tabSwitch = document.getElementById('tabSwitch');
  const tabTitle = document.getElementById('tabTitle');
  const tabUrl = document.getElementById('tabUrl');
  const stateChip = document.getElementById('stateChip');
  const heatmapChip = document.getElementById('heatmapChip');
  const tabStateLabel = document.getElementById('tabStateLabel');
  const logCount = document.getElementById('logCount');
  const heatmapCount = document.getElementById('heatmapCount');
  const activityState = document.getElementById('activityState');
  const allowButton = document.getElementById('allowButton');
  const subtitle = document.getElementById('appSubtitle');
  const statusDot = document.getElementById('statusDot');
  const reloadBanner = document.getElementById('reloadBanner');

  const globalEnabled = Boolean(data?.globalEnabled);
  globalSwitch.setAttribute('aria-checked', String(globalEnabled));
  subtitle.textContent = globalEnabled ? 'Guarding tabs' : 'Protection paused globally';

  if (tab?.spoofingEnabled) {
    statusDot.style.background = 'var(--md3-primary)';
    statusDot.style.boxShadow = '0 0 10px rgba(74,214,255,0.8)';
  } else if (tab?.allowlisted) {
    statusDot.style.background = 'var(--md3-secondary)';
    statusDot.style.boxShadow = '0 0 6px rgba(111,124,138,0.6)';
  } else {
    statusDot.style.background = 'var(--md3-outline)';
    statusDot.style.boxShadow = 'none';
  }

  if (tab) {
    tabTitle.textContent = tab.domain || 'Active tab';
    tabUrl.textContent = formatDomain(tab.url);
    const states = [];
    if (tab.allowlisted) {
      states.push('Allowlisted');
    } else if (tab.pausedReason) {
      states.push(`Paused – ${tab.pausedReason}`);
    } else if (tab.spoofingEnabled) {
      states.push('Active');
    } else {
      states.push('Neutral');
    }
    stateChip.textContent = states.join(' ');
    tabStateLabel.textContent = tab.spoofingEnabled ? 'Spoofing & event cloaking active' : 'Protection disabled for this tab';
    tabSwitch.removeAttribute('disabled');
    tabSwitch.setAttribute('aria-checked', String(Boolean(tab.spoofingEnabled)));
    allowButton.disabled = Boolean(tab.allowlisted);
  } else {
    tabTitle.textContent = 'No active tab';
    tabUrl.textContent = 'Focus a permitted page to manage Specter.';
    stateChip.textContent = 'Idle';
    tabStateLabel.textContent = 'Waiting for active tab context';
    tabSwitch.setAttribute('aria-checked', 'false');
    tabSwitch.setAttribute('disabled', 'true');
    allowButton.disabled = true;
  }

  const heatmapDomains = data?.heatmapDomains || 0;
  heatmapChip.textContent = `Heatmap — ${heatmapDomains} domains`;
  logCount.textContent = (data?.logs?.length || 0).toString();
  heatmapCount.textContent = heatmapDomains.toString();
  activityState.textContent = data?.fakeActivity?.enabled ? 'On' : 'Off';

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
  if (/^\*\./.test(tab.domain)) {
    return tab.domain;
  }
  if (/localhost|^\d+\.\d+/.test(tab.domain)) {
    return tab.domain;
  }
  return `*.${tab.domain}`;
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
    toast('Site added to allowlist');
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

function openShortcuts() {
  const ua = navigator.userAgent || '';
  const url = /firefox/i.test(ua) ? 'about:addons' : 'chrome://extensions/shortcuts';
  const handleError = (err) => {
    if (err && err.message) {
      toast('Open shortcuts manually');
    }
  };
  try {
    const result = api.tabs.create({ url }, () => {
      const lastError = api.runtime && api.runtime.lastError;
      if (lastError) {
        toast('Open shortcuts page manually');
      }
    });
    if (result && typeof result.catch === 'function') {
      result.catch(handleError);
    }
  } catch (error) {
    toast('Open shortcuts page manually');
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
  api.runtime.onMessage.addListener((message) => {
    if (message?.type === 'specter:state-updated') {
      scheduleRefresh();
    }
  });
}

initEvents();
loadDashboard();
