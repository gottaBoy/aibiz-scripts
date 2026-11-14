import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  auditPermissionSuites, GENERATED_DEPLOYMENT_ARCHIVES, MODELING_CORE_MODULE, parseSurefireSuites, permissionMavenCommand,
  PINNED_MAVEN_IMAGE, REQUIRED_PERMISSION_SUITES, runModelingPermissionRegression,
  verifyModelingPermissionRegression,
} from '../harness-modeling-permission-regression.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';

const harness = fileURLToPath(new URL('../harness-modeling-permission-regression.mjs', import.meta.url));
const reportsPath = `${MODELING_CORE_MODULE}/target/surefire-reports`;
const extraSuite = 'net.ibizsys.modeling.core.dataentity.ModelActionDispatchTest';
const addedPermissionSuites = [
  'net.ibizsys.modeling.core.security.SystemAccessManagerEditorRegistryTest',
  'net.ibizsys.modeling.core.security.PSDevUserCacheCodecTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerJsonCacheTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerRootErrorMappingTest',
  'net.ibizsys.modeling.core.sysutil.addin.ModelSysUtilRTAddinAuthorizationTest',
];
const fullSuites = [...REQUIRED_PERMISSION_SUITES, extraSuite].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function xml(name, { tests = 1, failure = false, error = false, skipped = false } = {}) {
  const cases = Array.from({ length: tests }, (_, index) => {
    const outcome = index === 0
      ? (failure ? '<failure message="denied"/>' : '') +
        (error ? '<error message="error"/>' : '') + (skipped ? '<skipped/>' : '')
      : '';
    return `<testcase name="case${index}" classname="${name}" time="0.01">${outcome}</testcase>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${name}" tests="${tests}" failures="${Number(failure)}" errors="${Number(error)}" skipped="${Number(skipped)}">
<properties><property name="message" value="quoted &amp; escaped"/></properties>${cases}
<system-out><![CDATA[Tests run: 999, Failures: 0, Errors: 0, Skipped: 0]]></system-out></testsuite>`;
}

function xmlReports(names = REQUIRED_PERMISSION_SUITES, options = {}) {
  return names.map(name => ({ path: `${reportsPath}/TEST-${name}.xml`, data: xml(name, options) }));
}

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'modeling-permission-regression-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, 'ibiz-service-hub');
  const seed = join(workspace, 'cache-seed');
  write(join(seed, 'controlled/dependency.pom'), '<project/>');
  write(join(seed, 'controlled/dependency.jar'), 'fixture-only cache bytes, not executable compiler evidence');
  write(join(source, 'pom.xml'), '<project/>');
  write(join(source, 'libs/pom.xml'), '<project/>');
  write(join(source, MODELING_CORE_MODULE, 'pom.xml'), '<project/>');
  write(join(source, 'libs/ibiz-model/pom.xml'), '<project/>');
  write(join(source, '.mvn/maven.config'), '-Dgroovy.version=3.0.20\n');
  write(join(source, '.git/HEAD'), 'ignored Git identity');
  write(join(source, '.artifacts/old-receipt.json'), '{}');
  write(join(source, MODELING_CORE_MODULE, 'target/provider.jar'), 'live provider sentinel');
  write(join(source, 'other/target/stale.class'), 'ignored nested build output');
  for (const name of fullSuites) {
    write(join(source, MODELING_CORE_MODULE, 'src/test/java', `${name.split('.').join('/')}.java`),
      `// Controlled ${name} source fixture; tests do not run Maven.\n`);
  }
  write(join(source, MODELING_CORE_MODULE, 'src/main/java/PermissionManager.java'),
    '// Controlled permission implementation fixture.\n');
  const output = join(workspace, '.artifacts/run');
  const commands = [];
  let onBuild = () => {};
  let onCommand = () => {};
  const execute = (executable, args, options) => {
    commands.push({ executable, args });
    const overridden = onCommand(executable, args, options);
    if (overridden) return overridden;
    if (executable === 'rsync') return spawnSync(executable, args, options);
    assert.equal(executable, 'docker');
    if (args[0] === 'image') {
      assert.deepEqual(args, ['image', 'inspect', '--format', '{{json .}}', PINNED_MAVEN_IMAGE]);
      fs.writeSync(options.stdio[1], JSON.stringify({
        Id: `sha256:${'1'.repeat(64)}`, Os: 'linux', Architecture: 'arm64',
        RepoDigests: [PINNED_MAVEN_IMAGE],
      }));
      return { status: 0, signal: null };
    }
    if (args[0] === 'rm') return { status: 0, signal: null };
    assert.equal(args[0], 'run');
    const workMount = args.find(arg => arg.startsWith('type=bind,source=') &&
      arg.endsWith(',target=/workspace/ibiz-service-hub'));
    assert.ok(workMount);
    const worktree = workMount.slice('type=bind,source='.length, -',target=/workspace/ibiz-service-hub'.length);
    const stage = basename(worktree);
    assert.ok(['focused', 'full'].includes(stage));
    assert.equal(options.timeout, 30 * 60_000);
    const reportDirectory = join(worktree, reportsPath);
    assert.equal(fs.existsSync(reportDirectory), false, 'Every stage must begin with no generated reports');
    assert.equal(fs.existsSync(join(worktree, MODELING_CORE_MODULE, 'target/provider.jar')), false);
    const names = stage === 'focused' ? REQUIRED_PERMISSION_SUITES : fullSuites;
    for (const name of names) {
      write(join(reportDirectory, `TEST-${name}.xml`), xml(name));
      write(join(reportDirectory, `${name}.txt`), 'Tests run: 1, Failures: 0, Errors: 0, Skipped: 0\n');
    }
    fs.writeSync(options.stdio[1], 'CONTROLLED DOCKER FIXTURE ONLY; NO JAVA/MAVEN EXECUTED\nBUILD SUCCESS\n');
    return onBuild({ stage, worktree, source, seed, output, reportDirectory, args, options }) ??
      { status: 0, signal: null };
  };
  const options = { workspace, source, output, mavenRepository: seed, execute };
  return {
    workspace, source, seed, output, commands, options,
    build: callback => { onBuild = callback; },
    command: callback => { onCommand = callback; },
    run: () => runModelingPermissionRegression(options),
    verify: reportPath => verifyModelingPermissionRegression({ workspace, reportPath }),
  };
}

function editReport(reportPath, mutate) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  mutate(report);
  write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

test('focused selector and XML gate require exactly the ten permission suites', () => {
  const expected = [
    'net.ibizsys.modeling.core.dataentity.security.PSModelDEAccessManagerTest',
    'net.ibizsys.modeling.core.security.PSDevUserCacheCodecTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerCacheTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerEditorRegistryTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerGrantTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerJsonCacheTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerRequestCacheTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerRootErrorMappingTest',
    'net.ibizsys.modeling.core.security.SystemAccessManagerSchemeGrantTest',
    'net.ibizsys.modeling.core.sysutil.addin.ModelSysUtilRTAddinAuthorizationTest',
  ];
  assert.deepEqual(REQUIRED_PERMISSION_SUITES, expected);
  const command = permissionMavenCommand({
    worktree: '/isolated/focused', snapshot: '/isolated/snapshot', repository: '/isolated/repository',
    containerName: 'modeling-permission-00000000-0000-0000-0000-000000000000',
    uid: 1000, gid: 1000, stage: 'focused',
  });
  assert.deepEqual(command.args.filter(arg => arg.startsWith('-Dtest=')), [
    '-Dtest=PSModelDEAccessManagerTest,PSDevUserCacheCodecTest,SystemAccessManagerCacheTest,' +
      'SystemAccessManagerEditorRegistryTest,' +
      'SystemAccessManagerGrantTest,SystemAccessManagerJsonCacheTest,' +
      'SystemAccessManagerRequestCacheTest,SystemAccessManagerRootErrorMappingTest,' +
      'SystemAccessManagerSchemeGrantTest,' +
      'ModelSysUtilRTAddinAuthorizationTest',
  ]);
  assert.equal(auditPermissionSuites(parseSurefireSuites(xmlReports(expected)), {
    stage: 'focused',
  }).suiteCount, 10);
  const legacy = expected.filter(name => !addedPermissionSuites.includes(name));
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports(legacy)), {
    stage: 'focused',
  }), /required suite inventory mismatch/);
  const previous = expected.filter(name => !name.endsWith('.SystemAccessManagerJsonCacheTest'));
  assert.equal(previous.length, 9);
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports(previous)), {
    stage: 'focused',
  }), /required suite inventory mismatch/);
});

