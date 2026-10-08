const api = typeof browser !== 'undefined' ? browser : chrome;
const usePromiseAPI = typeof browser !== 'undefined' && api === browser;
const state = {
  settings: null,
  diagnostics: null,
  commands: [],
  dirtyForms: new Set(),
  pending: false,
  loadOperation: 0,
  logLimit: 50,
  siteLimit: 50,
  toastTimer: null
};

const { applyTheme, buildPalette } = SpecterTheme;

const refs = {
  heroGlobal: document.getElementById('heroGlobal'),
  heroAllow: document.getElementById('heroAllow'),
  heroHeatmap: document.getElementById('heroHeatmap'),
  heroTime: document.getElementById('heroTime'),
  globalSwitch: document.getElementById('generalGlobal'),
  loggingSwitch: document.getElementById('loggingSwitch'),
  elementSwitch: document.getElementById('elementSwitch'),
  autoReloadSwitch: document.getElementById('autoReloadSwitch'),
  fullscreenPauseSwitch: document.getElementById('fullscreenPauseSwitch'),
  holdFullscreenSwitch: document.getElementById('holdFullscreenSwitch'),
  clipboardSwitch: document.getElementById('clipboardSwitch'),
  allowTable: document.querySelector('#allowlistTable tbody'),
  fakeForm: document.getElementById('fakeActivityForm'),
  fakeSwitch: document.getElementById('fakeActivitySwitch'),
  decoyForm: document.getElementById('decoyForm'),
  decoySwitch: document.getElementById('decoySwitch'),
  appearanceForm: document.getElementById('appearanceForm'),
  themePreview: document.getElementById('themePreview'),
  logList: document.getElementById('logList'),
  heatmapTable: document.querySelector('#heatmapTable tbody'),
  toast: document.getElementById('optionsToast'),
  envBrowser: document.getElementById('envBrowser'),
  envHeadless: document.getElementById('envHeadless'),
  envSupport: document.getElementById('envSupport'),
  envGuidance: document.getElementById('envGuidance'),
  envError: document.getElementById('envError'),
  envCopy: document.getElementById('envCopy'),
  aboutVersion: document.getElementById('aboutVersion'),
  footerVersion: document.getElementById('footerVersion'),
  globalShortcut: document.getElementById('globalShortcut'),
  tabShortcut: document.getElementById('tabShortcut'),
  shortcutGuidance: document.getElementById('shortcutGuidance'),
  manageShortcuts: document.getElementById('manageShortcuts'),
  importDrop: document.getElementById('importDrop'),
  modeToggle: document.getElementById('modeToggle'),
  sectionNav: document.getElementById('sectionNav'),
  sectionButtons: document.querySelectorAll('[data-section-target]'),
  sectionPanels: document.querySelectorAll('[data-section-panel]'),
  openShortcutHelp: document.getElementById('openShortcutHelp'),
  footerImport: document.getElementById('footerImport'),
  footerExport: document.getElementById('footerExport'),
  protectionStatusText: document.getElementById('protectionStatusText')
};

refs.globalLamp = document.getElementById('globalLamp');
refs.overviewState = document.getElementById('overviewState');
refs.overviewDetail = document.getElementById('overviewDetail');

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

function toast(message, timeout = 2600) {
  refs.toast.textContent = message;
  refs.toast.dataset.visible = 'true';
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    refs.toast.dataset.visible = 'false';
  }, timeout);
}

