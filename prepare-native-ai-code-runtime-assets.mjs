#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMigrationContract, WORKSPACE } from './harness-modeling-core-audit.mjs';
import { fingerprint, PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { verifyNativeAiCodeDeployment } from './prepare-native-ai-code-deployment.mjs';
import { readFileBase64Replacement } from './prepare-native-file-base64-replacement.mjs';
import { readGlobalUtilReplacement } from './prepare-native-global-util-replacement.mjs';
import { readStudioThemeReplacements } from './prepare-native-studio-theme-replacement.mjs';
import { readDesignIndexReplacement } from './prepare-native-design-index-replacement.mjs';
import { readConsoleLayoutReplacements } from './prepare-native-console-layout-replacements.mjs';
import { readModelDesignCandidate, verifyModelDesignReferenceSurface } from './prepare-native-model-design-candidate.mjs';
import { rewritePluginReferences } from './prepare-native-model-candidate.mjs';
import {
  compileNativePluralize, modelDesignRuntimeDelivery, modelDesignRuntimeImportMap,
  modelDesignRuntimeNginx, replayNativePluralize,
} from './native-model-design-runtime.mjs';
import { patchMonacoWordHighlighter } from './monaco-word-highlighter-compat.mjs';
import { selectFrontendSourceDist } from '../modelingweb/app/scripts/frontend-source-dist.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const loaderName = '@monaco-editor/loader';
const loaderVersion = '1.7.0';
const monacoVersion = '0.52.2';
const aiCodeRepo = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const loaderAsset = `extras/js/${loaderName}/${loaderVersion}/index.system.min.js`;
const outputRoot = '.artifacts/native-ai-code-runtime-assets';
const sourceRoot = 'vendor-upstream/gottaboy-plm-web/plugin-src/' + aiCodeRepo;
const importMapSource = 'modelingweb/app/dist/extras/json/system-import.json';
const applications = ['Central', 'ModelDesign'];
const modelFiles = ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'];
const monacoEditorAsset = 'vs/editor/editor.main.js';
const monacoPatchSource = 'scripts/monaco-word-highlighter-compat.mjs';
const monacoPatchPath = fileURLToPath(new URL('./monaco-word-highlighter-compat.mjs', import.meta.url));
// PLM work-item counter bridge. The Modeling IDE design-index plugin asks the
// localized PLM service for the todo count, so the native frontend container
// needs its own route; the upstream template stays untouched.
const plmServiceVariable = '$native_plm_service';
const plmServiceOrigin = 'http://plmservice:30251';
const plmCounterApi = '/api/nativeapicode/work_items/count_my_todo';
const plmCounterUpstream = '/ibizservicerunner/serviceapi/work_items/count_my_todo';

function localPath(workspace, path, label) {
  assert.ok(typeof path === 'string' && path && !isAbsolute(path) &&
    !/[\x00-\x1f\x7f\\:%?#]/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..'),
  `${label} must be a workspace-relative path`);
  return join(workspace, path);
}

function fileAt(directories, path, expected) {
  return readPinnedFile(directories, directories.open(dirname(path)), basename(path), expected);
}

function pinnedBytes(path) {
  const directories = new PinnedDirectories();
  try { return fileAt(directories, path).data; }
  finally { directories.close(); }
}

function exactDirectories(directories, root, paths) {
  const children = new Map([['', new Set()]]);
  for (const path of paths) {
    const parts = path.split('/');
    let parent = '';
    for (const [index, part] of parts.entries()) {
      children.get(parent).add(part);
      if (index === parts.length - 1) break;
      parent = parent ? `${parent}/${part}` : part;
      if (!children.has(parent)) children.set(parent, new Set());
    }
  }
  for (const [path, names] of children) {
    const directory = directories.open(join(root, path));
    assert.deepEqual(fs.readdirSync(directory.access).sort(), [...names].sort(),
      `Unexpected candidate files or directories: ${path || '.'}`);
    directories.verify(directory);
  }
}

function candidateEvidence(workspace, candidate, cliSourcePins) {
  const directory = resolve(workspace, candidate);
  const root = join(workspace, '.artifacts/native-model-migration');
  const child = relative(root, directory);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child),
    'Model candidate must stay under .artifacts/native-model-migration');
  const directories = new PinnedDirectories();
  try {
    const receiptPath = join(directory, 'receipt.json');
    const persisted = fileAt(directories, receiptPath);
    const receiptBytes = persisted.data;
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.contract, 'native-modeling-source-backed-candidate');
    assert.equal(receipt.status, 'prepared-not-accepted');
    assert.equal(receipt.acceptedForProduction, false);
    assert.ok(Array.isArray(receipt.plugins), 'Candidate plugin evidence is required');
    assert.deepEqual(Object.keys(receipt.applications ?? {}).sort(), [...applications].sort(),
      'Candidate must record exactly both applications');
    const sourceModelRoot = localPath(workspace, receipt.sourceModelRoot, 'Original model root');
    const tree = readTree(directory, { jsonOnly: false });
    const files = new Map(tree.contents.map(file => [file.path, file]));
    assert.deepEqual(files.get('receipt.json')?.data, receiptBytes, 'Candidate receipt changed');
    const expectedPaths = ['receipt.json', 'nginx-native.conf'];
    const originals = [];
    for (const application of applications) {
      const recorded = receipt.applications[application].files;
      const paths = modelFiles.map(name => `PSSYSAPPS/${application}/${name}`);
      assert.ok(Array.isArray(recorded), `Missing ${application} model evidence`);
      assert.deepEqual(recorded.map(file => file.path).sort(), [...paths].sort(),
        `Candidate must record all three ${application} models exactly once`);
      for (const file of recorded) {
        const path = `model/${file.path}`;
        expectedPaths.push(path);
        assert.ok(files.has(path), `Missing candidate model: ${file.path}`);
        assert.equal(files.get(path).sha256, file.outputSha256,
          `Candidate model changed: ${file.path}`);
        const originalPath = join(sourceModelRoot, file.path);
        const original = fileAt(directories, originalPath);
        assert.equal(hash(original.data), file.inputSha256, `Original model changed: ${file.path}`);
        originals.push({ path: originalPath, ...original });
      }
    }
    const pluginTrees = new Map();
    const requested = new Map();
    for (const plugin of receipt.plugins) {
      assert.match(plugin.to, /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9._+-]*$/,
        'Invalid candidate plugin identity');
      assert.ok(!pluginTrees.has(plugin.to), 'Duplicate candidate plugin identity');
      const siblings = requested.get(plugin.from) ?? [];
      const selector = value => JSON.stringify([value.pluginType, value.pluginCode]);
      if (siblings.length) {
        assert.ok(plugin.partialReplacement === true &&
          siblings.every(item => item.partialReplacement === true),
        'Conflicting full/scoped candidate plugin identity');
        assert.ok(siblings.every(item => selector(item) !== selector(plugin)),
          'Duplicate scoped candidate plugin selector');
      }
      if (plugin.partialReplacement) {
        assert.equal(plugin.partialReplacement, true);
        assert.ok([plugin.pluginType, plugin.pluginCode].every(value =>
          typeof value === 'string' && value), 'Invalid scoped candidate plugin selector');
      }
      requested.set(plugin.from, [...siblings, plugin]);
      assert.equal(plugin.acceptedForProduction, false);
      assert.equal(plugin.compatibility, 'not-verified');
      const prefix = `plugins/${plugin.to}/`;
      const entries = tree.entries.filter(file => file.path.startsWith(prefix))
        .map(file => ({ ...file, path: file.path.slice(prefix.length) }));
      assert.ok(entries.length, `Missing candidate plugin: ${plugin.to}`);
      assert.equal(fingerprint(entries).fingerprint, plugin.outputFingerprint,
        `Candidate ${plugin.to === aiCodeRepo ? 'ai-code' : 'sibling plugin'} files changed: ${plugin.to}`);
      pluginTrees.set(plugin.to, entries);
      expectedPaths.push(...entries.map(file => `${prefix}${file.path}`));
    }
    assert.deepEqual(tree.entries.map(file => file.path), expectedPaths.sort((a, b) => a.localeCompare(b)),
      'Unexpected candidate delivery files');
    exactDirectories(directories, directory, expectedPaths);
    const replacementReaders = new Map([
      ['native-file-base64-independent-replacement', readFileBase64Replacement],
      ['native-global-util-independent-replacement', readGlobalUtilReplacement],
      ['native-studio-theme-independent-replacement', (options, requested) =>
        readStudioThemeReplacements(options).find(item => item.plugin.from === requested.from)],
      ['native-design-index-independent-replacement', readDesignIndexReplacement],
      ['native-console-layout-independent-replacement', (options, requested) =>
        readConsoleLayoutReplacements(options).find(item =>
          item.plugin.from === requested.from && item.plugin.to === requested.to &&
          item.plugin.pluginType === requested.pluginType && item.plugin.pluginCode === requested.pluginCode)],
      ['native-model-design-independent-replacement', (options, requested) =>
        readModelDesignCandidate({ ...options,
          sourceReport: localPath(workspace, requested.sourceBuildReport?.path, 'Model-design source report'),
        })],
    ]);
    const independentIdentities = [
      '@aibiz/file-to-base64@0.1.0', '@aibiz/global-util@0.1.0',
      '@aibiz/studio-theme@0.1.0', '@aibiz/studio-icon@0.1.0',
      '@aibiz/design-index@0.1.0',
      '@aibiz/console-terminal@0.1.0', '@aibiz/swagger-preview@0.1.0',
      '@aibiz/model-design-candidate@0.1.0',
    ];
    for (const plugin of receipt.plugins) {
      if (independentIdentities.includes(plugin.to) || plugin.contract?.endsWith('independent-replacement')) {
        assert.ok(replacementReaders.has(plugin.contract),
          'Independent replacement declarations require actual plugin evidence and a recognized contract');
      }
    }
    const replacements = receipt.plugins.filter(plugin => replacementReaders.has(plugin.contract));
    let modelDesignReplacement;
    if (replacements.length) {
      const verifiedMappings = [];
      for (const plugin of replacements) {
        const verified = replacementReaders.get(plugin.contract)({
          workspace, contract: loadMigrationContract(workspace),
        }, plugin);
        assert.ok(verified, 'Independent replacement identity must match its current local source/build');
        assert.deepEqual(plugin, verified.plugin,
          'Independent replacement evidence differs from the current local source/build');
        assert.deepEqual(pluginTrees.get(verified.plugin.to), verified.files.entries,
          'Independent replacement delivery differs');
        if (plugin.contract === 'native-model-design-independent-replacement') modelDesignReplacement = verified;
        verifiedMappings.push({
          from: verified.plugin.from, to: verified.plugin.to,
          originalSourceRecovered: false, nativeCompatibilityVerified: false,
          originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
        });
      }
      assert.deepEqual(receipt.independentReplacementMappings, verifiedMappings,
        'Independent replacement cannot claim original migration acceptance');
    } else {
      assert.ok(!receipt.independentReplacementMappings?.length,
        'Independent replacement declarations require actual plugin evidence');
    }
    const consoleLayoutReplacement = replacements.some(plugin =>
      plugin.contract === 'native-console-layout-independent-replacement');
    if (modelDesignReplacement || consoleLayoutReplacement) {
      assert.equal(receipt.nativeAccepted, false, 'Independent candidate cannot claim native acceptance');
      const mappings = new Map(receipt.plugins.filter(plugin => !plugin.partialReplacement)
        .map(plugin => [plugin.from, plugin.to]));
      const scoped = receipt.plugins.filter(plugin => plugin.partialReplacement);
      for (const original of originals) {
        const path = relative(sourceModelRoot, original.path);
        const model = JSON.parse(original.data);
        if (modelDesignReplacement) verifyModelDesignReferenceSurface(model);
        const rewritten = rewritePluginReferences(model, mappings, scoped);
        assert.deepEqual(JSON.parse(files.get(`model/${path}`).data), rewritten.model,
          `Candidate model differs from the verified source transformation: ${path}`);
        const application = path.split('/')[1];
        const recorded = receipt.applications[application].files.find(file => file.path === path);
        assert.deepEqual(recorded.changes, rewritten.changes,
          `Candidate model transformation receipt differs: ${path}`);
      }
    }
    const nginx = files.get('nginx-native.conf')?.data;
    assert.ok(nginx, 'Missing candidate nginx');
    assert.equal(hash(nginx), receipt.nginx.outputSha256, 'Candidate nginx changed');
    const nginxSourcePath = join(workspace, 'modelingweb/nginx-native.conf');
    const nginxSource = fileAt(directories, nginxSourcePath);
    assert.equal(hash(nginxSource.data), receipt.nginx.inputSha256, 'Original nginx changed');
    originals.push({ path: nginxSourcePath, ...nginxSource });

    const aiCode = receipt.plugins.find(plugin => plugin.to === aiCodeRepo);
    assert.equal(aiCode?.ibizDependencySourceBuildsVerified, true,
      'A source-built ai-code candidate is required');
    assert.ok(aiCode.deploymentReceipt && aiCode.sourceDependencies,
      'Candidate ai-code requires deployment receipt and source report evidence');
    const deploymentPath = localPath(workspace, aiCode.deploymentReceipt.path, 'Deployment receipt');
    const reportPath = localPath(workspace, aiCode.sourceDependencies.reportPath, 'Source report');
    const deployment = fileAt(directories, deploymentPath);
    const report = fileAt(directories, reportPath);
    assert.equal(hash(deployment.data), aiCode.deploymentReceipt.sha256, 'Deployment receipt hash changed');
    assert.equal(hash(report.data), aiCode.sourceDependencies.reportSha256, 'Source report hash changed');
    // Revalidate the audited build; recorded verification flags are not evidence on their own.
    const verified = verifyNativeAiCodeDeployment({
      workspace, receipt: deploymentPath, sourceReport: reportPath,
      ...(cliSourcePins ? { cliSourcePins } : {}),
    });
    assert.equal(verified.deploymentIntegrityVerified, true);
    assert.equal(verified.acceptedForProduction, false);
    assert.equal(verified.dependencies.ibizDependencySourceBuildsVerified, true);
    assert.deepEqual({
      from: aiCode.from, to: aiCode.to, sourcePath: aiCode.sourcePath,
      sourceFingerprint: aiCode.sourceFingerprint, buildOutputFingerprint: aiCode.buildOutputFingerprint,
      outputFingerprint: aiCode.outputFingerprint, buildCommand: aiCode.buildCommand,
      sourceDependencies: aiCode.sourceDependencies,
      toolchainSourceBuildsVerified: aiCode.toolchainSourceBuildsVerified,
      originalRepositoryAuthenticated: aiCode.originalRepositoryAuthenticated,
    }, {
      from: verified.mapping.requested, to: verified.mapping.candidate, sourcePath: verified.source.path,
      sourceFingerprint: verified.source.fingerprint, buildOutputFingerprint: verified.build.outputFingerprint,
      outputFingerprint: verified.deployment.fingerprint, buildCommand: verified.build.command,
      sourceDependencies: verified.dependencies.sourceBuildEvidence,
      toolchainSourceBuildsVerified: verified.dependencies.toolchainSourceBuildsVerified,
      originalRepositoryAuthenticated: verified.originalRepositoryAuthenticated,
    }, 'Candidate ai-code evidence differs from the verified deployment');
    assert.deepEqual(pluginTrees.get(aiCodeRepo), verified.deployment.entries,
      'Candidate ai-code copy differs from the verified deployment');
    for (const original of [
      ...originals, { path: deploymentPath, ...deployment }, { path: reportPath, ...report },
      { path: receiptPath, ...persisted },
    ]) {
      assert.deepEqual(fileAt(directories, original.path, original.identity).data, original.data,
        'Candidate input changed during verification');
    }
    assert.deepEqual(readTree(directory, { jsonOnly: false }).entries, tree.entries,
      'Candidate delivery changed during verification');
    exactDirectories(directories, directory, expectedPaths);
    return { directory, receipt, receiptBytes, nginx, modelDesignReplacement };
  } finally { directories.close(); }
}