for (const name of addedPermissionSuites) {
  test(`focused gate rejects missing or skipped ${name.split('.').at(-1)}`, () => {
    const missing = REQUIRED_PERMISSION_SUITES.filter(suite => suite !== name);
    assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports(missing)), {
      stage: 'focused',
    }), /required suite inventory mismatch/);
    const skipped = xmlReports().map(report => report.path.endsWith(`/TEST-${name}.xml`)
      ? { ...report, data: xml(name, { skipped: true }) } : report);
    assert.throws(() => auditPermissionSuites(parseSurefireSuites(skipped), {
      stage: 'focused',
    }), /Failures, errors or required skips/);
  });

  test(`captured source must include ${name.split('.').at(-1)} before any compiler execution`, t => {
    const f = fixture(t);
    fs.rmSync(join(f.source, MODELING_CORE_MODULE, 'src/test/java', `${name.split('.').join('/')}.java`));
    const result = f.run();
    assert.equal(result.report.status, 'failed');
    assert.ok(result.report.errors.some(error =>
      error.includes(`Required permission suite absent from source: ${name}`)));
    assert.equal(f.commands.length, 0);
  });

  test(`receipt verifier rejects recorded source drift in ${name.split('.').at(-1)}`, t => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.report.unitRegression, true);
    const path = join(f.source, MODELING_CORE_MODULE, 'src/test/java', `${name.split('.').join('/')}.java`);
    fs.appendFileSync(path, '// Post-receipt security regression source drift.\n');
    assert.throws(() => f.verify(result.reportPath), /sourceInputs recorded inventory drift/);
  });
}

