const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHex, buildPalette, contrastRatio, SURFACES } = require('../styles/theme.js');

test('theme accepts only complete hex colors and uses a safe fallback', () => {
  for (const value of [null, {}, [], 7, '#1234', '#12345', '#abcdef0', 'red', '#fff; color:red']) {
    assert.equal(normalizeHex(value), '#1b4ed8');
  }
  assert.equal(normalizeHex(' #AbC '), '#aabbcc');
});

test('custom accents preserve text, hover, focus, and component contrast across every surface', () => {
  for (const red of [0, 51, 102, 153, 204, 255]) {
    for (const green of [0, 51, 102, 153, 204, 255]) {
      for (const blue of [0, 51, 102, 153, 204, 255]) {
        const seed = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
        for (const [mode, palette] of Object.entries(buildPalette(seed))) {
          for (const surface of SURFACES[mode]) {
            assert.ok(contrastRatio(palette['--accent-strong'], surface) >= 4.5, `${seed} ${mode} link`);
            assert.ok(contrastRatio(palette['--focus'], surface) >= 3, `${seed} ${mode} focus`);
          }
          assert.ok(contrastRatio(palette['--accent'], palette['--accent-ink']) >= 4.5, `${seed} ${mode} button`);
          assert.ok(contrastRatio(palette['--accent-strong'], palette['--accent-hover-ink']) >= 4.5, `${seed} ${mode} hover`);
        }
      }
    }
  }
});

test('installed font names reject characters that could escape CSS', () => {
  const { isValidFontFamily } = require('../styles/theme.js');
  for (const name of ['Inter', 'Segoe UI Variable', 'Noto Sans CJK JP', '思源黑体', "Font's (Pro)", 'Fira Code']) {
    assert.equal(isValidFontFamily(name), true, name);
  }
  for (const name of ['', '   ', '"Inter"', 'Inter, serif', 'A;B', 'a{b}', 'x\\y', '-lead', 'a'.repeat(101), null, 7]) {
    assert.equal(isValidFontFamily(name), false, String(name));
  }
});
