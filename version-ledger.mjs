#!/usr/bin/env node

// Version ledger: makes the iBiz source-localization version spread visible.
//
// It answers one question per component: which version does each authority
// actually demand, and do they agree? Authorities are plm-web declarations,
// the pnpm lockfile, what is installed on disk, the ibiz-app-hub source tree,
// the last source build output, and the plugin peer ranges that the system
// model pins. Optional --live adds running container images and published
// registry tips, which need network and Docker.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
export const workspaceRoot = resolve(dirname(scriptPath), '..');

export const BASE_PACKAGES = Object.freeze([
  '@ibiz-template/core',
  '@ibiz-template/runtime',
  '@ibiz-template/vue3-util',
  '@ibiz-template/vue3-components',
  '@ibiz-template/model-helper',
]);

export const DEFAULT_PATHS = Object.freeze({
  appManifest: 'plm-web/package.json',
  lockfile: 'plm-web/pnpm-lock.yaml',
  nodeModules: 'plm-web/node_modules',
  builtBundles: 'plm-web/dist/extras/js/@ibiz-template',
  hubPackages: 'ibiz-app-hub/packages',
  modelApp: 'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json',
  plugins: 'plm-web/public/plugins',
  importMap: 'plm-web/public/extras/json/system-import.json',
});

// Entry points a plugin bundle may expose. Every one of them carries the same
// bare @ibiz-template/* specifiers, so any hit proves the contract; the order
// only decides which file is read first.
export const PLUGIN_ENTRY_CANDIDATES = Object.freeze([
  'dist/index.es.js',
  'dist/index.legacy.js',
  'dist/index.system.min.js',
]);

// Container front doors that the local stack depends on.
export const RUNTIME_CONTAINERS = Object.freeze([
  'ibiz-ebsx-allinone',
  'ibiz-ebsx-gateway',
  'ibizlab-uaa-api',
  'plmweb',
  'plmservice',
  'modelingweb',
  'modelingservice',
  'task',
]);

const packageSpecPattern =
  /^(?<name>(?:@[^/]+\/)?[^@/]+)@(?<version>[^@]+)$/;

export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  };
}