function inputFile(path, data = pinnedBytes(path)) {
  return { path, bytes: data.length, sha256: hash(data) };
}

function thirdPartyOwner(directories, path) {
  let directory = dirname(path);
  while (directory !== dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const file = fileAt(directories, manifest);
      const pkg = JSON.parse(file.data);
      assert.ok([loaderName, 'state-local'].includes(pkg.name),
        `Unexpected loader dependency: ${pkg.name}`);
      return { name: pkg.name, version: pkg.version, manifest, root: directory, file };
    }
    directory = dirname(directory);
  }
  throw new Error(`No package identity for loader input: ${path}`);
}

function workspaceFile(workspace, path) {
  assert.ok(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    'Loader input must be an unambiguous absolute path');
  localPath(workspace, relative(workspace, path), 'Loader input');
  return path;
}

function validateInputs(directories, workspace, inputs, label) {
  assert.ok(Array.isArray(inputs) && inputs.length && inputs.length <= 4096,
    `${label} inventory is required`);
  const seen = new Set();
  for (const input of inputs) {
    assert.deepEqual(Object.keys(input).sort(), ['bytes', 'path', 'sha256'],
      `${label} fields differ`);
    workspaceFile(workspace, input.path);
    assert.ok(!seen.has(input.path), `${label} contains duplicate paths`);
    seen.add(input.path);
    assert.ok(Number.isSafeInteger(input.bytes) && input.bytes >= 0 &&
      typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256),
    `${label} hashes are invalid`);
    const file = fileAt(directories, input.path);
    assert.deepEqual(inputFile(input.path, file.data), input, `${label} changed: ${input.path}`);
  }
}