function getCommands() {
  if (!api.commands?.getAll) return Promise.resolve([]);
  if (usePromiseAPI) {
    return api.commands.getAll().catch(() => []);
  }
  return new Promise((resolve) => {
    try {
      api.commands.getAll((commands) => {
        resolve(api.runtime.lastError ? [] : (commands || []));
      });
    } catch (_) {
      resolve([]);
    }
  });
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isNaN(number) ? min : Math.min(Math.max(number, min), max);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function setSwitch(element, value) {
  if (!element) return;
  element.setAttribute('aria-checked', String(Boolean(value)));
}

function renderHero() {
  const settings = state.settings;
  const heatmapEntries = Object.values(settings.heatmap || {});
  const siteCount = heatmapEntries.length;
  const trackerCount = heatmapEntries.reduce((total, entry) => total + (Number(entry?.hits) || 0), 0);
  const requestCount = heatmapEntries.reduce((total, entry) => total + (Number(entry?.blockedEvents) || 0), 0);
  refs.heroGlobal.textContent = formatNumber(siteCount);
  refs.heroAllow.textContent = formatNumber(trackerCount);
  refs.heroHeatmap.textContent = formatNumber(requestCount);
  if (refs.heroTime) {
    refs.heroTime.textContent = formatNumber(settings.allowlist?.length || 0);
  }
  if (refs.protectionStatusText) {
    refs.protectionStatusText.textContent = settings.globalEnabled ? 'Protection on' : 'Protection off';
  }
  if (refs.overviewState) {
    refs.overviewState.textContent = settings.globalEnabled ? 'Protection is on' : 'Protection is off';
  }
  if (refs.overviewDetail) {
    refs.overviewDetail.textContent = settings.globalEnabled
      ? 'Supported pages see an active, visible tab unless a rule below turns it off.'
      : 'Pages see real visibility and focus changes. Turn protection on to hide them.';
  }
  if (refs.globalLamp) {
    refs.globalLamp.dataset.state = settings.globalEnabled ? 'active' : 'off';
  }
  document.documentElement.dataset.protection = settings.globalEnabled ? 'active' : 'off';
  setSwitch(refs.globalSwitch, settings.globalEnabled);
  setSwitch(refs.loggingSwitch, settings.activityLogging);
  setSwitch(refs.elementSwitch, settings.elementFocusBlocking);
  setSwitch(refs.autoReloadSwitch, settings.autoReloadOnActivation);
  setSwitch(refs.fullscreenPauseSwitch, settings.pauseInFullscreen);
  setSwitch(refs.holdFullscreenSwitch, settings.holdFullscreen);
  setSwitch(refs.clipboardSwitch, settings.allowClipboard);
}

function renderAllowlist() {
  const tbody = refs.allowTable;
  const entries = [...state.settings.allowlist].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4">No exceptions yet. Add a site above to pause protection there.</td></tr>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const expires = entry.expiresAt ? formatExpiry(entry.expiresAt) : 'Never';
    const row = document.createElement('tr');
    row.dataset.entry = String(entry.id);

    for (const value of [entry.pattern, entry.scope, expires]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }

    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.dataset.remove = '';
    button.setAttribute('aria-label', `Remove ${entry.pattern}`);
    button.title = 'Remove exception';

    button.textContent = 'Remove';
    actionCell.append(button);
    row.append(actionCell);
    fragment.append(row);
  }
  tbody.replaceChildren(fragment);
}