function comparePrerelease(left, right) {
  if (left === null && right === null) return 0;
  // A version without a prerelease outranks one that has it.
  if (left === null) return 1;
  if (right === null) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    const numeric = /^\d+$/.test(a) && /^\d+$/.test(b);
    if (numeric) return Number(a) < Number(b) ? -1 : 1;
    if (/^\d+$/.test(a)) return -1;
    if (/^\d+$/.test(b)) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareSemver(a, b) {
  const left = typeof a === 'string' ? parseSemver(a) : a;
  const right = typeof b === 'string' ? parseSemver(b) : b;
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function caretUpperBound(base) {
  if (base.major > 0) return { major: base.major + 1, minor: 0, patch: 0, prerelease: null };
  if (base.minor > 0) return { major: 0, minor: base.minor + 1, patch: 0, prerelease: null };
  return { major: 0, minor: 0, patch: base.patch + 1, prerelease: null };
}

// npm semantics, narrowed to the two range forms these manifests use: an exact
// version and a caret range. Anything else is reported as unsupported rather
// than guessed at, so a silent false pass cannot hide a real mismatch.
export function satisfiesRange(range, version) {
  const candidate = parseSemver(version);
  if (!candidate) return { status: 'invalid', version };
  const text = range.trim();
  if (text.startsWith('^')) {
    const base = parseSemver(text.slice(1));
    if (!base) return { status: 'unsupported', range: text };
    const lower = compareSemver(candidate, base);
    const upper = compareSemver(candidate, caretUpperBound(base));
    if (lower < 0 || upper >= 0) return { status: 'outside', range: text };
    // Prereleases only satisfy a comparator that shares their major.minor.patch.
    if (candidate.prerelease !== null) {
      const sharesTuple = other =>
        other.major === candidate.major &&
        other.minor === candidate.minor &&
        other.patch === candidate.patch;
      if (!sharesTuple(base) && !sharesTuple(caretUpperBound(base)))
        return { status: 'prerelease-excluded', range: text };
    }
    return { status: 'satisfied', range: text };
  }
  const exact = parseSemver(text);
  if (!exact) return { status: 'unsupported', range: text };
  return compareSemver(candidate, exact) === 0
    ? { status: 'satisfied', range: text }
    : { status: 'outside', range: text };
}

// pnpm v6 writes entries such as:
//   /@ibiz-template/core@0.7.41-alpha.78(axios@1.13.2):
// peer suffixes and the trailing colon are stripped before parsing.
export function lockfileVersions(text, scope) {
  const found = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s{2}\/([^:]+):\s*$/.exec(line);
    if (!match) continue;
    const spec = match[1].replace(/\(.*$/, '');
    const parsed = packageSpecPattern.exec(spec);
    if (!parsed || !parsed.groups.name.startsWith(scope)) continue;
    const versions = found.get(parsed.groups.name) || new Set();
    versions.add(parsed.groups.version);
    found.set(parsed.groups.name, versions);
  }
  return Object.fromEntries(
    [...found.entries()]
      .map(([name, versions]) => [name, [...versions].sort((a, b) => compareSemver(a, b) || a.localeCompare(b))])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function pluginRefsFromModel(model) {
  const refs = new Set();
  const visit = value => {
    if (typeof value === 'string') {
      const match = packageSpecPattern.exec(value);
      if (
        match &&
        match.groups.name.startsWith('@ibiz-template') &&
        parseSemver(match.groups.version)
      )
        refs.add(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') return Object.values(value).forEach(visit);
    return undefined;
  };
  visit(model);
  return [...refs].sort();
}

export function readPluginManifests(pluginsRoot) {
  const manifests = new Map();
  if (!existsSync(pluginsRoot)) return manifests;
  for (const scope of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!scope.isDirectory() || scope.name.startsWith('.')) continue;
    const scopeDir = join(pluginsRoot, scope.name);
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = packageSpecPattern.exec(entry.name);
      if (!match) continue;
      const name = `${scope.name}/${match.groups.name}`;
      const file = join(scopeDir, entry.name, 'package.json');
      let peers = {};
      if (existsSync(file)) {
        try {
          const parsed = JSON.parse(readFileSync(file, 'utf8'));
          peers = { ...(parsed.peerDependencies || {}), ...(parsed.dependencies || {}) };
        } catch {
          peers = {};
        }
      }
      const record = manifests.get(name) || { versions: {}, unreadable: 0 };
      record.versions[match.groups.version] = peers;
      manifests.set(name, record);
    }
  }
  return manifests;
}

// Plugin bundles import the base packages as bare specifiers with no version,
// e.g. `import { TreeController } from "@ibiz-template/runtime"`. SystemJS
// resolves those through public/extras/json/system-import.json, so the import
// map is the only contract that actually fails at runtime. Peer ranges in
// plugin manifests are build-time metadata and are never enforced.
export function readImportMap(file) {
  if (!existsSync(file)) return { keys: [], mapped: new Map() };
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const imports = json.imports || {};
  const styles = json.styles || {};
  const mapped = new Map();
  for (const [name, target] of Object.entries(imports)) {
    mapped.set(name, Array.isArray(target) ? target[0] : target);
  }
  for (const [name, target] of Object.entries(styles)) {
    if (!mapped.has(name)) mapped.set(name, Array.isArray(target) ? target[0] : target);
  }
  return { keys: [...mapped.keys()], mapped };
}

function bareImportsFrom(file) {
  if (!existsSync(file)) return new Set();
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  const pattern = /["'](@ibiz-template(?:-plugin)?\/[a-z0-9._-]+)["']/gi;
  for (const match of text.matchAll(pattern)) {
    if (!match[1].endsWith('/')) found.add(match[1]);
  }
  return found;
}

// The import map lives in public/extras/json and its targets are relative to
// that directory, so resolution is resolve(dirname(mapFile), target).
//
// A target is satisfied one of two ways, and the distinction matters:
//   committed  checked into public/extras, so every serving mode can reach it
//   build-only only present after `pnpm build` copies the @ibiz-template bundles
//              from node_modules into dist/extras, so a plain `pnpm dev` cannot
//              serve it without the dev middleware that was added for exactly
//              this reason
export function resolveImportTarget({ mapFile, target, distRoot }) {
  const relative = target.split('?')[0];
  const committed = resolve(dirname(mapFile), relative);
  if (existsSync(committed)) return { source: 'committed', file: committed };
  const built = resolve(distRoot, relative.replace(/^\.\.\//, 'extras/'));
  if (existsSync(built)) return { source: 'build-only', file: built };
  return { source: null, file: committed };
}
export function importMapContracts({
  pluginsRoot,
  model,
  mapFile,
  candidates,
  distRoot,
}) {
  const refs = pluginRefsFromModel(model);
  const { keys, mapped } = readImportMap(mapFile);
  const used = new Map();
  const problems = [];
  const unreadable = [];

  for (const ref of refs) {
    const { name, version } = packageSpecPattern.exec(ref).groups;
    // On disk plugins live as <pluginsRoot>/<scope>/<package>@<version>.
    const [scope, pkg] = name.split('/');
    const directory = join(pluginsRoot, scope, `${pkg}@${version}`);
    const entry = candidates
      .map(candidate => join(directory, candidate))
      .find(candidate => existsSync(candidate));
    if (!entry) {
      unreadable.push(ref);
      continue;
    }
    for (const specifier of bareImportsFrom(entry)) {
      const target = mapped.get(specifier);
      if (!target) {
        problems.push({ plugin: ref, specifier, reason: 'not-in-import-map' });
        continue;
      }
      const resolution = resolveImportTarget({ mapFile, target, distRoot });
      if (!resolution.source)
        problems.push({
          plugin: ref,
          specifier,
          reason: 'import-map-target-missing',
          target,
        });
      const record =
        used.get(specifier) ||
        { plugins: new Set(), targets: new Set(), sources: new Set() };
      if (resolution.source) record.sources.add(resolution.source);
      record.plugins.add(ref);
      record.targets.add(target.split('?')[0]);
      used.set(specifier, record);
    }
  }

  return {
    importMapKeys: keys.filter(key => key.startsWith('@ibiz-template/')).sort(),
    used: [...used.entries()]
      .map(([specifier, record]) => ({
        specifier,
        plugins: record.plugins.size,
        target: [...record.targets].join(', '),
        sources: [...record.sources].sort(),
      }))
      .sort((a, b) => b.plugins - a.plugins || a.specifier.localeCompare(b.specifier)),
    problems,
    unreadable,
  };
}

function installedVersion(nodeModulesRoot, name) {
  const file = join(nodeModulesRoot, ...name.split('/'), 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version || null;
  } catch {
    return null;
  }
}

function hubSourceVersion(hubRoot, name) {
  const short = name.replace(/^@[^/]+\//, '');
  const file = join(hubRoot, short, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version || null;
  } catch {
    return null;
  }
}

export function collectBasePackages(root, paths = DEFAULT_PATHS) {
  const manifest = JSON.parse(readFileSync(join(root, paths.appManifest), 'utf8'));
  const lockText = readFileSync(join(root, paths.lockfile), 'utf8');
  const lock = lockfileVersions(lockText, '@ibiz-template/');
  return BASE_PACKAGES.map(name => {
    const declared = (manifest.dependencies || {})[name] || null;
    const locked = lock[name] || null;
    const builtDir = join(root, paths.builtBundles, name.replace(/^@[^/]+\//, ''));
    return {
      name,
      declared,
      locked: Array.isArray(locked) ? locked : locked === null ? [] : [locked],
      installed: installedVersion(join(root, paths.nodeModules), name),
      hubSource: hubSourceVersion(join(root, paths.hubPackages), name),
      builtBundle: existsSync(join(builtDir, 'index.system.min.js')),
    };
  });
}

// base comes from collectBasePackages so the manifests are read once and the
// two views of the data cannot disagree.
export function analyzePlugins(root, paths = DEFAULT_PATHS, base) {
  const model = JSON.parse(readFileSync(join(root, paths.modelApp), 'utf8'));
  const refs = pluginRefsFromModel(model);
  const manifests = readPluginManifests(join(root, paths.plugins));
  const packages = base || collectBasePackages(root, paths);
  const installed = new Map(packages.map(entry => [entry.name, entry.installed]));
  const missing = [];
  const constraints = [];

  for (const ref of refs) {
    const { name, version } = packageSpecPattern.exec(ref).groups;
    const record = manifests.get(name);
    if (!record || !record.versions[version]) {
      missing.push({ ref, reason: record ? 'version-not-on-disk' : 'package-not-on-disk' });
      continue;
    }
    for (const [dependency, range] of Object.entries(record.versions[version])) {
      if (!dependency.startsWith('@ibiz-template/') || !BASE_PACKAGES.includes(dependency))
        continue;
      const candidate = installed.get(dependency);
      if (!candidate) continue;
      const result = satisfiesRange(range, candidate);
      constraints.push({
        plugin: ref,
        dependency,
        range,
        candidate,
        status: result.status,
      });
    }
  }

  const unsatisfied = constraints.filter(item => item.status !== 'satisfied');
  const distinct = values => [...new Set(values)].sort();
  return {
    pinnedPlugins: refs.length,
    missing,
    checked: constraints.length,
    unsatisfied,
    // One row per base package so a single drifting package reads at a glance
    // instead of being buried in per-plugin rows.
    packages: packages.map(entry => {
      const related = constraints.filter(item => item.dependency === entry.name);
      const broken = unsatisfied.filter(item => item.dependency === entry.name);
      return {
        name: entry.name,
        declared: entry.declared,
        locked: entry.locked,
        installed: entry.installed,
        hubSource: entry.hubSource,
        builtBundle: entry.builtBundle,
        pluginRanges: distinct(related.map(item => item.range)),
        satisfied: broken.length === 0,
        unsatisfiedPlugins: distinct(broken.map(item => item.plugin)),
      };
    }),
  };
}

export function baseFindings(base) {
  const findings = [];
  for (const entry of base) {
    if (!entry.installed)
      findings.push({ level: 'FAIL', component: entry.name, issue: 'not installed' });
    if (entry.declared && entry.installed && entry.declared !== entry.installed)
      findings.push({
        level: 'FAIL',
        component: entry.name,
        issue: `manifest asks ${entry.declared} but ${entry.installed} is installed`,
      });
    if (entry.locked.length > 1)
      findings.push({
        // Only one copy can be served, because the import map maps a single
        // target per specifier and the build externalises these packages, so a
        // duplicated resolution is dependency-graph hygiene rather than a
        // runtime split.
        level: 'WARN',
        component: entry.name,
        issue: `lockfile resolves ${entry.locked.length} versions: ${entry.locked.join(', ')}`,
      });
    if (entry.hubSource && entry.installed && entry.hubSource !== entry.installed)
      findings.push({
        level: 'WARN',
        component: entry.name,
        issue: `ibiz-app-hub source is ${entry.hubSource} while ${entry.installed} is in use`,
      });
    if (!entry.builtBundle)
      findings.push({
        level: 'WARN',
        component: entry.name,
        issue: 'no built SystemJS bundle in plm-web/dist',
      });
  }
  return findings;
}

// Only what can break at runtime is FAIL. Plugin peer ranges are build-time
// metadata that the runtime never checks, so drift there is reported as INFO
// for migration planning rather than failing the gate.
export function pluginFindings(analysis, contracts) {
  const findings = [];
  for (const item of analysis.missing)
    findings.push({
      level: 'FAIL',
      component: `plugin ${item.ref}`,
      issue: `model pins it but ${item.reason}`,
    });
  // Aggregated per specifier and reason: an unresolvable asset breaks every
  // plugin that imports it, so one row carries the blast radius instead of
  // repeating the same failure per plugin.
  const broken = new Map();
  for (const item of contracts.problems) {
    const key = `${item.specifier}|${item.reason}|${item.target || ''}`;
    const record = broken.get(key) || { ...item, plugins: new Set() };
    record.plugins.add(item.plugin);
    broken.set(key, record);
  }
  for (const item of [...broken.values()].sort(
    (a, b) => b.plugins.size - a.plugins.size || a.specifier.localeCompare(b.specifier),
  ))
    findings.push({
      level: 'FAIL',
      component: item.specifier,
      issue:
        `${item.reason}${item.target ? ` (${item.target})` : ''} ` +
        `for ${item.plugins.size} plugin(s)`,
    });
  if (contracts.unreadable.length)
    findings.push({
      level: 'WARN',
      component: 'plugins',
      issue: `${contracts.unreadable.length} pinned plugin(s) have no readable bundle entry`,
    });
  // Collapsed per package: a single row carrying the widest demand and how many
  // plugins still declare something else.
  const byPackage = new Map();
  for (const item of analysis.unsatisfied) {
    const record = byPackage.get(item.dependency) || {
      candidate: item.candidate,
      ranges: new Set(),
      plugins: new Set(),
      highest: null,
    };
    record.ranges.add(item.range);
    record.plugins.add(item.plugin);
    const parsed = parseSemver(item.range.replace(/^\^/, ''));
    if (parsed && (!record.highest || compareSemver(parsed, record.highest) > 0))
      record.highest = parsed;
    byPackage.set(item.dependency, record);
  }
  for (const [dependency, record] of [...byPackage.entries()].sort()) {
    const newest = record.highest
      ? `${record.highest.major}.${record.highest.minor}.${record.highest.patch}${
          record.highest.prerelease ? `-${record.highest.prerelease.join('.')}` : ''
        }`
      : 'unknown';
    findings.push({
      level: 'INFO',
      component: dependency,
      issue:
        `in use ${record.candidate}; ${record.plugins.size} plugin(s) declare ` +
        `${record.ranges.size} unsatisfied build-time range(s), highest unmet ${newest} ` +
        `(not enforced at runtime)`,
    });
  }
  return findings;
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

export function liveContainers(names = RUNTIME_CONTAINERS) {
  const template = '{{.Config.Image}}|{{.State.Status}}';
  return names.map(name => {
    const out = run('docker', ['inspect', name, '--format', template]);
    if (!out) return { name, image: null, status: 'absent' };
    const [image, status] = out.trim().split('|');
    return { name, image: image || null, status: status || 'unknown' };
  });
}

export function registryTips(packages, registry) {
  return packages.map(name => {
    const out = run('npm', ['view', name, 'version', `--registry=${registry}`]);
    return { name, latest: out ? out.trim() : null };
  });
}

export function formatLedger(report) {
  const lines = [];
  lines.push('iBiz version ledger');
  lines.push(`generated=${report.generated}`);
  lines.push('');
  lines.push('Runtime base packages (@ibiz-template/*)');
  lines.push(
    [
      'package'.padEnd(30),
      'declared'.padEnd(20),
      'installed'.padEnd(20),
      'hub-source'.padEnd(18),
      'built'.padEnd(6),
      'plugin-ranges(distinct/newest)',
    ].join(' '),
  );
  for (const entry of report.plugins.packages) {
    const ranges = entry.pluginRanges;
    const highest = ranges
      .map(range => parseSemver(range.replace(/^\^/, '')))
      .filter(Boolean)
      .reduce(
        (best, current) => (!best || compareSemver(current, best) > 0 ? current : best),
        null,
      );
    const newest = highest
      ? `${highest.major}.${highest.minor}.${highest.patch}${
          highest.prerelease ? `-${highest.prerelease.join('.')}` : ''
        }`
      : '-';
    lines.push(
      [
        entry.name.replace('@ibiz-template/', '').padEnd(30),
        (entry.declared || '-').padEnd(20),
        (entry.installed || '-').padEnd(20),
        (entry.hubSource || '-').padEnd(18),
        (entry.builtBundle ? 'yes' : 'no').padEnd(6),
        ranges.length ? `${ranges.length} / ${newest}` : '-',
      ].join(' '),
    );
  }
  lines.push('');
  lines.push(
    `Plugins pinned by the system model: ${report.plugins.pinnedPlugins}, ` +
      `peer constraints checked: ${report.plugins.checked}`,
  );
  if (report.containers.length) {
    lines.push('');
    lines.push('Running containers');
    for (const container of report.containers)
      lines.push(`  ${container.name.padEnd(20)} ${container.status.padEnd(9)} ${container.image || '-'}`);
  }
  if (report.registry.length) {
    lines.push('');
    lines.push('Published registry tips');
    for (const entry of report.registry)
      lines.push(`  ${entry.name.padEnd(34)} ${entry.latest || 'unreachable'}`);
  }
  lines.push('');
  lines.push('Runtime contract (SystemJS import map, the only version binding enforced)');
  for (const entry of report.contracts.used)
    lines.push(
      `  ${entry.specifier.padEnd(30)} used by ${String(entry.plugins).padStart(3)} plugin(s)  resolved by: ${entry.sources.join(', ') || 'nothing'}`,
    );
  lines.push('');
  for (const level of ['FAIL', 'WARN', 'INFO']) {
    const items = report.findings.filter(item => item.level === level);
    if (!items.length) continue;
    lines.push(`${level}s (${items.length})`);
    for (const item of items) lines.push(`  ${item.component}: ${item.issue}`);
    lines.push('');
  }
  lines.push(`RESULT ${report.findings.some(item => item.level === 'FAIL') ? 'FAIL' : 'PASS'}`);
  return `${lines.join('\n')}\n`;
}

export function buildReport(options = {}) {
  const root = options.root || workspaceRoot;
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const base = collectBasePackages(root, paths);
  const analysis = analyzePlugins(root, paths, base);
  const contracts = importMapContracts({
    pluginsRoot: join(root, paths.plugins),
    model: JSON.parse(readFileSync(join(root, paths.modelApp), 'utf8')),
    mapFile: join(root, paths.importMap),
    candidates: PLUGIN_ENTRY_CANDIDATES,
    distRoot: join(root, 'plm-web/dist'),
  });
  const order = { FAIL: 0, WARN: 1, INFO: 2 };
  const findings = [...baseFindings(base), ...pluginFindings(analysis, contracts)].sort(
    (a, b) => order[a.level] - order[b.level] || a.component.localeCompare(b.component),
  );
  return {
    generated: new Date().toISOString(),
    requested: BASE_PACKAGES,
    packages: base,
    plugins: analysis,
    contracts,
    findings,
    containers: options.live ? liveContainers() : [],
    registry:
      options.live && options.registry
        ? registryTips(BASE_PACKAGES, options.registry)
        : [],
    failed: findings.some(item => item.level === 'FAIL'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const { values } = parseArgs({
    options: {
      live: { type: 'boolean', default: false },
      registry: { type: 'string' },
      json: { type: 'boolean', default: false },
      'report-dir': { type: 'string' },
    },
  });
  const report = buildReport({ live: values.live, registry: values.registry });
  const text = values.json ? `${JSON.stringify(report, null, 2)}\n` : formatLedger(report);
  if (values['report-dir']) {
    mkdirSync(values['report-dir'], { recursive: true });
    writeFileSync(join(values['report-dir'], 'version-ledger.txt'), text);
  }
  process.stdout.write(text);
  if (report.failed) process.exitCode = 1;
}