function runtimeMetadata(directories, loader, monaco) {
  return [
    [loader, 'package.json', `extras/js/${loaderName}/${loaderVersion}/package.json`],
    [loader, 'LICENSE', `extras/js/${loaderName}/${loaderVersion}/LICENSE`],
    [monaco, 'package.json', `plugins/monaco-editor@${monacoVersion}/package.json`],
    [monaco, 'LICENSE', `plugins/monaco-editor@${monacoVersion}/LICENSE`],
    [monaco, 'ThirdPartyNotices.txt', `plugins/monaco-editor@${monacoVersion}/ThirdPartyNotices.txt`],
  ].map(([root, name, path]) => {
    const source = join(root, name);
    const file = fileAt(directories, source);
    return { path, data: file.data, input: inputFile(source, file.data),
      source, identity: file.identity, root };
  });
}

// Both preparation and the synchronous verifier replay this same in-memory build.
export async function compileNativeRuntimeLoader({ workspace, loader }) {
  workspace = resolve(workspace);
  workspaceFile(workspace, join(loader, 'lib/es/index.js'));
  const directories = new PinnedDirectories();
  let bundle;
  try {
    const sources = new Map();
    const owners = new Map();
    const sourceTrees = new Map();
    const capture = (path, file = fileAt(directories, path)) => {
      const previous = sources.get(path);
      if (previous) {
        assert.equal(file.identity.dev, previous.identity.dev, 'Loader input identity changed');
        assert.equal(file.identity.ino, previous.identity.ino, 'Loader input identity changed');
        assert.deepEqual(file.data, previous.data, 'Loader input changed during compilation');
      } else sources.set(path, file);
      return file;
    };
    const owner = path => {
      const current = thirdPartyOwner(directories, path);
      assert.ok(current.name !== loaderName || current.root === loader,
        'Loader input belongs to another loader source');
      assert.ok(!owners.has(current.name) || owners.get(current.name).root === current.root,
        'Ambiguous loader dependency roots');
      if (current.name === loaderName) assert.equal(current.version, loaderVersion);
      if (!sourceTrees.has(current.root)) {
        sourceTrees.set(current.root, readTree(join(current.root, 'lib/es'), { jsonOnly: false }));
      }
      owners.set(current.name, current);
      capture(current.manifest, current.file);
      return current;
    };
    owner(join(loader, 'lib/es/index.js'));
    capture(join(loader, 'lib/es/index.js'));
    const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
    const { rollup } = require('rollup');
    const { nodeResolve } = require('@rollup/plugin-node-resolve');
    bundle = await rollup({
      input: join(loader, 'lib/es/index.js'),
      plugins: [
        nodeResolve({ browser: true }),
        {
          name: 'pinned-local-loader-inputs',
          load(path) {
            workspaceFile(workspace, path);
            owner(path);
            this.addWatchFile(path);
            return capture(path).data.toString('utf8');
          },
        },
      ],
      onwarn(warning) { throw new Error(warning.message); },
    });
    const paths = bundle.watchFiles.map(path => workspaceFile(workspace, path));
    assert.equal(new Set(paths).size, paths.length, 'Duplicate loader build inputs');
    assert.ok(paths.every(path => sources.has(path)), 'Unrecorded loader build inputs');
    paths.push(...[...new Set(paths.map(path => owner(path).manifest))]);
    assert.equal(new Set(paths).size, paths.length, 'Ambiguous loader build input inventory');
    assert.deepEqual([...sources.keys()].sort(), [...paths].sort(),
      'Loader build input inventory is incomplete');
    const generated = await bundle.generate({ format: 'system', compact: true, sourcemap: false });
    assert.equal(generated.output.length, 1, 'Loader must be a single self-contained SystemJS bundle');
    assert.equal(generated.output[0].type, 'chunk');
    assert.deepEqual(generated.output[0].imports, [], 'Loader must not leave unresolved dependencies');
    for (const [path, file] of sources) {
      assert.deepEqual(fileAt(directories, path, file.identity).data, file.data,
        'Loader input changed during compilation');
    }
    for (const [root, tree] of sourceTrees) {
      assert.deepEqual(readTree(join(root, 'lib/es'), { jsonOnly: false }).entries, tree.entries,
        'Loader source tree changed during compilation');
    }
    return {
      data: Buffer.from(generated.output[0].code),
      inputs: paths.map(path => inputFile(path, sources.get(path).data)),
    };
  } finally {
    try { if (bundle) await bundle.close(); }
    finally { directories.close(); }
  }
}

