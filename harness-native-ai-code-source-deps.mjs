#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  fingerprint, optionalStat, PinnedDirectories, readPinnedFile,
} from './native-candidate-files.mjs';
import { verifyNativeCliSourceBuild } from './harness-native-cli-source-build.mjs';

export const SOURCE_PACKAGES = [
  { id: 'model-core', name: '@ibiz/model-core', path: 'models/model-core', kind: 'tsc' },
  { id: 'rt-model-api', name: '@ibiz/rt-model-api', path: 'models/rt-model-api', kind: 'unbuild' },
  { id: 'core', name: '@ibiz-template/core', path: 'packages/core', kind: 'library' },
  { id: 'runtime', name: '@ibiz-template/runtime', path: 'packages/runtime', kind: 'library' },
  { id: 'model-helper', name: '@ibiz-template/model-helper', path: 'packages/model-helper', kind: 'library' },
  { id: 'vue3-util', name: '@ibiz-template/vue3-util', path: 'packages/vue3-util', kind: 'cli' },
  { id: 'theme', name: '@ibiz-template/theme', path: 'packages/theme', kind: 'scss-input' },
  { id: 'web-theme', name: '@ibiz-template/web-theme', path: 'components/web-theme', kind: 'cli' },
];
export const AI_CODE_SOURCE =
  'vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const aiCode = { id: 'ai-code', name: '@ibiz-template-plugin/ai-code', kind: 'cli' };
const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const generated = new Set(['out', 'es', 'lib', 'dist', 'types']);
const excluded = new Set([
  'node_modules', '.git', '.artifacts', 'cache', '.cache', '.turbo', '.vite',
  '.rollup.cache', '.rpt2_cache', '.eslintcache', '.stylelintcache', 'coverage',
]);
const rootConfigs = [
  'package.json', 'tsconfig.json', '.editorconfig', '.eslintignore', '.eslintrc.cjs',
  '.prettierrc.yaml', '.stylelintrc.yaml', 'commitlint.config.cjs',
];
const ownTools = new Set([
  '@ibiz-template/cli', '@ibiz-template/cli-core', '@ibizlab/cli', '@ibizlab/cli-core',
]);
const cliVersions = ['0.3.0', '0.3.23', '0.3.30'];
const sections = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies'];
const isFramework = name => /^@(?:ibiz(?:-template(?:-plugin)?)?|ibizlab)\//.test(name);
const inside = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);
const manifest = root => JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'));
const entriesOnly = contents => contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
const aliasParsers = new Map();

function npmAlias(owner, name, actualName) {
  const declared = declarations(manifest(owner)).filter(item => item.name === name);
  if (!declared.some(item => item.range.startsWith('npm:'))) return null;
  const req = createRequire(join(owner, 'package.json'));
  const search = req.resolve.paths('npm-package-arg') ?? [];
  const path = [...search, ...search.map(root => join(root, '.pnpm/node_modules'))]
    .map(root => join(root, 'npm-package-arg/package.json')).find(candidate => fs.existsSync(candidate));
  assert.ok(path, 'Installed npm-package-arg required to audit an npm alias');
  const realpath = fs.realpathSync(dirname(path));
  assert.ok(!realpath.split(sep).includes('.artifacts'), 'Artifact alias parser rejected');
  const value = manifest(realpath);
  assert.equal(value.name, 'npm-package-arg', 'Alias parser identity differs');
  let parser = aliasParsers.get(realpath);
  if (!parser) {
    parser = createRequire(join(realpath, 'package.json'))(realpath);
    aliasParsers.set(realpath, parser);
  }
  for (const item of declared) {
    const parsed = parser.resolve(name, item.range, owner);
    if (parsed.type === 'alias' && parsed.subSpec.name === actualName) {
      return {
        aliasDeclaration: item.range, aliasTargetRange: parsed.subSpec.rawSpec,
        aliasParser: { name: value.name, version: value.version, realpath },
      };
    }
  }
  return null;
}

function omit(name, depth) {
  return excluded.has(name) || name.endsWith('.tsbuildinfo') ||
    (depth === 0 && generated.has(name)) || name.startsWith('.rpt2_cache');
}

