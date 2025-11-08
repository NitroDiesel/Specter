const api = typeof browser !== 'undefined' ? browser : chrome;
const usePromiseAPI = typeof browser !== 'undefined' && api === browser;
const state = {
  settings: null,
  diagnostics: null
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

const refs = {
  heroGlobal: document.getElementById('heroGlobal'),
  heroAllow: document.getElementById('heroAllow'),
  heroHeatmap: document.getElementById('heroHeatmap'),
  globalSwitch: document.getElementById('generalGlobal'),
  telemetrySwitch: document.getElementById('telemetrySwitch'),
  loggingSwitch: document.getElementById('loggingSwitch'),
  elementSwitch: document.getElementById('elementSwitch'),
  autoReloadSwitch: document.getElementById('autoReloadSwitch'),
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
  envCopy: document.getElementById('envCopy')
};

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
  setTimeout(() => {
    refs.toast.dataset.visible = 'false';
  }, timeout);
}

function injectPalette(palettes) {
  const id = 'specter-theme-overrides';
  let style = document.getElementById(id);
  if (!palettes) {
    if (style) style.remove();
    return;
  }
  const light = palettes.light || {};
  const dark = palettes.dark || {};
  const serialize = (set) => COLOR_KEYS.map((key) => (set[key] ? `${key}:${set[key]};` : '')).join('');
  const css = [`:root{${serialize(light)}}`, `:root[data-theme='dark']{${serialize(dark)}}`, `@media(prefers-color-scheme: dark){:root:not([data-theme='light']){${serialize(dark)}}}`].join('');
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
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

function clamp(value, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.min(Math.max(num, min), max);
}

function normalizeHex(color) {
  if (!color) return '#4ad6ff';
  let hex = color.trim().replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  return `#${hex.slice(0, 6)}`.toLowerCase();
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex).replace('#', '');
  const intVal = parseInt(normalized, 16);
  return {
    r: (intVal >> 16) & 255,
    g: (intVal >> 8) & 255,
    b: intVal & 255
  };
}

function rgbToHex(r, g, b) {
  const clampChannel = (value) => clamp(Math.round(value), 0, 255);
  const toHex = (value) => clampChannel(value).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mix(colorA, colorB, ratio = 0.5) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const t = clamp(ratio, 0, 1);
  return rgbToHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  );
}

function lighten(hex, amount = 0.1) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount
  );
}

function darken(hex, amount = 0.1) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r * (1 - amount),
    g * (1 - amount),
    b * (1 - amount)
  );
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function onColor(hex) {
  return relativeLuminance(hex) > 0.55 ? '#001318' : '#ffffff';
}