function replayRuntimeLoader(workspace, loader) {
  const script = [
    `import { compileNativeRuntimeLoader } from ${JSON.stringify(import.meta.url)};`,
    'const result = await compileNativeRuntimeLoader(JSON.parse(process.argv[1]));',
    'process.stdout.write(JSON.stringify({ inputs: result.inputs, data: result.data.toString("base64") }));',
  ].join('\n');
  const result = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '--eval', script, JSON.stringify({ workspace, loader }),
  ], { cwd: workspace, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] }));
  return { inputs: result.inputs, data: Buffer.from(result.data, 'base64') };
}

function readable(path) {
  const info = fs.lstatSync(path);
  assert.ok(!info.isSymbolicLink(), 'Runtime assets cannot contain symlinks');
  if (info.isDirectory()) {
    fs.chmodSync(path, 0o755);
    for (const name of fs.readdirSync(path)) readable(join(path, name));
  } else {
    assert.ok(info.isFile(), 'Runtime assets require regular files');
    fs.chmodSync(path, 0o644);
  }
}

export function nativePlmCounterNginxBlock() {
  return [
    `    set ${plmServiceVariable} ${plmServiceOrigin};`,
    '',
    `    location = ${plmCounterApi} {`,
    `        rewrite ^ ${plmCounterUpstream} break;`,
    `        proxy_pass ${plmServiceVariable};`,
    '        proxy_set_header Host $host;',
    '        proxy_set_header Authorization $http_authorization;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    }',
  ].join('\n');
}

