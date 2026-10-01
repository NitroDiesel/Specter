const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sourceManifestPath = path.join(root, 'manifest.json');

const inspectScript = String.raw`
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as zf:
    print(json.dumps({
        'names': zf.namelist(),
        'manifest': json.loads(zf.read('manifest.json').decode('utf-8')),
        'corrupt': zf.testzip()
    }))
`;

const python = ['python3', 'python'].find((candidate) => {
  const probe = spawnSync(candidate, ['-c', 'import zipfile'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
});

function inspect(filename) {
  assert.ok(python, 'Python 3 is required to inspect archives');
  const result = spawnSync(python, ['-c', inspectScript, path.join(root, filename)], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function digest(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, filename))).digest('hex');
}

test('build produces target-specific, runtime-only archives without changing source manifest', () => {
  const sourceBefore = fs.readFileSync(sourceManifestPath, 'utf8');
  const build = spawnSync(process.execPath, ['scripts/build.js'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(fs.readFileSync(sourceManifestPath, 'utf8'), sourceBefore);

  const chrome = inspect('specter-chrome.zip');
  const firefox = inspect('specter-firefox.zip');
  const firstDigests = {
    chrome: digest('specter-chrome.zip'),
    firefox: digest('specter-firefox.zip')
  };

  const rebuild = spawnSync(process.execPath, ['scripts/build.js'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(rebuild.status, 0, rebuild.stderr || rebuild.stdout);
  assert.deepEqual({
    chrome: digest('specter-chrome.zip'),
    firefox: digest('specter-firefox.zip')
  }, firstDigests);

  assert.equal(chrome.corrupt, null);
  assert.equal(firefox.corrupt, null);
  assert.equal(chrome.manifest.background.service_worker, 'background.js');
  assert.equal(chrome.manifest.background.scripts, undefined);
  assert.deepEqual(firefox.manifest.background.scripts, ['background.js']);
  assert.equal(firefox.manifest.background.service_worker, undefined);
  assert.equal(firefox.manifest.browser_specific_settings.gecko.strict_min_version, '152.0');
  assert.deepEqual(
    firefox.manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ['none']
  );
  for (const archive of [chrome, firefox]) {
    assert.deepEqual([...archive.names].sort(), [...new Set(archive.names)].sort());
    for (const required of [
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'styles/theme.js',
      'assets/svg/specter-logo.svg',
      'fonts/ubuntu-regular.woff2',
      'licenses/Ubuntu-Font-License-1.0.txt'
    ]) {
      assert.ok(archive.names.includes(required), `${required} missing from archive`);
    }
    assert.equal(
      archive.names.some((name) => /(^|\/)(\.git|\.github|tests|scripts|node_modules)(\/|$)|\.(zip|pem)$/i.test(name)),
      false
    );
  }
});