test('XML parser binds suite counts to actual testcases, not console-looking output', () => {
  const parsed = parseSurefireSuites(xmlReports());
  const results = auditPermissionSuites(parsed, { stage: 'focused' });
  assert.equal(results.tests, REQUIRED_PERMISSION_SUITES.length);
  assert.equal(results.suiteCount, REQUIRED_PERMISSION_SUITES.length);
  assert.equal(results.modelingCoreTests, REQUIRED_PERMISSION_SUITES.length);
  assert.equal(results.failures + results.errors + results.skipped, 0);
});

for (const [label, mutate, expected] of [
  ['empty report set', () => [], /No Surefire XML/],
  ['non-XML console summary', reports => {
    reports[0].data = 'Tests run: 54, Failures: 0, Errors: 0, Skipped: 0\nBUILD SUCCESS';
  }, /Invalid Surefire XML/],
  ['malformed XML', reports => { reports[0].data = '<testsuite>'; }, /Invalid Surefire XML/],
  ['incorrect root schema', reports => {
    reports[0].data = '<testsuites/>';
  }, /Expected a Surefire testsuite root/],
  ['wrong filename', reports => { reports[0].path = `${reportsPath}/TEST-Wrong.xml`; }, /filename\/name mismatch/],
  ['missing tests count', reports => {
    reports[0].data = reports[0].data.replace('tests="1"', '');
  }, /Invalid suite tests count/],
  ['negative count', reports => {
    reports[0].data = reports[0].data.replace('tests="1"', 'tests="-1"');
  }, /Invalid suite tests count/],
  ['fractional count', reports => {
    reports[0].data = reports[0].data.replace('tests="1"', 'tests="1.5"');
  }, /Invalid suite tests count/],
  ['unsafe count', reports => {
    reports[0].data = reports[0].data.replace('tests="1"', 'tests="9007199254740993"');
  }, /Unsafe suite tests count/],
  ['forged count', reports => {
    reports[0].data = reports[0].data.replace('tests="1"', 'tests="54"');
  }, /Suite\/testcase count mismatch/],
  ['empty suite', reports => { reports[0].data = xml(REQUIRED_PERMISSION_SUITES[0], { tests: 0 }); }, /Empty Surefire/],
  ['duplicate suite', reports => { reports.push(reports[0]); }, /Duplicate Surefire suite/],
  ['unreported failure', reports => {
    reports[0].data = xml(REQUIRED_PERMISSION_SUITES[0], { failure: true }).replace('failures="1"', 'failures="0"');
  }, /failures count mismatch/],
  ['unreported skip', reports => {
    reports[0].data = xml(REQUIRED_PERMISSION_SUITES[0], { skipped: true }).replace('skipped="1"', 'skipped="0"');
  }, /skipped count mismatch/],
  ['missing testcase identity', reports => {
    reports[0].data = reports[0].data.replace('name="case0"', '');
  }, /Missing testcase name/],
  ['testcase from another class', reports => {
    reports[0].data = reports[0].data.replace(`classname="${REQUIRED_PERMISSION_SUITES[0]}"`,
      'classname="unrelated.Test"');
  }, /Testcase classname\/suite mismatch/],
  ['unsupported flaky retry', reports => {
    reports[0].data = reports[0].data.replace('</testcase>', '<flakyFailure/></testcase>');
  }, /Unsupported Surefire testcase child/],
  ['nested suite', reports => {
    reports[0].data = reports[0].data.replace('</testsuite>', '<testsuite/></testsuite>');
  }, /Unsupported Surefire suite child/],
  ['DTD/entity input', reports => {
    reports[0].data = '<!DOCTYPE testsuite [<!ENTITY x "x">]><testsuite/>';
  }, /DTD\/entities are not allowed/],
]) {
  test(`invalid suite evidence fails closed: ${label}`, () => {
    let reports = xmlReports();
    reports = mutate(reports) ?? reports;
    assert.throws(() => parseSurefireSuites(reports), expected);
  });
}

for (const outcome of ['failure', 'error', 'skipped']) {
  test(`required suites reject ${outcome} even with valid XML counts`, () => {
    const parsed = parseSurefireSuites(xmlReports(REQUIRED_PERMISSION_SUITES, { [outcome]: true }));
    assert.throws(() => auditPermissionSuites(parsed, { stage: 'focused' }),
      /Failures, errors or required skips/);
  });
}

test('missing, renamed, wrong-module and stale extra focused suites cannot satisfy required coverage', () => {
  const reports = xmlReports();
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(reports.slice(1)), { stage: 'focused' }),
    /required suite inventory mismatch/);
  const renamed = [...REQUIRED_PERMISSION_SUITES.slice(1), extraSuite];
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports(renamed)), { stage: 'focused' }),
    /required suite inventory mismatch/);
  reports[0].path = reports[0].path.replace(MODELING_CORE_MODULE, 'libs/ibiz-model');
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(reports), { stage: 'focused' }),
    /required suite inventory mismatch/);
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports(fullSuites)), { stage: 'focused' }),
    /required suite inventory mismatch/);
});

