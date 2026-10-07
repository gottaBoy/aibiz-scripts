#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const workspaceDefault = resolve(scriptsRoot, '..');
const contract = 'plm-ibiz-dependency-source-closure-v1';
const dependencyPattern = /^[| +\\-]*cn\.ibizlab\.(?<group>[^: ]+):(?<artifact>[^: ]+):(?<type>jar|pom):(?<version>[^: ]+)/;
const pomDependencyPattern = /<dependency>[\s\S]*?<\/dependency>/g;
const sourceExtensions = new Set(['.java', '.groovy']);

function childOf(parent, path) {
  assert.equal(typeof path, 'string', 'Path must be a string');
  const value = relative(parent, resolve(parent, path));
  assert.ok(value && value !== '..' && !value.startsWith(`..${sep}`) && !path.startsWith('/'),
    `Unsafe path: ${path}`);
  return resolve(parent, path);
}

function readText(workspace, path, limit = 64 * 1024 * 1024) {
  const bytes = fs.readFileSync(childOf(workspace, path));
  assert.ok(bytes.length <= limit, `File too large: ${path}`);
  return bytes.toString('utf8');
}

function collectSourceFiles(root) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Symlink source rejected: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(path);
    }
  };
  visit(root);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function parsePomIdentity(pom) {
  const parent = pom.match(/<parent>[\s\S]*?<\/parent>/)?.[0] ?? '';
  const project = pom.replace(parent, '');
  const artifactId = project.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
  const dependencies = project.match(/<dependencies>[\s\S]*<\/dependencies>/)?.[0] ?? '';
  const declaration = project.slice(0, dependencies ? project.indexOf(dependencies) : project.length);
  const groupId = declaration.match(/<groupId>([^<]+)<\/groupId>/)?.[1] ??
    parent.match(/<groupId>([^<]+)<\/groupId>/)?.[1];
  const version = declaration.match(/<version>([^<]+)<\/version>/)?.[1] ??
    parent.match(/<version>([^<]+)<\/version>/)?.[1];
  return { groupId, artifactId, version };
}

function parsePomProperties(pom) {
  const properties = {};
  const block = pom.match(/<properties>[\s\S]*?<\/properties>/)?.[0] ?? '';
  for (const match of block.matchAll(/<([^ >]+)>([^<]*)<\/\1>/g)) properties[match[1]] = match[2];
  return properties;
}

function parsePomIbizDependencies(pom, properties) {
  const dependencies = [];
  for (const block of pom.match(pomDependencyPattern) ?? []) {
    const groupId = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1];
    const artifactId = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
    if (!groupId?.startsWith('cn.ibizlab.')) continue;
    const version = block.match(/<version>([^<]+)<\/version>/)?.[1]
      ?.replace(/\$\{([^}]+)\}/g, (_, name) => properties[name] ?? '') || null;
    dependencies.push({ groupId, artifactId, version });
  }
  return dependencies;
}

function parseDependencyTree(tree) {
  const all = new Set();
  const direct = new Set();
  for (const line of tree.split(/\r?\n/)) {
    const match = line.match(dependencyPattern);
    if (!match?.groups) continue;
    const dependency = {
      groupId: `cn.ibizlab.${match.groups.group}`,
      artifactId: match.groups.artifact,
      version: match.groups.version,
      type: match.groups.type,
    };
    const key = `${dependency.groupId}:${dependency.artifactId}:${dependency.version}`;
    all.add(key);
    if (!line.includes('  ')) direct.add(key);
  }
  assert.ok(all.size > 0, 'Dependency tree contains no iBiz dependencies');
  return {
    direct: [...direct].sort().map(parseKey),
    transitive: [...all].sort().map(parseKey),
  };
}

function parseKey(key) {
  const [groupId, artifactId, version] = key.split(':');
  return { groupId, artifactId, version };
}

function inspectModule(workspace, modulesRoot, dependency, inspections, blockers) {
  const key = `${dependency.groupId}:${dependency.artifactId}:${dependency.version}`;
  if (inspections.has(key)) return;
  const modulePath = join(modulesRoot, dependency.artifactId);
  const pomPath = join(modulePath, 'pom.xml');
  const sourceRoot = join(modulePath, 'src');
  const result = {
    groupId: dependency.groupId,
    artifactId: dependency.artifactId,
    version: dependency.version,
    modulePath: relative(workspace, modulePath),
    pomExists: fs.existsSync(pomPath),
    sourceRootExists: fs.existsSync(sourceRoot),
    sourceFiles: 0,
    identityVerified: false,
    sourcePresentVerified: false,
    ownDependencies: [],
    blockers: [],
  };
  inspections.set(key, result);

  if (!result.pomExists) {
    result.blockers.push('editable POM module is missing');
  } else {
    const pom = fs.readFileSync(pomPath, 'utf8');
    const identity = parsePomIdentity(pom);
    result.identityVerified = identity.groupId === dependency.groupId &&
      identity.artifactId === dependency.artifactId && identity.version === dependency.version;
    if (!result.identityVerified) {
      result.blockers.push(`module identity differs: ${identity.groupId}:${identity.artifactId}:${identity.version}`);
    }

    if (result.sourceRootExists) {
      result.sourceFiles = collectSourceFiles(sourceRoot).length;
      result.sourcePresentVerified = result.sourceFiles > 0;
    }
    if (!result.sourcePresentVerified) result.blockers.push('editable Java/Groovy source is missing');

    result.ownDependencies = parsePomIbizDependencies(pom, parsePomProperties(pom));
    for (const own of result.ownDependencies) {
      const ownKey = `${own.groupId}:${own.artifactId}:${own.version}`;
      if (own.version !== dependency.version) {
        result.blockers.push(`own dependency version differs: ${ownKey}`);
      }
      inspectModule(workspace, modulesRoot, own, inspections, blockers);
    }
  }
  if (result.blockers.length > 0) blockers.push({ dependency: key, reasons: result.blockers });
}

export function verifyPlmIbizDependencyClosure({
  workspace = workspaceDefault,
  dependencyTree = '.artifacts/plm-ibiz-groovy-recursive-dependency-tree.txt',
  modulesRoot = 'ibiz-service-hub/libs',
} = {}) {
  workspace = resolve(workspace);
  const resolvedModulesRoot = childOf(workspace, modulesRoot);
  const parsed = parseDependencyTree(readText(workspace, dependencyTree));
  const inspections = new Map();
  const blockers = [];
  for (const dependency of parsed.transitive) {
    inspectModule(workspace, resolvedModulesRoot, dependency, inspections, blockers);
  }
  const modules = [...inspections.values()].sort((a, b) =>
    `${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`));
  const verified = blockers.length === 0;
  return {
    contract,
    component: 'plm-backend',
    status: verified ? 'passed' : 'blocked',
    dependencyTree: relative(workspace, childOf(workspace, dependencyTree)),
    directDependencies: parsed.direct,
    ibizDependencies: parsed.transitive,
    moduleCount: modules.length,
    sourceFileCount: modules.reduce((total, module) => total + module.sourceFiles, 0),
    ownDependencySourceClosureVerified: verified,
    fullSourceClosureVerified: false,
    nativeAcceptance: false,
    modules,
    blockers,
  };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: node harness-plm-ibiz-dependency-closure.mjs');
    return 0;
  }
  assert.equal(argv.length, 0, 'This harness takes no arguments');
  const result = verifyPlmIbizDependencyClosure();
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'passed' ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
