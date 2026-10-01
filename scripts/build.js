#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const payload = [
  'manifest.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'licenses',
  'background.js',
  'content.js',
  '_locales',
  'assets',
  'fonts',
  'injected',
  'options',
  'popup',
  'styles'
];

const archives = [
  { target: 'chrome', filename: 'specter-chrome.zip' },
  { target: 'firefox', filename: 'specter-firefox.zip' }
];

const pythonBuildScript = String.raw`
import json, os, sys, zipfile

root = sys.argv[1]
dest = sys.argv[2]
target = sys.argv[3]
payload = sys.argv[4:]
files = []

for item in payload:
    source = os.path.join(root, item)
    if os.path.isfile(source):
        files.append((source, item.replace(os.sep, '/')))
        continue
    for folder, directories, filenames in os.walk(source):
        directories.sort()
        for filename in sorted(filenames):
            absolute = os.path.join(folder, filename)
            relative = os.path.relpath(absolute, root).replace(os.sep, '/')
            files.append((absolute, relative))

with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for absolute, relative in sorted(files, key=lambda entry: entry[1]):
        if relative == 'manifest.json':
            with open(absolute, encoding='utf-8') as source:
                manifest = json.load(source)
            if target == 'firefox':
                background = manifest.setdefault('background', {})
                worker = background.pop('service_worker', None)
                if not worker:
                    raise RuntimeError('Chrome source manifest is missing background.service_worker')
                background['scripts'] = [worker]
            content = (json.dumps(manifest, indent=2, ensure_ascii=True) + '\n').encode('utf-8')
        else:
            with open(absolute, 'rb') as source:
                content = source.read()

        info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        zf.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
`;

const pythonInspectScript = String.raw`
import json, sys, zipfile

with zipfile.ZipFile(sys.argv[1]) as zf:
    names = [entry.filename for entry in zf.infolist()]
    manifest = json.loads(zf.read('manifest.json').decode('utf-8'))
    print(json.dumps({
        'names': names,
        'manifest': manifest,
        'corrupt': zf.testzip()
    }))
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function listPayloadFiles() {
  const files = [];

  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      files.push(relative.split(path.sep).join('/'));
      return;
    }
    for (const entry of fs.readdirSync(absolute).sort()) {
      visit(path.join(relative, entry));
    }
  }

  for (const item of payload) visit(item);
  return files.sort();
}

let pythonCommand = null;

// Many Linux distributions ship only python3; Windows usually ships python.
function resolvePython() {
  if (pythonCommand) return pythonCommand;
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import zipfile'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      pythonCommand = candidate;
      return pythonCommand;
    }
  }
  fail('Python 3 is required to package Specter. Install python3 or python on PATH.');
}

function runPython(script, args, captureOutput = false) {
  const result = spawnSync(resolvePython(), ['-c', script, ...args], {
    encoding: captureOutput ? 'utf8' : undefined,
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error || result.status !== 0) {
    if (captureOutput && result.stderr) process.stderr.write(result.stderr);
    fail(result.error?.message || `Python packaging command failed with status ${result.status}`);
  }
  return result.stdout;
}

function inspectArchive(filename) {
  const output = runPython(pythonInspectScript, [path.join(root, filename)], true);
  return JSON.parse(output);
}

function validateArchive({ target, filename }, expectedFiles) {
  const { names, manifest, corrupt } = inspectArchive(filename);
  const sortedNames = [...names].sort();

  if (corrupt) fail(`${filename} contains a corrupt entry: ${corrupt}`);
  if (new Set(names).size !== names.length) fail(`${filename} contains duplicate entries`);
  if (JSON.stringify(sortedNames) !== JSON.stringify(expectedFiles)) {
    const missing = expectedFiles.filter((file) => !names.includes(file));
    const extra = names.filter((file) => !expectedFiles.includes(file));
    fail(`${filename} payload mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }

  const background = manifest.background || {};
  if (target === 'chrome') {
    if (background.service_worker !== 'background.js' || background.scripts) {
      fail(`${filename} must use background.service_worker only`);
    }
  } else if (JSON.stringify(background.scripts) !== JSON.stringify(['background.js']) || background.service_worker) {
    fail(`${filename} must use background.scripts only`);
  }

  const forbidden = names.filter((name) => /(^|\/)(\.git|\.github|tests|scripts|node_modules)(\/|$)|\.(zip|pem)$/i.test(name));
  if (forbidden.length) fail(`${filename} contains non-runtime files: ${forbidden.join(', ')}`);

  console.log(`Validated ${filename} (${names.length} files, ${target} manifest)`);
}

for (const item of payload) {
  if (!fs.existsSync(path.join(root, item))) fail(`Missing release payload: ${item}`);
}

const sourceManifestBefore = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
const expectedFiles = listPayloadFiles();

for (const archive of archives) {
  const destination = path.join(root, archive.filename);
  runPython(pythonBuildScript, [root, destination, archive.target, ...payload]);
  validateArchive(archive, expectedFiles);
}

const sourceManifestAfter = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
if (sourceManifestAfter !== sourceManifestBefore) fail('Packaging modified the source manifest');

console.log('Built deterministic Chrome and Firefox-family release archives');