test('full stage follows newly captured source suites instead of accepting focused-only reports', () => {
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports()), {
    stage: 'full', fullSuites,
  }), /required suite inventory mismatch/);
  assert.equal(auditPermissionSuites(parseSurefireSuites(xmlReports(fullSuites)), {
    stage: 'full', fullSuites,
  }).tests, fullSuites.length);
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(xmlReports()), { stage: 'full' }),
    /source suite inventory missing/);
});

test('upstream reactor reports are counted and cannot hide failed or skipped tests', () => {
  const upstream = {
    path: 'libs/ibiz-model/target/surefire-reports/TEST-net.ibizsys.model.ModelTest.xml',
    data: xml('net.ibizsys.model.ModelTest', { tests: 3 }),
  };
  const reports = [...xmlReports(), upstream];
  const audit = auditPermissionSuites(parseSurefireSuites(reports), { stage: 'focused' });
  assert.equal(audit.tests, REQUIRED_PERMISSION_SUITES.length + 3);
  assert.equal(audit.modelingCoreTests, REQUIRED_PERMISSION_SUITES.length);
  upstream.data = xml('net.ibizsys.model.ModelTest', { skipped: true });
  assert.throws(() => auditPermissionSuites(parseSurefireSuites(reports), { stage: 'focused' }),
    /required skips/);
});

test('isolated run copies source once, builds two clean worktrees and verifies immutable inventories', t => {
  const f = fixture(t);
  const before = sourceBuildInputs(f.source);
  const seedBefore = sourceBuildInputs(f.seed);
  const provider = join(f.source, MODELING_CORE_MODULE, 'target/provider.jar');
  const providerBefore = fs.readFileSync(provider);
  const result = f.run();
  assert.equal(result.report.status, 'passed-unit-regression-only');
  assert.equal(result.report.unitRegression, true);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.acceptedForProduction, false);
  assert.deepEqual(result.report.errors, []);
  assert.deepEqual(result.report.sourceInputs.before, before);
  assert.deepEqual(result.report.sourceInputs.after, before);
  assert.deepEqual(result.report.snapshotInputs.before, before);
  assert.deepEqual(result.report.snapshotInputs.after, before);
  assert.deepEqual(result.report.repositoryInputs.before, seedBefore);
  assert.deepEqual(result.report.repositoryInputs.after, seedBefore);
  assert.deepEqual(sourceBuildInputs(f.source), before);
  assert.deepEqual(sourceBuildInputs(f.seed), seedBefore);
  assert.deepEqual(fs.readFileSync(provider), providerBefore);
  assert.deepEqual(result.report.expectedFullSuites, fullSuites);
  assert.deepEqual(fs.readdirSync(join(f.output, 'snapshot')).sort(), ['.mvn', 'libs', 'other', 'pom.xml']);
  assert.equal(fs.existsSync(join(f.output, 'snapshot', MODELING_CORE_MODULE, 'target')), false);
  assert.deepEqual(result.report.stages.map(stage => stage.stage), ['focused', 'full']);
  for (const record of result.report.stages) {
    assert.equal(record.status, 'passed');
    assert.deepEqual(record.before, before);
    assert.deepEqual(record.after, before);
    assert.ok(record.reportFiles.entries.some(entry => entry.path.endsWith('.xml')));
    assert.ok(record.reportFiles.entries.some(entry => entry.path.endsWith('.txt')));
    assert.ok(fs.readFileSync(join(f.output, record.command.log.path), 'utf8')
      .includes('CONTROLLED DOCKER FIXTURE ONLY'));
    const args = record.command.args;
    assert.ok(args.includes(PINNED_MAVEN_IMAGE));
    for (const flag of ['--network=none', '--read-only', '--pull=never',
      '-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false', '-o']) {
      assert.ok(args.includes(flag), flag);
    }
    assert.ok(args.includes(`type=bind,source=${join(f.output, 'snapshot')},target=/snapshot,readonly`));
    assert.ok(args.includes(`type=bind,source=${join(f.output, 'repository')},target=/maven-repository,readonly`));
    assert.equal(args.some(arg => arg.includes(f.source)), false, 'Original source cannot be mounted');
    assert.equal(args.some(arg => arg.includes(f.seed)), false, 'Original cache cannot be mounted');
    assert.deepEqual(args.slice(-4), ['-pl', MODELING_CORE_MODULE, '-am', 'test']);
    assert.equal(args.some(arg => arg.startsWith('-Dtest=')), record.stage === 'focused');
    assert.deepEqual(record.results.suites.map(suite => suite.name).sort(),
      record.stage === 'focused' ? [...REQUIRED_PERMISSION_SUITES].sort() : fullSuites);
  }
  assert.equal(f.commands.filter(command => command.executable === 'docker' && command.args[0] === 'run').length, 2);
  assert.equal(f.commands.some(command => command.args.includes('restart')), false);
  const verified = f.verify(result.reportPath);
  assert.equal(verified.unitRegression, true);
  assert.equal(verified.nativeAcceptance, false);
  assert.equal(verified.reportSha256, hash(fs.readFileSync(result.reportPath)));
});

