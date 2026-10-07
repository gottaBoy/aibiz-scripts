import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as sourceDepsHarness from '../harness-native-ai-code-source-deps.mjs';
import {
  cliSourceFixture, fakeBuild, fixture, fixtureSnapshot, hash, json,
  setConsumerCliVersion, sourceBuild, updateCliBuildReport, write,
} from './helpers/native-ai-code-source-deps-fixture.mjs';

const {
  installedPackage, runAiCodeSourceDepsHarness, sourceFiles,
  verifyFrameworkLinks,
} = sourceDepsHarness;

const harness = fileURLToPath(new URL('../harness-native-ai-code-source-deps.mjs', import.meta.url));

function notAccepted(report) {
  for (const name of [
    'nativeAccepted', 'acceptedForProduction', 'fullLocalization',
    'toolchainSourceVerified', 'originalVersionReproductionVerified',
  ]) assert.equal(report[name], false, name);
  assert.equal(report.declaredRangeCompatibility, 'not-verified');
}

function builtFixture(t) {
  const options = fixture(t);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  return { options, result };
}

function verifyFixtureReport(options, result) {
  assert.equal(typeof sourceDepsHarness.verifyAiCodeSourceDepsHarness, 'function');
  return sourceDepsHarness.verifyAiCodeSourceDepsHarness({
    workspace: options.workspace, sourceReport: result.reportPath,
    ...(options.cliSourcePins ? { cliSourcePins: options.cliSourcePins } : {}),
  });
}

function rejectedFixtureReport(options, result) {
  assert.equal(typeof sourceDepsHarness.verifyAiCodeSourceDepsHarness, 'function');
  const before = fixtureSnapshot(options.workspace);
  assert.throws(() => verifyFixtureReport(options, result));
  assert.deepEqual(fixtureSnapshot(options.workspace), before);
}

test('output must be a fresh direct child, never replaces an existing candidate', t => {
  const options = fixture(t);
  for (const output of [
    options.hub, join(options.output, 'nested'), join(dirname(options.output), '..', 'escape'),
  ]) {
    assert.throws(() => runAiCodeSourceDepsHarness({ ...options, output }), /direct child/);
    assert.ok(!fs.existsSync(output === options.hub ? options.output : output));
  }
  write(join(options.output, 'keep.txt'), 'existing evidence');
  assert.throws(() => runAiCodeSourceDepsHarness(options), /must not be overwritten/);
  assert.equal(fs.readFileSync(join(options.output, 'keep.txt'), 'utf8'), 'existing evidence');
  assert.ok(!fs.existsSync(join(options.output, 'report.json')));
});

