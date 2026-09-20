#!/usr/bin/env node

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(dirname(scriptPath), '..');

export const DEFAULT_INPUTS = Object.freeze({
  model: resolve(workspaceRoot, 'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json'),
  plugins: resolve(workspaceRoot, 'plm-web/public/plugins'),
  dist: resolve(workspaceRoot, 'modelingweb/app/dist/plugins'),
});

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const packagePattern =
  /^(?<name>(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(?<version>[a-z0-9][a-z0-9.+_-]*)$/i;

function inside(root, target) {
  const path = relative(root, target);
  return path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function safeRelativePath(path) {
  return typeof path === 'string' &&
    path.length > 0 &&
    path.trim() === path &&
    !isAbsolute(path) &&
    !win32.isAbsolute(path) &&
    !/[\x00-\x1f\x7f\\:%?#]/.test(path) &&
    path.split('/').every(part => part !== '' && part !== '..') &&
    path.split('/').some(part => part !== '.');
}

function unavailable(path, error = 'package-unavailable', safe = true) {
  return { path, exists: false, safe, error };
}

// Check every component before following it, including scope directories and links.
function inspectPath(root, path, kind = 'file') {
  if (!safeRelativePath(path)) {
    return unavailable(path, 'unsafe-relative-path', false);
  }
  if (!root) return unavailable(path);
  try {
    const boundary = realpathSync(root);
    let current = boundary;
    const parts = path.split('/').filter(part => part !== '.');
    for (let index = 0; index < parts.length; index += 1) {
      current = join(current, parts[index]);
      let info = lstatSync(current);
      if (info.isSymbolicLink()) {
        current = realpathSync(current);
        if (!inside(boundary, current)) {
          return unavailable(path, 'symlink-escape', false);
        }
        info = statSync(current);
      }
      const expected = index === parts.length - 1 ? kind : 'directory';
      if (!(expected === 'directory' ? info.isDirectory() : info.isFile())) {
        return unavailable(path, `not-${expected}`);
      }
    }
    return { path, exists: true, safe: true, error: null, realPath: current };
  } catch (error) {
    return unavailable(path, error.code || error.message);
  }
}

export function collectPluginReferences(model) {
  const packages = new Map();
  const invalidReferences = [];
  let referenceCount = 0;
  const visit = (value, pointer = '') => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const location = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (key.toLowerCase() === 'rtobjectrepo') {
        referenceCount += 1;
        const match = safeRelativePath(child) && packagePattern.exec(child);
        if (!match) {
          invalidReferences.push({
            location,
            value: child,
            error: 'expected-safe-name@version-or-@scope/name@version',
          });
        } else {
          if (!packages.has(child)) {
            packages.set(child, {
              repo: child,
              name: match.groups.name,
              version: match.groups.version,
              locations: [],
            });
          }
          packages.get(child).locations.push(location);
        }
      }
      visit(child, location);
    }
  };
  visit(model);
  return {
    referenceCount,
    invalidReferences,
    packages: [...packages.keys()].sort().map(repo => packages.get(repo)),
  };
}

function identityField(manifest, key, expected) {
  const present = has(manifest, key);
  const value = present ? manifest[key] : null;
  const valid = typeof value === 'string' && value.trim().length > 0;
  return { present, value, valid, matches: valid && value === expected };
}

function assetField(manifest, keys, root, { styles = false } = {}) {
  const declaredKeys = keys.filter(key => has(manifest, key));
  const values = Object.fromEntries(declaredKeys.map(key => [key, manifest[key]]));
  let valid = declaredKeys.length > 0 || styles;
  const files = [];
  for (const key of declaredKeys) {
    const paths = styles && Array.isArray(manifest[key])
      ? manifest[key]
      : [manifest[key]];
    for (const path of paths) {
      if (typeof path !== 'string' || path.length === 0) valid = false;
      files.push({ key, ...inspectPath(root, path) });
    }
  }
  return {
    present: declaredKeys.length > 0,
    keys: declaredKeys,
    values,
    valid,
    files,
    complete: valid && files.every(file => file.exists && file.safe),
  };
}

function auditPackage(root, reference) {
  const directory = inspectPath(root, reference.repo, 'directory');
  const packageRoot = directory.exists ? directory.realPath : null;
  const manifestFile = inspectPath(packageRoot, 'package.json');
  let manifest = {};
  let manifestError = manifestFile.error;
  if (manifestFile.exists) {
    try {
      manifest = JSON.parse(readFileSync(manifestFile.realPath, 'utf8'));
      if (!isObject(manifest)) throw new Error('manifest-must-be-an-object');
      manifestError = null;
    } catch (error) {
      manifest = {};
      manifestError = error.message;
    }
  }
  const fields = {
    name: identityField(manifest, 'name', reference.name),
    version: identityField(manifest, 'version', reference.version),
    system: assetField(manifest, ['system'], packageRoot),
    styles: assetField(manifest, ['styles'], packageRoot, { styles: true }),
    main: assetField(manifest, ['main'], packageRoot),
    module: assetField(manifest, ['module'], packageRoot),
    types: assetField(manifest, ['types', 'typings'], packageRoot),
  };
  const result = {
    directory,
    manifest: { ...manifestFile, valid: manifestError === null, error: manifestError },
    fields,
    dist: inspectPath(packageRoot, 'dist', 'directory'),
    runtimeComplete: manifestError === null &&
      fields.name.matches && fields.version.matches &&
      fields.system.complete && fields.styles.complete,
  };
  return { result, manifest, packageRoot };
}

function auditSource(packageRoot, manifest, identityMatches) {
  const src = inspectPath(packageRoot, 'src', 'directory');
  const implementationFiles = [];
  const declarationFiles = [];
  const scanErrors = [];
  const visit = path => {
    try {
      // Linked/generated output is not evidence of editable implementation source.
      if (lstatSync(join(packageRoot, path)).isSymbolicLink()) {
        scanErrors.push({ path, error: 'source-symlink-not-audited' });
        return;
      }
      for (const name of readdirSync(join(packageRoot, path)).sort()) {
        if (['node_modules', 'dist', 'coverage', '.git'].includes(name)) continue;
        const child = `${path}/${name}`;
        const info = lstatSync(join(packageRoot, child));
        if (info.isSymbolicLink()) {
          scanErrors.push({ path: child, error: 'source-symlink-not-audited' });
        } else if (info.isDirectory()) {
          visit(child);
        } else if (info.isFile()) {
          if (/\.d\.(ts|mts|cts)$/i.test(name)) {
            declarationFiles.push(child);
          } else if (/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(name)) {
            implementationFiles.push(child);
          }
        }
      }
    } catch (error) {
      scanErrors.push({ path, error: error.code || error.message });
    }
  };
  if (src.exists) visit('src');
  const buildScript = isObject(manifest.scripts) &&
    typeof manifest.scripts.build === 'string' && manifest.scripts.build.trim()
    ? manifest.scripts.build
    : null;
  const staticPrerequisitesMet = identityMatches && src.exists &&
    implementationFiles.length > 0 && scanErrors.length === 0 && buildScript !== null;
  let status = 'unverified';
  if (!src.exists) status = src.safe ? 'missing-src' : 'unsafe-src';
  else if (scanErrors.length > 0) status = 'source-scan-incomplete';
  else if (implementationFiles.length === 0) status = 'no-implementation-source';
  else if (!buildScript) status = 'missing-build-script';
  else if (!identityMatches) status = 'invalid-package-identity';
  return {
    src,
    implementationFiles,
    declarationFiles,
    scanErrors,
    buildScript,
    staticPrerequisitesMet,
    buildVerified: false,
    status,
  };
}

export function auditPlugins(options = {}) {
  const inputs = Object.fromEntries(
    Object.entries(DEFAULT_INPUTS).map(([key, value]) => [
      key, resolve(options[key] ?? value),
    ]),
  );
  const model = JSON.parse(readFileSync(inputs.model, 'utf8'));
  if (model === null || typeof model !== 'object') {
    throw new Error('Model JSON must be an object or array');
  }
  const references = collectPluginReferences(model);
  const plugins = references.packages.map(reference => {
    const local = auditPackage(inputs.plugins, reference);
    const published = auditPackage(inputs.dist, reference);
    return {
      ...reference,
      referenceCount: reference.locations.length,
      local: local.result,
      published: published.result,
      source: auditSource(
        local.packageRoot,
        local.manifest,
        local.result.fields.name.matches && local.result.fields.version.matches,
      ),
    };
  });
  const count = predicate => plugins.filter(predicate).length;
  const summary = {
    references: references.referenceCount,
    uniquePackages: plugins.length,
    invalidReferences: references.invalidReferences.length,
    missingLocalPackages: count(plugin => !plugin.local.directory.exists),
    missingPublishedPackages: count(plugin => !plugin.published.directory.exists),
    localRuntimeComplete: count(plugin => plugin.local.runtimeComplete),
    publishedRuntimeComplete: count(plugin => plugin.published.runtimeComplete),
    sourceDirectories: count(plugin => plugin.source.src.exists),
    implementationSourcePresent: count(plugin => plugin.source.implementationFiles.length > 0),
    sourceBuildCandidates: count(plugin => plugin.source.staticPrerequisitesMet),
    sourceBuildVerified: 0,
  };
  return {
    schemaVersion: 1,
    inputs,
    scope: {
      runtime: 'Manifest identity, system entry and declared styles; no browser execution or transitive dependency audit.',
      source: 'Local src implementation files and scripts.build are static prerequisites only; no dependency installation or build is executed.',
      declarations: '.d.ts, .d.mts and .d.cts files are not implementation source.',
    },
    runtimeComplete: summary.invalidReferences === 0 &&
      summary.localRuntimeComplete === plugins.length &&
      summary.publishedRuntimeComplete === plugins.length,
    summary,
    invalidReferences: references.invalidReferences,
    plugins,
  };
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), relative(parent, path));
  }
}

