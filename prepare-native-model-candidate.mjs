#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, openSync,
  readFileSync, readdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  fingerprintDirectory, inside, loadMigrationContract, validateMigrationMapping, WORKSPACE,
} from './harness-modeling-core-audit.mjs';
import { collectPluginReferences } from './harness-plugin-audit.mjs';
import { directoryPath, PinnedDirectories, readTree } from './native-candidate-files.mjs';
import { verifyNativeAiCodeDeployment } from './prepare-native-ai-code-deployment.mjs';
import { readFileBase64Replacement } from './prepare-native-file-base64-replacement.mjs';
import { readGlobalUtilReplacement } from './prepare-native-global-util-replacement.mjs';
import { readStudioThemeReplacements } from './prepare-native-studio-theme-replacement.mjs';
import { readDesignIndexReplacement } from './prepare-native-design-index-replacement.mjs';
import { readConsoleLayoutReplacements } from './prepare-native-console-layout-replacements.mjs';
import { readModelDesignCandidate, verifyModelDesignReferenceSurface } from './prepare-native-model-design-candidate.mjs';
import { inspectNativeThemeReferences } from './native-theme-references.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const modelFiles = ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json'];
const applicationNames = ['Central', 'ModelDesign'];

function makeCandidateReadable(directories, directory) {
  directories.verify(directory);
  for (const name of readdirSync(directory.access)) {
    const path = directories.entry(directory, name);
    const info = lstatSync(path);
    assert.ok(!info.isSymbolicLink(), 'Candidate delivery cannot contain symlinks');
    if (info.isDirectory()) {
      makeCandidateReadable(directories, directories.open(join(directory.path, name)));
    } else {
      assert.ok(info.isFile(), 'Candidate delivery requires regular files');
      const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = fstatSync(descriptor);
        assert.ok(opened.isFile() && opened.dev === info.dev && opened.ino === info.ino,
          'Candidate file changed while publishing');
        fchmodSync(descriptor, 0o644);
      } finally {
        closeSync(descriptor);
      }
    }
  }
  directories.verify(directory);
  fchmodSync(directory.descriptor, 0o755);
}

export function readAiCodeModelCandidate({ workspace = WORKSPACE, receipt, sourceReport } = {}) {
  assert.ok(receipt && sourceReport,
    'ai-code integration requires both a deployment receipt and a source-dependency report');
  workspace = resolve(workspace);
  const verified = verifyNativeAiCodeDeployment({ workspace, receipt, sourceReport });
  assert.equal(verified.dependencies.ibizDependencySourceBuildsVerified, true,
    'ai-code must be freshly built with local source dependencies');
  const files = readTree(join(workspace, verified.deployment.path), { jsonOnly: false });
  assert.deepEqual(files.entries, verified.deployment.entries,
    'ai-code integration files differ from the verified deployment');
  return {
    files,
    plugin: {
      from: verified.mapping.requested, to: verified.mapping.candidate,
      sourcePath: verified.source.path,
      sourceStatus: 'published-source-with-recorded-local-fixes',
      sourceFingerprint: verified.source.fingerprint,
      buildOutputFingerprint: verified.build.outputFingerprint,
      outputFingerprint: files.fingerprint,
      buildCommand: verified.build.command,
      deploymentReceipt: {
        path: relative(workspace, resolve(workspace, receipt)),
        sha256: hash(readFileSync(resolve(workspace, receipt))),
      },
      sourceDependencies: verified.dependencies.sourceBuildEvidence,
      ibizDependencySourceBuildsVerified: true,
      toolchainSourceBuildsVerified: verified.dependencies.toolchainSourceBuildsVerified,
      originalRepositoryAuthenticated: false,
      compatibility: 'not-verified', acceptedForProduction: false,
    },
  };
}