test('symlink artifact ancestor is rejected without writing its target', t => {
  const options = fixture(t);
  const target = join(options.workspace, 'outside');
  fs.mkdirSync(target);
  fs.mkdirSync(join(options.workspace, '.artifacts'));
  fs.symlinkSync(target, dirname(options.output), 'dir');
  assert.throws(() => runAiCodeSourceDepsHarness(options), /Symlink directory rejected/);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('fresh staged input excludes old outputs and caches, preserves source manifests', t => {
  const options = fixture(t);
  const before = sourceFiles(options.roots.get('model-core'));
  const manifestBefore = fs.readFileSync(join(options.source, 'package.json'));
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  const source = result.report.sources.find(pkg => pkg.id === 'model-core');
  assert.deepEqual(source.entries.map(entry => entry.path), ['package.json', 'src/index.ts', 'tsconfig.json']);
  assert.deepEqual(sourceFiles(options.roots.get('model-core')), before);
  assert.deepEqual(fs.readFileSync(join(options.source, 'package.json')), manifestBefore);
  assert.deepEqual(fs.readFileSync(join(result.destination, 'source/plugins/ai-code/package.json')), manifestBefore);
  assert.equal(fs.readFileSync(join(options.roots.get('model-core'), 'out/old-output.js'), 'utf8'),
    'old must never be reused');
  assert.ok(!fs.existsSync(join(source.staged, 'out/old-output.js')));
  assert.deepEqual(result.report.sourceDrift, { original: 'unchanged', staged: 'unchanged' });
});

test('all framework links target fresh source; records original nested version splits and tools', t => {
  const options = fixture(t);
  const { report } = runAiCodeSourceDepsHarness(options);
  assert.equal(report.exitCode, 2, report.errors.join('\n'));
  const links = report.moduleLinks.filter(link => link.role === 'staged-source');
  assert.equal(links.length, 10 * 9);
  for (const link of links) assert.ok(link.target.startsWith(`${options.output}/source/`));
  assert.ok(report.originalResolvedToHubRebase.some(edge =>
    edge.originalResolved?.version === '0.0.2-nested' && edge.hubRebase.version === '1.0.0-core'));
  assert.ok(report.reusedPackages.some(pkg =>
    pkg.name === 'third-party' && pkg.version === '2.3.4' && pkg.realpath.startsWith(options.hub)));
  assert.ok(report.publishedOwnToolchain.some(pkg =>
    pkg.name === '@ibiz-template/cli-core' && pkg.version === '0.3.30' && pkg.sourceVerified === false));
  assert.ok(report.tools.every(tool => !tool.entry.includes('/.bin/')));
  notAccepted(report);
});

test('framework mapping rejects a published fallback instead of trusting its matching name', t => {
  const options = fixture(t);
  const { report } = runAiCodeSourceDepsHarness(options);
  assert.equal(report.exitCode, 2, report.errors.join('\n'));
  const staged = report.sources.find(pkg => pkg.id === 'runtime').staged;
  const core = report.sources.find(pkg => pkg.id === 'core');
  const path = join(staged, 'node_modules/@ibiz-template/core');
  fs.unlinkSync(path);
  fs.symlinkSync(join(options.source, 'node_modules/@ibiz-template/core'), path, 'dir');
  assert.throws(() => verifyFrameworkLinks([{ stage: staged }],
    new Map([[core.name, { stage: core.staged }]])), /Published framework fallback/);
});

test('third-party transitive published framework fallback fails before builds and retains report', t => {
  const options = fixture(t);
  json(join(options.hub, 'node_modules/third-party/package.json'), {
    name: 'third-party', version: '2.3.4', dependencies: { '@ibiz-template/core': '0.0.1' },
  });
  json(join(options.hub, 'node_modules/third-party/node_modules/@ibiz-template/core/package.json'),
    { name: '@ibiz-template/core', version: '0.0.1' });
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Published framework fallback through third-party/);
  assert.ok(result.report.steps.every(step => step.status === 'not-executed'));
  assert.ok(fs.existsSync(result.reportPath));
  notAccepted(result.report);
});

test('missing direct runtime dependency fails before any compiler runs', t => {
  const options = fixture(t);
  const name = 'source-deps-fixture-missing-runtime-dependency';
  const path = join(options.roots.get('runtime'), 'package.json');
  const value = JSON.parse(fs.readFileSync(path));
  value.dependencies[name] = '1.0.0';
  json(path, value);
  const before = sourceFiles(options.roots.get('runtime'));
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'failed');
  assert.match(result.report.errors.join('\n'), /Required dependency unavailable/);
  assert.ok(result.report.errors.some(error => error.includes(name)));
  assert.ok(result.report.steps.every(step =>
    step.status === 'not-executed' && step.commands.length === 0));
  assert.equal(result.report.runtimeSourceBuildsVerified, false);
  assert.equal(result.report.aiCodeSourceBuildVerified, false);
  assert.deepEqual(sourceFiles(options.roots.get('runtime')), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  notAccepted(result.report);
});

test('missing transitive required dependency fails before any compiler runs', t => {
  const options = fixture(t);
  const name = 'source-deps-fixture-missing-transitive-dependency';
  json(join(options.hub, 'node_modules/third-party/package.json'), {
    name: 'third-party', version: '2.3.4', dependencies: { [name]: '1.0.0' },
  });
  const path = join(options.roots.get('runtime'), 'package.json');
  const value = JSON.parse(fs.readFileSync(path));
  value.dependencies['third-party'] = '2.3.4';
  json(path, value);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'failed');
  assert.match(result.report.errors.join('\n'), /Required dependency unavailable/);
  assert.ok(result.report.errors.some(error => error.includes(name)));
  assert.ok(result.report.steps.every(step =>
    step.status === 'not-executed' && step.commands.length === 0));
  assert.equal(result.report.runtimeSourceBuildsVerified, false);
  assert.equal(result.report.aiCodeSourceBuildVerified, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  notAccepted(result.report);
});

test('missing optional runtime dependency is recorded without blocking builds', t => {
  const options = fixture(t);
  const name = 'source-deps-fixture-missing-optional-runtime';
  const path = join(options.roots.get('runtime'), 'package.json');
  const value = JSON.parse(fs.readFileSync(path));
  value.optionalDependencies = { [name]: '1.0.0' };
  json(path, value);
  const before = sourceFiles(options.roots.get('runtime'));
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  assert.deepEqual(result.report.errors, []);
  assert.ok(result.report.unavailablePackages.some(item =>
    item.owner === 'runtime' && item.name === name && item.section === 'optionalDependencies'));
  assert.ok(result.report.steps.every(step => step.status === 'built' &&
    step.commands.length > 0 && step.commands.every(command => command.exitCode === 0)));
  assert.equal(result.report.runtimeSourceBuildsVerified, true);
  assert.equal(result.report.aiCodeSourceBuildVerified, true);
  assert.deepEqual(sourceFiles(options.roots.get('runtime')), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  notAccepted(result.report);
});

test('missing optional transitive dependency is recorded without blocking builds', t => {
  const options = fixture(t);
  const name = 'source-deps-fixture-missing-optional-transitive';
  json(join(options.hub, 'node_modules/third-party/package.json'), {
    name: 'third-party', version: '2.3.4', optionalDependencies: { [name]: '1.0.0' },
  });
  const path = join(options.roots.get('runtime'), 'package.json');
  const value = JSON.parse(fs.readFileSync(path));
  value.dependencies['third-party'] = '2.3.4';
  json(path, value);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  assert.deepEqual(result.report.errors, []);
  assert.ok(result.report.unavailablePackages.some(item =>
    item.owner === 'third-party' && item.name === name && item.section === 'optionalDependencies'));
  assert.ok(result.report.steps.every(step => step.status === 'built' &&
    step.commands.length > 0 && step.commands.every(command => command.exitCode === 0)));
  assert.equal(result.report.runtimeSourceBuildsVerified, true);
  assert.equal(result.report.aiCodeSourceBuildVerified, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  notAccepted(result.report);
});

test('npm dependency sharing a Node builtin name uses the nearest installed package identity', t => {
  const options = fixture(t);
  const name = 'string_decoder';
  const owner = join(options.hub, 'node_modules/third-party');
  const nearest = join(owner, 'node_modules', name);
  json(join(owner, 'package.json'), {
    name: 'third-party', version: '2.3.4', dependencies: { [name]: '1.3.0' },
  });
  json(join(options.hub, 'node_modules', name, 'package.json'), { name, version: '9.9.9' });
  json(join(nearest, 'package.json'), { name, version: '1.3.0' });
  assert.equal(createRequire(join(owner, 'package.json')).resolve.paths(name), null);
  const found = installedPackage(owner, name);
  assert.equal(found.name, name);
  assert.equal(found.version, '1.3.0');
  assert.equal(found.realpath, fs.realpathSync(nearest));
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  assert.ok(result.report.reusedPackages.some(pkg =>
    pkg.name === name && pkg.version === '1.3.0' && pkg.realpath === found.realpath &&
    pkg.role === 'installed-third-party'));
  assert.ok(!result.report.unavailablePackages.some(item =>
    item.owner === 'third-party' && item.name === name));
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  notAccepted(result.report);
});

test('missing npm dependency sharing a Node builtin name still fails before compilation', t => {
  const options = fixture(t);
  const name = 'string_decoder';
  const owner = join(options.hub, 'node_modules/third-party');
  json(join(owner, 'package.json'), {
    name: 'third-party', version: '2.3.4', dependencies: { [name]: '1.3.0' },
  });
  assert.equal(createRequire(join(owner, 'package.json')).resolve.paths(name), null);
  assert.equal(installedPackage(owner, name, { optional: true }), null);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors.join('\n'), /Required dependency unavailable/);
  assert.ok(result.report.errors.some(error => error.includes(name)));
  assert.ok(result.report.unavailablePackages.some(item =>
    item.owner === 'third-party' && item.name === name &&
    item.section === 'dependencies' && item.optional === false));
  assert.ok(result.report.steps.every(step =>
    step.status === 'not-executed' && step.commands.length === 0));
  assert.equal(result.report.runtimeSourceBuildsVerified, false);
  assert.equal(result.report.aiCodeSourceBuildVerified, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  notAccepted(result.report);
});

const missingDependencyCases = [
  {
    id: 'optional-peer', label: 'optional peer/meta', peer: true, optionalPeer: true,
    required: false, recordedSections: ['peerDependencies'],
  },
  {
    id: 'required-peer', label: 'required peer/meta false', peer: true, optionalPeer: false,
    required: true, requiredSection: 'peerDependencies',
  },
  {
    id: 'peer-and-dependency', label: 'optional peer/meta cannot downgrade dependencies',
    peer: true, optionalPeer: true, dependency: true,
    required: true, requiredSection: 'dependencies',
  },
  {
    id: 'optional-override', label: 'optionalDependencies override same-name dependencies',
    dependency: true, optionalDependency: true,
    required: false, recordedSections: ['dependencies', 'optionalDependencies'],
  },
];

for (const transitive of [false, true]) {
  for (const scenario of missingDependencyCases) {
    test(`${transitive ? 'transitive' : 'direct'} missing ${scenario.label} has correct requiredness`, t => {
      const options = fixture(t);
      const owner = transitive ? 'third-party' : 'runtime';
      const root = transitive ? join(options.hub, 'node_modules/third-party') : options.roots.get('runtime');
      const path = join(root, 'package.json');
      const value = JSON.parse(fs.readFileSync(path));
      const name = `source-deps-fixture-missing-${owner}-${scenario.id}`;
      if (scenario.dependency) value.dependencies = { ...value.dependencies, [name]: '1.0.0' };
      if (scenario.peer) {
        value.peerDependencies = { [name]: '1.0.0' };
        value.peerDependenciesMeta = { [name]: { optional: scenario.optionalPeer } };
      }
      if (scenario.optionalDependency) value.optionalDependencies = { [name]: '2.0.0' };
      json(path, value);
      const before = fs.readFileSync(path);
      const result = runAiCodeSourceDepsHarness(options);
      assert.equal(result.exitCode, scenario.required ? 1 : 2, result.report.errors.join('\n'));
      if (scenario.required) {
        assert.match(result.report.errors.join('\n'), /Required dependency unavailable/);
        assert.ok(result.report.errors.some(error => error.includes(name)));
        assert.ok(result.report.unavailablePackages.some(item =>
          item.owner === owner && item.name === name &&
          item.section === scenario.requiredSection && item.optional === false));
        assert.ok(result.report.steps.every(step =>
          step.status === 'not-executed' && step.commands.length === 0));
      } else {
        assert.deepEqual(result.report.errors, []);
        for (const section of scenario.recordedSections) {
          assert.ok(result.report.unavailablePackages.some(item =>
            item.owner === owner && item.name === name && item.section === section &&
            item.optional === true), `${owner}/${name}/${section}`);
        }
        assert.ok(result.report.steps.every(step => step.status === 'built' &&
          step.commands.every(command => command.exitCode === 0) &&
          step.completedOutputs.fingerprint === step.outputs.fingerprint));
      }
      assert.equal(result.report.runtimeSourceBuildsVerified, !scenario.required);
      assert.equal(result.report.aiCodeSourceBuildVerified, !scenario.required);
      assert.deepEqual(fs.readFileSync(path), before);
      assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
      notAccepted(result.report);
    });
  }
}

test('unused publishing CLI is recorded without loading its framework dependencies', t => {
  const options = fixture(t);
  const theme = join(options.roots.get('web-theme'), 'package.json');
  const value = JSON.parse(fs.readFileSync(theme));
  value.devDependencies = { '@ibizlab/cli': '0.2.26' };
  json(theme, value);
  json(join(options.hub, 'node_modules/@ibizlab/cli/package.json'), {
    name: '@ibizlab/cli', version: '0.2.26',
    dependencies: { '@ibizlab/template': '0.2.26' },
  });
  json(join(options.hub, 'node_modules/@ibizlab/template/package.json'), {
    name: '@ibizlab/template', version: '0.2.26',
  });
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  assert.ok(result.report.omittedToolchainPackages.some(item =>
    item.owner === 'web-theme' && item.name === '@ibizlab/cli' &&
    item.declarations[0].section === 'devDependencies' &&
    item.reason === 'not-in-build-command-plan'));
  assert.ok(!result.report.reusedPackages.some(item => item.name === '@ibizlab/cli'));
  assert.ok(!result.report.moduleLinks.some(item => item.name === '@ibizlab/cli'));
  notAccepted(result.report);
});

test('unplanned framework tools in runtime dependencies cannot be silently omitted', t => {
  const options = fixture(t);
  const path = join(options.roots.get('runtime'), 'package.json');
  const value = JSON.parse(fs.readFileSync(path));
  value.dependencies['@ibizlab/cli'] = '0.2.26';
  json(path, value);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Unplanned framework tool in runtime dependencies/);
  assert.ok(result.report.steps.every(step => step.status === 'not-executed'));
});

test('explicit npm third-party aliases retain requested and resolved identities', t => {
  const options = fixture(t);
  json(join(options.hub, 'node_modules/third-party/package.json'), {
    name: 'third-party', version: '2.3.4', dependencies: { 'small-cjs': 'npm:small@^1.0.0' },
  });
  json(join(options.hub, 'node_modules/third-party/node_modules/small-cjs/package.json'),
    { name: 'small', version: '1.2.3' });
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  assert.ok(result.report.reusedPackages.some(pkg => pkg.name === 'small-cjs' &&
    pkg.linkName === 'small-cjs' && pkg.actualName === 'small' &&
    pkg.version === '1.2.3' && pkg.aliasDeclaration === 'npm:small@^1.0.0' &&
    pkg.aliasTargetRange === '^1.0.0' && pkg.aliasParser.name === 'npm-package-arg'));
});

test('npm alias declared target must match the installed manifest identity', t => {
  const options = fixture(t);
  json(join(options.hub, 'node_modules/third-party/package.json'), {
    name: 'third-party', version: '2.3.4', dependencies: { 'small-cjs': 'npm:wrong-target@^1.0.0' },
  });
  json(join(options.hub, 'node_modules/third-party/node_modules/small-cjs/package.json'),
    { name: 'small', version: '1.2.3' });
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /identity differs without a third-party npm alias/);
  assert.ok(result.report.steps.every(step => step.status === 'not-executed'));
});

test('a third-party alias cannot hide a framework binary', t => {
  const options = fixture(t);
  json(join(options.hub, 'node_modules/third-party/package.json'), {
    name: 'third-party', version: '2.3.4',
    dependencies: { hidden: 'npm:@ibiz-template/core@0.0.1' },
  });
  json(join(options.hub, 'node_modules/third-party/node_modules/hidden/package.json'),
    { name: '@ibiz-template/core', version: '0.0.1' });
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /identity differs without a third-party npm alias/);
  assert.ok(result.report.steps.every(step => step.status === 'not-executed'));
});