// Trusted source trees, cooperative single writer; not an atomic multi-file snapshot.
export function sourceFiles(root, { names } = {}) {
  const directories = new PinnedDirectories();
  const files = [];
  let bytes = 0;
  function visit(directory, prefix = '') {
    directories.verify(directory);
    for (const entry of fs.readdirSync(directory.access).sort()) {
      if ((!prefix && names && !names.includes(entry)) || omit(entry, prefix ? 1 : 0)) continue;
      const path = prefix ? `${prefix}/${entry}` : entry;
      const info = fs.lstatSync(directories.entry(directory, entry));
      assert.ok(!info.isSymbolicLink(), `Symlink source input rejected: ${path}`);
      assert.ok(!entry.includes('\\'), `Ambiguous source input: ${path}`);
      if (info.isDirectory()) {
        visit(directories.open(join(directory.path, entry)), path);
      } else {
        const { data } = readPinnedFile(directories, directory, entry, info);
        bytes += data.length;
        assert.ok(bytes <= 256 * 1024 * 1024, 'Source input tree too large');
        files.push({ path, bytes: data.length, sha256: hash(data), data });
      }
    }
    directories.verify(directory);
  }
  try { visit(directories.open(root)); }
  finally { directories.close(); }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function installedPackage(owner, name, { optional = false } = {}) {
  assert.match(name, /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/, 'Invalid package name');
  const req = createRequire(join(owner, 'package.json'));
  // A declared npm dependency can share a name with a Node builtin (e.g. string_decoder).
  const path = req.resolve.paths('__ibiz_package_lookup__')?.map(root => join(root, name, 'package.json'))
    .find(candidate => fs.existsSync(candidate));
  if (!path && optional) return null;
  assert.ok(path, `Installed package unavailable: ${name} from ${owner}`);
  const realpath = fs.realpathSync(dirname(path));
  assert.ok(!realpath.split(sep).includes('.artifacts'),
    `Old artifact dependency rejected: ${realpath}`);
  const value = manifest(realpath);
  let alias;
  if (value.name !== name) {
    alias = npmAlias(owner, name, value.name);
    assert.ok(alias && !isFramework(name) && !isFramework(value.name),
      `Installed package identity differs without a third-party npm alias: ${realpath}`);
  }
  return { name, version: value.version, realpath, manifest: value,
    ...(alias ? { actualName: value.name, ...alias } : {}) };
}

function identity(pkg) {
  return { name: pkg.name, version: pkg.version, realpath: pkg.realpath,
    ...(pkg.aliasDeclaration ? {
      linkName: pkg.name, actualName: pkg.actualName, aliasDeclaration: pkg.aliasDeclaration,
      aliasTargetRange: pkg.aliasTargetRange, aliasParser: pkg.aliasParser,
    } : {}) };
}

function tool(owner, name, bin) {
  const pkg = installedPackage(owner, name);
  const bins = pkg.manifest.bin;
  const entry = typeof bins === 'string' ? bins : bins?.[bin];
  assert.ok(entry, `Missing explicit tool entry: ${name}/${bin}`);
  const path = fs.realpathSync(resolve(pkg.realpath, entry));
  assert.ok(inside(pkg.realpath, path) && fs.statSync(path).isFile(), `Invalid tool entry: ${path}`);
  return { ...identity(pkg), entry: path, entrySha256: hash(fs.readFileSync(path)),
    sourceVerified: false, role: ownTools.has(name) ? 'published-own-toolchain' : 'installed-toolchain' };
}

function loadCliSourceReports(workspace, paths, pins) {
  if (paths === undefined) return null;
  assert.ok(Array.isArray(paths) && paths.length === cliVersions.length,
    'CLI source reports must contain the three exact releases');
  assert.ok(paths.every(path => typeof path === 'string' && path),
    'Invalid CLI source report path');
  assert.equal(new Set(paths.map(path => resolve(workspace, path))).size, paths.length,
    'Duplicate CLI source report path');
  const builds = new Map();
  for (const sourceReport of paths) {
    // Default production pins are never replaced by claims inside a receipt.
    const verified = verifyNativeCliSourceBuild({
      workspace, sourceReport, ...(pins ? { pins } : {}),
    });
    const version = verified.report.version;
    assert.ok(cliVersions.includes(version), 'Unsupported exact CLI source version');
    assert.ok(!builds.has(version), 'Duplicate CLI source release');
    builds.set(version, verified);
  }
  assert.deepEqual([...builds.keys()].sort(), [...cliVersions].sort(),
    'Missing exact CLI source release');
  return builds;
}

function cliReportEvidence(builds) {
  return cliVersions.map(version => {
    const verified = builds.get(version);
    const report = verified.report;
    return {
      version, reportPath: verified.reportPath, reportSha256: verified.reportSha256,
      cliSourceBuildVerified: verified.cliSourceBuildVerified,
      sourceFingerprint: report.source.fingerprint,
      commit: report.source.commit, tree: report.source.tree,
      stage: report.stage, outputFingerprint: report.outputs.fingerprint,
    };
  });
}

function sourceBuiltCli(owner, builds) {
  const consumerCli = installedPackage(owner, '@ibiz-template/cli');
  assert.ok(cliVersions.includes(consumerCli.version), 'Unsupported exact consumer CLI version');
  const consumerCore = installedPackage(consumerCli.realpath, '@ibiz-template/cli-core');
  assert.equal(consumerCore.version, consumerCli.version, 'Original consumer CLI/core version mismatch');
  const verified = builds.get(consumerCli.version);
  assert.ok(verified, 'No source-built CLI for exact consumer version');
  const { report } = verified;
  const cliRoot = join(report.stage, 'packages/cli');
  const coreRoot = join(report.stage, 'packages/core');
  const directories = new PinnedDirectories();
  try {
    const cli = directories.open(cliRoot);
    const core = directories.open(coreRoot);
    for (const [directory, name] of [[cli, '@ibiz-template/cli'], [core, '@ibiz-template/cli-core']]) {
      const value = JSON.parse(readPinnedFile(directories, directory, 'package.json').data);
      assert.equal(value.name, name, 'Source-built CLI/core identity mismatch');
      assert.equal(value.version, consumerCli.version, 'Source-built CLI/core version mismatch');
      if (name === '@ibiz-template/cli') {
        assert.equal(value.bin?.['ibiz-temp'], 'dist/bin.js', 'Unexpected source-built CLI entry');
        assert.equal(value.dependencies?.['@ibiz-template/cli-core'], 'workspace:*',
          'Source-built CLI/core declaration changed');
      }
    }
    const coreLink = join(cliRoot, 'node_modules/@ibiz-template/cli-core');
    assert.ok(optionalStat(coreLink)?.isSymbolicLink(), 'Source-built core link missing');
    assert.equal(fs.readlinkSync(coreLink), coreRoot, 'Source-built core link downgrade');
    assert.equal(fs.realpathSync(coreLink), coreRoot, 'Source-built core target downgrade');
    const entry = join(cliRoot, 'dist/bin.js');
    const entryBytes = readPinnedFile(directories, directories.open(dirname(entry)), 'bin.js').data;
    const sourceVerified = verified.cliSourceBuildVerified;
    return {
      name: '@ibiz-template/cli', version: consumerCli.version, realpath: cliRoot,
      entry, entrySha256: hash(entryBytes), sourceVerified, role: 'source-built-own-toolchain',
      sourceReport: verified.reportPath, sourceReportSha256: verified.reportSha256,
      sourceBuiltCore: {
        name: '@ibiz-template/cli-core', version: consumerCli.version, realpath: coreRoot,
        outputFingerprint: report.completedOutputs.core.fingerprint, sourceVerified,
      },
      originalConsumer: { cli: identity(consumerCli), core: identity(consumerCore) },
    };
  } finally { directories.close(); }
}

function toolchainVerified(builds, tools) {
  const own = tools.tools.filter(tool => ownTools.has(tool.name));
  return Boolean(builds && own.length > 0 &&
    cliReportEvidence(builds).every(report => report.cliSourceBuildVerified) &&
    own.every(tool => tool.role === 'source-built-own-toolchain' && tool.sourceVerified) &&
    tools.publishedOwnToolchain.length === 0);
}

function installedNames(owner) {
  const root = join(owner, 'node_modules');
  if (!optionalStat(root)) return [];
  const names = [];
  for (const entry of fs.readdirSync(root).filter(name => !name.startsWith('.'))) {
    if (entry.startsWith('@')) {
      for (const child of fs.readdirSync(join(root, entry))) names.push(`${entry}/${child}`);
    } else names.push(entry);
  }
  return names;
}

function declarations(value) {
  return sections.flatMap(section => Object.entries(value[section] ?? {}).map(([name, range]) =>
    ({ section, name, range })));
}

function missingDeclarations(report, owner, value, declared) {
  for (const item of declared) {
    const optional = Object.hasOwn(value.optionalDependencies ?? {}, item.name) ||
      (item.section === 'peerDependencies' &&
        value.peerDependenciesMeta?.[item.name]?.optional === true);
    report.unavailablePackages.push({ owner, ...item, optional });
  }
  const required = declared.find(item =>
    !Object.hasOwn(value.optionalDependencies ?? {}, item.name) &&
    !(item.section === 'peerDependencies' &&
      value.peerDependenciesMeta?.[item.name]?.optional === true));
  assert.ok(!required,
    `Required dependency unavailable: ${owner} -> ${required?.name} (${required?.section})`);
}

function originalGraph(source, closure) {
  const graph = [];
  const visited = new Set();
  function visit(owner, value) {
    if (visited.has(owner)) return;
    visited.add(owner);
    for (const declared of declarations(value).filter(item => closure.has(item.name))) {
      const found = installedPackage(owner, declared.name, { optional: true });
      graph.push({
        owner: value.name, ownerVersion: value.version, ownerRealpath: owner,
        ...declared, originalResolved: found ? identity(found) : null,
        hubRebase: { name: declared.name, version: closure.get(declared.name).version },
        declaredRangeCompatibility: 'not-verified',
      });
      if (found) visit(found.realpath, found.manifest);
    }
  }
  visit(source.original, source.manifest);
  return graph;
}

function link(directories, root, name, target) {
  const path = join(root, 'node_modules', name);
  const parent = directories.open(dirname(path), { create: true });
  directories.verify(parent);
  assert.ok(!optionalStat(directories.entry(parent, basename(path))), `Existing module link: ${path}`);
  fs.symlinkSync(target, directories.entry(parent, basename(path)), 'dir');
  directories.verify(parent);
}

export function verifyFrameworkLinks(contexts, closure) {
  for (const context of contexts) {
    for (const [name, pkg] of closure) {
      const path = join(context.stage, 'node_modules', name);
      assert.ok(optionalStat(path)?.isSymbolicLink(), `Framework mapping missing: ${name}`);
      assert.equal(fs.realpathSync(path), pkg.stage, `Published framework fallback rejected: ${name}`);
    }
  }
}

function mapModules(directories, contexts, closure, report, { verifyOnly = false, cliBuilds } = {}) {
  const rootNames = installedNames(contexts[0].original);
  const audited = new Set();
  function mapLink(root, name, target) {
    if (!verifyOnly) return link(directories, root, name, target);
    const path = join(root, 'node_modules', name);
    assert.ok(optionalStat(path)?.isSymbolicLink(), `Module mapping missing: ${name}`);
    assert.equal(fs.realpathSync(path), target, `Module mapping changed: ${name}`);
  }
  // Reused runtime dependencies must not resolve a transitive framework binary.
  // Published CLI tool trees are separate evidence, never source-localized.
  function audit(pkg, role) {
    const key = `${role}:${pkg.realpath}`;
    if (audited.has(key)) return;
    audited.add(key);
    report.reusedPackages.push({ ...identity(pkg), role, sourceVerified: false });
    for (const declared of declarations(pkg.manifest).filter(item =>
      item.section !== 'devDependencies')) {
      const found = installedPackage(pkg.realpath, declared.name, { optional: true });
      if (!found) {
        missingDeclarations(report, pkg.name, pkg.manifest, [declared]);
        continue;
      }
      if (closure.has(found.name)) {
        assert.equal(role, 'published-toolchain',
          `Published framework fallback through ${pkg.name}: ${found.name}`);
        report.toolchainFrameworkBinaries.push({ owner: pkg.name, ...identity(found) });
      } else if (isFramework(found.name)) {
        assert.ok(role === 'published-toolchain' && ownTools.has(found.name),
          `Framework outside source closure: ${pkg.name} -> ${found.name}`);
      }
      audit(found, role);
    }
  }
  for (const context of contexts) {
    const declared = declarations(context.manifest);
    const names = new Set([...rootNames, ...installedNames(context.original),
      ...declared.map(item => item.name), ...closure.keys()]);
    for (const name of [...names].sort()) {
      if (closure.has(name)) {
        const pkg = closure.get(name);
        mapLink(context.stage, name, pkg.stage);
        report.moduleLinks.push({ owner: context.id, name, target: pkg.stage, role: 'staged-source' });
        continue;
      }
      if (ownTools.has(name) &&
          !(context.kind === 'cli' && name === '@ibiz-template/cli')) {
        const declarations = declared.filter(item => item.name === name);
        assert.ok(declarations.every(item => item.section === 'devDependencies'),
          `Unplanned framework tool in runtime dependencies: ${context.id} -> ${name}`);
        report.omittedToolchainPackages.push({
          owner: context.id, name, declarations, reason: 'not-in-build-command-plan',
        });
        continue;
      }
      if (isFramework(name) && !ownTools.has(name)) {
        assert.ok(!declared.some(item => item.name === name),
          `Declared framework outside source closure: ${context.id} -> ${name}`);
        report.omittedFrameworkPackages.push({ owner: context.id, name });
        continue;
      }
      if (name === '@ibiz-template/cli' && cliBuilds) {
        const found = sourceBuiltCli(context.original, cliBuilds);
        mapLink(context.stage, name, found.realpath);
        report.moduleLinks.push({
          owner: context.id, name, version: found.version, target: found.realpath,
          role: found.role, sourceVerified: found.sourceVerified,
        });
        continue;
      }
      const found = installedPackage(context.original, name, { optional: true });
      if (!found) {
        missingDeclarations(report, context.id, context.manifest,
          declared.filter(item => item.name === name));
        continue;
      }
      const role = ownTools.has(name) ? 'published-toolchain' : 'installed-third-party';
      audit(found, role);
      mapLink(context.stage, name, found.realpath);
      report.moduleLinks.push({ owner: context.id, ...identity(found), target: found.realpath, role });
    }
  }
  verifyFrameworkLinks(contexts, closure);
}

function copyInputs(directories, context, files) {
  directories.open(context.stage, { create: true, exclusive: true });
  for (const file of files) {
    const path = join(context.stage, file.path);
    directories.write(directories.open(dirname(path), { create: true }), basename(path), file.data);
  }
}

function requiredOutputs(pkg) {
  if (pkg.kind === 'tsc') return ['out/index.js', 'out/index.d.ts'];
  if (pkg.kind === 'unbuild') return [
    'es/index.mjs', 'es/index.d.ts', 'lib/index.js', 'dist/ibiz-rt-model-api.umd.js',
  ];
  if (pkg.kind === 'library') return [
    'out/index.js', 'out/index.d.ts', 'dist/index.esm.js', 'dist/index.system.min.js',
  ];
  return ['es/index.mjs', 'es/index.d.ts', 'lib/index.cjs', 'dist/index.system.min.js'];
}

function commandsFor(pkg, report, cliBuilds) {
  const commands = [];
  function compiler(name, bin, args) {
    const found = name === '@ibiz-template/cli' && cliBuilds
      ? sourceBuiltCli(pkg.original, cliBuilds) : tool(pkg.original, name, bin);
    report.tools.push({ owner: pkg.id, ...found });
    commands.push({ entry: found.entry, args, tool: `${name}@${found.version}` });
    if (name === '@ibiz-template/cli') {
      if (cliBuilds) report.sourceBuiltOwnToolchain.push({ owner: pkg.id, ...found });
      else {
        const core = installedPackage(found.realpath, '@ibiz-template/cli-core');
        report.publishedOwnToolchain.push({ owner: pkg.id, ...identity(core), sourceVerified: false });
        report.publishedOwnToolchain.push({ owner: pkg.id, ...found });
      }
    }
  }
  function script(path) {
    const entry = join(pkg.stage, path);
    assert.ok(fs.lstatSync(entry).isFile(), `Missing source build entry: ${entry}`);
    commands.push({ entry, args: [], tool: 'copied-source-script', entrySha256: hash(fs.readFileSync(entry)) });
  }
  if (pkg.kind === 'tsc') compiler('typescript', 'tsc', ['--build']);
  else if (pkg.kind === 'unbuild') {
    compiler('unbuild', 'unbuild', []);
    script('scripts/build.mjs');
  } else if (pkg.kind === 'library') {
    script('scripts/build.js');
    compiler('rollup', 'rollup', ['-c']);
    compiler('typescript', 'tsc', ['--build']);
  } else {
    compiler('@ibiz-template/cli', 'ibiz-temp', ['build', '-c']);
    compiler('vue-tsc', 'vue-tsc', ['--declaration', '--emitDeclarationOnly']);
  }
  return commands;
}

function outputInventory(root) {
  const directories = new PinnedDirectories();
  const entries = [];
  function visit(directory, prefix) {
    directories.verify(directory);
    for (const name of fs.readdirSync(directory.access).sort()) {
      const path = `${prefix}/${name}`;
      const info = fs.lstatSync(directories.entry(directory, name));
      assert.ok(!info.isSymbolicLink(), `Symlink build output rejected: ${path}`);
      if (info.isDirectory()) visit(directories.open(join(directory.path, name)), path);
      else {
        const { data } = readPinnedFile(directories, directory, name, info);
        entries.push({ path, bytes: data.length, sha256: hash(data) });
      }
    }
  }
  try {
    const directory = directories.open(root);
    for (const name of fs.readdirSync(directory.access).sort()) {
      if (generated.has(name) && optionalStat(join(root, name))) {
        visit(directories.open(join(root, name)), name);
      } else if (name.endsWith('.tsbuildinfo')) {
        const { data } = readPinnedFile(directories, directory, name);
        entries.push({ path: name, bytes: data.length, sha256: hash(data) });
      }
    }
  } finally { directories.close(); }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { ...fingerprint(entries), entries };
}

function privateEnvironment(directories, destination) {
  const bin = directories.open(join(destination, 'bin'), { create: true });
  const home = directories.open(join(destination, 'home'), { create: true });
  const cache = directories.open(join(destination, 'cache'), { create: true });
  const tmp = directories.open(join(destination, 'tmp'), { create: true });
  const deny = directories.write(bin, 'deny-package-manager.cjs',
    '#!/usr/bin/env node\nconsole.error("Package-manager invocation forbidden in source probe"); process.exit(126);\n');
  fs.chmodSync(directories.entry(bin, 'deny-package-manager.cjs'), 0o700);
  assert.equal(fs.lstatSync(directories.entry(bin, 'deny-package-manager.cjs')).ino, deny.ino);
  for (const name of ['npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'yarnpkg', 'corepack', 'bun']) {
    fs.symlinkSync('deny-package-manager.cjs', directories.entry(bin, name));
  }
  fs.symlinkSync(process.execPath, directories.entry(bin, 'node'));
  directories.write(home, '.npmrc', 'registry=http://127.0.0.1:9/\noffline=true\nignore-scripts=true\n');
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(NODE_OPTIONS|NODE_PATH|INIT_CWD|npm_|PNPM_|COREPACK_|YARN_)/i.test(name)) delete env[name];
  }
  return {
    ...env, PATH: `${bin.path}:/usr/bin:/bin`, HOME: home.path, TMPDIR: tmp.path,
    XDG_CACHE_HOME: cache.path, JITI_CACHE_DIR: join(cache.path, 'jiti'), JITI_CACHE: 'false',
    npm_config_userconfig: join(home.path, '.npmrc'), npm_config_cache: join(cache.path, 'npm'),
    npm_config_registry: 'http://127.0.0.1:9/', npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true', COREPACK_ENABLE_NETWORK: '0',
  };
}

