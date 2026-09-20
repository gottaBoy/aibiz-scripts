#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseSystemInserts, validateCatalog } from './harness-modeling-extension-inventory.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(workspace, 'extensions/upstream');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function repositorySlug(value) {
  if (typeof value !== 'string' || !/^https:\/\/gitee\.com\/ibizlab-appstore\/[a-z0-9][a-z0-9-]*\.git$/.test(value)) {
    throw new Error('Only the registered public ibizlab-appstore HTTPS repositories are accepted');
  }
  return new URL(value).pathname.split('/').at(-1).slice(0, -4);
}

export function caseCollisions(paths) {
  const groups = new Map();
  for (const path of paths) {
    const key = path.normalize('NFC').toLowerCase();
    groups.set(key, [...groups.get(key) || [], path]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

export function summarizePackageManifest(text) {
  const manifest = JSON.parse(text);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('non-object-manifest');
  const pick = field => {
    const value = manifest[field];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, spec]) => typeof spec === 'string').sort());
  };
  return {
    kind: 'package.json',
    name: typeof manifest.name === 'string' ? manifest.name : null,
    version: typeof manifest.version === 'string' ? manifest.version : null,
    dependencies: pick('dependencies'), devDependencies: pick('devDependencies'), peerDependencies: pick('peerDependencies'),
  };
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`))?.[1] ?? null;

export function summarizePom(text) {
  const xml = text.replace(/<!--[\s\S]*?-->/g, '');
  const parentXml = xml.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] ?? '';
  const ownXml = xml.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencies>[\s\S]*<\/dependencies>/, '')
    .replace(/<build>[\s\S]*<\/build>/, '').replace(/<properties>[\s\S]*?<\/properties>/, '');
  const properties = {};
  for (const [, name, value] of (xml.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? '').matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<]*?)\s*<\/\1>/g)) {
    if (/version/i.test(name)) properties[name] = value;
  }
  const dependencies = [];
  for (const [, body] of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const groupId = tag(body, 'groupId');
    if (groupId && /^(net\.ibizsys|cn\.ibizlab|com\.ibiz)/.test(groupId)) {
      dependencies.push({ groupId, artifactId: tag(body, 'artifactId'), version: tag(body, 'version') });
    }
  }
  return {
    kind: 'pom.xml',
    groupId: tag(ownXml, 'groupId'), artifactId: tag(ownXml, 'artifactId'), version: tag(ownXml, 'version'),
    parent: parentXml ? { groupId: tag(parentXml, 'groupId'), artifactId: tag(parentXml, 'artifactId'), version: tag(parentXml, 'version') } : null,
    versionProperties: properties, ibizDependencies: dependencies,
  };
}

export function declaredVersions(manifests) {
  const templatePackages = {};
  const cloudVersions = new Set();
  for (const manifest of manifests) {
    if (manifest.kind === 'package.json') {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const [name, spec] of Object.entries(manifest[field])) {
          if (/^@ibiz(-template|lab)?(-plugin)?\//.test(name)) templatePackages[name] = [...new Set([...(templatePackages[name] || []), spec])];
        }
      }
    } else if (manifest.kind === 'pom.xml') {
      for (const [name, value] of Object.entries(manifest.versionProperties)) if (/^ibiz\./.test(name)) cloudVersions.add(`${name}=${value}`);
    }
  }
  return { ibizTemplatePackages: templatePackages, ibizMavenVersionProperties: [...cloudVersions].sort() };
}

function inspectManifests(paths, commit, inspectOptions) {
  const manifests = [];
  for (const path of paths.filter(path => /(^|\/)(package\.json|pom\.xml)$/.test(path) && !/(^|\/)node_modules\//.test(path))) {
    try {
      const text = git(['show', `${commit}:${path}`], inspectOptions).toString('utf8');
      manifests.push({ path, ...(path.endsWith('package.json') ? summarizePackageManifest(text) : summarizePom(text)) });
    } catch (error) {
      manifests.push({ path, kind: path.endsWith('package.json') ? 'package.json' : 'pom.xml', error: (error.stderr?.toString().trim() || error.message).slice(0, 300) });
    }
  }
  return manifests;
}

function assertUnlinked(path) {
  for (let current = path; current !== dirname(current); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('Source and report paths must not contain symlinks');
    }
  }
}

function git(args, options = {}) {
  const container = options.container;
  const prefix = container
    ? ['docker', 'exec', ...(options.cwd ? ['-w', options.cwd] : []), container]
    : [];
  const command = prefix.length === 0 ? 'git' : prefix[0];
  const commandArgs = prefix.length === 0
    ? []
    : [...prefix.slice(1), 'git'];
  return execFileSync(command, [
    ...commandArgs,
    '-c', 'credential.helper=', '-c', 'core.askPass=',
    '-c', 'http.sslVerify=true', '-c', 'http.lowSpeedTime=20', '-c', 'http.lowSpeedLimit=1024',
    ...args,
  ], {
    ...(prefix.length === 0 ? { cwd: options.cwd || workspace } : {}),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function captureRepository(repository, output) {
  const slug = repositorySlug(repository.repository);
  const directory = join(sourceRoot, slug);
  assertUnlinked(directory);
  const existed = existsSync(directory);
  let containerDirectory;
  const useContainerTransport = Boolean(process.env.AIBIZ_GIT_TRANSPORT_CONTAINER) && !existed;
  if (useContainerTransport) {
    containerDirectory = `/tmp/aibiz-upstream/${slug}`;
    const container = process.env.AIBIZ_GIT_TRANSPORT_CONTAINER;
    execFileSync('docker', ['exec', container, 'rm', '-rf', containerDirectory], {
      env: process.env, timeout: 30000,
    });
    execFileSync('docker', ['exec', container, 'mkdir', '-p', '/tmp/aibiz-upstream-archives'], {
      env: process.env, timeout: 30000,
    });
    execFileSync('docker', ['exec', container, 'mkdir', '-p', containerDirectory], {
      env: process.env, timeout: 30000,
    });
    git(['clone', '--depth', '1', '--no-tags', '--no-checkout', repository.repository, containerDirectory], {
      container,
    });
  } else if (!existed) {
    git(['clone', '--depth', '1', '--no-tags', '--no-checkout', repository.repository, directory], {
      cwd: sourceRoot,
    });
  }
  const inspectOptions = useContainerTransport
    ? { container: process.env.AIBIZ_GIT_TRANSPORT_CONTAINER, cwd: containerDirectory }
    : { cwd: directory };
  const actualRemote = git(['remote', 'get-url', 'origin'], inspectOptions).toString().trim();
  if (actualRemote !== repository.repository) throw new Error('Existing repository has another origin; no files changed');
  const commit = git(['rev-parse', 'HEAD^{commit}'], inspectOptions).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Unexpected commit identity');
  const paths = git(['ls-tree', '-r', '--name-only', '-z', commit], inspectOptions)
    .toString('utf8').split('\0').filter(Boolean);
  const collisions = caseCollisions(paths);
  // Checkout only a newly cloned, collision-free tree. Existing worktrees are never rewritten.
  if (!existed && collisions.length === 0) {
    git(['checkout', '--detach', commit], inspectOptions);
  }
  const archive = join(output, `${slug}-${commit}.tar`);
  if (existsSync(archive)) throw new Error('Refusing to overwrite an archive');
  const containerArchive = join('/tmp/aibiz-upstream-archives', `${slug}-${commit}.tar`);
  if (useContainerTransport) {
    git(['archive', '--format=tar', `--output=${containerArchive}`, commit], inspectOptions);
    execFileSync('docker', ['cp', `${process.env.AIBIZ_GIT_TRANSPORT_CONTAINER}:${containerArchive}`, archive], {
      env: process.env, timeout: 120000,
    });
    execFileSync('docker', ['exec', process.env.AIBIZ_GIT_TRANSPORT_CONTAINER, 'rm', '-f', containerArchive], {
      env: process.env, timeout: 30000,
    });
  } else {
    git(['archive', '--format=tar', `--output=${archive}`, commit], inspectOptions);
  }
  let clean = true;
  try {
    git(['diff', '--quiet', commit, '--'], inspectOptions);
  } catch { clean = false; }
  const manifests = inspectManifests(paths, commit, inspectOptions);
  return {
    productId: repository.productId, repository: repository.repository,
    directory: useContainerTransport ? null : relative(workspace, directory),
    containerDirectory: useContainerTransport ? containerDirectory : null,
    sourceLocation: useContainerTransport ? 'archive-only' : 'worktree-and-archive',
    commit,
    transport: existed
      ? 'existing-origin-not-refetched'
      : (useContainerTransport ? 'public-https-clone-via-container' : 'public-https-clone'),
    gitTreeFiles: paths.length, caseCollisions: collisions,
    checkoutComplete: clean && collisions.length === 0,
    archive: relative(workspace, archive), archiveSha256: sha256(readFileSync(archive)),
    licensePaths: paths.filter(path => /(^|\/)(LICENSE|COPYING)(\.|$)/i.test(path)),
    modelRoots: paths.filter(path => /(^|\/)PSSYSTEM\.json$/.test(path)),
    buildEntries: paths.filter(path => /(^|\/)(pom\.xml|package\.json|build\.xml|ibizmodel\.yaml)$/.test(path)),
    hasPackageJson: paths.some(path => /(^|\/)package\.json$/.test(path) && !/(^|\/)node_modules\//.test(path)),
    hasPomXml: paths.some(path => /(^|\/)pom\.xml$/.test(path)),
    manifests, declaredVersions: declaredVersions(manifests),
    sourceSnapshotStatus: 'pass', buildVerified: false, platformIntegration: 'not-verified',
  };
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, options: { product: { type: 'string', multiple: true }, help: { type: 'boolean' } },
    allowPositionals: false,
  });
  if (values.help) {
    console.log('Usage: node scripts/fetch-modeling-upstream.mjs [--product ID ...]\nClones registered public repositories only, retains Git objects and commit archives.\nNo installs, builds, service changes or overwrites of existing worktrees.\nSet AIBIZ_GIT_TRANSPORT_CONTAINER=<container> to clone through a Docker container when host DNS is blocked.');
    return 0;
  }
  const catalog = validateCatalog(JSON.parse(readFileSync(join(workspace, 'modelingweb/app/src/modeling-plugins/catalog.json'))));
  const sql = readFileSync(join(workspace, 'modelingservice/sql/init.sql'));
  const registered = parseSystemInserts(sql.toString());
  const selected = values.product ? registered.filter(row => values.product.includes(row.productId)) : registered;
  if (values.product?.some(id => !registered.some(row => row.productId === id))) throw new Error('Requested product has no registered upstream identity');
  selected.forEach(row => repositorySlug(row.repository));
  selected.sort((left, right) => Number(existsSync(join(sourceRoot, repositorySlug(right.repository)))) -
    Number(existsSync(join(sourceRoot, repositorySlug(left.repository)))));
  const output = join(workspace, '.artifacts/modeling-upstream',
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
  assertUnlinked(output);
  assertUnlinked(sourceRoot);
  mkdirSync(output, { recursive: true });
  mkdirSync(sourceRoot, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), sqlSha256: sha256(sql),
    scope: 'registered-public-git-source-snapshots',
    notVerified: ['source builds', 'exact npm dependencies', 'platform integration', 'upstream behavioral equivalence'],
    unknownUpstreamIds: catalog.filter(item => !item.upstreamProductId).map(item => item.id),
    results: [], originalCompleteness: false,
  };
  const save = () => writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  save();
  for (const row of selected) {
    try {
      const result = captureRepository(row, output);
      report.results.push(result);
      console.log(`SOURCE ${row.productId}: ${result.commit.slice(0, 12)}; checkout=${result.checkoutComplete}; archive=retained`);
    } catch (error) {
      const message = error.stderr?.toString().trim() || error.message;
      report.results.push({ productId: row.productId, sourceSnapshotStatus: 'fail', error: message.slice(0, 1800) });
      console.log(`FAIL ${row.productId}: ${message.split('\n').at(-1)}`);
      if (/operation not permitted|permission denied|EACCES|EPERM|could not resolve host|could not resolve proxy/i.test(message)) {
        report.interrupted = 'network-or-permission-blocked-no-retry';
        report.unattempted = selected.slice(report.results.length).map(item => item.productId);
        save();
        break;
      }
    }
    save();
  }
  report.completedAt = new Date().toISOString();
  report.requested = selected.length;
  report.captured = report.results.filter(row => row.sourceSnapshotStatus === 'pass').length;
  report.sourceSnapshotStatus = report.captured === selected.length ? 'pass' : 'fail';
  save();
  console.log(`Report: ${join(output, 'report.json')}`);
  return report.sourceSnapshotStatus === 'pass' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