function formatExpiry(timestamp) {
  const remaining = Number(timestamp) - Date.now();
  if (remaining <= 0) return 'Expired';
  const minutes = Math.round(remaining / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

function renderFakeActivity() {
  const fake = state.settings.fakeActivity;
  setSwitch(refs.fakeSwitch, fake.enabled);
  if (state.dirtyForms.has(refs.fakeForm.id)) return;
  refs.fakeForm.min.value = fake.min;
  refs.fakeForm.max.value = fake.max;
  refs.fakeForm.jitter.value = fake.jitter;
  refs.fakeForm.moveRadius.value = fake.moveRadius;
  setSwitch(refs.fakeSwitch, fake.enabled);
}

function renderDecoy() {
  const decoy = state.settings.decoyTiming;
  setSwitch(refs.decoySwitch, decoy.enabled);
  if (state.dirtyForms.has(refs.decoyForm.id)) return;
  refs.decoyForm.min.value = decoy.min;
  refs.decoyForm.max.value = decoy.max;
  setSwitch(refs.decoySwitch, decoy.enabled);
}

function renderLogs() {
  const all = state.settings.logs || [];
  const query = document.getElementById('logSearch').value.trim().toLowerCase();
  const logs = all.filter((entry) => `${entry.domain || ''} ${entry.category || ''} ${JSON.stringify(entry.data || {})}`.toLowerCase().includes(query));
  document.getElementById('logCount').textContent = `Showing ${Math.min(logs.length, state.logLimit)} of ${logs.length} records.${state.settings.activityLogging ? '' : ' Logging is off.'}`;
  document.getElementById('moreLogs').hidden = logs.length <= state.logLimit;
  if (!logs.length) {
    const item = document.createElement('li');
    item.className = 'list-item';
    item.textContent = query ? 'No records match this search.' : state.settings.activityLogging ? 'No recorded events yet. Browse a supported page to collect activity.' : 'Logging is off. Enable Activity logging in Protection to record events on this device.';
    refs.logList.replaceChildren(item);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of logs.slice().reverse().slice(0, state.logLimit)) {
    const time = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('li');
    item.className = 'list-item';

    const content = document.createElement('div');
    const category = document.createElement('div');
    category.className = 'list-item-title';
    category.textContent = String(entry.category);

    const details = document.createElement('div');
    details.className = 'list-item-detail';
    details.textContent = entry.domain || 'Unknown site';
    if (entry.data && Object.keys(entry.data).length) {
      const data = document.createElement('code');
      data.textContent = JSON.stringify(entry.data);
      details.append(data);
    }

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = time;

    content.append(category, details);
    item.append(content, badge);
    fragment.append(item);
  }
  refs.logList.replaceChildren(fragment);
}

function renderHeatmap() {
  const query = document.getElementById('siteSearch').value.trim().toLowerCase();
  const entries = Object.entries(state.settings.heatmap || {}).map(([domain, stats]) => ({ ...stats, domain })).filter((entry) => entry.domain.toLowerCase().includes(query));
  document.getElementById('siteCount').textContent = `Showing ${Math.min(entries.length, state.siteLimit)} of ${entries.length} sites.`;
  document.getElementById('moreSites').hidden = entries.length <= state.siteLimit;
  if (!entries.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = query ? 'No sites match this search.' : 'No local activity yet. Sites appear here as Specter receives page signals.';
    row.append(cell);
    refs.heatmapTable.replaceChildren(row);
    return;
  }
  entries.sort((a, b) => (b.hits || 0) - (a.hits || 0));
  const fragment = document.createDocumentFragment();
  for (const entry of entries.slice(0, state.siteLimit)) {
    const row = document.createElement('tr');
    for (const value of [entry.domain, formatNumber(entry.hits || 0), formatNumber(entry.blockedEvents || 0)]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    fragment.append(row);
  }
  refs.heatmapTable.replaceChildren(fragment);
}

function renderAppearance() {
  if (state.dirtyForms.has(refs.appearanceForm.id)) return;
  const theme = state.settings.theme || {};
  refs.appearanceForm.seed.value = SpecterTheme.normalizeHex(theme.seed);
  refs.appearanceForm.mode.value = theme.mode || 'auto';
  refs.appearanceForm.font.value = ['ubuntu', 'system', 'mono'].includes(state.settings.font) ? state.settings.font : 'system';
}

function previewAppearance() {
  const form = refs.appearanceForm;
  if (!form) return;
  const seed = form.seed.value || '#1b4ed8';
  applyTheme({
    seed,
    mode: form.mode.value || 'auto',
    dynamic: true,
    palettes: buildPalette(seed)
  }, form.font.value || 'system');
}

function renderAll() {
  const version = api.runtime.getManifest?.().version || 'Unknown';
  if (refs.aboutVersion) refs.aboutVersion.textContent = version;
  if (refs.footerVersion) refs.footerVersion.textContent = version;
  renderHero();
  renderAllowlist();
  renderFakeActivity();
  renderDecoy();
  renderLogs();
  renderHeatmap();
  renderAppearance();
  renderEnvironment();
  renderShortcuts();
}

function renderShortcuts() {
  if (!refs.globalShortcut || !refs.tabShortcut || !refs.shortcutGuidance) return;
  const findShortcut = (name) => state.commands.find((command) => command.name === name)?.shortcut || '';
  const globalShortcut = findShortcut('toggle-global');
  const tabShortcut = findShortcut('toggle-tab');
  refs.globalShortcut.textContent = globalShortcut || 'Not assigned';
  refs.tabShortcut.textContent = tabShortcut || 'Not assigned';
  refs.shortcutGuidance.textContent = globalShortcut && tabShortcut
    ? 'Both commands are assigned. Change either binding if another extension uses it.'
    : 'A shortcut is unavailable or conflicts with another extension. Assign a different binding.';
}

function renderEnvironment() {
  if (!refs.envBrowser) return;
  const env = state.diagnostics?.environment;
  if (!env) {
    refs.envBrowser.textContent = 'Detecting…';
    refs.envHeadless.textContent = '-';
    refs.envSupport.textContent = '-';
    refs.envGuidance.textContent = 'Diagnostics unavailable yet.';
  } else {
    const ua = navigator.userAgent || '';
    const browserLabel = env.isCromite ? 'Cromite' : /Floorp\//i.test(ua) ? 'Floorp' : /Firefox\//i.test(ua) ? 'Firefox' : env.isChrome ? 'Chrome' : env.isChromium ? 'Chromium' : 'Other';
    refs.envBrowser.textContent = browserLabel;
    refs.envHeadless.textContent = env.headless ? 'Yes' : 'No';
    refs.envSupport.textContent = env.supportsCommandLineLoading ? 'Yes' : 'No';
    refs.envGuidance.textContent = env.guidance || 'All clear. Command-line loading supported.';
  }
  const lastError = state.diagnostics?.lastError;
  if (lastError) {
    refs.envError.textContent = `${lastError.message} (context: ${lastError.context})\n${lastError.timestamp}`;
  } else {
    refs.envError.textContent = 'No errors recorded for this session.';
  }
}

async function copyDiagnostics() {
  if (!state.diagnostics) {
    toast('Diagnostics are still loading. Try again in a moment.');
    return;
  }
  const text = JSON.stringify({
    ...state.diagnostics,
    commands: state.commands.map(({ name, shortcut }) => ({ name, shortcut: shortcut || null }))
  }, null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast('Report copied');
      return;
    }
  } catch (err) {
    // fallback below
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    toast('Report copied');
  } catch (error) {
    toast('Couldn’t copy the report. Select the text and copy it instead.');
  }
  textarea.remove();
}

async function loadSettings() {
  const operation = ++state.loadOperation;
  try {
    const [result, commands] = await Promise.all([
      sendMessage({ type: 'specter:get-settings' }),
      getCommands()
    ]);
    if (operation !== state.loadOperation) return;
    state.settings = result.settings;
    state.diagnostics = result.diagnostics;
    state.commands = commands;
    if (!state.dirtyForms.has(refs.appearanceForm.id)) applyTheme(state.settings.theme, state.settings.font);
    document.getElementById('settingsError').hidden = true;
    renderAll();
  } catch (error) {
    if (operation !== state.loadOperation) return;
    document.getElementById('settingsError').hidden = false;
  }
}

function setDirty(form, dirty) {
  if (dirty) state.dirtyForms.add(form.id);
  else state.dirtyForms.delete(form.id);
  form.dataset.dirty = String(dirty);
  form.querySelector('.save-state').textContent = dirty ? 'Unsaved changes' : 'Saved on this device';
  form.querySelector('[data-discard]').hidden = !dirty;
}

async function runMutation(action) {
  if (state.pending || !state.settings) return;
  state.pending = true;
  const controls = [...document.querySelectorAll('button, input, select')].filter((control) => !control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  document.body.setAttribute('aria-busy', 'true');
  try { await action(); }
  catch (error) { toast(error.message || 'Couldn’t save. Try again.'); }
  finally {
    state.pending = false;
    controls.forEach((control) => { control.disabled = false; });
    document.body.removeAttribute('aria-busy');
  }
}

async function toggleGlobal() {
  try {
    const enabled = !state.settings.globalEnabled;
    await sendMessage({ type: 'specter:toggle-global', enabled });
    toast(enabled ? 'Specter turned on' : 'Specter turned off');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Couldn’t change Specter’s state. Try again.');
  }
}

async function toggleLogging() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { activityLogging: !state.settings.activityLogging } });
    state.settings = updated;
    renderHero();
    renderLogs();
    toast(updated.activityLogging ? 'Activity logging turned on' : 'Activity logging turned off');
  } catch (error) {
    toast(error.message || 'Couldn’t change activity logging. Try again.');
  }
}

