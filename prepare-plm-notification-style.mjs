#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hub = path.join(workspace, 'ibiz-app-hub');
const require = createRequire(path.join(hub, 'components/ibiz-next-vue3/package.json'));
const sass = require('sass');
const postcss = require('postcss');
const selectorRequire = createRequire(require.resolve('stylelint'));
const selectors = selectorRequire('postcss-selector-parser');
const webRequire = createRequire(path.join(workspace, 'plm-web/package.json'));
const vueRequire = createRequire(webRequire.resolve('vue'));
const parseHtml = vueRequire('@vue/compiler-dom').parse;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const notificationStyleSources = [
  'components/ibiz-next-vue3/src/panel-component/user-message/user-message.scss',
  'components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-group/internal-message-group.scss',
  'components/ibiz-next-vue3/src/panel-component/user-message/internal-message/common/internal-message-container/internal-message-container.scss',
];
const global = path.join(hub, 'packages/theme/style/global.scss');
const originalIndexSha256 = '1d12c09ece14b684dbf9e53f3bdd955fce9982ca1666afced5e23a02a5abc236';

export function scopeNotificationCss(css) {
  const root = postcss.parse(css);
  root.walkAtRules(rule => assert.equal(rule.name, 'media', 'Only media rules are expected in this narrow stylesheet'));
  root.walkRules(rule => {
    const parsed = selectors().astSync(rule.selector);
    parsed.each(selector => {
      const classes = [];
      selector.walkClasses(node => classes.push(node));
      const popup = classes.find(node => node.value === 'ibiz-user-message-popover');
      if (popup) {
        if (!classes.some(node => node.value === 'el-popover')) {
          selector.insertAfter(popup, selectors.className({ value: 'el-popover' }));
        }
      } else if (classes.some(node => node.value.startsWith('ibiz-internal-message') ||
          node.value.startsWith('ibiz-user-message-popover-'))) {
        const prefix = selectors().astSync('.ibiz-user-message-popover.el-popover').first;
        for (const node of [...prefix.nodes].reverse()) selector.prepend(node.clone());
        selector.insertBefore(selector.nodes[2], selectors.combinator({ value: ' ' }));
      } else selector.remove();
    });
    if (parsed.nodes.length) rule.selector = parsed.toString();
    else rule.remove();
  });
  root.walkAtRules(rule => { if (!rule.nodes?.length) rule.remove(); });
  root.walkDecls(declaration => assert.ok(!/url\s*\(|expression\s*\(/i.test(declaration.value),
    'No external assets or executable style expressions are allowed'));
  return root.toString();
}

export function compileNotificationStyles() {
  const entries = notificationStyleSources.map(filename => fs.readFileSync(path.join(hub, filename), 'utf8'));
  const compiled = sass.compileString(`@use ${JSON.stringify(global)} as *;\n${entries.join('\n')}`, {
    url: pathToFileURL(path.join(hub, 'components/ibiz-next-vue3/notification-style-entry.scss')),
    style: 'expanded', loadPaths: [path.join(hub, 'node_modules')], logger: sass.Logger.silent,
  });
  const dependencies = [...new Set([global, ...compiled.loadedUrls.filter(url => url.protocol === 'file:').map(fileURLToPath)])]
    .filter(filename => fs.existsSync(filename)).map(filename => ({ path: path.relative(workspace, filename),
      bytes: fs.statSync(filename).size, sha256: digest(fs.readFileSync(filename)) }));
  return { css: scopeNotificationCss(compiled.css), rawCss: compiled.css, dependencies,
    sources: notificationStyleSources.map((filename, index) => ({ path: `ibiz-app-hub/${filename}`,
      bytes: Buffer.byteLength(entries[index]), sha256: digest(entries[index]) })) };
}

export function addNotificationStyleLink(html, cssPath) {
  assert.match(cssPath, /^static\/css\/plm-notification-[a-f0-9]{16}\.css$/);
  const parsed = parseHtml(html, { onError(error) {
    if (error.code === 11 && /^<!doctype\s+html\s*>/i.test(html.slice(error.loc.start.offset))) return;
    throw error;
  } });
  const heads = [];
  const visit = node => {
    if (node.type === 1 && node.tag === 'head') heads.push(node);
    (node.children ?? []).forEach(visit);
  };
  visit(parsed);
  assert.equal(heads.length, 1);
  assert.ok(!html.includes('plm-notification-'), 'A prior notification style entry requires a new review');
  const [head] = heads;
  const end = html.lastIndexOf('</head>', head.loc.end.offset);
  assert.ok(end >= head.loc.start.offset && end < head.loc.end.offset);
  const link = `    <link rel="stylesheet" href="./${cssPath}" />\n  `;
  return html.slice(0, end) + link + html.slice(end);
}

function witness() {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', 'plmweb'], { encoding: 'utf8' }));
  assert.equal(container.Name, '/plmweb');
  assert.ok(container.State.Running);
  return { id: container.Id, image: container.Image, startedAt: container.State.StartedAt,
    restartCount: container.RestartCount,
    mounts: [...container.Mounts].sort((left, right) => left.Destination.localeCompare(right.Destination)),
    configSha256: digest(JSON.stringify({ config: container.Config, host: container.HostConfig })) };
}

export async function prepareNotificationStyle({ output }) {
  assert.ok(path.isAbsolute(output));
  assert.equal(fs.realpathSync(path.dirname(output)), path.join(workspace, '.artifacts'));
  const before = witness();
  const source = compileNotificationStyles();
  const css = Buffer.from(source.css);
  const cssPath = `static/css/plm-notification-${digest(css).slice(0, 16)}.css`;
  const response = await fetch('http://127.0.0.1:30250/ibizplm-plmweb/', { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  const original = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(original), originalIndexSha256, 'The reviewed guard HTML changed');
  const hostIndex = path.join(workspace, 'plm-web/dist/index.html');
  assert.equal(digest(fs.readFileSync(hostIndex)), originalIndexSha256);
  assert.equal(digest(execFileSync('docker', ['exec', before.id, 'cat', '/dist/index.html'])), originalIndexSha256);
  assert.equal(fs.existsSync(path.join(workspace, 'plm-web/dist', cssPath)), false);
  execFileSync('docker', ['exec', before.id, 'sh', '-c',
    'test ! -e "$1" && test ! -L "$1"', 'notification-style', `/dist/${cssPath}`]);
  const index = Buffer.from(addNotificationStyleLink(original.toString(), cssPath));
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (relative, bytes) => {
    const destination = path.join(output, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const handle = fs.openSync(destination, 'wx', 0o600);
    try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    let directory = path.dirname(destination);
    while (directory.startsWith(output)) {
      const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      if (directory === output) break;
      directory = path.dirname(directory);
    }
    return { path: relative, bytes: bytes.length, sha256: digest(bytes) };
  };
  write('rollback/index.html', original);
  const files = [write(`overlay/${cssPath}`, css), write('overlay/index.html', index)];
  const inputs = [...source.sources, ...source.dependencies];
  for (const input of inputs) write(`sources/${input.path}`, fs.readFileSync(path.join(workspace, input.path)));
  const tools = [
    { name: 'sass', entry: require.resolve('sass') },
    { name: 'postcss', entry: require.resolve('postcss') },
    { name: 'postcss-selector-parser', entry: selectorRequire.resolve('postcss-selector-parser') },
  ].map(tool => ({ name: tool.name, path: path.relative(workspace, tool.entry),
    sha256: digest(fs.readFileSync(tool.entry)) }));
  for (const tool of tools) write(`tool-inputs/${tool.path}`, fs.readFileSync(path.join(workspace, tool.path)));
  const script = fs.readFileSync(fileURLToPath(import.meta.url));
  write('executed-preparer.private.mjs', script);
  const after = witness();
  assert.deepEqual(after, before);
  const metadata = fs.statSync(hostIndex);
  const report = { contract: 'private-plm-notification-style-v1', status: 'PREPARED-NOT-DEPLOYED',
    cssPath, files, sources: source.sources, mixinDependencies: source.dependencies, tools,
    sourceCommand: 'node scripts/prepare-plm-notification-style.mjs --output <new-private-directory>',
    preparerSha256: digest(script), nodeVersion: process.version, sassInfo: sass.info,
    dependencySourceClosureReconstructed: false, before, after,
    hostIndexMetadata: { uid: metadata.uid, gid: metadata.gid, mode: (metadata.mode & 0o7777).toString(8) },
    originalIndexSha256, originalStaticResourcesRetained: true,
    cascade: { rootSelector: '.ibiz-user-message-popover.el-popover',
      descendantsScopedToPopup: true, oldBaseMayLoadLater: true, normalInlineWidthOverriddenByImportantRule: true },
    deployment: { scope: ['one-new-hash-css', 'index-html-last'], host: 'plm-web/dist', container: '/dist',
      startupOrder: 'host-dist copied, then plugins subtree, then environment overrides',
      existingPluginsModelsEnvironmentFrameworkUnchanged: true },
    rollback: { input: 'rollback/index.html', sha256: originalIndexSha256,
      restoreOnlyIfCurrentIndexMatchesCandidate: files[1].sha256,
      removeOnlyExactNewCssWithRecordedHashAndOriginalAbsence: files[0].sha256,
      sharedDeploymentPerformed: false },
    syntheticLayoutIsNotBusinessAcceptance: true, actualMobileNotificationAcceptance: false,
    preparedAt: new Date().toISOString() };
  write('notification-style.private.json', Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } });
  prepareNotificationStyle(values).then(report => console.log(JSON.stringify({
    status: report.status, cssPath: report.cssPath, outputs: report.files,
  }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