test('first compiler failure preserves log, exit and partial output hashes; later builds are not-executed', t => {
  const options = fixture(t);
  write(join(options.toolDirs.typescript, 'tsc.cjs'),
    `${fakeBuild}\nconsole.error('real fixture compiler failure'); process.exit(17);\n`);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  const [first, ...later] = result.report.steps;
  assert.equal(first.status, 'failed');
  assert.equal(first.commands[0].exitCode, 17);
  assert.ok(later.every(step => step.status === 'not-executed' && step.commands.length === 0));
  const log = fs.readFileSync(join(result.destination, first.commands[0].log));
  assert.match(log.toString(), /real fixture compiler failure/);
  assert.equal(first.commands[0].logSha256, hash(log));
  const output = first.outputs.entries.find(entry => entry.path === 'out/index.js');
  assert.equal(output.sha256, hash(fs.readFileSync(join(result.destination, 'source/models/model-core/out/index.js'))));
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
  assert.equal(result.report.runtimeSourceBuildsVerified, false);
  notAccepted(result.report);
});

test('zero exit without required fresh outputs is failure, not source build evidence', t => {
  const options = fixture(t);
  write(join(options.toolDirs.typescript, 'tsc.cjs'), 'console.log("no output");\n');
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Missing fresh build output/);
  assert.equal(result.report.steps[0].commands[0].exitCode, 0);
  assert.equal(result.report.steps[0].status, 'failed');
  assert.equal(result.report.steps[1].status, 'not-executed');
});