async function toggleElementBlocking() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { elementFocusBlocking: !state.settings.elementFocusBlocking } });
    state.settings = updated;
    renderHero();
    toast(updated.elementFocusBlocking ? 'Element focus protection turned on' : 'Element focus protection turned off');
  } catch (error) {
    toast(error.message || 'Couldn’t change element focus protection. Try again.');
  }
}

async function toggleAutoReload() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { autoReloadOnActivation: !state.settings.autoReloadOnActivation } });
    state.settings = updated;
    renderHero();
    toast(updated.autoReloadOnActivation ? 'Automatic reload turned on' : 'Automatic reload turned off');
  } catch (error) {
    toast(error.message || 'Couldn’t change automatic reload. Try again.');
  }
}

async function toggleFullscreenPause() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { pauseInFullscreen: !state.settings.pauseInFullscreen } });
    state.settings = updated;
    renderHero();
    toast(updated.pauseInFullscreen ? 'Pause in fullscreen turned on' : 'Pause in fullscreen turned off');
  } catch (error) {
    toast(error.message || 'Couldn’t change pause in fullscreen. Try again.');
  }
}

async function toggleHoldFullscreen() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { holdFullscreen: !state.settings.holdFullscreen } });
    state.settings = updated;
    renderHero();
    toast(updated.holdFullscreen ? 'Fullscreen state held' : 'Fullscreen state follows the browser');
  } catch (error) {
    toast(error.message || 'Couldn’t change fullscreen state. Try again.');
  }
}