function buildPalette(seedColor) {
  const seed = normalizeHex(seedColor);
  const primary = darken(seed, 0.12);
  const primaryContainer = lighten(seed, 0.45);
  const secondary = mix(seed, '#4b626f', 0.4);
  const secondaryContainer = lighten(secondary, 0.4);
  const tertiary = mix(seed, '#7c4dff', 0.5);
  const tertiaryContainer = lighten(tertiary, 0.35);
  const surface = mix('#ffffff', '#0a1017', 0.05);
  const surfaceDark = mix('#0b1118', seed, 0.06);
  const outline = mix(primary, '#6f7882', 0.4);
  const outlineDark = mix(lighten(primary, 0.4), '#88909a', 0.5);
  const primaryDark = lighten(seed, 0.4);
  const primaryDarkContainer = darken(primaryDark, 0.35);
  const secondaryDark = mix(seed, '#a5cbe0', 0.5);
  const tertiaryDark = mix(seed, '#c4c2f6', 0.6);

  const light = {
    '--md3-primary': primary,
    '--md3-on-primary': onColor(primary),
    '--md3-primary-container': primaryContainer,
    '--md3-on-primary-container': '#001f26',
    '--md3-secondary': secondary,
    '--md3-on-secondary': onColor(secondary),
    '--md3-secondary-container': secondaryContainer,
    '--md3-on-secondary-container': '#061b24',
    '--md3-tertiary': tertiary,
    '--md3-on-tertiary': onColor(tertiary),
    '--md3-tertiary-container': tertiaryContainer,
    '--md3-on-tertiary-container': '#1b1134',
    '--md3-surface': surface,
    '--md3-surface-container-low': mix(surface, '#0a1017', 0.03),
    '--md3-surface-container': mix(surface, '#0a1017', 0.06),
    '--md3-surface-container-high': mix(surface, '#0a1017', 0.1),
    '--md3-surface-container-highest': mix(surface, '#0a1017', 0.13),
    '--md3-surface-tint': primary,
    '--md3-on-surface': '#111b22',
    '--md3-on-surface-variant': '#3f4a53',
    '--md3-outline': outline,
    '--md3-outline-variant': mix(outline, '#c1c7cf', 0.55),
    '--md3-error': '#ba1b1b',
    '--md3-on-error': '#ffffff',
    '--md3-error-container': '#ffdad6',
    '--md3-on-error-container': '#410002',
    '--md3-inverse-surface': '#242c32',
    '--md3-inverse-on-surface': '#edf1f5',
    '--md3-inverse-primary': lighten(seed, 0.5)
  };

  const dark = {
    '--md3-primary': primaryDark,
    '--md3-on-primary': '#003545',
    '--md3-primary-container': primaryDarkContainer,
    '--md3-on-primary-container': onColor(primaryDarkContainer),
    '--md3-secondary': secondaryDark,
    '--md3-on-secondary': '#152630',
    '--md3-secondary-container': darken(secondaryDark, 0.3),
    '--md3-on-secondary-container': onColor(darken(secondaryDark, 0.3)),
    '--md3-tertiary': tertiaryDark,
    '--md3-on-tertiary': '#251b40',
    '--md3-tertiary-container': darken(tertiaryDark, 0.35),
    '--md3-on-tertiary-container': onColor(darken(tertiaryDark, 0.35)),
    '--md3-surface': surfaceDark,
    '--md3-surface-container-low': mix(surfaceDark, '#141b21', 0.3),
    '--md3-surface-container': mix(surfaceDark, '#1c242b', 0.45),
    '--md3-surface-container-high': mix(surfaceDark, '#222a33', 0.6),
    '--md3-surface-container-highest': mix(surfaceDark, '#2b333c', 0.75),
    '--md3-surface-tint': primaryDark,
    '--md3-on-surface': '#dce2e8',
    '--md3-on-surface-variant': '#aeb6bf',
    '--md3-outline': outlineDark,
    '--md3-outline-variant': mix(outlineDark, '#3d464f', 0.4),
    '--md3-error': '#ffb4ab',
    '--md3-on-error': '#690005',
    '--md3-error-container': '#93000a',
    '--md3-on-error-container': '#ffdad6',
    '--md3-inverse-surface': '#e2e6eb',
    '--md3-inverse-on-surface': '#121417',
    '--md3-inverse-primary': primary
  };

  return { light, dark };
}

function updatePreview(seed) {
  const palettes = buildPalette(seed);
  refs.themePreview.style.setProperty('--preview-primary', palettes.light['--md3-primary']);
  refs.themePreview.style.setProperty('--preview-secondary', palettes.light['--md3-secondary']);
  refs.themePreview.style.setProperty('--preview-tertiary', palettes.light['--md3-tertiary']);
}

function setSwitch(element, value) {
  if (!element) return;
  element.setAttribute('aria-checked', String(Boolean(value)));
}

function renderHero() {
  const settings = state.settings;
  refs.heroGlobal.textContent = settings.globalEnabled ? 'Enabled' : 'Disabled';
  refs.heroAllow.textContent = settings.allowlist.length.toString();
  refs.heroHeatmap.textContent = Object.keys(settings.heatmap || {}).length.toString();
  setSwitch(refs.globalSwitch, settings.globalEnabled);
  setSwitch(refs.telemetrySwitch, settings.telemetryEnabled);
  setSwitch(refs.loggingSwitch, settings.activityLogging);
  setSwitch(refs.elementSwitch, settings.elementFocusBlocking);
  setSwitch(refs.autoReloadSwitch, settings.autoReloadOnActivation);
}