for (const mode of ['modified', 'deleted']) {
  test(`completed model-core build output drift is rejected when later rt-model-api output is ${mode}`, t => {
    const options = fixture(t);
    const changed = 'changed by later rt-model-api build\n';
    const mutation = mode === 'modified'
      ? `fs.writeFileSync('../model-core/out/index.js', ${JSON.stringify(changed)});`
      : "fs.unlinkSync('../model-core/out/index.js');";
    write(join(options.roots.get('rt-model-api'), 'scripts/build.mjs'),
      `${sourceBuild}\n${mutation}\nconsole.log('model-core output ${mode}');\n`);
    const original = options.roots.get('model-core');
    const sourceBefore = sourceFiles(original);
    const oldOutput = fs.readFileSync(join(original, 'out/old-output.js'));
    const result = runAiCodeSourceDepsHarness(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, 'failed');
    assert.match(result.report.errors.join('\n'), /Build output drift/);
    assert.equal(result.report.runtimeSourceBuildsVerified, false);
    assert.equal(result.report.aiCodeSourceBuildVerified, false);
    const model = result.report.steps.find(step => step.id === 'model-core');
    const initial = model.commands[0].outputs.entries.find(entry => entry.path === 'out/index.js');
    assert.equal(model.commands[0].exitCode, 0);
    assert.equal(initial.sha256, hash('fresh @ibiz/model-core'));
    const later = result.report.steps.find(step => step.id === 'rt-model-api');
    assert.equal(later.commands[1].exitCode, 0);
    assert.match(fs.readFileSync(join(result.destination, later.commands[1].log), 'utf8'),
      new RegExp(`model-core output ${mode}`));
    const staged = result.report.sources.find(pkg => pkg.id === 'model-core').staged;
    const actual = model.outputs.entries.find(entry => entry.path === 'out/index.js');
    if (mode === 'modified') {
      assert.equal(fs.readFileSync(join(staged, 'out/index.js'), 'utf8'), changed);
      assert.equal(actual.sha256, hash(changed));
      assert.equal(actual.bytes, Buffer.byteLength(changed));
      assert.notEqual(actual.sha256, initial.sha256);
    } else {
      assert.ok(!fs.existsSync(join(staged, 'out/index.js')));
      assert.equal(actual, undefined);
    }
    assert.ok(model.outputs.entries.some(entry => entry.path === 'out/index.d.ts'));
    assert.notDeepEqual(model.outputs.entries, model.commands[0].outputs.entries);
    assert.deepEqual(sourceFiles(original), sourceBefore);
    assert.deepEqual(fs.readFileSync(join(original, 'out/old-output.js')), oldOutput);
    assert.deepEqual(result.report.sourceDrift, { original: 'unchanged', staged: 'unchanged' });
    assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
    notAccepted(result.report);
  });
}