async function toggleClipboard() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { allowClipboard: !state.settings.allowClipboard } });
    state.settings = updated;
    renderHero();
    toast(updated.allowClipboard ? 'Copy and paste allowed' : 'Pages can block copy and paste');
  } catch (error) {
    toast(error.message || 'Couldn’t change copy and paste. Try again.');
  }
}

async function submitAllowlist(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const pattern = form.pattern.value.trim();
  if (!pattern) return;
  try {
    await sendMessage({
      type: 'specter:allow-site',
      pattern,
      scope: form.scope.value,
      durationMinutes: form.duration.value ? Number(form.duration.value) : null
    });
    form.reset();
    toast('Exception added');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Couldn’t add the exception. Check the pattern and try again.');
  }
}

async function removeAllowlist(id) {
  try {
    await sendMessage({ type: 'specter:remove-allow', id });
    toast('Exception removed');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Couldn’t remove the exception. Try again.');
  }
}

async function saveFakeActivity(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    fakeActivity: {
      enabled: state.settings.fakeActivity.enabled,
      min: clamp(form.min.value, 250, 15000),
      max: clamp(form.max.value, 250, 15000),
      jitter: clamp(form.jitter.value, 0, 0.9),
      moveRadius: clamp(form.moveRadius.value, 4, 64)
    }
  };
  if (payload.fakeActivity.min > payload.fakeActivity.max) {
    [payload.fakeActivity.min, payload.fakeActivity.max] = [payload.fakeActivity.max, payload.fakeActivity.min];
  }
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload });
    state.settings = updated;
    setDirty(form, false);
    renderFakeActivity();
    toast('Activity settings saved');
  } catch (error) {
    toast(error.message || 'Couldn’t save activity settings. Try again.');
  }
}