function writeReport(path, report) {
  const output = resolve(path);
  const canonicalOutput = canonicalPath(output);
  const { model, plugins, dist } = report.inputs;
  if ([plugins, dist].some(root =>
    inside(root, output) || inside(canonicalPath(root), canonicalOutput)) ||
    output === model || canonicalOutput === canonicalPath(model)) {
    throw new Error('--output must not overwrite the model or plugin resources');
  }
  try {
    const info = lstatSync(output);
    if (info.isSymbolicLink() || info.nlink > 1 || !info.isFile()) {
      throw new Error('--output must be a regular, non-linked file');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const help = `Usage: node scripts/harness-plugin-audit.mjs [options]

  --model PATH     Model JSON (default: plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json)
  --plugins PATH   Local catalog (default: plm-web/public/plugins)
  --dist PATH      Published catalog (default: modelingweb/app/dist/plugins)
  --output PATH    Write JSON report outside input resources; otherwise JSON goes to stdout
  --help          Show this help

Defaults are workspace-relative; explicit paths are working-directory-relative.
Exit codes: 0 = runtime assets complete, 1 = runtime gaps/invalid references,
2 = invalid arguments, unreadable model or report write failure.
Source build status is reported separately and is never verified by this read-only audit.
`;

export function main(args = process.argv.slice(2)) {
  try {
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === '--help' || argument === '-h') {
        process.stdout.write(help);
        return 0;
      }
      if (!['--model', '--plugins', '--dist', '--output'].includes(argument)) {
        throw new Error(`Unknown option: ${argument}`);
      }
      const key = argument.slice(2);
      const value = args[++index];
      if (!value || value.startsWith('--') || has(options, key)) {
        throw new Error(`Expected one path for ${argument}`);
      }
      options[key] = value;
    }
    const report = auditPlugins(options);
    if (options.output) {
      writeReport(options.output, report);
      process.stdout.write(`${JSON.stringify({
        output: resolve(options.output),
        runtimeComplete: report.runtimeComplete,
        summary: report.summary,
      }, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
    return report.runtimeComplete ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Plugin audit failed: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.exitCode = main();
}