// Drop the PLM bridge from a generated runtime nginx. Deployments on another
// owned network have no PLM service, so the route must not survive there.
export function stripNativePlmCounterNginxBlock(nginx) {
  const block = `${nativePlmCounterNginxBlock()}\n\n`;
  assert.ok(nginx.split(block).length <= 2, 'PLM counter route must appear at most once');
  const result = nginx.replace(block, '');
  assert.ok(!result.includes(plmServiceVariable) && !result.includes('plmservice'),
    'PLM counter bridge route cannot survive stripping');
  return result;
}

export function runtimeAssetNginx(nginx) {
  const anchor = '    location ^~ /nativeappcode/plugins/ {';
  assert.equal(nginx.split(anchor).length, 2, 'Expected exactly one candidate plugin route');
  return nginx.replace(anchor, [
    '    location = /nativeappcode/extras/json/system-import.json {',
    '        alias /opt/aibiz/native-ai-code-runtime-assets/extras/json/system-import.json;',
    '        default_type application/json;',
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    `    location ^~ /nativeappcode/extras/js/${loaderName}/${loaderVersion}/ {`,
    `        alias /opt/aibiz/native-ai-code-runtime-assets/extras/js/${loaderName}/${loaderVersion}/;`,
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    `    location ^~ /nativeappcode/plugins/monaco-editor@${monacoVersion}/ {`,
    `        alias /opt/aibiz/native-ai-code-runtime-assets/plugins/monaco-editor@${monacoVersion}/;`,
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    `    location ^~ /plugins/monaco-editor@${monacoVersion}/ {`,
    `        alias /opt/aibiz/native-ai-code-runtime-assets/plugins/monaco-editor@${monacoVersion}/;`,
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    nativePlmCounterNginxBlock(),
    '',
    anchor,
  ].join('\n'));
}

export function runtimeImportMap(importMap) {
  const result = structuredClone(importMap);
  assert.ok(result.imports && typeof result.imports === 'object');
  const target = `../js/${loaderName}/${loaderVersion}/index.system.min.js`;
  assert.ok(!result.imports[loaderName] || result.imports[loaderName] === target,
    'Do not silently replace another loader version');
  result.imports[loaderName] = target;
  return result;
}