async function toggleFakeActivity() {
  try {
    const payload = {
      fakeActivity: {
        ...state.settings.fakeActivity,
        enabled: !state.settings.fakeActivity.enabled
      }
    };
    const updated = await sendMessage({ type: 'specter:update-settings', payload });
    state.settings = updated;
    renderFakeActivity();
    toast(updated.fakeActivity.enabled ? 'Synthetic activity turned on' : 'Synthetic activity turned off');
  } catch (error) {
    toast(error.message || 'Couldn’t change synthetic activity. Try again.');
  }
}

async function saveDecoy(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    decoyTiming: {
      enabled: state.settings.decoyTiming.enabled,
      min: clamp(form.min.value, 250, 15000),
      max: clamp(form.max.value, 250, 15000)
    }
  };
  if (payload.decoyTiming.min > payload.decoyTiming.max) {
    [payload.decoyTiming.min, payload.decoyTiming.max] = [payload.decoyTiming.max, payload.decoyTiming.min];
  }
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload });
    state.settings = updated;
    setDirty(form, false);
    renderDecoy();
    toast('Timing settings saved');
  } catch (error) {
    toast(error.message || 'Couldn’t save timing settings. Try again.');
  }
}

async function toggleDecoy() {
  try {
    const payload = {
      decoyTiming: {
        ...state.settings.decoyTiming,
        enabled: !state.settings.decoyTiming.enabled
      }
    };
    const updated = await sendMessage({ type: 'specter:update-settings', payload });
    state.settings = updated;
    renderDecoy();
    toast(updated.decoyTiming.enabled ? 'Decoy timing turned on' : 'Decoy timing turned off');
  } catch (error) {
    toast(error.message || 'Couldn’t change decoy timing. Try again.');
  }
}

async function saveAppearance(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const seed = form.seed.value;
  const mode = form.mode.value;
  const font = form.font.value;
  const palettes = buildPalette(seed);
  try {
    const updated = await sendMessage({
      type: 'specter:update-settings',
      payload: {
        theme: {
          seed,
          mode,
          dynamic: true,
          palettes
        },
        font
      }
    });
    state.settings = updated;
    setDirty(form, false);
    applyTheme(state.settings.theme, state.settings.font);
    toast('Appearance saved');
  } catch (error) {
    toast(error.message || 'Couldn’t save appearance. Try again.');
  }
}