for (const staged of [true, false]) {
  test(`${staged ? 'staged' : 'original'} source drift is retained as failure`, t => {
    const options = fixture(t);
    const mutation = staged ? "'src/index.ts'" :
      JSON.stringify(join(options.roots.get('model-core'), 'src/index.ts'));
    write(join(options.toolDirs.typescript, 'tsc.cjs'),
      `${fakeBuild}\nfs.appendFileSync(${mutation}, '// changed');\n`);
    const result = runAiCodeSourceDepsHarness(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.sourceDrift[staged ? 'staged' : 'original'], 'detected');
    assert.match(result.report.errors.join('\n'), /source input drift/);
    assert.equal(result.report.steps[1].status, 'not-executed');
    notAccepted(result.report);
  });
}

test('source symlinks are rejected and preflight failure leaves an honest report', t => {
  const options = fixture(t);
  fs.symlinkSync(join(options.hub, 'package.json'), join(options.roots.get('model-core'), 'src/linked.json'));
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Symlink source input rejected/);
  assert.equal(result.report.sourceDrift.original, 'incomplete');
  assert.ok(result.report.steps.every(step => step.status === 'not-executed'));
  assert.ok(fs.existsSync(result.reportPath));
});

test('package-manager PATH guards prevent installation from a copied build script', t => {
  const options = fixture(t);
  write(join(options.roots.get('rt-model-api'), 'scripts/build.mjs'), `
import { spawnSync } from 'node:child_process';
const result = spawnSync('pnpm', ['install'], {stdio: 'inherit'});
process.exit(result.status ?? 1);
`);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  const step = result.report.steps.find(step => step.id === 'rt-model-api');
  assert.equal(step.commands[1].exitCode, 126);
  assert.match(fs.readFileSync(join(result.destination, step.commands[1].log), 'utf8'),
    /Package-manager invocation forbidden/);
  assert.ok(!fs.existsSync(join(options.output, 'source/pnpm-lock.yaml')));
});

