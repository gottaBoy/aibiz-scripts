import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  main, runRuntimeModelSourceBuild, verifyRuntimeModelSourceBuild,
} from '../harness-runtime-model-source-build.mjs';
import { sourceBuildEvidence } from './runtime-model-test-support.mjs';
import {
  fakeBuild, fixture, hash, mutate, realPackage, updateReport, write,
} from './helpers/runtime-model-source-build-fixture.mjs';

test('isolated double build uses pinned binaries, protects live output and retains unaccepted evidence', t => {
  const f = fixture(t);
  write(join(f.packageRoot, 'dist/live.txt'), 'do not remove\n');
  const calls = fakeBuild(t, ({ options, build }) => {
    if (!build) {
      assert.equal(fs.existsSync(join(options.cwd, 'dist')), false, 'Each build must start clean');
      assert.equal(fs.existsSync(join(options.cwd, 'loader')), false);
    }
  });
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(result.report.status, 'source-build-complete-not-accepted');
  assert.equal(result.report.sourceBuildVerified, true);
  assert.equal(result.report.reproducibleBuildVerified, true);
  for (const field of ['nativeAccepted', 'acceptedForProduction', 'originalSourceRecovered',
    'originalLicenseAuthenticated', 'networkRequestsExecutedByHarness',
    'arbitraryNpmScriptsExecuted', 'networkAccessPrevented']) {
    assert.equal(result.report[field], false, field);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.executable === process.execPath && call.options.shell === false));
  assert.ok(calls.every(call => call.options.cwd === join(f.output, 'package')));
  assert.ok(calls.every(call => call.options.env.COREPACK_ENABLE_NETWORK === '0'));
  assert.ok(calls.every(call => call.options.env.npm_config_offline === 'true'));
  assert.equal(fs.readFileSync(join(f.packageRoot, 'dist/live.txt'), 'utf8'), 'do not remove\n');
  assert.deepEqual(result.report.builds[0].outputs, result.report.builds[1].outputs);
  const paths = result.report.outputs.entries.map(item => item.path);
  assert.ok(paths.includes('loader/index.js'));
  assert.ok(paths.includes('dist/esm/loader.js'));
  assert.equal(new Set(paths).size, paths.length, 'Output roots must not collide');
  assert.equal(verifyRuntimeModelSourceBuild({
    workspace: f.workspace, sourceReport: result.reportPath,
  }).report.sourceBuildVerified, true);
});

test('fixed revision has a separate source root, exact delta ledger and reactive-selection loader metadata', t => {
  const f = fixture(t, { revision: 'fixed' });
  fakeBuild(t);
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(result.report.candidateVersion, '0.2.2-local.2');
  assert.equal(result.report.candidateRevision, 'fixed');
  assert.match(result.report.packageRoot, /runtime-model-next$/);
  const list = result.report.builds[0].loader.components.find(item => item.tag === 'ibiz-model-runtime-list');
  assert.deepEqual(list.members.activeData, [32]);
  assert.equal(verifyRuntimeModelSourceBuild({
    workspace: f.workspace, sourceReport: result.reportPath,
  }).report.nativeAccepted, false);
});

test('unknown revision cannot choose an arbitrary source directory or launch tools', t => {
  const f = fixture(t);
  const calls = fakeBuild(t);
  assert.throws(() => runRuntimeModelSourceBuild({ ...f.options, revision: '../arbitrary' }),
    /Unknown runtime-model revision/);
  assert.equal(calls.length, 0);
});

for (const name of ['missing delta ledger', 'changed baseline version', 'fixed source labeled as baseline']) {
  test(`fixed revision rejects ${name}`, t => {
    const f = fixture(t, { revision: 'fixed' });
    mutate(join(f.packageRoot, 'package.json'), manifest => {
      if (name === 'missing delta ledger') manifest.aibiz.intentionalDifferences.pop();
      if (name === 'changed baseline version') manifest.aibiz.baselineVersion = '0.2.2';
      if (name === 'fixed source labeled as baseline') manifest.version = '0.2.2-local.1';
    });
    const calls = fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
  });
}