test('only exact deployment archives are excluded; compiler inputs and dependency JARs remain bound', t => {
  const f = fixture(t);
  assert.deepEqual(GENERATED_DEPLOYMENT_ARCHIVES, [
    'ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar',
    'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
    'ibiz-service-runner/ibizservicerunner-provider.jar',
  ]);
  for (const path of GENERATED_DEPLOYMENT_ARCHIVES) {
    const archive = join(f.source, path);
    write(archive, 'existing generated deployment sentinel');
    const fd = fs.openSync(archive, 'r+');
    try { fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); }
    finally { fs.closeSync(fd); }
    write(join(f.seed, path), 'a dependency with the same path must not be excluded');
  }
  const retained = [
    'libs/vendor.jar', 'nested/ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
    'ibiz-ebsx-runtime/other.jar', 'ibiz-ebsx-runtime/src/main/java/Runtime.java',
    'ibiz-ebsx-runtime/pom.xml',
  ];
  for (const path of retained) write(join(f.source, path), 'required input sentinel');
  const before = sourceBuildInputs(f.source, { generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES });
  const result = f.run();
  assert.equal(result.report.unitRegression, true, result.report.errors.join('\n'));
  assert.deepEqual(result.report.sourceInputs.generatedArtifacts, GENERATED_DEPLOYMENT_ARCHIVES);
  assert.deepEqual(result.report.sourceInputs.before, before);
  assert.deepEqual(result.report.repositoryInputs.before, sourceBuildInputs(f.seed));
  for (const root of [result.report.snapshot, ...result.report.stages.map(stage => stage.worktree)]) {
    for (const path of GENERATED_DEPLOYMENT_ARCHIVES) assert.equal(fs.existsSync(join(root, path)), false);
    for (const path of retained) assert.equal(fs.readFileSync(join(root, path), 'utf8'), 'required input sentinel');
  }
  const sourceCopy = result.report.commands[0].args;
  for (const path of GENERATED_DEPLOYMENT_ARCHIVES) {
    assert.ok(sourceCopy.includes(`--exclude=/${path}`));
    assert.equal(fs.statSync(join(f.source, path)).size, 64 * 1024 * 1024 + 1);
    assert.ok(result.report.repositoryInputs.before.entries.some(entry => entry.path === path));
  }
  assert.equal(result.report.commands[1].args.some(arg => arg.endsWith('.jar')), false);
  assert.equal(f.verify(result.reportPath).unitRegression, true);
  write(join(f.source, retained[0]), 'changed required JAR');
  assert.throws(() => f.verify(result.reportPath), /sourceInputs recorded inventory drift/);
});

for (const target of ['snapshot', 'focused', 'full']) {
  test(`a deployment archive injected into ${target} cannot be hidden by source-only exclusions`, t => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.report.unitRegression, true);
    write(join(f.output, target, GENERATED_DEPLOYMENT_ARCHIVES[0]), 'injected compiler input');
    assert.throws(() => f.verify(result.reportPath), target === 'snapshot'
      ? /snapshotInputs recorded inventory drift/ : /Worktree source drift/);
  });
}

test('an unknown oversized archive is rejected rather than silently excluded', t => {
  const f = fixture(t);
  const archive = join(f.source, 'libs/required-input.jar');
  write(archive, 'required dependency sentinel');
  const fd = fs.openSync(archive, 'r+');
  try { fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); }
  finally { fs.closeSync(fd); }
  const result = f.run();
  assert.equal(result.report.unitRegression, false);
  assert.ok(result.report.errors.some(error => error.includes('Resource too large: required-input.jar')));
  assert.equal(f.commands.length, 0);
});

