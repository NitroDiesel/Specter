#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const manifest = JSON.parse(read('manifest.json'));
const packageJson = JSON.parse(read('package.json'));
if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push('manifest version must use x.y.z');
if (packageJson.version !== manifest.version) errors.push('package and manifest versions must match');
if (!read('CHANGELOG.md').includes(`## [${manifest.version}]`)) {
  errors.push('changelog must include the manifest version');
}
if (Number.parseInt(manifest.browser_specific_settings?.gecko?.strict_min_version, 10) < 152) {
  errors.push('Firefox/Gecko 152 or later is required for reliable static content-script loading');
}

const [mainWorldEntry, isolatedEntry] = manifest.content_scripts || [];
if (
  mainWorldEntry?.world !== 'MAIN'
  || mainWorldEntry?.run_at !== 'document_start'
  || !mainWorldEntry?.all_frames
  || !mainWorldEntry?.match_about_blank
  || !mainWorldEntry?.match_origin_as_fallback
  || !mainWorldEntry?.js?.includes('injected/main-world.js')
) {
  errors.push('main-world hooks must run first at document_start in every matching frame');
}
if (
  isolatedEntry?.world !== 'ISOLATED'
  || isolatedEntry?.run_at !== 'document_start'
  || !isolatedEntry?.all_frames
  || !isolatedEntry?.match_about_blank
  || !isolatedEntry?.match_origin_as_fallback
  || !isolatedEntry?.js?.includes('content.js')
) {
  errors.push('isolated bridge must follow the main-world hooks in every matching frame');
}

const requiredFiles = [
  'injected/main-world.js',
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])])
].filter(Boolean);

for (const file of requiredFiles) {
  if (!exists(file)) errors.push(`manifest references missing file: ${file}`);
}

const webAccessibleResources = (manifest.web_accessible_resources || [])
  .flatMap((entry) => entry.resources || []);
if (webAccessibleResources.includes('injected/main-world.js')) {
  errors.push('injected/main-world.js must not be exposed through web_accessible_resources');
}

for (const bridgeFile of ['content.js', 'injected/main-world.js']) {
  if (!exists(bridgeFile)) continue;
  const source = read(bridgeFile);
  for (const eventName of ['specter:update-config', 'specter:request-config']) {
    if (source.includes(eventName)) {
      errors.push(`${bridgeFile} contains legacy fixed bridge event name: ${eventName}`);
    }
  }
}

for (const htmlFile of ['popup/popup.html', 'options/options.html']) {
  const html = read(htmlFile);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) errors.push(`${htmlFile} has duplicate IDs: ${[...new Set(duplicates)].join(', ')}`);
  if (/<(script|link)[^>]+https?:\/\//i.test(html)) errors.push(`${htmlFile} loads a remote script or stylesheet`);
}

if (manifest.permissions?.includes('activeTab') && manifest.permissions?.includes('tabs')) {
  errors.push('activeTab is redundant when tabs permission is present');
}

const licenseFiles = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'licenses/Ubuntu-Font-License-1.0.txt'
];
for (const file of licenseFiles) {
  if (!exists(file)) errors.push(`missing release license file: ${file}`);
}

if (exists('THIRD_PARTY_NOTICES.md')) {
  const notices = read('THIRD_PARTY_NOTICES.md');
  const licensedAssets = [
    'fonts/ubuntu-regular.woff2',
    'fonts/ubuntu-medium.woff2',
    'fonts/ubuntu-bold.woff2',
    'fonts/ubuntumono-regular.woff2',
    'fonts/ubuntumono-bold.woff2'
  ];
  for (const asset of licensedAssets) {
    if (!exists(asset)) errors.push(`missing bundled third-party asset: ${asset}`);
    if (!notices.includes(`\`${asset}\``)) errors.push(`third-party notices omit bundled asset: ${asset}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Validated Specter ${manifest.version}`);