for (const field of ['candidateVersion', 'candidateRevision', 'package', 'packageRoot']) {
  test(`fixed revision verification rejects report ${field} relabeling`, t => {
    const f = fixture(t, { revision: 'fixed' });
    fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    updateReport(result, report => {
      report[field] = field === 'candidateVersion' ? '0.2.2-local.1'
        : field === 'candidateRevision' ? 'baseline'
          : field === 'packageRoot' ? report.packageRoot.replace('-next', '') : '@ibiz/fake';
    });
    assert.throws(() => verifyRuntimeModelSourceBuild({
      workspace: f.workspace, sourceReport: result.reportPath,
    }));
  });
}

for (const [name, change] of [
  ['unfixed dependency range', manifest => { manifest.dependencies.ramda = '^0.29.1'; }],
  ['upstream source claim', manifest => { manifest.aibiz.originalSourceRecovered = true; }],
  ['license claim', manifest => { manifest.aibiz.originalLicenseAuthenticated = true; }],
  ['native acceptance claim', manifest => { manifest.aibiz.nativeAccepted = true; }],
  ['production acceptance claim', manifest => { manifest.aibiz.acceptedForProduction = true; }],
  ['unexpected build command', manifest => { manifest.scripts.build += ' && echo modified'; }],
  ['prebuild lifecycle hook', manifest => { manifest.scripts.prebuild = 'echo should-not-run'; }],
]) {
  test(`input rejects ${name} before launching a tool`, t => {
    const f = fixture(t);
    mutate(join(f.packageRoot, 'package.json'), change);
    const calls = fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.equal(result.report.sourceBuildVerified, false);
    assert.equal(result.report.errors.length, 1);
  });
}

for (const name of ['lockfile', 'installed version', 'missing stylesheet', 'source symlink']) {
  test(`input rejects ${name} drift and retains failed report`, t => {
    const f = fixture(t);
    if (name === 'lockfile') mutate(join(f.packageRoot, 'package-lock.json'), lock => {
      lock.packages[''].dependencies.ramda = '0.30.0';
    });
    if (name === 'installed version') mutate(join(f.packageRoot, 'node_modules/@stencil/store/package.json'),
      manifest => { manifest.version = '0.0.0'; });
    const style = join(f.packageRoot, 'src/components/loading-mask/loading-mask.css');
    if (name === 'missing stylesheet') fs.rmSync(style);
    if (name === 'source symlink') {
      fs.rmSync(style);
      fs.symlinkSync(join(realPackage, 'src/components/loading-mask/loading-mask.css'), style);
    }
    const calls = fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 0);
    assert.ok(fs.existsSync(result.reportPath));
    assert.ok(fs.existsSync(join(f.output, 'report.sha256')));
  });
}

for (const [name, error] of [
  ['nonzero exit', { status: 2 }],
  ['timeout', { status: null, signal: 'SIGTERM', error: new Error('timeout') }],
  ['launch failure', { status: null, error: new Error('tool unavailable') }],
  ['signal with zero status', { status: 0, signal: 'SIGTERM' }],
]) {
  test(`${name} cannot be promoted by existing build outputs`, t => {
    const f = fixture(t);
    const calls = fakeBuild(t, ({ result }) => Object.assign(result, error));
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 1);
    assert.equal(result.report.sourceBuildVerified, false);
    assert.equal(result.report.reproducibleBuildVerified, false);
  });
}

for (const name of ['loader', 'method', 'attribute', 'type', 'style', 'entry',
  'polyfill export', 'loader reexport', 'loader declaration', 'loader package entry']) {
  test(`output validation rejects missing or changed ${name}`, t => {
    const f = fixture(t);
    fakeBuild(t, ({ build, options }) => {
      if (!build) return;
      const root = options.cwd;
      if (name === 'loader') fs.rmSync(join(root, 'dist/esm/loader.js'));
      if (name === 'method' || name === 'attribute') {
        const path = join(root, 'dist/esm/loader.js');
        const code = fs.readFileSync(path, 'utf8');
        fs.writeFileSync(path, name === 'method'
          ? code.replace('"show":[64]', '"show":[8]')
          : code.replace('"parent-key"', '"wrong-key"'));
      }
      if (name === 'type') fs.rmSync(join(root, 'dist/types/components/loading-mask/loading-mask.d.ts'));
      if (name === 'style') fs.rmSync(join(root, 'dist/collection/components/loading-panel/loading-panel.css'));
      if (name === 'entry') fs.rmSync(join(root, 'dist/esm/ibiz-model-runtime_4.entry.js'));
      if (name === 'polyfill export') {
        write(join(root, 'dist/esm/polyfills/index.js'), 'function applyPolyfills() {}\n');
      }
      if (name === 'loader reexport') {
        write(join(root, 'loader/index.js'), "export * from '../dist/esm/wrong.js';\n");
      }
      if (name === 'loader declaration') fs.rmSync(join(root, 'loader/index.d.ts'));
      if (name === 'loader package entry') {
        mutate(join(root, 'loader/package.json'), manifest => { manifest.module = './wrong.js'; });
      }
    });
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.errors.length, 1);
    assert.equal(result.report.sourceBuildVerified, false);
  });
}