for (const [label, mutate, expected] of [
  ['missing required XML', ({ reportDirectory }) => {
    fs.rmSync(join(reportDirectory, `TEST-${REQUIRED_PERMISSION_SUITES[0]}.xml`));
  }, /required suite inventory mismatch/],
  ['malformed XML', ({ reportDirectory }) => {
    write(join(reportDirectory, `TEST-${REQUIRED_PERMISSION_SUITES[0]}.xml`), '<testsuite>');
  }, /Invalid Surefire XML/],
  ['missing all reports', ({ reportDirectory }) => {
    fs.rmSync(reportDirectory, { recursive: true });
  }, /No Surefire XML/],
  ['required skipped test', ({ reportDirectory }) => {
    write(join(reportDirectory, `TEST-${REQUIRED_PERMISSION_SUITES[0]}.xml`),
      xml(REQUIRED_PERMISSION_SUITES[0], { skipped: true }));
  }, /required skips/],
  ['test failure', ({ reportDirectory }) => {
    write(join(reportDirectory, `TEST-${REQUIRED_PERMISSION_SUITES[0]}.xml`),
      xml(REQUIRED_PERMISSION_SUITES[0], { failure: true }));
  }, /Failures, errors/],
  ['Surefire crash dump', ({ reportDirectory }) => {
    write(join(reportDirectory, 'jvm.dumpstream'), 'crashed fork');
  }, /Surefire crash evidence/],
  ['post-build source edit', ({ worktree }) => {
    write(join(worktree, MODELING_CORE_MODULE, 'src/main/java/PermissionManager.java'), '// changed\n');
  }, /post-build source drift/],
  ['live source drift', ({ source }) => {
    write(join(source, MODELING_CORE_MODULE, 'src/main/java/PermissionManager.java'), '// changed\n');
  }, /sourceInputs source drift/],
  ['immutable snapshot drift', ({ output }) => {
    write(join(output, 'snapshot', MODELING_CORE_MODULE, 'src/main/java/PermissionManager.java'), '// changed\n');
  }, /snapshot drift/],
  ['dependency snapshot drift', ({ output }) => {
    write(join(output, 'repository/controlled/dependency.jar'), 'changed dependency');
  }, /repositoryInputs source drift/],
]) {
  test(`failed run preserves logs and denies acceptance: ${label}`, t => {
    const f = fixture(t);
    f.build(info => {
      if (info.stage === 'focused') mutate(info);
    });
    const result = f.run();
    assert.equal(result.report.status, 'failed');
    assert.equal(result.report.unitRegression, false);
    assert.equal(result.report.nativeAcceptance, false);
    assert.ok(result.report.errors.some(error => expected.test(error)), result.report.errors.join('\n'));
    assert.ok(fs.existsSync(join(f.output, 'focused.log')));
    assert.ok(fs.existsSync(result.reportPath));
    assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
    assert.throws(() => f.verify(result.reportPath), /not passing/);
  });
}

test('a failed focused command retains logs, removes only its own container and still runs full', t => {
  const f = fixture(t);
  f.build(info => {
    if (info.stage === 'focused') {
      fs.writeSync(info.options.stdio[2], 'permission compile error sentinel\n');
      return { status: 17, signal: null };
    }
  });
  const result = f.run();
  assert.equal(result.report.unitRegression, false);
  assert.equal(result.report.stages[0].command.exitCode, 17);
  assert.equal(result.report.stages[0].status, 'failed');
  assert.equal(result.report.stages[1].status, 'passed');
  assert.match(fs.readFileSync(join(f.output, 'focused.log'), 'utf8'), /compile error sentinel/);
  const cleanup = f.commands.find(command => command.args[0] === 'rm');
  assert.deepEqual(cleanup, {
    executable: 'docker', args: ['rm', '--force', result.report.stages[0].containerName],
  });
  assert.ok(result.report.errors.includes('focused Maven execution failed'));
});

test('execution errors and timeout signals retain partial output and cannot become success', t => {
  const f = fixture(t);
  f.build(info => info.stage === 'focused'
    ? { status: null, signal: 'SIGTERM', error: new Error('controlled ETIMEDOUT') } : undefined);
  const result = f.run();
  const record = result.report.stages[0];
  assert.equal(record.command.exitCode, null);
  assert.equal(record.command.signal, 'SIGTERM');
  assert.equal(record.command.error, 'controlled ETIMEDOUT');
  assert.equal(result.report.status, 'failed');
  assert.ok(fs.existsSync(join(f.output, 'focused.log')));
});

test('rsync failure preserves preparation failure logs without starting a compiler', t => {
  const f = fixture(t);
  f.command((command, args, options) => {
    if (command === 'rsync') {
      fs.writeSync(options.stdio[2], 'controlled rsync failure\n');
      return { status: 23, signal: null };
    }
  });
  const result = f.run();
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.commands[0].exitCode, 23);
  assert.match(fs.readFileSync(join(f.output, 'snapshot-rsync.log'), 'utf8'), /rsync failure/);
  assert.equal(f.commands.some(command => command.executable === 'docker'), false);
});

test('thrown command errors and missing XML parser retain errors instead of passing', t => {
  const thrown = fixture(t);
  thrown.command(command => {
    if (command === 'rsync') throw new Error('controlled command spawn failure');
  });
  const failed = thrown.run();
  assert.equal(failed.report.status, 'failed');
  assert.equal(failed.report.commands[0].error, 'controlled command spawn failure');
  assert.match(fs.readFileSync(join(thrown.output, 'snapshot-rsync.log'), 'utf8'), /spawn failure/);
  const missingParser = fixture(t);
  const result = runModelingPermissionRegression({
    ...missingParser.options, python: join(missingParser.workspace, 'no-python-here'),
  });
  assert.equal(result.report.unitRegression, false);
  assert.equal(result.report.stages.length, 2);
  assert.ok(result.report.errors.every(error => error.includes('Invalid Surefire XML')));
  assert.ok(fs.existsSync(join(missingParser.output, 'full.log')));
});

