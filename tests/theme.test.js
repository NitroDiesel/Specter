const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHex, buildPalette, contrastRatio } = require('../styles/theme.js');

test('theme accepts only complete hex colors and uses a safe fallback', () => {
  for (const value of [null, {}, [], 7, '#1234', '#12345', '#abcdef0', 'red', '#fff; color:red']) {
    assert.equal(normalizeHex(value), '#007c91');
  }
  assert.equal(normalizeHex(' #AbC '), '#aabbcc');
});

test('custom accents preserve text, hover, focus, and component contrast across every surface', () => {
  for (const red of [0, 51, 102, 153, 204, 255]) {
    for (const green of [0, 51, 102, 153, 204, 255]) {
      for (const blue of [0, 51, 102, 153, 204, 255]) {
        const seed = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
        for (const [mode, palette] of Object.entries(buildPalette(seed))) {
          const surfaces = mode === 'light' ? ['#fff', '#f4f6f5', '#e7ebeb', '#dce2e2'] : ['#111518', '#191f23', '#242b2f', '#2d3539'];
          for (const surface of surfaces) {
            assert.ok(contrastRatio(palette['--accent-strong'], surface) >= 4.5, `${seed} ${mode} link`);
            assert.ok(contrastRatio(palette['--focus'], surface) >= 3, `${seed} ${mode} focus`);
          }
          assert.ok(contrastRatio(palette['--accent'], palette['--accent-ink']) >= 4.5, `${seed} ${mode} button`);
          assert.ok(contrastRatio(palette['--accent-strong'], palette['--accent-hover-ink']) >= 4.5, `${seed} ${mode} hover`);
          assert.ok(contrastRatio(palette['--focus-on-dark'], '#252a2e') >= 3);
        }
      }
    }
  }
});