test('second clean build mismatch fails rather than normalizing generated bytes', t => {
  const f = fixture(t);
  fakeBuild(t, ({ build, calls, options }) => {
    if (build && calls.length === 4) write(join(options.cwd, 'dist/esm/extra.mjs'), 'different\n');
  });
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 1);
  assert.match(result.report.errors[0], /Second source build output differs/);
});

for (const path of ['ramda/src/index.js', '@stencil/core/compiler/stencil.js',
  '@stencil/store/dist/index.js']) {
  test(`verification detects implementation drift without manifest changes: ${path}`, t => {
    const f = fixture(t);
    fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    write(join(f.packageRoot, 'node_modules', path), '// changed implementation\n');
    assert.throws(() => verifyRuntimeModelSourceBuild({
      workspace: f.workspace, sourceReport: result.reportPath,
    }), /dependency drift/);
  });
}

for (const name of ['source', 'isolated source', 'dependency', 'dependency directory']) {
  test(`input ${name} drift during a command fails before another tool executes`, t => {
    const f = fixture(t);
    const calls = fakeBuild(t, ({ options }) => {
      if (name === 'dependency directory') {
        fs.rmSync(join(options.cwd, 'node_modules'));
        fs.mkdirSync(join(f.output, 'alternate-node_modules'));
        fs.symlinkSync(join(f.output, 'alternate-node_modules'), join(options.cwd, 'node_modules'), 'dir');
        return;
      }
      const path = name === 'source' ? join(f.packageRoot, 'src/index.ts')
        : name === 'isolated source' ? join(options.cwd, 'src/index.ts')
          : join(f.packageRoot, 'node_modules/ramda/src/index.js');
      write(path, '// changed during the command\n');
    });
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, 1);
    assert.equal(result.report.sourceBuildVerified, false);
    assert.equal(result.report.reproducibleBuildVerified, false);
    assert.match(result.report.errors[0], /drift/);
  });
}

test('pinned tools cannot inherit NODE_OPTIONS or NODE_PATH injection', t => {
  const f = fixture(t);
  const previous = { NODE_OPTIONS: process.env.NODE_OPTIONS, NODE_PATH: process.env.NODE_PATH };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_OPTIONS = '--require fixture-preload.cjs';
  process.env.NODE_PATH = '/fixture/untracked-modules';
  const calls = fakeBuild(t);
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  for (const call of calls) {
    assert.equal(call.options.env.NODE_OPTIONS, '');
    assert.equal(call.options.env.NODE_PATH, '');
  }
});

for (const name of ['report hash', 'log', 'source', 'isolated source', 'output', 'tool',
  'command args', 'missing command', 'loader metadata', 'build result', 'double-build inventory',
  'dependency directory']) {
  test(`independent verification detects ${name} tampering`, t => {
    const f = fixture(t);
    fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    if (name === 'report hash') write(result.reportPath, '{}\n');
    if (name === 'log') write(join(f.output, 'logs/1-build.log'), 'changed\n');
    if (name === 'source') write(join(f.packageRoot, 'src/index.ts'), 'export {};\n');
    if (name === 'isolated source') write(join(f.output, 'package/src/index.ts'), 'export {};\n');
    if (name === 'output') write(join(f.output, 'package/loader/index.js'), 'export {};\n');
    if (name === 'tool') write(join(f.packageRoot, 'node_modules/@stencil/core/bin/stencil'), '// changed\n');
    if (name === 'command args') updateReport(result, report => {
      report.commands[0].args.push('--wrong');
      report.builds[0].commands[0].args.push('--wrong');
    });
    if (name === 'missing command') updateReport(result, report => { report.commands.pop(); });
    if (name === 'loader metadata') updateReport(result, report => {
      report.builds[1].loader.requiredElements = [];
    });
    if (name === 'build result') updateReport(result, report => {
      report.commands[0].exitCode = 1;
      report.builds[0].commands[0].exitCode = 1;
    });
    if (name === 'double-build inventory') updateReport(result, report => {
      for (const build of report.builds) build.outputs = {
        files: 0, bytes: 0, fingerprint: hash('[]'), entries: [],
      };
    });
    if (name === 'dependency directory') {
      fs.rmSync(join(result.report.buildRoot, 'node_modules'));
      fs.mkdirSync(join(f.output, 'alternate-node_modules'));
      fs.symlinkSync(join(f.output, 'alternate-node_modules'),
        join(result.report.buildRoot, 'node_modules'), 'dir');
    }
    assert.throws(() => verifyRuntimeModelSourceBuild({
      workspace: f.workspace, sourceReport: result.reportPath,
    }));
  });
}