test('a moving source during rsync cannot bind the copied snapshot to a later source version', t => {
  const f = fixture(t);
  f.command((command, args, options) => {
    if (command === 'rsync' && args.at(-1) === `${join(f.output, 'snapshot')}/`) {
      const result = spawnSync(command, args, options);
      write(join(f.source, 'pom.xml'), '<project>changed during copy</project>');
      return result;
    }
  });
  const result = f.run();
  assert.equal(result.report.unitRegression, false);
  assert.ok(result.report.errors.some(error => error.includes('Source drift during snapshot')));
  assert.equal(result.report.stages.length, 0);
});

test('unavailable or mismatched pinned image fails closed with inspection logs retained', t => {
  const f = fixture(t);
  f.command((command, args, options) => {
    if (command === 'docker' && args[0] === 'image') {
      fs.writeSync(options.stdio[1], JSON.stringify({
        Id: `sha256:${'1'.repeat(64)}`, Os: 'linux', Architecture: 'arm64', RepoDigests: [],
      }));
      return { status: 0, signal: null };
    }
  });
  const result = f.run();
  assert.equal(result.report.unitRegression, false);
  assert.ok(result.report.errors.some(error => error.includes('digest mismatch')));
  assert.equal(result.report.stages.length, 0);
  assert.ok(fs.existsSync(join(f.output, 'image-inspect.log')));
});

for (const [label, mutate, expected] of [
  ['nativeAcceptance claim', report => { report.nativeAcceptance = true; }, /cannot establish nativeAcceptance/],
  ['production acceptance', report => { report.acceptedForProduction = true; }, /Expected values/],
  ['missing full stage', report => { report.stages.pop(); }, /Missing\/invalid stages/],
  ['wrong schema contract', report => { report.contract = 'invalid'; }, /Invalid regression report contract/],
  ['invented suite total', report => { report.stages[0].results.tests = 54; }, /Suite\/count\/schema/],
  ['missing source inventory', report => { delete report.sourceInputs.before; }, /recorded inventory drift/],
  ['extra generated exclusion', report => {
    report.sourceInputs.generatedArtifacts.push('libs/required-input.jar');
  }, /Generated deployment archive exclusions mismatch/],
  ['missing generated exclusions', report => {
    delete report.sourceInputs.generatedArtifacts;
  }, /Generated deployment archive exclusions mismatch/],
  ['forged input fingerprint', report => { report.snapshotInputs.before.fingerprint = '0'.repeat(64); }, /recorded inventory drift/],
  ['missing post-build inventory', report => { delete report.sourceInputs.after; }, /post-build inventory drift/],
  ['nonzero command exit', report => { report.stages[0].command.exitCode = 1; }, /Failed command/],
  ['string command exit', report => { report.stages[0].command.exitCode = '0'; }, /Failed command/],
  ['skip flag removed', report => {
    report.stages[0].command.args = report.stages[0].command.args.filter(arg => arg !== '-Dmaven.test.skip=false');
  }, /Maven command mismatch/],
  ['test skip enabled', report => {
    report.stages[0].command.args = report.stages[0].command.args.map(arg =>
      arg === '-DskipTests=false' ? '-DskipTests=true' : arg);
  }, /Maven command mismatch/],
  ['image tag substituted', report => {
    report.stages[0].command.args = report.stages[0].command.args.map(arg =>
      arg === PINNED_MAVEN_IMAGE ? 'maven:latest' : arg);
  }, /Maven command mismatch/],
  ['in-place build path', report => { report.stages[0].worktree = report.source; }, /In-place build rejected/],
  ['shared live source mount', report => {
    report.stages[0].command.args = report.stages[0].command.args.map(arg =>
      arg.endsWith(',target=/workspace/ibiz-service-hub')
        ? `type=bind,source=${report.source},target=/workspace/ibiz-service-hub` : arg);
  }, /Maven command mismatch/],
  ['log path traversal', report => { report.stages[0].command.log.path = '../outside.log'; }, /Invalid command log/],
]) {
  test(`receipt verifier rejects ${label}`, t => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.report.unitRegression, true);
    editReport(result.reportPath, mutate);
    assert.throws(() => f.verify(result.reportPath), expected);
  });
}

for (const [label, change, expected] of [
  ['original source', (f, result) => write(join(f.source, 'pom.xml'), '<project>changed</project>'), /recorded inventory drift/],
  ['captured snapshot', (f, result) => write(join(result.report.snapshot, 'pom.xml'), '<project>changed</project>'), /recorded inventory drift/],
  ['cache dependency', (f, result) => write(join(result.report.repository, 'controlled/dependency.jar'), 'changed'), /recorded inventory drift/],
  ['built worktree', (f, result) => write(join(result.report.stages[0].worktree, 'pom.xml'), '<project>changed</project>'), /Worktree source drift/],
  ['XML bytes', (f, result) => {
    const path = join(result.report.stages[0].worktree, reportsPath, `TEST-${REQUIRED_PERMISSION_SUITES[0]}.xml`);
    fs.appendFileSync(path, '\n');
  }, /Surefire report file drift/],
  ['build log', (f, result) => fs.appendFileSync(join(f.output, 'focused.log'), 'altered\n'), /Command log drift/],
  ['report symlink', (f, result) => {
    fs.renameSync(result.reportPath, join(f.output, 'real-report.json'));
    fs.symlinkSync('real-report.json', result.reportPath);
  }, /Symlink resource rejected/],
  ['XML symlink', (f, result) => {
    const path = join(result.report.stages[0].worktree, reportsPath, `TEST-${REQUIRED_PERMISSION_SUITES[0]}.xml`);
    fs.renameSync(path, `${path}.original`);
    fs.symlinkSync(`${path}.original`, path);
  }, /Symlink resource rejected/],
]) {
  test(`receipt verifier rejects post-run drift in ${label}`, t => {
    const f = fixture(t);
    const result = f.run();
    change(f, result);
    assert.throws(() => f.verify(result.reportPath), expected);
  });
}