export function rewritePluginReferences(model, replacements, scopedReplacements = []) {
  const selections = new Set();
  for (const selection of scopedReplacements) {
    assert.ok(selection && ['from', 'to', 'pluginType', 'pluginCode'].every(key =>
      typeof selection[key] === 'string' && selection[key]), 'Invalid scoped plugin replacement');
    const identity = JSON.stringify([selection.from, selection.pluginType, selection.pluginCode]);
    assert.ok(!selections.has(identity) && !replacements.has(selection.from),
      'Conflicting scoped plugin replacement');
    selections.add(identity);
  }
  const candidate = structuredClone(model);
  const changes = [];
  const visit = (value, pointer = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const location = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      const themeReference =
        (key === 'theme-package-path' && /^\/getAllPSAppUIThemes\/\d+\/themeParams$/.test(pointer)) ||
        (key === 'themeUrl' && /^\/getAllPSAppUIThemes\/\d+$/.test(pointer));
      const scoped = key.toLowerCase() === 'rtobjectrepo' ?
        scopedReplacements.find(selection => selection.from === child &&
          selection.pluginType === value.pluginType && selection.pluginCode === value.pluginCode) : undefined;
      if (((key.toLowerCase() === 'rtobjectrepo' || themeReference) && replacements.has(child)) || scoped) {
        const target = scoped?.to ?? replacements.get(child);
        if (target !== child) {
          value[key] = target;
          changes.push({ location, from: child, to: target });
        }
      } else {
        visit(child, location);
      }
    }
  };
  visit(candidate);
  return { model: candidate, changes };
}

