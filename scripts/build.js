#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const excludes = new Set(['.git', '.venv', 'node_modules', 'specter-chrome.zip', 'specter-firefox.zip']);

const pythonScript = `import os, sys, zipfile
root = sys.argv[1]
dest = sys.argv[2]
excludes = set(sys.argv[3].split(';')) if len(sys.argv) > 3 else set()

def should_skip(rel_path):
    parts = [p for p in rel_path.split(os.sep) if p and p != '.']
    for part in parts:
        if part in excludes:
            return True
    return False

with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as zf:
    for folder, dirs, files in os.walk(root):
        rel_dir = os.path.relpath(folder, root)
        if should_skip(rel_dir):
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not should_skip(os.path.join(rel_dir, d))]
        for file in files:
            rel_path = os.path.normpath(os.path.join(rel_dir, file))
            if rel_path in ('.', ''):
                continue
            if should_skip(rel_path):
                continue
            zf.write(os.path.join(root, rel_path), rel_path)
print(f'Wrote {dest}')
`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runPython(target) {
  const dest = path.join(root, target);
  const args = ['-c', pythonScript, root, dest, Array.from(excludes).join(';')];
  const result = spawnSync('python', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`Failed to create ${target}`);
    process.exit(result.status || 1);
  }
}

ensureDir(root);
runPython('specter-chrome.zip');
runPython('specter-firefox.zip');