function destinationFor(workspace, output) {
  const root = join(workspace, '.artifacts/native-ai-code-source-deps');
  const destination = resolve(workspace, output ?? join(root, `probe-${randomUUID()}`));
  assert.equal(dirname(destination), root,
    'Output must be a direct child of .artifacts/native-ai-code-source-deps');
  assert.match(basename(destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid output name');
  return { root, destination };
}

function sourceSpecs(workspace, destination) {
  const hub = join(workspace, 'ibiz-app-hub');
  const stage = join(destination, 'source');
  return [
    { id: 'hub-config', original: hub, stage, names: rootConfigs },
    ...SOURCE_PACKAGES.map(pkg => ({ ...pkg, original: join(hub, pkg.path), stage: join(stage, pkg.path) })),
    { ...aiCode, original: join(workspace, AI_CODE_SOURCE), stage: join(stage, 'plugins/ai-code') },
  ];
}

export function verifyAiCodeSourceDepsHarness(options = {}) {
  const workspace = resolve(options.workspace ?? workspaceDefault);
  assert.ok(typeof options.sourceReport === 'string' && options.sourceReport,
    'A source dependency report path is required');
  const reportPath = resolve(workspace, options.sourceReport);
  assert.equal(basename(reportPath), 'report.json', 'Expected a source dependency report.json');
  const { destination } = destinationFor(workspace, dirname(reportPath));
  const directories = new PinnedDirectories();
  try {
    const run = directories.open(destination);
    const receipt = readPinnedFile(directories, run, 'report.json');
    const report = JSON.parse(receipt.data.toString('utf8'));
    assert.equal(report.schemaVersion, 1, 'Unsupported source dependency report schema');
    assert.equal(report.contract, 'native-ai-code-source-runtime-deps-probe', 'Unexpected source report contract');
    assert.equal(report.status, 'source-runtime-deps-probe-complete-not-accepted', 'Source dependency build did not complete');
    assert.equal(report.exitCode, 2, 'Source dependency build did not complete');
    assert.equal(report.workspace, workspace, 'Source dependency workspace changed');
    assert.equal(report.destination, destination, 'Source dependency destination changed');
    for (const key of ['runtimeSourceBuildsVerified', 'aiCodeSourceBuildVerified']) {
      assert.equal(report[key], true, `Source build evidence missing: ${key}`);
    }
    for (const key of ['nativeAccepted', 'acceptedForProduction', 'fullLocalization',
      'sourceRepositoryAuthenticityVerified',
      'originalVersionReproductionVerified']) {
      assert.equal(report[key], false, `Unsupported source build acceptance: ${key}`);
    }
    assert.deepEqual(report.errors, [], 'Source dependency build contains errors');
    assert.deepEqual(report.outputDrift, [], 'Source dependency build contains output drift');
    assert.deepEqual(report.sourceDrift, { original: 'unchanged', staged: 'unchanged' },
      'Source dependency build contains source drift');
    const cliBuilds = loadCliSourceReports(workspace,
      report.cliSourceReports?.map(item => item.reportPath), options.cliSourcePins);
    if (cliBuilds) {
      assert.deepEqual(report.cliSourceReports, cliReportEvidence(cliBuilds),
        'CLI source report evidence changed');
    }
    const specs = sourceSpecs(workspace, destination);
    assert.deepEqual(report.sources.map(pkg => pkg.id), specs.map(pkg => pkg.id), 'Source package set changed');
    const contexts = specs.map((spec, index) => {
      const recorded = report.sources[index];
      const entries = entriesOnly(sourceFiles(spec.original, { names: spec.names }));
      assert.deepEqual(entriesOnly(sourceFiles(spec.stage, { names: spec.names })), entries,
        `Staged source input drift: ${spec.id}`);
      assert.deepEqual(recorded.entries, entries, `Original source input drift: ${spec.id}`);
      const value = manifest(spec.original);
      assert.deepEqual({
        name: recorded.name, version: recorded.version, original: recorded.original,
        staged: recorded.staged, files: recorded.files, bytes: recorded.bytes,
        fingerprint: recorded.fingerprint, fingerprintKind: recorded.fingerprintKind,
      }, {
        name: value.name, version: value.version, original: spec.original,
        staged: spec.stage, ...fingerprint(entries),
      }, `Source identity/inventory changed: ${spec.id}`);
      if (spec.name) assert.equal(value.name, spec.name, `Source package identity changed: ${spec.id}`);
      return { ...spec, manifest: value, version: value.version, entries };
    });
    const closure = new Map(contexts.filter(pkg => pkg.kind).map(pkg => [pkg.name, pkg]));
    assert.deepEqual(report.originalResolvedToHubRebase, originalGraph(contexts.at(-1), closure),
      'Original dependency resolution changed');
    const dependencyKeys = [
      'moduleLinks', 'reusedPackages', 'omittedFrameworkPackages', 'omittedToolchainPackages',
      'unavailablePackages', 'toolchainFrameworkBinaries',
    ];
    const current = Object.fromEntries(dependencyKeys.map(key => [key, []]));
    mapModules(directories, contexts, closure, current, { verifyOnly: true, cliBuilds });
    for (const key of dependencyKeys) {
      assert.deepEqual(report[key], current[key], `Dependency evidence changed: ${key}`);
    }
    const buildPackages = contexts.filter(pkg => pkg.kind && pkg.kind !== 'scss-input');
    assert.deepEqual(report.steps.map(step => step.id), buildPackages.map(pkg => pkg.id),
      'Source build step set changed');
    const tools = { tools: [], publishedOwnToolchain: [], sourceBuiltOwnToolchain: [] };
    for (const [index, pkg] of buildPackages.entries()) {
      const step = report.steps[index];
      assert.equal(step.status, 'built', `Source build step incomplete: ${step.id}`);
      const commands = commandsFor(pkg, tools, cliBuilds);
      assert.deepEqual(step.plannedCommands, commands, `Source build command plan changed: ${step.id}`);
      assert.equal(step.commands.length, commands.length, `Source build commands incomplete: ${step.id}`);
      for (const [commandIndex, plan] of commands.entries()) {
        const command = step.commands[commandIndex];
        assert.deepEqual({
          entry: command.entry, args: command.args, tool: command.tool,
          ...(plan.entrySha256 ? { entrySha256: command.entrySha256 } : {}),
        }, plan, `Source build command changed: ${step.id}`);
        assert.equal(command.executable, process.execPath, 'Source compiler executable changed');
        assert.equal(command.cwd, pkg.stage, 'Source build cwd changed');
        assert.equal(command.exitCode, 0, 'Source build command failed');
        assert.equal(command.signal, null, 'Source build command was interrupted');
        assert.equal(command.error, null, 'Source build command contains an error');
        const logName = `${step.id}-${commandIndex + 1}.log`;
        assert.equal(command.log, `logs/${logName}`, 'Source build log path changed');
        const log = readPinnedFile(directories, directories.open(join(destination, 'logs')), logName).data;
        assert.equal(command.logBytes, log.length, 'Source build log length changed');
        assert.equal(command.logSha256, hash(log), 'Source build log hash changed');
      }
      const outputs = outputInventory(pkg.stage);
      assert.deepEqual(step.completedOutputs, outputs, `Build output drift: ${step.id}`);
      assert.deepEqual(step.outputs, outputs, `Build output drift: ${step.id}`);
      assert.deepEqual(step.commands.at(-1).outputs, outputs, `Final command output drift: ${step.id}`);
      assert.deepEqual(step.requiredOutputs, requiredOutputs(pkg), 'Required build outputs changed');
      for (const path of requiredOutputs(pkg)) {
        assert.ok(outputs.entries.some(entry => entry.path === path && entry.bytes > 0),
          `Missing fresh build output: ${step.id}/${path}`);
      }
    }
    assert.deepEqual(report.tools, tools.tools, 'Build tool identity changed');
    assert.deepEqual(report.publishedOwnToolchain, tools.publishedOwnToolchain, 'Published toolchain identity changed');
    assert.deepEqual(report.sourceBuiltOwnToolchain ?? [], tools.sourceBuiltOwnToolchain,
      'Source-built own toolchain evidence changed');
    assert.equal(report.toolchainSourceVerified, toolchainVerified(cliBuilds, tools),
      'Toolchain source verification claim changed');
    if (cliBuilds) {
      assert.deepEqual(cliReportEvidence(loadCliSourceReports(workspace,
        report.cliSourceReports.map(item => item.reportPath), options.cliSourcePins)),
      report.cliSourceReports, 'CLI source report drift during verification');
    }
    assert.deepEqual(readPinnedFile(directories, run, 'report.json', receipt.identity).data, receipt.data,
      'Source dependency report changed during verification');
    return {
      report, reportPath, reportSha256: hash(receipt.data), dependencySourceBuildsVerified: true,
      toolchainSourceVerified: report.toolchainSourceVerified,
    };
  } finally { directories.close(); }
}

export function runAiCodeSourceDepsHarness(options = {}) {
  const workspace = resolve(options.workspace ?? workspaceDefault);
  const { root, destination } = destinationFor(workspace, options.output);
  const directories = new PinnedDirectories();
  const report = {
    schemaVersion: 1, contract: 'native-ai-code-source-runtime-deps-probe',
    startedAt: new Date().toISOString(), status: 'failed', exitCode: 1,
    nativeAccepted: false, acceptedForProduction: false, fullLocalization: false,
    originalVersionReproductionVerified: false, declaredRangeCompatibility: 'not-verified',
    runtimeSourceBuildsVerified: false, aiCodeSourceBuildVerified: false,
    toolchainSourceVerified: false, sourceRepositoryAuthenticityVerified: false,
    scope: 'Eight hub packages rebased into an independent source build plus ai-code; not full application acceptance',
    trustBoundary: 'Trusted owner/group/root and cooperative single writer; no arbitrary concurrent replacement or atomic multi-file snapshot guarantee',
    isolation: {
      packageManagerInvocationsAllowed: false, sharedManifestOrLockWritesAllowed: false,
      copiedSourceBuildCwdOnly: true, sharedInstalledPackagesReused: true,
      securitySandbox: false, arbitrarySourceScriptsSupported: false,
    },
    workspace, destination, node: { version: process.version, executable: process.execPath },
    sources: [], originalResolvedToHubRebase: [], moduleLinks: [], reusedPackages: [],
    omittedFrameworkPackages: [], omittedToolchainPackages: [], unavailablePackages: [], tools: [],
    publishedOwnToolchain: [], sourceBuiltOwnToolchain: [], toolchainFrameworkBinaries: [], steps: [],
    outputDrift: [],
    sourceDrift: { original: 'not-checked', staged: 'not-checked' }, errors: [],
    limitations: [
      'Rebase differs from original published dependency versions; declared ranges and behavior are not accepted.',
      'Installed third parties and published CLI/CLI-core are not source-built toolchain evidence.',
      'No browser, original-source gate, standard-service, production or native acceptance is conferred.',
      'Trusted build scripts run with private cwd/home/cache and package-manager PATH guards, not an OS security sandbox.',
    ],
  };
  const contexts = [];
  let cliBuilds;
  let run;
  function checkInputs(context, staged) {
    const path = staged ? context.stage : context.original;
    const current = entriesOnly(sourceFiles(path, { names: context.names }));
    assert.deepEqual(current, context.entries,
      `${staged ? 'Staged' : 'Original'} source input drift: ${context.id}`);
  }
  function checkOutputs(step, phase) {
    const pkg = contexts.find(context => context.id === step.id);
    const actual = outputInventory(pkg.stage);
    step.outputs = actual;
    if (!step.completedOutputs || actual.fingerprint === step.completedOutputs.fingerprint) return;
    if (!report.outputDrift.some(item => item.owner === step.id &&
        item.actual.fingerprint === actual.fingerprint)) {
      report.outputDrift.push({
        owner: step.id, phase, expected: step.completedOutputs, actual,
      });
    }
    assert.fail(`Build output drift: ${step.id} (${phase})`);
  }
  function checkCompletedOutputs(phase) {
    for (const step of report.steps.filter(item => item.completedOutputs)) checkOutputs(step, phase);
  }
  function checkCliReports() {
    if (!cliBuilds) return;
    const current = loadCliSourceReports(workspace, options.cliSourceReports, options.cliSourcePins);
    assert.deepEqual(cliReportEvidence(current), report.cliSourceReports, 'CLI source report drift');
  }
  function checkCliLinks() {
    if (!cliBuilds) return;
    for (const mapped of report.moduleLinks.filter(item => item.role === 'source-built-own-toolchain')) {
      const context = contexts.find(item => item.id === mapped.owner);
      const path = join(context.stage, 'node_modules', mapped.name);
      assert.ok(optionalStat(path)?.isSymbolicLink(), 'Source-built CLI mapping missing');
      assert.equal(fs.readlinkSync(path), mapped.target, 'Source-built CLI mapping downgrade');
      assert.equal(fs.realpathSync(path), mapped.target, 'Source-built CLI target downgrade');
    }
  }
  try {
    directories.open(root, { create: true });
    run = directories.open(destination, { create: true, exclusive: true });
    const specs = sourceSpecs(workspace, destination);
    // Initialize all statuses before any copying/resolution can fail.
    report.steps = specs.filter(pkg => pkg.kind && pkg.kind !== 'scss-input').map(pkg => ({
      id: pkg.id, status: 'not-executed', commands: [], requiredOutputs: requiredOutputs(pkg),
    }));
    cliBuilds = loadCliSourceReports(workspace, options.cliSourceReports, options.cliSourcePins);
    if (cliBuilds) report.cliSourceReports = cliReportEvidence(cliBuilds);
    for (const spec of specs) {
      const files = sourceFiles(spec.original, { names: spec.names });
      const entries = entriesOnly(files);
      const value = JSON.parse(files.find(file => file.path === 'package.json')?.data.toString() ?? 'null');
      assert.ok(value?.name && value.version, `Missing source manifest: ${spec.id}`);
      if (spec.name) assert.equal(value.name, spec.name, `Canonical source identity differs: ${spec.id}`);
      if (spec.kind === 'scss-input') {
        assert.ok(entries.some(file => file.path.startsWith('style/') && file.path.endsWith('.scss')),
          'Theme must contain source SCSS');
      } else if (spec.kind) {
        assert.ok(entries.some(file => file.path.startsWith('src/')), `Missing source inputs: ${spec.id}`);
      }
      const context = { ...spec, manifest: value, version: value.version, entries };
      contexts.push(context);
      report.sources.push({
        id: spec.id, name: value.name, version: value.version,
        original: spec.original, staged: spec.stage, ...fingerprint(entries), entries,
        ...(spec.kind === 'scss-input' ? { status: 'scss-input-recorded', compile: 'not-applicable' } : {}),
      });
      copyInputs(directories, context, files);
      checkInputs(context, true);
      checkInputs(context, false);
    }
    const closure = new Map(contexts.filter(pkg => pkg.kind).map(pkg => [pkg.name, pkg]));
    report.originalResolvedToHubRebase = originalGraph(contexts.at(-1), closure);
    mapModules(directories, contexts, closure, report, { cliBuilds });
    const env = privateEnvironment(directories, destination);
    const logs = directories.open(join(destination, 'logs'), { create: true });
    for (const step of report.steps) {
      step.plannedCommands = commandsFor(contexts.find(context => context.id === step.id), report, cliBuilds);
    }
    for (const step of report.steps) {
      const pkg = contexts.find(context => context.id === step.id);
      checkCliReports();
      checkCliLinks();
      checkCompletedOutputs(`before ${step.id}`);
      checkInputs(pkg, false);
      checkInputs(pkg, true);
      verifyFrameworkLinks(contexts, closure);
      step.status = 'running';
      for (const [index, command] of step.plannedCommands.entries()) {
        if (cliBuilds && command.tool.startsWith('@ibiz-template/cli@')) {
          checkCliReports();
          checkCliLinks();
        }
        const logName = `${step.id}-${index + 1}.log`;
        directories.write(logs, logName, '');
        const fd = fs.openSync(directories.entry(logs, logName),
          fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
        const started = Date.now();
        let result;
        try {
          result = spawnSync(process.execPath, [command.entry, ...command.args], {
            cwd: pkg.stage, env, stdio: ['ignore', fd, fd],
            timeout: options.timeout ?? 600_000,
          });
        } finally { fs.closeSync(fd); }
        const { data } = readPinnedFile(directories, logs, logName);
        const evidence = {
          executable: process.execPath, ...command, cwd: pkg.stage,
          exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
          durationMs: Date.now() - started, log: `logs/${logName}`,
          logBytes: data.length, logSha256: hash(data),
        };
        step.commands.push(evidence);
        step.outputs = outputInventory(pkg.stage);
        evidence.outputs = step.outputs;
        assert.ok(!result.error && result.status === 0,
          `${step.id} command ${index + 1} failed: ${result.error?.message ?? `exit ${result.status}, signal ${result.signal}`}; ${evidence.log}`);
        checkCliLinks();
        checkCompletedOutputs(`after ${step.id} command ${index + 1}`);
      }
      checkInputs(pkg, true);
      checkInputs(pkg, false);
      verifyFrameworkLinks(contexts, closure);
      for (const path of step.requiredOutputs) {
        assert.ok(step.outputs.entries.some(entry => entry.path === path && entry.bytes > 0),
          `Missing fresh build output: ${step.id}/${path}`);
      }
      step.completedOutputs = step.outputs;
      step.status = 'built';
    }
    checkCompletedOutputs('final acceptance check');
    checkCliReports();
    checkCliLinks();
    report.toolchainSourceVerified = toolchainVerified(cliBuilds, report);
    report.runtimeSourceBuildsVerified = true;
    report.aiCodeSourceBuildVerified = true;
    report.status = 'source-runtime-deps-probe-complete-not-accepted';
    report.exitCode = 2;
  } catch (error) {
    const active = report.steps.find(step => step.status === 'running');
    if (active) active.status = 'failed';
    report.errors.push(error.message);
  } finally {
    if (run) {
      try { checkCliReports(); checkCliLinks(); }
      catch (error) { report.errors.push(error.message); }
      for (const [staged, key] of [[false, 'original'], [true, 'staged']]) {
        try {
          for (const context of contexts) checkInputs(context, staged);
          report.sourceDrift[key] = contexts.length === 10 ? 'unchanged' : 'incomplete';
        } catch (error) {
          report.sourceDrift[key] = 'detected';
          report.errors.push(error.message);
        }
      }
      for (const step of report.steps) {
        const pkg = contexts.find(context => context.id === step.id);
        if (!pkg) continue;
        try { checkOutputs(step, 'final report'); }
        catch (error) { report.errors.push(`Output inventory ${step.id}: ${error.message}`); }
      }
      if (report.errors.length) {
        report.status = 'failed';
        report.exitCode = 1;
        report.runtimeSourceBuildsVerified = false;
        report.aiCodeSourceBuildVerified = false;
        report.toolchainSourceVerified = false;
      }
      report.finishedAt = new Date().toISOString();
      try { directories.write(run, 'report.json', `${JSON.stringify(report, null, 2)}\n`); }
      finally { directories.close(); }
    } else {
      directories.close();
    }
  }
  // Refuse overwrite/path violations rather than returning an unpersisted receipt.
  assert.ok(run, report.errors.join('; '));
  return { report, destination, reportPath: join(destination, 'report.json'), exitCode: report.exitCode };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv, options: {
      workspace: { type: 'string' }, output: { type: 'string' }, 'verify-report': { type: 'string' },
      'cli-source-report': { type: 'string', multiple: true },
    },
  });
  assert.ok(!values.output || !values['verify-report'],
    '--verify-report cannot be combined with --output');
  assert.ok(!values['verify-report'] || !values['cli-source-report'],
    '--verify-report uses the recorded CLI source reports, not replacement reports');
  if (values['verify-report']) {
    const result = verifyAiCodeSourceDepsHarness({
      workspace: values.workspace, sourceReport: values['verify-report'],
    });
    console.log(JSON.stringify({
      status: 'verified-source-runtime-deps-not-accepted', report: result.reportPath,
      reportSha256: result.reportSha256, dependencySourceBuildsVerified: true,
      toolchainSourceVerified: result.toolchainSourceVerified,
      nativeAccepted: false, fullLocalization: false,
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  const result = runAiCodeSourceDepsHarness({
    ...values, cliSourceReports: values['cli-source-report'],
  });
  console.log(JSON.stringify({
    status: result.report.status, exitCode: result.exitCode, report: result.reportPath,
    toolchainSourceVerified: result.report.toolchainSourceVerified,
    nativeAccepted: false, fullLocalization: false, errors: result.report.errors,
  }, null, 2));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