test('browser provenance verifies the complete source-build contract with exact native loader paths', t => {
  const f = fixture(t);
  fakeBuild(t);
  const result = runRuntimeModelSourceBuild(f.options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  const evidence = sourceBuildEvidence(result.report.buildRoot, {
    workspace: f.workspace, reportPath: result.reportPath,
  });
  assert.equal(evidence.loaderRelative, 'dist/esm/loader.js');
  assert.equal(evidence.originalLoaderRelative, 'dist/esm/loader.mjs');
  assert.equal(evidence.nativeAcceptance, false);
  assert.equal(evidence.reportSha256, hash(fs.readFileSync(result.reportPath)));
});

for (const name of ['failed status', 'missing command', 'command exit', 'log', 'loader metadata',
  'double-build inventory', 'undeclared output', 'missing declaration', 'mjs-only loader']) {
  test(`browser provenance cannot bypass ${name} evidence`, t => {
    const f = fixture(t);
    fakeBuild(t);
    const result = runRuntimeModelSourceBuild(f.options);
    assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
    if (name === 'failed status') updateReport(result, report => { report.status = 'failed'; });
    if (name === 'missing command') updateReport(result, report => { report.commands = []; });
    if (name === 'command exit') updateReport(result, report => {
      report.commands[0].exitCode = 1;
      report.builds[0].commands[0].exitCode = 1;
    });
    if (name === 'log') write(join(f.output, 'logs/1-build.log'), 'changed\n');
    if (name === 'loader metadata') updateReport(result, report => {
      report.builds[1].loader.requiredElements = [];
    });
    if (name === 'double-build inventory') updateReport(result, report => {
      for (const build of report.builds) build.outputs.entries = [];
    });
    if (name === 'undeclared output') write(join(result.report.buildRoot, 'dist/extra.js'), 'export {};\n');
    if (name === 'missing declaration') fs.rmSync(join(result.report.buildRoot, 'loader/index.d.ts'));
    if (name === 'mjs-only loader') {
      fs.renameSync(join(result.report.buildRoot, 'dist/esm/loader.js'),
        join(result.report.buildRoot, 'dist/esm/loader.mjs'));
    }
    assert.throws(() => sourceBuildEvidence(result.report.buildRoot, {
      workspace: f.workspace, reportPath: result.reportPath,
    }));
  });
}

test('CLI help and argument checks do not launch builds', t => {
  const calls = fakeBuild(t);
  const messages = [];
  t.mock.method(console, 'log', message => messages.push(message));
  main(['--help']);
  assert.ok(messages.some(message => /exit 2/.test(message)));
  assert.throws(() => main(['--unknown']), /Unknown option/);
  assert.throws(() => runRuntimeModelSourceBuild({ timeout: NaN }), /positive integer/);
  assert.throws(() => runRuntimeModelSourceBuild({ timeout: -1 }), /positive integer/);
  assert.equal(calls.length, 0);
});

test('output directory cannot escape its owned artifact namespace or overwrite prior evidence', t => {
  const f = fixture(t);
  fakeBuild(t);
  assert.throws(() => runRuntimeModelSourceBuild({
    ...f.options, output: join(f.workspace, 'unsafe'),
  }), /direct runtime-model/);
  runRuntimeModelSourceBuild(f.options);
  assert.throws(() => runRuntimeModelSourceBuild(f.options), /EEXIST/);
});
