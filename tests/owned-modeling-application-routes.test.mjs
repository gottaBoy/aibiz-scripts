import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import {
  ownedModelingApplicationRoute, probeOwnedModelingApplicationRoutes, verifyOwnedModelingRouteProbe,
} from '../owned-modeling-application-routes.mjs';

export function routeProbe() {
  return {
    contract: 'owned-modeling-application-route-probe-v1', application: 'ModelDesign',
    disabledFactoryReturnedNull: true, enabledFactoryClass: 'net.ibizsys.central.app.ApplicationRuntime',
    canonicalRoute: {
      id: 'ibizmodeling__modeldesign__psdevslnsys',
      uri: 'lb://ibizmodeling-modelapi', order: 100,
      predicates: ['Path=/ibizmodeling__modeldesign/psdevslnsys/**'],
      filters: ['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi'],
    },
    generatorOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
    factoryOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
  };
}

test('only the exact packaged ModelDesign factory and canonical root route are accepted', () => {
  const probe = routeProbe();
  assert.doesNotThrow(() => verifyOwnedModelingRouteProbe(probe));
  const snapshot = structuredClone(probe);
  const route = ownedModelingApplicationRoute(probe,
    'http://nf-123456789abc-backend-application-r1-provider:32002');
  assert.equal(route.uri, 'http://nf-123456789abc-backend-application-r1-provider:32002');
  assert.deepEqual(route.predicates, [{ name: 'Path', args: {
    _genkey_0: '/api/ibizmodeling__modeldesign/psdevslnsys/**',
  } }]);
  assert.deepEqual(route.filters, [
    { name: 'StripPrefix', args: { parts: '2' } },
    { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
  ]);
  assert.deepEqual(probe, snapshot);
  route.filters[1].args.prefix = '/other';
  assert.deepEqual(probe, snapshot);
});

for (const [name, mutate] of [
  ['missing route', p => { delete p.canonicalRoute; }],
  ['different application', p => { p.application = 'Central'; }],
  ['unreproduced factory', p => { p.disabledFactoryReturnedNull = false; }],
  ['unexpected enabled factory', p => { p.enabledFactoryClass = 'java.lang.Object'; }],
  ['different generator bytes', p => { p.generatorOrigin = 'file:/other.jar'; }],
  ['different factory bytes', p => { p.factoryOrigin = 'file:/other.jar'; }],
  ['unbounded application path', p => { p.canonicalRoute.predicates = ['Path=/**']; }],
  ['changed service', p => { p.canonicalRoute.uri = 'http://shared'; }],
  ['changed strip count', p => { p.canonicalRoute.filters[0] = 'StripPrefix=2'; }],
  ['raw extension substitution', p => { p.canonicalRoute.filters[1] = 'PrefixPath=/extension/api'; }],
  ['header bypass', p => { p.canonicalRoute.filters.push('AddRequestHeader=Superuser,1'); }],
]) {
  test(`route probe rejects ${name}`, () => {
    const probe = routeProbe();
    mutate(probe);
    assert.throws(() => verifyOwnedModelingRouteProbe(probe));
  });
}

test('owned route rejects foreign providers, unsafe origins and missing probe evidence', () => {
  for (const origin of ['http://provider:32002', 'http://127.0.0.1:32002',
    'http://nf-123456789abc-backend-application-r1-provider:32002/other',
    'https://nf-123456789abc-backend-application-r1-provider:32002']) {
    assert.throws(() => ownedModelingApplicationRoute(routeProbe(), origin));
  }
  assert.throws(() => ownedModelingApplicationRoute(undefined, 'http://provider:32002'));
});

function executionFixture(t, mutate = () => {}) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'owned-modeling-routes-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  fs.mkdirSync(join(workspace, 'scripts/fixtures'), { recursive: true });
  fs.writeFileSync(join(workspace, 'scripts/fixtures/OwnedModelingApplicationRoutesProbe.java'), '// test helper\n');
  fs.writeFileSync(join(workspace, 'scripts/owned-modeling-application-routes.mjs'), '// test tool\n');
  const base = join(workspace, '.artifacts/test-owned');
  const options = {
    workspace, runId: '123456789abc', label: 'application-r1', imageId: `sha256:${'a'.repeat(64)}`,
    dependencies: join(base, 'dependencies'), modelPath: join(base, 'model'),
    outputPath: join(base, 'probe'), directories,
  };
  for (const path of [options.dependencies, options.modelPath]) fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(join(options.dependencies, 'test-library.jar'), 'test library inventory');
  fs.writeFileSync(join(options.modelPath, 'PSSYSTEM.json'), '{}\n');
  const calls = [];
  options.docker = args => {
    calls.push(args);
    if (args[0] === 'container') return {
      status: 1, stdout: '[]\n', stderr: `Error response from daemon: No such container: ${args[2]}\n`,
    };
    assert.equal(args[0], 'run');
    if (args.includes('javac')) {
      fs.writeFileSync(join(options.outputPath, 'classes/Probe.class'), 'mock compiled output');
      return { status: 0, stdout: '', stderr: '' };
    }
    const probe = routeProbe();
    mutate(probe);
    return { status: 0, stdout: JSON.stringify(probe), stderr: '' };
  };
  return { options, calls };
}

test('execution compiles and probes offline with bounded read-only inputs and immutable inventories', t => {
  const { options, calls } = executionFixture(t);
  const report = probeOwnedModelingApplicationRoutes(options);
  assert.deepEqual(report.probe, routeProbe());
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.permissionAcceptance, false);
  assert.equal(report.commands.length, 2);
  assert.equal(report.helperClasses.entries.length, 1);
  for (const args of calls.filter(args => args[0] === 'run')) {
    for (const value of ['--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--pull=never']) assert.ok(args.includes(value));
    assert.ok(!args.some(value => /MYSQL_PWD|jdbc:|--publish|--privileged/.test(value)));
    assert.equal(args[args.indexOf('--entrypoint') + 2], options.imageId);
  }
  const compile = report.commands[0].args;
  for (const value of ['-proc:none', '-implicit:none', '--release']) assert.ok(compile.includes(value));
  const probe = report.commands[1].args;
  assert.ok(probe.includes('65532:65532'));
  assert.ok(probe.includes(`type=bind,src=${options.modelPath},dst=/model,readonly`));
  assert.ok(probe.includes(`type=bind,src=${options.dependencies},dst=/dependencies,readonly`));
});

test('pre-existing helper name aborts before launch without cleanup or adoption', t => {
  const { options } = executionFixture(t);
  const calls = [];
  options.docker = args => { calls.push(args); return { status: 0, stdout: '[]', stderr: '' }; };
  assert.throws(() => probeOwnedModelingApplicationRoutes(options));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'container');
});

test('changed generated route cannot produce a successful probe report', t => {
  const { options } = executionFixture(t, probe => { probe.canonicalRoute.filters = []; });
  assert.throws(() => probeOwnedModelingApplicationRoutes(options));
  assert.equal(fs.existsSync(join(options.outputPath, 'report.json')), false);
  assert.ok(fs.existsSync(join(options.outputPath, '1.private.log')));
});

test('helper absence cannot be inferred from unrelated Docker failures', t => {
  const { options } = executionFixture(t);
  options.docker = () => ({ status: 1, stdout: '', stderr: 'daemon unavailable' });
  assert.throws(() => probeOwnedModelingApplicationRoutes(options));
});