async function exportData(format) {
  try {
    const payload = await sendMessage({ type: 'specter:export', format });
    const blob = new Blob([payload], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `specter-export.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message || 'Couldn’t export. Try again.');
  }
}

async function importData(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a Specter JSON file smaller than 5 MB.');
    const text = await file.text();
    await sendMessage({ type: 'specter:import', data: text });
    [refs.fakeForm, refs.decoyForm, refs.appearanceForm].forEach((form) => setDirty(form, false));
    toast('Settings imported');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Couldn’t import that file. Choose a Specter JSON export.');
  }
}

function bindDropZone() {
  const drop = refs.importDrop;
  if (!drop) return;
  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  ['dragenter', 'dragover'].forEach((type) => {
    drop.addEventListener(type, (event) => {
      prevent(event);
      drop.dataset.state = 'hover';
    });
  });
  ['dragleave', 'dragend'].forEach((type) => {
    drop.addEventListener(type, (event) => {
      prevent(event);
      drop.dataset.state = '';
    });
  });
  drop.addEventListener('drop', (event) => {
    prevent(event);
    drop.dataset.state = '';
    const file = event.dataTransfer?.files && event.dataTransfer.files[0];
    if (!file) {
      toast('Drop a Specter JSON file to import it');
      return;
    }
    const isJson = (file.type && file.type.includes('json')) || file.name.toLowerCase().endsWith('.json');
    if (!isJson) {
      toast('Only Specter JSON files can be imported');
      return;
    }
    runMutation(() => importData(file));
  });
  drop.addEventListener('click', () => {
    document.getElementById('importFile')?.click();
  });
}

async function resetHeatmap() {
  try {
    await sendMessage({ type: 'specter:reset-heatmap' });
    toast('Site activity reset');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Couldn’t reset site activity. Try again.');
  }
}

async function clearLogs() {
  try {
    await sendMessage({ type: 'specter:clear-logs' });
    toast('Event log cleared');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Couldn’t clear the event log. Try again.');
  }
}

function activateSection(name) {
  const target = [...refs.sectionPanels].some((panel) => panel.dataset.sectionPanel === name) ? name : 'overview';
  if (['logs', 'diagnostics'].includes(target) && document.body.classList.contains('mode-basic')) applyMode('advanced');
  refs.sectionPanels.forEach((panel) => {
    panel.classList.toggle('options-section--active', panel.dataset.sectionPanel === target);
  });
  refs.sectionButtons.forEach((button) => {
    if (!button.classList.contains('dash-tab')) return;
    const active = button.dataset.sectionTarget === target;
    button.classList.toggle('dash-tab--active', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
      button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } else {
      button.removeAttribute('aria-current');
    }
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (location.hash !== `#${target}`) history.replaceState(null, '', `#${target}`);
}

function handleSectionNavigation(event) {
  const button = event.target.closest('[data-section-target]');
  if (!button) return;
  activateSection(button.dataset.sectionTarget);
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
  try {
    const operation = api.tabs.create({ url });
    operation?.catch?.(() => toast('Open your browser’s extension shortcut settings to change keys'));
  } catch (error) {
    toast('Open your browser’s extension shortcut settings to change keys');
  }
}

function applyMode(mode) {
  mode = mode === 'advanced' ? 'advanced' : 'basic';
  document.body.classList.toggle('mode-basic', mode === 'basic');
  document.body.classList.toggle('mode-advanced', mode === 'advanced');
  const btns = refs.modeToggle?.querySelectorAll('.segmented__btn') || [];
  btns.forEach((btn) => {
    const active = btn.dataset.modeValue === mode;
    btn.classList.toggle('segmented__btn--active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  if (mode === 'basic' && document.querySelector('.options-section--active')?.classList.contains('advanced-only')) activateSection('overview');
}

function toggleMode(event) {
  const btn = event.target.closest('[data-mode-value]');
  if (!btn) return;
  const mode = btn.dataset.modeValue;
  applyMode(mode);
  if (mode === 'basic' && ['logs', 'diagnostics'].includes(location.hash.slice(1))) activateSection('overview');
  api.storage.local.set({ specterOptionsMode: mode }).catch(() => toast('Couldn’t remember this view. It resets next time.'));
}

function bindEvents() {
  [refs.fakeForm, refs.decoyForm, refs.appearanceForm].forEach((form) => {
    const feedback = document.createElement('div');
    feedback.className = 'save-feedback';
    const label = document.createElement('span');
    label.className = 'save-state';
    label.setAttribute('role', 'status');
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'button button--quiet';
    discard.dataset.discard = '';
    discard.textContent = 'Discard changes';
    feedback.append(label, discard);
    (form === refs.appearanceForm ? form.querySelector('.settings-row--actions') : form).append(feedback);
    setDirty(form, false);
    form.addEventListener('input', () => setDirty(form, true));
    form.addEventListener('change', () => setDirty(form, true));
    discard.addEventListener('click', () => {
      setDirty(form, false);
      renderAll();
      if (form === refs.appearanceForm) applyTheme(state.settings.theme, state.settings.font);
    });
  });
  document.getElementById('retrySettings').addEventListener('click', loadSettings);
  document.getElementById('logSearch').addEventListener('input', () => { state.logLimit = 50; if (state.settings) renderLogs(); });
  document.getElementById('siteSearch').addEventListener('input', () => { state.siteLimit = 50; if (state.settings) renderHeatmap(); });
  document.getElementById('moreLogs').addEventListener('click', () => { state.logLimit += 50; renderLogs(); });
  document.getElementById('moreSites').addEventListener('click', () => { state.siteLimit += 50; renderHeatmap(); });
  window.addEventListener('hashchange', () => activateSection(location.hash.slice(1)));
  window.addEventListener('beforeunload', (event) => {
    if (state.dirtyForms.size) { event.preventDefault(); event.returnValue = ''; }
  });
  refs.globalSwitch.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleGlobal(event)); });
  refs.loggingSwitch.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleLogging(event)); });
  refs.elementSwitch?.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleElementBlocking(event)); });
  refs.autoReloadSwitch?.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleAutoReload(event)); });
  refs.fullscreenPauseSwitch?.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleFullscreenPause(event)); });
  refs.holdFullscreenSwitch?.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleHoldFullscreen(event)); });
  refs.clipboardSwitch?.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleClipboard(event)); });
  document.getElementById('allowlistForm').addEventListener('submit', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => submitAllowlist(event)); });
  document.getElementById('allowlistTable').addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-remove]');
    if (!removeBtn) return;
    const row = removeBtn.closest('tr');
    if (row?.dataset.entry) {
      runMutation(() => removeAllowlist(row.dataset.entry));
    }
  });
  refs.fakeForm.addEventListener('submit', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => saveFakeActivity(event)); });
  refs.fakeSwitch.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleFakeActivity(event)); });
  refs.decoyForm.addEventListener('submit', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => saveDecoy(event)); });
  refs.decoySwitch.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => toggleDecoy(event)); });
  refs.appearanceForm.addEventListener('input', previewAppearance);
  refs.appearanceForm.addEventListener('change', previewAppearance);
  refs.appearanceForm.addEventListener('submit', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => saveAppearance(event)); });
  document.getElementById('exportJson').addEventListener('click', () => exportData('json'));
  document.getElementById('exportCsv').addEventListener('click', () => exportData('csv'));
  document.getElementById('importFile').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) {
      runMutation(() => importData(file));
      event.target.value = '';
    }
  });
  document.getElementById('resetHeatmap').addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => resetHeatmap(event)); });
  document.getElementById('clearLogs')?.addEventListener('click', (event) => { if (event.type === 'submit') event.preventDefault(); runMutation(() => clearLogs(event)); });
  refs.envCopy?.addEventListener('click', copyDiagnostics);
  bindDropZone();
  refs.modeToggle?.addEventListener('click', toggleMode);
  document.querySelector('.options-content')?.addEventListener('click', handleSectionNavigation);
  refs.sectionNav?.addEventListener('click', handleSectionNavigation);
  document.querySelector('.dash-bar')?.addEventListener('click', handleSectionNavigation);
  refs.openShortcutHelp?.addEventListener('click', openShortcuts);
  refs.manageShortcuts?.addEventListener('click', openShortcuts);
  refs.footerImport?.addEventListener('click', () => document.getElementById('importFile')?.click());
  refs.footerExport?.addEventListener('click', () => exportData('json'));
  refs.importDrop?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      document.getElementById('importFile')?.click();
    }
  });
}

bindEvents();

// Restore mode preference then load settings
(async () => {
  try {
    const result = await api.storage.local.get('specterOptionsMode');
    applyMode(result.specterOptionsMode || 'basic');
  } catch (_) {
    applyMode('basic');
  }
  activateSection(location.hash.slice(1));
  loadSettings();
})();