export async function prepareNativeAiCodeRuntimeAssets({
  workspace = WORKSPACE, candidate, output, cliSourcePins,
  frontendDist, frontendReceipt, frontendReceiptSha256,
  loaderSource = join(workspace, sourceRoot, 'node_modules', loaderName),
  monacoSource = join(workspace, sourceRoot, 'node_modules/monaco-editor'),
} = {}, { selectFrontend = selectFrontendSourceDist } = {}) {
  workspace = resolve(workspace);
  const frontendOptions = { workspace, frontendDist, frontendReceipt, frontendReceiptSha256 };
  const frontend = selectFrontend(frontendOptions);
  assert.ok(candidate, 'An explicit model candidate is required');
  const evidence = candidateEvidence(workspace, candidate, cliSourcePins);
  const destination = resolve(workspace, output ?? join(outputRoot, `assets-${randomUUID()}`));
  assert.equal(dirname(destination), join(workspace, outputRoot), 'Invalid runtime asset output');
  assert.match(relative(join(workspace, outputRoot), destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!fs.existsSync(destination), 'Existing runtime evidence must not be overwritten');
  const loader = fs.realpathSync(loaderSource);
  const monaco = fs.realpathSync(monacoSource);
  for (const path of [loader, monaco]) {
    assert.ok(relative(workspace, path) && !relative(workspace, path).startsWith('..'),
      'Third-party inputs must be local workspace files');
  }
  const directories = new PinnedDirectories();
  try {
    const metadata = runtimeMetadata(directories, loader, monaco);
    const loaderManifest = JSON.parse(metadata.find(file =>
      file.source === join(loader, 'package.json')).data);
    const monacoManifest = JSON.parse(metadata.find(file =>
      file.source === join(monaco, 'package.json')).data);
    assert.equal(loaderManifest.name, loaderName);
    assert.equal(loaderManifest.version, loaderVersion);
    assert.equal(monacoManifest.name, 'monaco-editor');
    assert.equal(monacoManifest.version, monacoVersion);
    const importMapPath = frontend ? join(frontend.dist, 'extras/json/system-import.json')
      : join(workspace, importMapSource);
    const importMapBytes = pinnedBytes(importMapPath);
    let importMap = runtimeImportMap(JSON.parse(importMapBytes));
    let runtimeNginx = runtimeAssetNginx(evidence.nginx.toString());
    let modelDesignRuntime;
    if (evidence.modelDesignReplacement) {
      const replacement = evidence.modelDesignReplacement;
      const compiled = await compileNativePluralize({ workspace, root: replacement.pluralizeSource });
      modelDesignRuntime = modelDesignRuntimeDelivery(replacement, compiled);
      importMap = modelDesignRuntimeImportMap(importMap);
      runtimeNginx = modelDesignRuntimeNginx(runtimeNginx);
      assert.ok(replacement.plugin.runtimeImports.every(name => Object.hasOwn(importMap.imports, name)),
        'Model-design has unresolved host imports');
    }
    const monacoFiles = readTree(join(monaco, 'min'), { jsonOnly: false });
    assert.ok(monacoFiles.entries.some(file => file.path === monacoEditorAsset));
    assert.ok(monacoFiles.entries.some(file => file.path === 'vs/loader.js'));
    const patchSourceBytes = pinnedBytes(monacoPatchPath);
    const patchedMonaco = patchMonacoWordHighlighter(
      monacoFiles.contents.find(file => file.path === monacoEditorAsset).data);

    const { data: compiled, inputs } = await compileNativeRuntimeLoader({ workspace, loader });
    const files = [
      { path: loaderAsset, data: compiled },
      { path: 'extras/json/system-import.json', data: Buffer.from(`${JSON.stringify(importMap, null, 2)}\n`) },
      { path: 'nginx-native.conf', data: Buffer.from(runtimeNginx) },
      ...(modelDesignRuntime?.files ?? []),
      ...monacoFiles.contents.map(file => ({
        ...file, path: `plugins/monaco-editor@${monacoVersion}/min/${file.path}`,
        data: file.path === monacoEditorAsset ? patchedMonaco.data : file.data,
      })),
      ...metadata,
    ].sort((left, right) => left.path.localeCompare(right.path));
    const entries = files.map(file => ({ path: file.path, bytes: file.data.length, sha256: hash(file.data) }));
    directories.open(join(workspace, outputRoot), { create: true });
    directories.open(destination, { create: true, exclusive: true });
    for (const file of files) {
      directories.write(directories.open(dirname(join(destination, file.path)), { create: true }),
        file.path.split('/').at(-1), file.data);
    }
    assert.deepEqual(readTree(destination, { jsonOnly: false }).entries, entries);
    assert.deepEqual(candidateEvidence(workspace, candidate, cliSourcePins).receiptBytes, evidence.receiptBytes);
    assert.deepEqual(pinnedBytes(importMapPath), importMapBytes, 'Original import map changed');
    assert.deepEqual(selectFrontend(frontendOptions), frontend, 'Independent frontend source evidence changed');
    assert.deepEqual(readTree(join(monaco, 'min'), { jsonOnly: false }).entries, monacoFiles.entries);
    assert.deepEqual(pinnedBytes(monacoPatchPath), patchSourceBytes,
      'Monaco compatibility patch changed during preparation');
    validateInputs(directories, workspace, inputs, 'Loader build inputs');
    for (const file of metadata) {
      assert.deepEqual(fileAt(directories, file.source, file.identity).data, file.data,
        'Third-party metadata changed during preparation');
    }
    const receipt = {
      schemaVersion: 1, contract: 'native-ai-code-local-runtime-assets',
      status: 'prepared-not-accepted', acceptedForProduction: false,
      candidate: { path: relative(workspace, evidence.directory), receiptSha256: hash(evidence.receiptBytes) },
      sourceImportMap: { path: relative(workspace, importMapPath), sha256: hash(importMapBytes) },
      ...(frontend ? { frontend } : {}),
      packages: [
        { name: loaderName, version: loaderVersion, source: relative(workspace, loader),
          build: 'local-rollup-systemjs', inputs,
          metadataInputs: metadata.filter(file => file.root === loader).map(file => file.input) },
        { name: 'monaco-editor', version: monacoVersion, source: relative(workspace, monaco),
          delivery: 'published-third-party-min-assets-with-recorded-compatibility-patch',
          metadataInputs: metadata.filter(file => file.root === monaco).map(file => file.input),
          compatibilityPatches: [{ ...patchedMonaco.evidence,
            source: monacoPatchSource, sourceSha256: hash(patchSourceBytes) }] },
      ],
      delivery: { ...fingerprint(entries), entries },
      ...(modelDesignRuntime ? { modelDesignRuntime: modelDesignRuntime.evidence, nativeAccepted: false } : {}),
      remainingAcceptance: ['native plugin rendering', 'native editor/save/fresh-session readback', 'missing sibling plugins'],
    };
    directories.write(directories.open(destination), 'receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
    readable(destination);
    return { destination, receipt };
  } finally { directories.close(); }
}

export function verifyNativeAiCodeRuntimeAssets({ workspace = WORKSPACE, assets, cliSourcePins } = {},
  { selectFrontend = selectFrontendSourceDist } = {}) {
  workspace = resolve(workspace);
  assert.ok(assets, 'An explicit runtime assets directory is required');
  const directory = resolve(workspace, assets);
  const directories = new PinnedDirectories();
  try {
    const receiptPath = join(directory, 'receipt.json');
    const persisted = fileAt(directories, receiptPath);
    const receiptBytes = persisted.data;
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.contract, 'native-ai-code-local-runtime-assets');
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.status, 'prepared-not-accepted');
    assert.equal(receipt.acceptedForProduction, false);
    let frontend;
    if (Object.hasOwn(receipt, 'frontend')) {
      assert.ok(receipt.frontend && typeof receipt.frontend === 'object');
      frontend = selectFrontend({
        workspace, frontendDist: receipt.frontend.dist,
        frontendReceipt: receipt.frontend.receipt?.path,
        frontendReceiptSha256: receipt.frontend.receipt?.sha256,
      });
      assert.deepEqual(frontend, receipt.frontend, 'Independent frontend source evidence changed');
    }
    assert.ok(Array.isArray(receipt.packages), 'Runtime package evidence is required');
    assert.deepEqual(receipt.packages.map(pkg => [pkg.name, pkg.version]),
      [[loaderName, loaderVersion], ['monaco-editor', monacoVersion]]);
    const evidence = candidateEvidence(workspace, receipt.candidate.path, cliSourcePins);
    assert.equal(hash(evidence.receiptBytes), receipt.candidate.receiptSha256, 'Model candidate receipt changed');
    const files = readTree(directory, { jsonOnly: false });
    assert.deepEqual(files.contents.find(file => file.path === 'receipt.json')?.data, receiptBytes,
      'Runtime asset receipt changed during verification');
    const entries = files.entries.filter(file => file.path !== 'receipt.json');
    assert.deepEqual(entries, receipt.delivery.entries, 'Runtime asset delivery changed');
    assert.deepEqual(fingerprint(entries), Object.fromEntries(Object.entries(receipt.delivery).filter(([key]) => key !== 'entries')));
    let expectedImportMap;
    let expectedNginx = runtimeAssetNginx(evidence.nginx.toString());
    let modelDesignRuntime;
    if (evidence.modelDesignReplacement) {
      assert.equal(receipt.nativeAccepted, false);
      const replacement = evidence.modelDesignReplacement;
      const compiled = replayNativePluralize({ workspace, root: replacement.pluralizeSource });
      modelDesignRuntime = modelDesignRuntimeDelivery(replacement, compiled);
      assert.deepEqual(receipt.modelDesignRuntime, modelDesignRuntime.evidence,
        'Source-built model-design runtime evidence drift');
      for (const file of modelDesignRuntime.files) {
        assert.deepEqual(files.contents.find(delivered => delivered.path === file.path)?.data, file.data,
          `Model-design runtime delivery differs: ${file.path}`);
      }
      expectedNginx = modelDesignRuntimeNginx(expectedNginx);
    } else {
      assert.equal(Object.hasOwn(receipt, 'modelDesignRuntime'), false,
        'Runtime integration requires a source-verified model-design candidate');
    }
    const loaderPackage = receipt.packages[0];
    const monacoPackage = receipt.packages[1];
    assert.equal(loaderPackage.build, 'local-rollup-systemjs', 'Loader build provenance differs');
    const loaderRoot = localPath(workspace, loaderPackage.source, 'Loader source');
    const monacoRoot = localPath(workspace, monacoPackage.source, 'Monaco source');
    assert.notEqual(loaderRoot, monacoRoot, 'Third-party source roots must differ');
    const metadata = runtimeMetadata(directories, loaderRoot, monacoRoot);
    const manifest = root => JSON.parse(metadata.find(file =>
      file.source === join(root, 'package.json')).data);
    assert.equal(manifest(loaderRoot).name, loaderName);
    assert.equal(manifest(loaderRoot).version, loaderVersion);
    assert.equal(manifest(monacoRoot).name, 'monaco-editor');
    assert.equal(manifest(monacoRoot).version, monacoVersion);
    validateInputs(directories, workspace, loaderPackage.inputs, 'Loader build inputs');
    const inputPaths = loaderPackage.inputs.map(input => input.path);
    assert.ok([join(loaderRoot, 'lib/es/index.js'), join(loaderRoot, 'package.json')]
      .every(path => inputPaths.includes(path)), 'Loader build input inventory is incomplete');
    for (const [pkg, root] of [[loaderPackage, loaderRoot], [monacoPackage, monacoRoot]]) {
      const label = `${pkg.name} metadata inputs`;
      validateInputs(directories, workspace, pkg.metadataInputs, label);
      assert.deepEqual(pkg.metadataInputs, metadata.filter(file => file.root === root).map(file => file.input),
        `${label} inventory differs`);
    }
    const replay = replayRuntimeLoader(workspace, loaderRoot);
    const sortedInputs = inputs => [...inputs].sort((left, right) => left.path.localeCompare(right.path));
    assert.deepEqual(sortedInputs(loaderPackage.inputs), sortedInputs(replay.inputs),
      'Loader build input inventory differs from the replayed build');
    assert.deepEqual(files.contents.find(file => file.path === loaderAsset)?.data, replay.data,
      'Loader runtime bundle differs from the replayed build');
    for (const file of metadata) {
      assert.deepEqual(files.contents.find(delivered => delivered.path === file.path)?.data, file.data,
        `Third-party metadata delivery differs: ${file.path}`);
    }
    assert.equal(monacoPackage.delivery,
      'published-third-party-min-assets-with-recorded-compatibility-patch',
      'Monaco lifecycle compatibility evidence is required');
    const monacoFiles = readTree(join(monacoRoot, 'min'), { jsonOnly: false });
    const patchedMonaco = patchMonacoWordHighlighter(
      monacoFiles.contents.find(file => file.path === monacoEditorAsset)?.data ??
        Buffer.from('Missing Monaco editor'));
    const patchSource = fileAt(directories, monacoPatchPath);
    assert.deepEqual(monacoPackage.compatibilityPatches, [{
      ...patchedMonaco.evidence, source: monacoPatchSource,
      sourceSha256: hash(patchSource.data),
    }], 'Monaco compatibility patch evidence changed');
    const prefix = `plugins/monaco-editor@${monacoVersion}/min/`;
    assert.deepEqual(entries.filter(file => file.path.startsWith(prefix)),
      monacoFiles.contents.map(file => {
        const data = file.path === monacoEditorAsset ? patchedMonaco.data : file.data;
        return { path: `${prefix}${file.path}`, bytes: data.length, sha256: hash(data) };
      }), 'Monaco runtime must preserve the exact source tree plus the recorded patch');
    const expectedPaths = [
      loaderAsset, 'extras/json/system-import.json', 'nginx-native.conf',
      ...monacoFiles.entries.map(file => `${prefix}${file.path}`),
      ...metadata.map(file => file.path),
      ...(modelDesignRuntime?.files.map(file => file.path) ?? []),
    ].sort((left, right) => left.localeCompare(right));
    assert.deepEqual(entries.map(file => file.path), expectedPaths,
      'Unexpected runtime asset delivery files');
    exactDirectories(directories, directory, [...expectedPaths, 'receipt.json']);
    assert.equal(receipt.sourceImportMap.path, frontend
      ? relative(workspace, join(frontend.dist, 'extras/json/system-import.json')) : importMapSource);
    const sourceImportMap = pinnedBytes(join(workspace, receipt.sourceImportMap.path));
    assert.equal(hash(sourceImportMap), receipt.sourceImportMap.sha256, 'Original import map changed');
    expectedImportMap = runtimeImportMap(JSON.parse(sourceImportMap));
    if (modelDesignRuntime) expectedImportMap = modelDesignRuntimeImportMap(expectedImportMap);
    assert.deepEqual(JSON.parse(pinnedBytes(join(directory, 'extras/json/system-import.json'))),
      expectedImportMap, 'Runtime map must preserve all existing imports');
    assert.equal(pinnedBytes(join(directory, 'nginx-native.conf')).toString(),
      expectedNginx, 'Runtime nginx routes changed');
    validateInputs(directories, workspace, loaderPackage.inputs, 'Loader build inputs');
    for (const file of metadata) {
      assert.deepEqual(fileAt(directories, file.source, file.identity).data, file.data,
        'Third-party metadata changed during verification');
    }
    assert.deepEqual(fileAt(directories, monacoPatchPath, patchSource.identity).data, patchSource.data,
      'Monaco compatibility patch changed during verification');
    assert.deepEqual(readTree(join(monacoRoot, 'min'), { jsonOnly: false }).entries, monacoFiles.entries,
      'Monaco source changed during verification');
    assert.deepEqual(fileAt(directories, receiptPath, persisted.identity).data, receiptBytes,
      'Runtime asset receipt changed during verification');
    assert.deepEqual(readTree(directory, { jsonOnly: false }).entries, files.entries,
      'Runtime asset delivery changed during verification');
    if (frontend) {
      assert.deepEqual(selectFrontend({
        workspace, frontendDist: frontend.dist, frontendReceipt: frontend.receipt.path,
        frontendReceiptSha256: frontend.receipt.sha256,
      }), frontend, 'Independent frontend source evidence changed during verification');
    }
    exactDirectories(directories, directory, [...expectedPaths, 'receipt.json']);
    return { directory, receipt, candidate: evidence.directory };
  } finally { directories.close(); }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    candidate: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    'frontend-dist': { type: 'string' }, 'frontend-receipt': { type: 'string' },
    'frontend-receipt-sha256': { type: 'string' },
  } });
  if (values.help) {
    console.log('Usage: node prepare-native-ai-code-runtime-assets.mjs --candidate PATH [--output PATH]');
    console.log('Independent source dist requires --frontend-dist PATH --frontend-receipt PATH --frontend-receipt-sha256 SHA.');
    return;
  }
  const result = await prepareNativeAiCodeRuntimeAssets({
    candidate: values.candidate, output: values.output,
    frontendDist: values['frontend-dist'], frontendReceipt: values['frontend-receipt'],
    frontendReceiptSha256: values['frontend-receipt-sha256'],
  });
  console.log(`Prepared ${result.receipt.delivery.files} runtime asset files: ${result.destination}`);
  console.log('Native acceptance remains incomplete');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