test('successful fixture CLI exits 2 with all real child commands recorded and no acceptance', t => {
  const options = fixture(t);
  const result = spawnSync(process.execPath, [harness, '--workspace', options.workspace,
    '--output', options.output], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  const report = JSON.parse(fs.readFileSync(summary.report));
  assert.equal(summary.nativeAccepted, false);
  assert.equal(report.steps.length, 8);
  assert.deepEqual(report.steps.map(step => step.id), [
    'model-core', 'rt-model-api', 'core', 'runtime', 'model-helper', 'vue3-util', 'web-theme', 'ai-code',
  ]);
  assert.ok(report.steps.every(step => step.status === 'built' &&
    step.commands.every(command => command.exitCode === 0 && command.executable === process.execPath)));
  const theme = report.sources.find(pkg => pkg.id === 'theme');
  assert.equal(theme.status, 'scss-input-recorded');
  assert.equal(theme.compile, 'not-applicable');
  assert.equal(report.runtimeSourceBuildsVerified, true);
  assert.equal(report.aiCodeSourceBuildVerified, true);
  notAccepted(report);
});

test('source-deps verifier binds a successful receipt without writing any fixture files', t => {
  const { options, result } = builtFixture(t);
  const before = fixtureSnapshot(options.workspace);
  const verified = verifyFixtureReport(options, result);
  assert.equal(verified.reportPath, result.reportPath);
  assert.equal(verified.reportSha256, hash(fs.readFileSync(result.reportPath)));
  assert.equal(verified.dependencySourceBuildsVerified, true);
  assert.deepEqual(verified.report, result.report);
  notAccepted(verified.report);
  assert.deepEqual(fixtureSnapshot(options.workspace), before);
});

for (const mode of ['modified', 'deleted']) {
  test(`source-deps verifier rejects ${mode} completed dependency output without repairing it`, t => {
    const { options, result } = builtFixture(t);
    verifyFixtureReport(options, result);
    const staged = result.report.sources.find(pkg => pkg.id === 'model-core').staged;
    const path = join(staged, 'out/index.js');
    if (mode === 'modified') write(path, 'changed after source build\n');
    else fs.unlinkSync(path);
    rejectedFixtureReport(options, result);
  });
}

for (const staged of [false, true]) {
  for (const input of ['src/index.ts', 'package.json']) {
    test(`source-deps verifier rejects ${staged ? 'staged' : 'original'} ${input} drift read-only`, t => {
      const { options, result } = builtFixture(t);
      verifyFixtureReport(options, result);
      const source = result.report.sources.find(pkg => pkg.id === 'model-core');
      const path = join(staged ? source.staged : source.original, input);
      if (input === 'package.json') {
        const value = JSON.parse(fs.readFileSync(path));
        json(path, { ...value, version: `${value.version}-drift` });
      } else fs.appendFileSync(path, '// changed after source build\n');
      rejectedFixtureReport(options, result);
    });
  }
}

test('source-deps verifier rejects a framework link replaced by a published fallback', t => {
  const { options, result } = builtFixture(t);
  verifyFixtureReport(options, result);
  const staged = result.report.sources.find(pkg => pkg.id === 'runtime').staged;
  const path = join(staged, 'node_modules/@ibiz-template/core');
  fs.unlinkSync(path);
  fs.symlinkSync(join(options.source, 'node_modules/@ibiz-template/core'), path, 'dir');
  rejectedFixtureReport(options, result);
});

test('source-deps verifier rejects a retained failed build receipt read-only', t => {
  const options = fixture(t);
  write(join(options.toolDirs.typescript, 'tsc.cjs'), `${fakeBuild}\nprocess.exit(17);\n`);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'failed');
  rejectedFixtureReport(options, result);
});

test('source-deps verifier rejects altered command log bytes without changing the receipt', t => {
  const { options, result } = builtFixture(t);
  verifyFixtureReport(options, result);
  const command = result.report.steps[0].commands[0];
  fs.appendFileSync(join(result.destination, command.log), 'changed after source build\n');
  rejectedFixtureReport(options, result);
});

test('source-deps verifier rejects changed installed tool entry bytes', t => {
  const { options, result } = builtFixture(t);
  verifyFixtureReport(options, result);
  write(join(options.toolDirs.typescript, 'tsc.cjs'), 'console.log("changed tool");\n');
  rejectedFixtureReport(options, result);
});

test('source-deps verifier rejects a command executable substituted in the receipt', t => {
  const { options, result } = builtFixture(t);
  verifyFixtureReport(options, result);
  const receipt = JSON.parse(fs.readFileSync(result.reportPath));
  receipt.steps[0].commands[0].executable = '/bin/true';
  json(result.reportPath, receipt);
  rejectedFixtureReport(options, result);
});

test('source-deps verifier rejects a receipt outside the fixed direct-child report path', t => {
  const { options, result } = builtFixture(t);
  verifyFixtureReport(options, result);
  const reportPath = join(options.workspace, 'copied-report.json');
  write(reportPath, fs.readFileSync(result.reportPath));
  rejectedFixtureReport(options, { reportPath });
});

test('source-deps verifier rejects a symlink report even when its target has unchanged bytes', t => {
  const { options, result } = builtFixture(t);
  verifyFixtureReport(options, result);
  const target = join(options.workspace, 'copied-report.json');
  write(target, fs.readFileSync(result.reportPath));
  fs.unlinkSync(result.reportPath);
  fs.symlinkSync(target, result.reportPath);
  rejectedFixtureReport(options, result);
});

async function builtCliFixture(t) {
  const options = await cliSourceFixture(t);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  return { options, result };
}

