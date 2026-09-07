const api = typeof browser !== 'undefined' ? browser : chrome;
const usePromiseAPI = typeof browser !== 'undefined' && api === browser;
const state = {
  dashboard: null,
  refreshTimer: null,
  busy: false,
  loadOperation: 0,
  toastTimer: null
};

const { applyTheme, buildPalette } = SpecterTheme;

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
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.dataset.visible = 'false';
  }, timeout);
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
  const paused = Boolean(tab?.allowlisted || tab?.pausedReason);
  const canToggleTab = Boolean(tab && globalEnabled && !paused && !state.busy);
  document.documentElement.dataset.protection = tab?.spoofingEnabled ? 'active' : (paused ? 'paused' : 'off');
  globalSwitch.disabled = !data || state.busy;
  document.getElementById('activeTabOpen').disabled = !tab;
  document.getElementById('scopeGlobal').textContent = globalEnabled ? 'On' : 'Off';
  document.getElementById('scopeSite').textContent = tab ? (tab.allowlisted ? 'Paused' : 'Ready') : '—';
  document.getElementById('scopeTab').textContent = tab ? (tab.spoofingEnabled ? 'On' : 'Off') : '—';
  globalSwitch.setAttribute('aria-checked', String(globalEnabled));
  if (globalStatusText) {
    globalStatusText.textContent = globalEnabled ? 'Protection on' : 'Protection off';
  }

  if (tab?.spoofingEnabled) {
    statusDot.dataset.state = 'active';
  } else if (paused) {
    statusDot.dataset.state = 'paused';
  } else {
    statusDot.dataset.state = 'off';
  }

  if (tab) {
    tabTitle.textContent = tab.domain || 'Local file';
    tabTitle.title = tab.domain || 'Local file';
    tabUrl.textContent = tab.url || formatDomain(tab.url);
    tabUrl.title = tab.url || '';
    if (tab.allowlisted) {
      stateChipLabel.textContent = 'Protection paused';
    } else if (tab.pausedReason) {
      stateChipLabel.textContent = `Paused: ${tab.pausedReason}`;
    } else if (tab.spoofingEnabled) {
      stateChipLabel.textContent = 'Protection active';
    } else {
      stateChipLabel.textContent = globalEnabled ? 'Protection off for tab' : 'Protection off';
    }
    document.getElementById('tabControlTitle').textContent = tab.spoofingEnabled ? 'Tab protected' : paused ? 'Protection paused' : 'Tab unprotected';
    tabStateLabel.textContent = !globalEnabled ? 'Turn on global protection above to enable this tab.'
      : tab.allowlisted ? `An exception applies to ${tab.allowEntry?.pattern || 'this site'}.`
      : tab.pausedReason === 'fullscreen' ? 'Protection resumes when you leave fullscreen.'
      : tab.pausedReason ? 'Protection is temporarily paused.'
      : tab.spoofingEnabled ? 'Visibility and focus are protected when you switch away.'
      : 'Turn on this tab to protect its visibility and focus.';
    tabSwitch.disabled = !canToggleTab;
    tabSwitch.setAttribute('aria-checked', String(Boolean(tab.spoofingEnabled)));
    allowButton.disabled = !tab.domain || state.busy;
    document.getElementById('allowDuration').disabled = tab.allowlisted || state.busy || !tab.domain;
    const allowButtonLabel = allowButton.querySelector('span:last-child');
    if (allowButtonLabel) {
      allowButtonLabel.textContent = tab.allowlisted ? (canResumeSite() ? 'Resume this site' : 'Manage exception') : 'Pause this site';
    }
  } else {
    tabTitle.textContent = data?.pageUnavailable ? 'Browser-controlled page' : 'No active tab';
    tabUrl.textContent = 'Open a website to use tab protection.';
    stateChipLabel.textContent = 'Protection unavailable here';
    document.getElementById('tabControlTitle').textContent = 'Open a website';
    tabStateLabel.textContent = 'Browser settings and other protected pages cannot run Specter.';
    tabSwitch.setAttribute('aria-checked', 'false');
    tabSwitch.setAttribute('disabled', 'true');
    allowButton.disabled = true;
    document.getElementById('allowDuration').disabled = true;
  }

  const heatmapDomains = data?.heatmapDomains || 0;
  const logTotal = typeof data?.logCount === 'number' ? data.logCount : (data?.logs?.length || 0);
  const allowlistSize = data?.allowlistSize || 0;
  if (activityChip) {
    activityChip.textContent = data?.activityLogging ? 'Local logging on' : 'Local logging off';
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
  const operation = ++state.loadOperation;
  try {
    const result = await sendMessage({ type: 'specter:get-dashboard' });
    if (operation !== state.loadOperation) return;
    state.dashboard = result || {};
    document.getElementById('loadError').hidden = true;
    applyTheme(state.dashboard.theme, state.dashboard.font);
    updateUI();
  } catch (error) {
    if (operation !== state.loadOperation) return;
    state.dashboard = null;
    updateUI();
    document.getElementById('loadErrorText').textContent = 'Unable to read Specter’s current state. Try again or reload the extension.';
    document.getElementById('loadError').hidden = false;
  }
}

async function runAction(action) {
  if (state.busy || !state.dashboard) return;
  state.busy = true;
  updateUI();
  try { await action(); }
  finally {
    await loadDashboard();
    state.busy = false;
    updateUI();
  }
}

function canResumeSite() {
  const tab = state.dashboard?.tab;
  return Boolean(tab?.allowEntry?.id && tab.allowEntry.scope === 'domain' && tab.allowEntry.pattern === tab.domain);
}

async function changeSitePause(duration) {
  const tab = state.dashboard?.tab;
  if (!tab?.allowlisted) return allowCurrentSite(duration);
  if (!canResumeSite()) return api.tabs.create({ url: api.runtime.getURL('options/options.html#allowlist') });
  try {
    await sendMessage({ type: 'specter:remove-allow', id: tab.allowEntry.id });
    toast('Site exception removed');
  } catch (error) { toast(error.message || 'Unable to resume this site'); }
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
  document.getElementById('globalSwitch').addEventListener('click', () => runAction(toggleGlobal));
  document.getElementById('tabSwitch').addEventListener('click', () => runAction(toggleTab));
  document.getElementById('retryLoad').addEventListener('click', loadDashboard);
  document.getElementById('allowForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = form.duration.value;
    runAction(() => changeSitePause(value || null));
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
