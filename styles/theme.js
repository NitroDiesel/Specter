(function (root) {
  const FALLBACK = '#007c91';

  function normalizeHex(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!/^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(text)) return FALLBACK;
    const hex = text.replace(/^#/, '');
    return `#${(hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex).toLowerCase()}`;
  }

  function mix(first, second, amount) {
    const channels = (color) => normalizeHex(color).slice(1).match(/../g).map((part) => parseInt(part, 16));
    const a = channels(first);
    const b = channels(second);
    return `#${a.map((part, index) => Math.round(part + (b[index] - part) * amount).toString(16).padStart(2, '0')).join('')}`;
  }

  function luminance(color) {
    const channels = normalizeHex(color).slice(1).match(/../g).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function contrastRatio(first, second) {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function onColor(color) {
    return contrastRatio(color, '#000000') > contrastRatio(color, '#ffffff') ? '#000000' : '#ffffff';
  }

  function fit(color, surfaces, minimum, toward) {
    let value = color;
    for (let index = 0; index < 64 && surfaces.some((surface) => contrastRatio(value, surface) < minimum); index += 1) {
      value = mix(value, toward, 0.08);
    }
    return value;
  }

  function buildPalette(value) {
    const seed = normalizeHex(value);
    const palette = (dark) => {
      const surfaces = dark ? ['#111518', '#191f23', '#242b2f', '#2d3539'] : ['#ffffff', '#f4f6f5', '#e7ebeb', '#dce2e2'];
      const toward = dark ? '#ffffff' : '#000000';
      const base = dark ? mix(seed, '#ffffff', 0.48) : seed;
      const action = fit(base, surfaces, 3, toward);
      const strong = fit(base, surfaces, 4.5, toward);
      return {
        '--accent': action,
        '--accent-strong': strong,
        '--accent-soft': mix(seed, dark ? '#111518' : '#ffffff', dark ? 0.85 : 0.9),
        '--accent-ink': onColor(action),
        '--accent-hover-ink': onColor(strong),
        '--focus': action,
        '--focus-on-dark': fit(mix(seed, '#ffffff', 0.48), ['#17191d', '#252a2e'], 3, '#ffffff'),
        '--selection': mix(seed, dark ? '#111518' : '#ffffff', dark ? 0.85 : 0.9)
      };
    };
    return { light: palette(false), dark: palette(true) };
  }

  function applyTheme(theme, font) {
    const element = document.documentElement;
    if (['light', 'dark'].includes(theme?.mode)) element.dataset.theme = theme.mode;
    else delete element.dataset.theme;
    element.dataset.font = ['ubuntu', 'system', 'mono'].includes(font) ? font : 'ubuntu';
    const palettes = buildPalette(theme?.seed);
    const serialize = (palette) => Object.entries(palette).map(([key, value]) => `${key}:${value}`).join(';');
    let style = document.getElementById('specter-dynamic-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'specter-dynamic-theme';
      document.head.append(style);
    }
    style.textContent = `:root{${serialize(palettes.light)}}:root[data-theme='dark']{${serialize(palettes.dark)}}@media(prefers-color-scheme:dark){:root:not([data-theme='light']){${serialize(palettes.dark)}}}`;
  }

  const theme = { normalizeHex, contrastRatio, buildPalette, applyTheme };
  if (typeof module !== 'undefined' && module.exports) module.exports = theme;
  else root.SpecterTheme = theme;
}(globalThis));