function withoutCompilers(t, action) {
  let calls = 0;
  const mock = t.mock.method(childProcess, 'spawnSync', () => {
    calls++;
    throw new Error('No compiler allowed in this verification/preflight test');
  });
  syncBuiltinESMExports();
  try {
    const result = action();
    assert.equal(calls, 0, 'Invalid reports/verifiers must never execute compilers');
    return result;
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
}

test('three source CLI reports retain each installed consumer version and staged same-version core', async t => {
  const options = await cliSourceFixture(t);
  const expected = { 'vue3-util': '0.3.0', 'web-theme': '0.3.23', 'ai-code': '0.3.30' };
  for (const [id, version] of Object.entries(expected)) setConsumerCliVersion(options, id, version);
  const protectedRoots = [options.hub, options.source, ...options.cliBuilds.map(build => build.destination)];
  const before = protectedRoots.map(fixtureSnapshot);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 2, result.report.errors.join('\n'));
  assert.deepEqual(result.report.publishedOwnToolchain, []);
  assert.deepEqual(result.report.toolchainFrameworkBinaries, []);
  assert.equal(result.report.sourceBuiltOwnToolchain.length, 3);
  assert.deepEqual(result.report.cliSourceReports.map(item => item.version),
    ['0.3.0', '0.3.23', '0.3.30']);
  for (const evidence of result.report.cliSourceReports) {
    const build = options.cliBuilds.find(item => item.report.version === evidence.version);
    assert.equal(evidence.reportSha256, hash(fs.readFileSync(build.reportPath)));
    assert.equal(evidence.cliSourceBuildVerified, false, 'Synthetic source pins are not production evidence');
  }
  for (const tool of result.report.sourceBuiltOwnToolchain) {
    const build = options.cliBuilds.find(item => item.report.version === expected[tool.owner]);
    assert.equal(tool.version, expected[tool.owner]);
    assert.equal(tool.originalConsumer.cli.version, tool.version);
    assert.equal(tool.originalConsumer.core.version, tool.version);
    assert.equal(tool.entry, join(build.report.stage, 'packages/cli/dist/bin.js'));
    assert.equal(tool.sourceReportSha256, hash(fs.readFileSync(build.reportPath)));
    assert.equal(tool.sourceBuiltCore.realpath, join(build.report.stage, 'packages/core'));
    assert.equal(tool.sourceBuiltCore.version, tool.version);
    const link = result.report.moduleLinks.find(item =>
      item.owner === tool.owner && item.name === '@ibiz-template/cli');
    assert.equal(link.target, tool.realpath);
    assert.equal(link.role, 'source-built-own-toolchain');
    assert.ok(result.report.steps.find(item => item.id === tool.owner).commands.some(command =>
      command.entry === tool.entry && command.exitCode === 0));
  }
  notAccepted(result.report);
  const snapshot = fixtureSnapshot(options.workspace);
  const verified = withoutCompilers(t, () => verifyFixtureReport(options, result));
  assert.equal(verified.toolchainSourceVerified, false);
  assert.deepEqual(fixtureSnapshot(options.workspace), snapshot);
  assert.deepEqual(protectedRoots.map(fixtureSnapshot), before);
  assert.throws(() => sourceDepsHarness.verifyAiCodeSourceDepsHarness({
    workspace: options.workspace, sourceReport: result.reportPath,
  }), /Pinned commit mismatch/);
});

test('legacy published probe remains readable without new source-built fields', t => {
  const { options, result } = builtFixture(t);
  const report = JSON.parse(fs.readFileSync(result.reportPath));
  delete report.sourceBuiltOwnToolchain;
  json(result.reportPath, report);
  const verified = withoutCompilers(t, () => verifyFixtureReport(options, result));
  assert.equal(verified.toolchainSourceVerified, false);
  assert.ok(verified.report.publishedOwnToolchain.length > 0);
  notAccepted(verified.report);
});

for (const [name, configure, pattern] of [
  ['empty reports', options => { options.cliSourceReports = []; }, /three exact releases/],
  ['missing version', options => { options.cliSourceReports.pop(); }, /three exact releases/],
  ['duplicate path', options => {
    options.cliSourceReports[1] = options.cliSourceReports[0];
  }, /Duplicate CLI source report path/],
  ['unsupported consumer version', options => setConsumerCliVersion(options, 'vue3-util', '0.3.31'),
    /Unsupported exact consumer CLI version/],
  ['consumer CLI/core version split', options =>
    setConsumerCliVersion(options, 'web-theme', '0.3.23', '0.3.30'), /consumer CLI\/core version mismatch/],
  ['report hash drift', options => fs.appendFileSync(options.cliBuilds[0].reportPath, '\n'),
    /Build report hash mismatch/],
  ['build log drift', options => {
    const build = options.cliBuilds[0];
    fs.appendFileSync(join(build.destination, build.report.commands[0].log), 'retained drift\n');
  }, /Build log (?:size|hash) drift/],
  ['built CLI output drift', options =>
    fs.appendFileSync(join(options.cliBuilds[0].report.stage, 'packages/cli/dist/bin.js'), '// drift\n'),
    /Tool entry drift|Build output drift/],
  ['original source drift', options =>
    fs.appendFileSync(join(options.cliBuilds[0].report.source.original, 'packages/cli/src/bin.ts'), '// drift\n'),
    /Original blob (?:size|hash) mismatch/],
  ['staged input drift', options =>
    fs.appendFileSync(join(options.cliBuilds[0].report.stage, 'packages/core/src/index.ts'), '// drift\n'),
    /Staged source input drift/],
  ['forged authentic source flag', options => updateCliBuildReport(options.cliBuilds[0], report => {
    report.cliSourceBuildVerified = true;
    report.toolchainSourceBuilt = true;
  }), /Pinned build claim mismatch/],
  ['default verifier rejects synthetic pins', options => { delete options.cliSourcePins; },
    /Pinned commit mismatch/],
]) {
  test(`source-built CLI preflight rejects ${name} before every compiler`, async t => {
    const options = await cliSourceFixture(t);
    configure(options);
    const result = withoutCompilers(t, () => runAiCodeSourceDepsHarness(options));
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors.join('\n'), pattern);
    assert.ok(result.report.steps.every(step =>
      step.status === 'not-executed' && step.commands.length === 0));
    assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
    notAccepted(result.report);
  });
}