export function prepareNativeModelCandidate({
  workspace = WORKSPACE,
  output = join(workspace, '.artifacts/native-model-migration/current'),
  aiCodeDeploymentReceipt,
  aiCodeSourceDepsReport,
  fileBase64Replacement = false,
  globalUtilReplacement = false,
  studioThemeReplacement = false,
  designIndexReplacement = false,
  consoleLayoutReplacement = false,
  modelDesignSourceReport,
} = {}) {
  workspace = resolve(workspace);
  output = resolve(output);
  const allowedRoot = join(workspace, '.artifacts/native-model-migration');
  assert.ok(inside(allowedRoot, output) && output !== allowedRoot,
    'Candidate output must be a child of .artifacts/native-model-migration');
  directoryPath(output, { allowMissing: true });
  assert.ok(!existsSync(output) || readdirSync(output).length === 0,
    'Use a new empty candidate directory; existing evidence must not be overwritten');
  const contract = loadMigrationContract(workspace);
  const mappings = contract.migrationMappings;
  assert.equal(Boolean(aiCodeDeploymentReceipt), Boolean(aiCodeSourceDepsReport),
    'ai-code integration requires both a deployment receipt and a source-dependency report');
  const aiCode = aiCodeDeploymentReceipt ? readAiCodeModelCandidate({
    workspace, receipt: aiCodeDeploymentReceipt, sourceReport: aiCodeSourceDepsReport,
  }) : null;
  assert.equal(typeof fileBase64Replacement, 'boolean', 'Replacement selection must be boolean');
  const fileBase64 = fileBase64Replacement ? readFileBase64Replacement({ workspace, contract }) : null;
  assert.equal(typeof globalUtilReplacement, 'boolean', 'Global utility replacement selection must be boolean');
  const globalUtil = globalUtilReplacement ? readGlobalUtilReplacement({ workspace, contract }) : null;
  assert.equal(typeof studioThemeReplacement, 'boolean', 'Theme replacement selection must be boolean');
  const themes = studioThemeReplacement ? readStudioThemeReplacements({ workspace, contract }) : [];
  assert.equal(typeof designIndexReplacement, 'boolean', 'Design index replacement selection must be boolean');
  const designIndex = designIndexReplacement ? readDesignIndexReplacement({ workspace, contract }) : null;
  assert.equal(typeof consoleLayoutReplacement, 'boolean', 'Console/layout replacement selection must be boolean');
  const consoleLayout = consoleLayoutReplacement ? readConsoleLayoutReplacements({ workspace, contract }) : [];
  const modelDesign = modelDesignSourceReport ? readModelDesignCandidate({
    workspace, contract, sourceReport: modelDesignSourceReport,
  }) : null;
  const selected = [];
  for (const mapping of mappings) {
    if (mapping.build.status !== 'verified') continue;
    const checked = validateMigrationMapping(mapping, workspace);
    assert.equal(checked.valid, true,
      `Invalid candidate evidence for ${mapping.from}: ${checked.blockers.join(', ')}`);
    const source = fingerprintDirectory(workspace, mapping.source.path);
    const target = fingerprintDirectory(workspace, mapping.target.artifact.path);
    assert.deepEqual(mapping.build.receipt.inputs, source.entries,
      `Build inputs must bind the complete current source: ${mapping.from}`);
    assert.deepEqual(mapping.build.receipt.outputs, target.entries,
      `Build outputs must bind the complete current target: ${mapping.from}`);
    selected.push(mapping);
  }
  const integrations = [aiCode, fileBase64, globalUtil, ...themes, designIndex, ...consoleLayout, modelDesign].filter(Boolean);
  assert.ok(selected.length || integrations.length, 'No locally built source-backed candidate plugins');
  for (const integration of integrations) {
    assert.ok(themes.includes(integration) ||
      mappings.some(mapping => mapping.from === integration.plugin.from),
      'Integrated requested identity must exist in the native migration contract');
    assert.ok(!selected.some(mapping => mapping.from === integration.plugin.from),
      'Integration cannot replace a second selected build of the same plugin');
  }
  const replacements = new Map(selected.map(mapping => [mapping.from, mapping.target.repo]));
  for (const integration of integrations) {
    if (!integration.plugin.partialReplacement) replacements.set(integration.plugin.from, integration.plugin.to);
  }
  const scopedReplacements = integrations.filter(item => item.plugin.partialReplacement).map(item => item.plugin);
  const applications = {};
  const pendingWrites = [];
  const originalThemes = new Map();
  for (const application of applicationNames) {
    const files = [];
    for (const file of modelFiles) {
      const relativePath = `PSSYSAPPS/${application}/${file}`;
      const input = readFileSync(join(workspace, contract.evidence.modelRoot, relativePath));
      if (file === 'PSSYSAPP.json') {
        assert.equal(hash(input), contract.evidence.applications[application].inputSha256,
          `Original ${application} model has changed; refresh its audit before migration`);
      }
      const original = JSON.parse(input);
      if (modelDesign) verifyModelDesignReferenceSurface(original);
      const references = collectPluginReferences(original);
      assert.equal(references.invalidReferences.length, 0, relativePath);
      const themeReferences = inspectNativeThemeReferences(original);
      for (const reference of themeReferences) {
        const replacement = themes.find(item => item.plugin.from === reference.repo);
        if (replacement) {
          for (const theme of reference.themes) {
            assert.equal(theme.tag, replacement.plugin.themeTag,
              `Native theme tag differs from its replacement in ${relativePath}`);
            assert.equal(theme.type, replacement.plugin.variant === 'icon' ? 'ICON' : 'COLOR',
              `Native theme type differs from its replacement in ${relativePath}`);
          }
        }
        const previous = originalThemes.get(reference.repo);
        originalThemes.set(reference.repo, {
          ...reference, themes: [...(previous?.themes ?? []), ...reference.themes],
        });
      }
      const rewritten = rewritePluginReferences(original, replacements, scopedReplacements);
      const remainingRepos = new Set(collectPluginReferences(rewritten.model).packages.map(plugin => plugin.repo));
      const bytes = Buffer.from(`${JSON.stringify(rewritten.model, null, 2)}\n`);
      pendingWrites.push({ relativePath: `model/${relativePath}`, bytes });
      files.push({
        path: relativePath, inputSha256: hash(input), outputSha256: hash(bytes),
        changes: rewritten.changes,
        unresolved: references.packages.filter(plugin => !replacements.has(plugin.repo) && remainingRepos.has(plugin.repo))
          .map(plugin => plugin.repo),
        ...(studioThemeReplacement ? {
          unresolvedThemes: themeReferences.filter(theme => !replacements.has(theme.repo))
            .map(theme => theme.repo),
        } : {}),
      });
    }
    applications[application] = { files };
  }
  for (const { plugin } of themes) {
    assert.ok(originalThemes.get(plugin.from)?.themes.some(theme => theme.tag === plugin.themeTag),
      'Theme replacement requires a matching original native declaration');
  }
  const nginxSource = readFileSync(join(workspace, 'modelingweb/nginx-native.conf'), 'utf8');
  const anchor = '    location /nativeappcode/ {';
  assert.equal(nginxSource.split(anchor).length, 2, 'Native nginx template must have one application route');
  const nginxCandidate = nginxSource.replace(anchor, [
    '    location ^~ /nativeappcode/plugins/ {',
    '        alias /opt/aibiz/native-candidate-plugins/;',
    '        add_header Cache-Control no-store;',
    '    }',
    '',
    anchor,
  ].join('\n'));
  const plugins = [];
  for (const mapping of selected) {
    const files = readTree(join(workspace, mapping.target.artifact.path), { jsonOnly: false });
    assert.deepEqual(files.entries, mapping.build.receipt.outputs,
      `Candidate input must preserve every verified build output: ${mapping.from}`);
    for (const file of files.contents) {
      pendingWrites.push({ relativePath: `plugins/${mapping.target.repo}/${file.path}`, bytes: file.data });
    }
    plugins.push({
      from: mapping.from, to: mapping.target.repo,
      sourcePath: mapping.source.path, sourceStatus: mapping.source.status,
      sourceFingerprint: mapping.source.fingerprint,
      outputFingerprint: files.fingerprint,
      buildCommand: mapping.build.receipt.command,
      compatibility: 'not-verified', acceptedForProduction: false,
    });
  }
  for (const integration of integrations) {
    const targetPath = `plugins/${integration.plugin.to}`;
    for (const file of integration.files.contents) {
      pendingWrites.push({ relativePath: `${targetPath}/${file.path}`, bytes: file.data });
    }
    const rechecked = integration === aiCode ? readAiCodeModelCandidate({
      workspace, receipt: aiCodeDeploymentReceipt, sourceReport: aiCodeSourceDepsReport,
    }) : integration === fileBase64 ?
      readFileBase64Replacement({ workspace, contract }) :
      integration === globalUtil ? readGlobalUtilReplacement({ workspace, contract }) :
      integration === designIndex ? readDesignIndexReplacement({ workspace, contract }) :
      consoleLayout.includes(integration) ? readConsoleLayoutReplacements({ workspace, contract })
        .find(item => item.plugin.to === integration.plugin.to) :
      integration === modelDesign ? readModelDesignCandidate({
        workspace, contract, sourceReport: modelDesignSourceReport,
      }) :
        readStudioThemeReplacements({ workspace, contract })
          .find(item => item.plugin.from === integration.plugin.from);
    assert.deepEqual(rechecked.plugin, integration.plugin,
      'Integration build evidence changed during candidate preparation');
    assert.deepEqual(rechecked.files.entries, integration.files.entries,
      'Integration files changed during candidate preparation');
    plugins.push(integration.plugin);
  }
  const receipt = {
    schemaVersion: 1, contract: 'native-modeling-source-backed-candidate',
    status: 'prepared-not-accepted', acceptedForProduction: false,
    ...(modelDesign || consoleLayout.length ? { nativeAccepted: false } : {}),
    sourceModelRoot: contract.evidence.modelRoot,
    nginx: { inputSha256: hash(nginxSource), outputSha256: hash(nginxCandidate) },
    plugins, applications,
    unresolvedMappings: mappings.filter(mapping => !replacements.has(mapping.from))
      .map(mapping => ({ repo: mapping.from, blockers: mapping.blockers })),
    ...(studioThemeReplacement ? {
      unresolvedThemeMappings: [...originalThemes.keys()].filter(repo => !replacements.has(repo)).sort(),
    } : {}),
    remainingAcceptance: [
      'complete editable source for every native plugin and its iBiz dependencies',
      'native plugin runtime compatibility',
      'native editor operations and model save',
      'fresh-session model readback',
    ],
    ...([fileBase64, globalUtil, ...themes, designIndex, ...consoleLayout, modelDesign].some(Boolean) ? {
      independentReplacementMappings: [fileBase64, globalUtil, ...themes, designIndex, ...consoleLayout, modelDesign].filter(Boolean).map(({ plugin }) => ({
        from: plugin.from, to: plugin.to,
        originalSourceRecovered: false, nativeCompatibilityVerified: false,
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
      })),
    } : {}),
  };
  pendingWrites.push(
    { relativePath: 'nginx-native.conf', bytes: nginxCandidate },
    { relativePath: 'receipt.json', bytes: `${JSON.stringify(receipt, null, 2)}\n` },
  );
  const directories = new PinnedDirectories();
  try {
    const destination = directories.open(output, { create: true });
    assert.equal(readdirSync(destination.access).length, 0,
      'Use a new empty candidate directory; existing evidence must not be overwritten');
    for (const { relativePath, bytes } of pendingWrites) {
      const file = join(output, relativePath);
      const parent = directories.open(dirname(file), { create: true });
      directories.write(parent, relative(parent.path, file), bytes);
    }
    for (const plugin of plugins) {
      assert.equal(readTree(join(output, 'plugins', plugin.to), { jsonOnly: false }).fingerprint,
        plugin.outputFingerprint, `Candidate package copy must preserve its build output: ${plugin.from}`);
    }
    // Only the delivery mounted by nginx UID 101 is made public, never its ancestors.
    makeCandidateReadable(directories, destination);
  } finally {
    directories.close();
  }
  return receipt;
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    output: { type: 'string' },
    'ai-code-deployment-receipt': { type: 'string' },
    'ai-code-source-deps-report': { type: 'string' },
    'file-base64-replacement': { type: 'boolean' },
    'global-util-replacement': { type: 'boolean' },
    'studio-theme-replacement': { type: 'boolean' },
    'design-index-replacement': { type: 'boolean' },
    'console-layout-replacement': { type: 'boolean' },
    'model-design-source-report': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node prepare-native-model-candidate.mjs [--output directory]');
    console.log('Optional source-built ai-code: --ai-code-deployment-receipt PATH --ai-code-source-deps-report PATH');
    console.log('Optional independent file editor: --file-base64-replacement (does not recover original source)');
    console.log('Optional independent global utilities: --global-util-replacement (does not recover original source)');
    console.log('Optional independent native themes: --studio-theme-replacement (does not recover original source)');
    console.log('Optional index-only layout replacement: --design-index-replacement (Swagger stays unresolved)');
    console.log('Optional scoped console and Swagger views: --console-layout-replacement (not original/native acceptance)');
    console.log('Optional full alpha122 source-built candidate: --model-design-source-report PATH (alpha90 native acceptance remains false)');
    console.log('Creates an isolated model/plugin candidate; native acceptance remains incomplete.');
    return;
  }
  const output = resolve(values.output || join(WORKSPACE, '.artifacts/native-model-migration/current'));
  const receipt = prepareNativeModelCandidate({
    output, aiCodeDeploymentReceipt: values['ai-code-deployment-receipt'],
    aiCodeSourceDepsReport: values['ai-code-source-deps-report'],
    fileBase64Replacement: values['file-base64-replacement'],
    globalUtilReplacement: values['global-util-replacement'],
    studioThemeReplacement: values['studio-theme-replacement'],
    designIndexReplacement: values['design-index-replacement'],
    consoleLayoutReplacement: values['console-layout-replacement'],
    modelDesignSourceReport: values['model-design-source-report'],
  });
  console.log(`Prepared ${receipt.plugins.length} source-backed candidate packages: ${output}`);
  console.log(`Unresolved mappings: ${receipt.unresolvedMappings.length}; production acceptance: false`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