test('existing output, in-place and outside-artifacts destinations are never overwritten', t => {
  const f = fixture(t);
  write(join(f.output, 'sentinel'), 'keep this existing run\n');
  const before = fs.readFileSync(join(f.output, 'sentinel'));
  assert.throws(f.run, /Existing destination must not be overwritten/);
  assert.deepEqual(fs.readFileSync(join(f.output, 'sentinel')), before);
  assert.equal(f.commands.length, 0);
  for (const output of [f.source, f.workspace, join(f.output, 'nested'), join(f.workspace, 'outside')]) {
    assert.throws(() => runModelingPermissionRegression({ ...f.options, output }),
      /new direct child of .artifacts/);
  }
  assert.equal(fs.existsSync(join(f.source, 'report.json')), false);
});

test('output symlink or nested source output cannot redirect builds into a shared tree', t => {
  const linked = fixture(t);
  fs.mkdirSync(dirname(linked.output), { recursive: true });
  fs.symlinkSync(linked.source, linked.output, 'dir');
  const before = sourceBuildInputs(linked.source);
  assert.throws(linked.run, /Existing destination must not be overwritten/);
  assert.deepEqual(sourceBuildInputs(linked.source), before);
  assert.equal(linked.commands.length, 0);
  const overlapping = fixture(t);
  fs.mkdirSync(join(overlapping.source, '.artifacts'), { recursive: true });
  assert.throws(() => runModelingPermissionRegression({
    ...overlapping.options, workspace: overlapping.source, source: MODELING_CORE_MODULE,
    output: join(overlapping.source, '.artifacts/fresh'),
    mavenRepository: overlapping.source,
  }), /Overlapping input\/output/);
});

test('symlink input trees and source inputs absent required suites are rejected without compiler execution', t => {
  const f = fixture(t);
  fs.symlinkSync(join(f.source, 'pom.xml'), join(f.source, 'linked-pom.xml'));
  const result = f.run();
  assert.equal(result.report.status, 'failed');
  assert.ok(result.report.errors.some(error => error.includes('Symlink source input rejected')));
  assert.equal(f.commands.length, 0);
  fs.rmSync(join(f.source, 'linked-pom.xml'));
  fs.rmSync(join(f.source, MODELING_CORE_MODULE, 'src/test/java',
    `${REQUIRED_PERMISSION_SUITES[0].split('.').join('/')}.java`));
  const missing = runModelingPermissionRegression({
    ...f.options, output: join(f.workspace, '.artifacts/missing-source-suite'),
  });
  assert.equal(missing.report.status, 'failed');
  assert.ok(missing.report.errors.some(error => error.includes('Required permission suite absent from source')));
  assert.equal(f.commands.length, 0);
});

test('Maven command rejects snapshot or dependency repository as an in-place worktree', () => {
  const options = { worktree: '/isolated/focused', snapshot: '/isolated/snapshot',
    repository: '/isolated/repository', containerName: 'modeling-permission-00000000-0000-0000-0000-000000000000',
    uid: 1000, gid: 1000, stage: 'focused' };
  for (const worktree of [options.snapshot, options.repository, '/isolated']) {
    assert.throws(() => permissionMavenCommand({ ...options, worktree }), /Overlapping input\/output/);
  }
  assert.throws(() => permissionMavenCommand({ ...options, stage: 'native' }), /Invalid Maven stage/);
  assert.throws(() => permissionMavenCommand({ ...options, containerName: 'shared-service' }),
    /Invalid isolated container name/);
  assert.throws(() => permissionMavenCommand({ ...options, uid: '0' }), /Invalid container user identity/);
});

test('CLI help is side-effect free and verification exits nonzero for unavailable evidence', t => {
  const f = fixture(t);
  const help = spawnSync(process.execPath, [harness, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:.*harness-modeling-permission-regression/);
  assert.equal(fs.existsSync(f.output), false);
  const verify = spawnSync(process.execPath, [harness, '--workspace', f.workspace,
    '--verify', relative(f.workspace, join(f.output, 'report.json'))], { encoding: 'utf8' });
  assert.equal(verify.status, 1);
  assert.match(verify.stderr, /Missing directory/);
});