for (const target of ['published-core', 'different-version-core']) {
  test(`source-built CLI preflight rejects ${target} link downgrade before compilers`, async t => {
    const options = await cliSourceFixture(t);
    const path = join(options.cliBuilds[0].report.stage, 'packages/cli/node_modules/@ibiz-template/cli-core');
    fs.unlinkSync(path);
    fs.symlinkSync(target === 'published-core' ?
      join(options.hub, 'node_modules/@ibiz-template/cli-core') :
      join(options.cliBuilds[1].report.stage, 'packages/core'), path, 'dir');
    const result = withoutCompilers(t, () => runAiCodeSourceDepsHarness(options));
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors.join('\n'), /fallback\/link drift|link target drift/i);
    assert.ok(result.report.steps.every(step => step.commands.length === 0));
    notAccepted(result.report);
  });
}

for (const [name, mutate] of [
  ['report hash', ({ options }) => fs.appendFileSync(options.cliBuilds[1].reportPath, '\n')],
  ['report hash binding with internally valid replacement', ({ options }) =>
    updateCliBuildReport(options.cliBuilds[1], report => { report.trustBoundary += '; fixture drift'; })],
  ['log', ({ options }) => {
    const build = options.cliBuilds[2];
    fs.appendFileSync(join(build.destination, build.report.commands[0].log), 'drift\n');
  }],
  ['unused-version output', ({ options }) =>
    fs.appendFileSync(join(options.cliBuilds[0].report.stage, 'packages/core/dist/index.js'), '// drift\n')],
  ['recorded source-built tool', ({ result }) => {
    const report = JSON.parse(fs.readFileSync(result.reportPath));
    report.sourceBuiltOwnToolchain[0].sourceReportSha256 = '0'.repeat(64);
    json(result.reportPath, report);
  }],
  ['forged aggregate source verification', ({ result }) => {
    const report = JSON.parse(fs.readFileSync(result.reportPath));
    report.toolchainSourceVerified = true;
    json(result.reportPath, report);
  }],
]) {
  test(`source-deps readback rejects source CLI ${name} without repair or execution`, async t => {
    const data = await builtCliFixture(t);
    mutate(data);
    withoutCompilers(t, () => rejectedFixtureReport(data.options, data.result));
  });
}

for (const target of ['published-cli', 'different-version-cli', 'published-core']) {
  test(`source-deps readback rejects ${target} downgrade`, async t => {
    const { options, result } = await builtCliFixture(t);
    const ai = result.report.sources.find(item => item.id === 'ai-code');
    const stagedCli = options.cliBuilds.find(item => item.report.version === '0.3.30').report.stage;
    const path = target === 'published-core' ?
      join(stagedCli, 'packages/cli/node_modules/@ibiz-template/cli-core') :
      join(ai.staged, 'node_modules/@ibiz-template/cli');
    fs.unlinkSync(path);
    fs.symlinkSync(target === 'published-core' ?
      join(options.hub, 'node_modules/@ibiz-template/cli-core') :
      target === 'published-cli' ? options.toolDirs['@ibiz-template/cli'] :
        join(options.cliBuilds[0].report.stage, 'packages/cli'), path, 'dir');
    withoutCompilers(t, () => rejectedFixtureReport(options, result));
  });
}

test('source CLI drift during an earlier dependency build prevents later CLI execution', async t => {
  const options = await cliSourceFixture(t);
  const build = options.cliBuilds[0];
  write(join(options.toolDirs.typescript, 'tsc.cjs'), `${fakeBuild}
fs.appendFileSync(${JSON.stringify(join(build.destination, build.report.commands[0].log))}, 'drift\\n');
`);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors.join('\n'), /Build log (?:size|hash) drift/);
  assert.equal(result.report.steps[0].commands.length, 1);
  assert.ok(result.report.steps.slice(1).every(step => step.commands.length === 0));
  notAccepted(result.report);
});

test('consumer CLI link downgrade during an earlier build fails before any CLI command', async t => {
  const options = await cliSourceFixture(t);
  const aiLink = join(options.output, 'source/plugins/ai-code/node_modules/@ibiz-template/cli');
  write(join(options.toolDirs.typescript, 'tsc.cjs'), `${fakeBuild}
fs.unlinkSync(${JSON.stringify(aiLink)});
fs.symlinkSync(${JSON.stringify(options.toolDirs['@ibiz-template/cli'])}, ${JSON.stringify(aiLink)}, 'dir');
`);
  const result = runAiCodeSourceDepsHarness(options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors.join('\n'), /Source-built CLI mapping downgrade/);
  assert.equal(result.report.steps[0].commands.length, 1);
  assert.ok(result.report.steps.slice(1).every(step => step.commands.length === 0));
  notAccepted(result.report);
});

test('CLI consumer rejects replacing recorded source reports at readback', t => {
  const result = spawnSync(process.execPath, [harness, '--verify-report', 'unused/report.json',
    '--cli-source-report', 'unused/cli/report.json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /recorded CLI source reports/);
});