function renderAllowlist() {
  const tbody = refs.allowTable;
  const entries = [...state.settings.allowlist].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4">No allowlisted sites</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map((entry) => {
    const expires = entry.expiresAt ? formatExpiry(entry.expiresAt) : 'Never';
    return `<tr data-entry="${entry.id}">
      <td>${entry.pattern}</td>
      <td>${entry.scope}</td>
      <td>${expires}</td>
      <td><button type="button" class="md3-icon-button" data-remove>
        <span class="material-symbols-rounded">delete</span>
      </button></td>
    </tr>`;
  }).join('');
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
  refs.fakeForm.min.value = fake.min;
  refs.fakeForm.max.value = fake.max;
  refs.fakeForm.jitter.value = fake.jitter;
  refs.fakeForm.moveRadius.value = fake.moveRadius;
  setSwitch(refs.fakeSwitch, fake.enabled);
}

function renderDecoy() {
  const decoy = state.settings.decoyTiming;
  refs.decoyForm.min.value = decoy.min;
  refs.decoyForm.max.value = decoy.max;
  setSwitch(refs.decoySwitch, decoy.enabled);
}

function renderLogs() {
  const logs = state.settings.activityLogging ? state.settings.logs || [] : [];
  if (!state.settings.activityLogging) {
    refs.logList.innerHTML = '<li class="md3-list-item">Logging disabled</li>';
    return;
  }
  if (!logs.length) {
    refs.logList.innerHTML = '<li class="md3-list-item">No logs yet</li>';
    return;
  }
  refs.logList.innerHTML = logs.slice(-6).reverse().map((entry) => {
    const time = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<li class="md3-list-item">
      <div>
        <div class="md3-type-title-small">${entry.category}</div>
        <div class="md3-type-body-small">${entry.domain || 'unknown'} • ${entry.data ? JSON.stringify(entry.data) : ''}</div>
      </div>
      <span class="badge">${time}</span>
    </li>`;
  }).join('');
}

function renderHeatmap() {
  const entries = Object.entries(state.settings.heatmap || {}).map(([domain, stats]) => ({ domain, ...stats }));
  if (!entries.length) {
    refs.heatmapTable.innerHTML = '<tr><td colspan="3">No data yet</td></tr>';
    return;
  }
  entries.sort((a, b) => (b.hits || 0) - (a.hits || 0));
  refs.heatmapTable.innerHTML = entries.slice(0, 8).map((entry) => `<tr>
    <td>${entry.domain}</td>
    <td>${entry.hits || 0}</td>
    <td>${entry.blockedEvents || 0}</td>
  </tr>`).join('');
}

function renderAppearance() {
  const theme = state.settings.theme || {};
  refs.appearanceForm.seed.value = theme.seed || '#4ad6ff';
  refs.appearanceForm.mode.value = theme.mode || 'auto';
  refs.appearanceForm.font.value = state.settings.font || 'roboto';
  updatePreview(refs.appearanceForm.seed.value);
}

function renderAll() {
  renderHero();
  renderAllowlist();
  renderFakeActivity();
  renderDecoy();
  renderLogs();
  renderHeatmap();
  renderAppearance();
  renderEnvironment();
}

function renderEnvironment() {
  if (!refs.envBrowser) return;
  const env = state.diagnostics?.environment;
  if (!env) {
    refs.envBrowser.textContent = 'Detecting…';
    refs.envHeadless.textContent = '—';
    refs.envSupport.textContent = '—';
    refs.envGuidance.textContent = 'Diagnostics unavailable yet.';
  } else {
    const browserLabel = env.isCromite ? 'Cromite' : env.isChrome ? 'Google Chrome' : env.isChromium ? 'Chromium' : 'Other';
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
    toast('Diagnostics not ready yet');
    return;
  }
  const text = JSON.stringify(state.diagnostics, null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast('Diagnostics copied');
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
    toast('Diagnostics copied');
  } catch (error) {
    toast('Unable to copy diagnostics');
  }
  textarea.remove();
}

async function loadSettings() {
  try {
    const result = await sendMessage({ type: 'specter:get-settings' });
    state.settings = result.settings;
    state.diagnostics = result.diagnostics;
    applyTheme(state.settings.theme, state.settings.font);
    renderAll();
  } catch (error) {
    toast(error.message || 'Unable to load settings');
  }
}

async function toggleGlobal() {
  try {
    await sendMessage({ type: 'specter:toggle-global', enabled: !state.settings.globalEnabled });
    toast('Global state updated');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Failed to toggle global state');
  }
}

async function toggleTelemetry() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { telemetryEnabled: !state.settings.telemetryEnabled } });
    state.settings = updated;
    renderHero();
    toast('Telemetry preference saved');
  } catch (error) {
    toast(error.message || 'Failed to update telemetry');
  }
}

async function toggleLogging() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { activityLogging: !state.settings.activityLogging } });
    state.settings = updated;
    renderHero();
    renderLogs();
    toast('Logging preference saved');
  } catch (error) {
    toast(error.message || 'Failed to update logging');
  }
}

async function toggleElementBlocking() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { elementFocusBlocking: !state.settings.elementFocusBlocking } });
    state.settings = updated;
    renderHero();
    toast('Element focus blocking updated');
  } catch (error) {
    toast(error.message || 'Failed to update focus blocking');
  }
}

async function toggleAutoReload() {
  try {
    const updated = await sendMessage({ type: 'specter:update-settings', payload: { autoReloadOnActivation: !state.settings.autoReloadOnActivation } });
    state.settings = updated;
    renderHero();
    toast('Auto reload preference saved');
  } catch (error) {
    toast(error.message || 'Failed to update auto reload');
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
    toast('Allowlist entry added');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Failed to add allowlist entry');
  }
}

async function removeAllowlist(id) {
  try {
    await sendMessage({ type: 'specter:remove-allow', id });
    toast('Entry removed');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Failed to remove entry');
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
    renderFakeActivity();
    toast('Fake activity saved');
  } catch (error) {
    toast(error.message || 'Failed to save fake activity');
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
    toast('Fake activity updated');
  } catch (error) {
    toast(error.message || 'Failed to toggle fake activity');
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
    renderDecoy();
    toast('Decoy timing saved');
  } catch (error) {
    toast(error.message || 'Failed to save decoy timing');
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
    toast('Decoy timing updated');
  } catch (error) {
    toast(error.message || 'Failed to toggle decoy');
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
    applyTheme(state.settings.theme, state.settings.font);
    toast('Theme saved');
  } catch (error) {
    toast(error.message || 'Failed to save theme');
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
    toast(error.message || 'Export failed');
  }
}

async function importData(file) {
  const text = await file.text();
  try {
    await sendMessage({ type: 'specter:import', data: text });
    toast('Import complete');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Import failed');
  }
}

async function resetHeatmap() {
  try {
    await sendMessage({ type: 'specter:reset-heatmap' });
    toast('Heatmap reset');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Failed to reset heatmap');
  }
}

async function clearLogs() {
  try {
    await sendMessage({ type: 'specter:clear-logs' });
    toast('Logs cleared');
    await loadSettings();
  } catch (error) {
    toast(error.message || 'Failed to clear logs');
  }
}

function bindEvents() {
  refs.globalSwitch.addEventListener('click', toggleGlobal);
  refs.telemetrySwitch.addEventListener('click', toggleTelemetry);
  refs.loggingSwitch.addEventListener('click', toggleLogging);
  refs.elementSwitch?.addEventListener('click', toggleElementBlocking);
  refs.autoReloadSwitch?.addEventListener('click', toggleAutoReload);
  document.getElementById('allowlistForm').addEventListener('submit', submitAllowlist);
  document.getElementById('refreshAllow').addEventListener('click', loadSettings);
  document.getElementById('allowlistTable').addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-remove]');
    if (!removeBtn) return;
    const row = removeBtn.closest('tr');
    if (row?.dataset.entry) {
      removeAllowlist(row.dataset.entry);
    }
  });
  refs.fakeForm.addEventListener('submit', saveFakeActivity);
  refs.fakeSwitch.addEventListener('click', toggleFakeActivity);
  refs.decoyForm.addEventListener('submit', saveDecoy);
  refs.decoySwitch.addEventListener('click', toggleDecoy);
  refs.appearanceForm.addEventListener('input', (event) => {
    if (event.target.name === 'seed') {
      updatePreview(event.target.value);
    }
  });
  refs.appearanceForm.addEventListener('submit', saveAppearance);
  document.getElementById('exportJson').addEventListener('click', () => exportData('json'));
  document.getElementById('exportCsv').addEventListener('click', () => exportData('csv'));
  document.getElementById('importFile').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) {
      importData(file);
      event.target.value = '';
    }
  });
  document.getElementById('resetHeatmap').addEventListener('click', resetHeatmap);
  document.getElementById('clearLogs').addEventListener('click', clearLogs);
  refs.envCopy?.addEventListener('click', copyDiagnostics);
}

bindEvents();
loadSettings();
