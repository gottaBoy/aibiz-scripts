import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  backendPackageCommand, EMPTY_PLACEHOLDERS, inspectBackendArchive, parseBackendSuites,
  CLOUD_CORE_MODULE, RUNNER_MODULE, runBackendSourcePackage, SAAS_MODULE, verifyBackendSourcePackage,
} from '../harness-backend-source-package.mjs';
import {
  GENERATED_DEPLOYMENT_ARCHIVES, MODELING_CORE_MODULE, PINNED_MAVEN_IMAGE,
  REQUIRED_PERMISSION_SUITES, runModelingPermissionRegression,
} from '../harness-modeling-permission-regression.mjs';

const harness = fileURLToPath(new URL('../harness-backend-source-package.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const extra = 'net.ibizsys.modeling.core.ControlledFullTest';
const cloudCore = 'controlled.cloudcore.JWTTest';
const fullSuites = [...REQUIRED_PERMISSION_SUITES, extra].sort();
const saas = 'controlled.saas.ConfigurationTest';
const runner = 'controlled.runner.RunnerTest';
const additionalReactor = 'libs/ibiz-extra';
const deployments = [
  { path: GENERATED_DEPLOYMENT_ARCHIVES[0], module: 'ibiz-ebsx-gateway',
    startClass: 'net.ibizsys.ebsx.gateway.boot.EBSXGatewayApplication', embedded: [] },
  { path: GENERATED_DEPLOYMENT_ARCHIVES[1], module: 'ibiz-ebsx-runtime',
    startClass: 'net.ibizsys.ebsx.allinone.boot.EBSXAllInOneApplication', embedded: [SAAS_MODULE] },
  { path: GENERATED_DEPLOYMENT_ARCHIVES[2], module: 'ibiz-service-runner/ibizservicerunner-provider',
    startClass: 'cn.ibizlab.runner.servicerunner.IBizRuntimeApplication', embedded: [MODELING_CORE_MODULE, RUNNER_MODULE] },
];

function write(path, bytes) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, bytes);
}

function xml(name, tests = 1, outcome = '') {
  return `<testsuite name="${name}" tests="${tests}" failures="${Number(outcome === 'failure')}" ` +
    `errors="${Number(outcome === 'error')}" skipped="${Number(outcome === 'skipped')}">` +
    Array.from({ length: tests }, (_, index) =>
      `<testcase name="case${index}" classname="${name}">${index === 0 && outcome ? `<${outcome}/>` : ''}</testcase>`).join('') +
    '</testsuite>';
}

function zip(path, entries) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const result = spawnSync('python3', ['-I', '-c', String.raw`
import base64, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as archive:
    for entry in json.load(sys.stdin):
        archive.writestr(entry["path"], base64.b64decode(entry["data"], validate=True))
`, path], {
    input: JSON.stringify(entries.map(({ path: name, data }) =>
      ({ path: name, data: Buffer.from(data).toString('base64') }))), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

function placeholderXml() {
  return EMPTY_PLACEHOLDERS.map(path => ({ path,
    data: xml(basename(path).slice(5, -4), 0) }));
}

function validXml() {
  return [
    ...fullSuites.map(name => ({
      path: `${MODELING_CORE_MODULE}/target/surefire-reports/TEST-${name}.xml`, data: xml(name),
    })),
    { path: `${SAAS_MODULE}/target/surefire-reports/TEST-${saas}.xml`, data: xml(saas, 24) },
    { path: `${RUNNER_MODULE}/target/surefire-reports/TEST-${runner}.xml`, data: xml(runner, 36) },
    { path: `${CLOUD_CORE_MODULE}/target/surefire-reports/TEST-${cloudCore}.xml`, data: xml(cloudCore, 5) },
    ...placeholderXml(),
  ];
}

function packageOutputs(worktree) {
  for (const item of validXml()) write(join(worktree, item.path), item.data);
  const modules = [...new Set([...deployments.flatMap(item => [item.module, ...item.embedded]), additionalReactor])];
  const targets = new Map();
  for (const module of modules) {
    const path = join(worktree, module, 'target', `${basename(module)}-8.1.0.584.1.jar`);
    zip(path, [{ path: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\n\r\n' },
      { path: 'controlled/NotRealBytecode.class', data: 'SYNTHETIC FIXTURE ONLY; NO COMPILER EXECUTED' }]);
    targets.set(module, path);
  }
  for (const item of deployments) {
    const classPath = `${item.startClass.replaceAll('.', '/')}.class`;
    const classBytes = Buffer.concat([Buffer.from('cafebabe00000034', 'hex'),
      Buffer.from('CONTROLLED INVALID CLASS BODY; NOT COMPILATION EVIDENCE')]);
    write(join(worktree, item.module, 'target/classes', classPath), classBytes);
    write(join(worktree, item.module, 'target/classes/application.yml'), 'fixture: no-secrets\n');
    if (item.module === 'ibiz-ebsx-runtime') {
      write(join(worktree, item.module, 'target/classes/META-INF/spring-configuration-metadata.json'),
        '{"groups":[],"properties":[]}\n');
    }
    const manifest = 'Manifest-Version: 1.0\r\nMain-Class: org.springframework.boot.loader.JarLauncher\r\n' +
      `Start-Class: ${item.startClass}\r\nSpring-Boot-Version: 2.4.0\r\n\r\n`;
    zip(join(worktree, item.path), [
      { path: 'META-INF/MANIFEST.MF', data: manifest },
      { path: `BOOT-INF/classes/${classPath}`, data: classBytes },
      { path: 'BOOT-INF/classes/application.yml', data: 'fixture: no-secrets\n' },
      ...(item.module === 'ibiz-ebsx-runtime' ? [{
        path: 'META-INF/spring-configuration-metadata.json', data: '{"groups":[],"properties":[]}\n',
      }] : []),
      ...item.embedded.map(module => ({
        path: `BOOT-INF/lib/${basename(targets.get(module))}`, data: fs.readFileSync(targets.get(module)),
      })),
      ...(item.module === 'ibiz-ebsx-runtime' ? [
        { path: 'BOOT-INF/lib/ibiz-extra-8.1.0.584.1.jar', data: fs.readFileSync(targets.get(additionalReactor)) },
        { path: 'BOOT-INF/lib/ibiz-unacquired-1.0.jar', data: 'BINARY ONLY; UNKNOWN ORIGINAL SOURCE' },
      ] : []),
    ]);
  }
}

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'backend-source-package-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, 'ibiz-service-hub');
  const cache = join(workspace, 'cache');
  write(join(cache, 'controlled/dependency.pom'), '<project/>');
  write(join(cache, 'controlled/dependency.jar'), 'SYNTHETIC BINARY; NOT SOURCE CLOSURE');
  const modules = [CLOUD_CORE_MODULE, MODELING_CORE_MODULE, SAAS_MODULE, RUNNER_MODULE, additionalReactor,
    'libs/ibiz-model-util', 'libs/ibiz-psmodel-runtime', ...deployments.map(item => item.module)];
  write(join(source, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion>' +
    '<groupId>cn.ibizlab.plugin</groupId><artifactId>ibiz-service-hub</artifactId>' +
    '<version>8.1.0.584.1</version><packaging>pom</packaging>' +
    `<modules>${modules.map(module => `<module>${module}</module>`).join('')}</modules></project>`);
  for (const module of modules) {
    write(join(source, module, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion>' +
      '<groupId>cn.ibizlab.plugin</groupId>' +
      `<artifactId>${basename(module)}</artifactId><version>8.1.0.584.1</version></project>`);
  }
  const addSource = (module, name) => write(
    join(source, module, 'src/test/java', `${name.replaceAll('.', '/')}.java`),
    `// Synthetic source fixture for ${name}; no actual Java tests executed.\n`);
  fullSuites.forEach(name => addSource(MODELING_CORE_MODULE, name));
  addSource(CLOUD_CORE_MODULE, cloudCore);
  addSource(SAAS_MODULE, saas);
  addSource(RUNNER_MODULE, runner);
  for (const item of placeholderXml()) addSource(item.path.split('/target/')[0], basename(item.path).slice(5, -4));
  write(join(source, MODELING_CORE_MODULE, 'src/main/java/Controlled.java'), '// immutable fixture\n');
  // Original generated output is retained and must never seed the worktree.
  write(join(source, GENERATED_DEPLOYMENT_ARCHIVES[0]), 'ORIGINAL ARCHIVE SENTINEL');
  write(join(source, MODELING_CORE_MODULE, 'target/stale-output.jar'), 'ORIGINAL TARGET SENTINEL');
  const image = options => {
    fs.writeSync(options.stdio[1], JSON.stringify({
      Id: `sha256:${'1'.repeat(64)}`, Os: 'linux', Architecture: 'arm64', RepoDigests: [PINNED_MAVEN_IMAGE],
    }));
    return { status: 0, signal: null };
  };
  const worktreeOf = args => {
    const suffix = ',target=/workspace/ibiz-service-hub';
    return args.find(arg => arg.startsWith('type=bind,source=') && arg.endsWith(suffix))
      .slice('type=bind,source='.length, -suffix.length);
  };
  const permission = runModelingPermissionRegression({
    workspace, source, mavenRepository: cache, output: '.artifacts/permission',
    execute(executable, args, options) {
      if (executable === 'rsync') return spawnSync(executable, args, options);
      if (args[0] === 'image') return image(options);
      const worktree = worktreeOf(args);
  const suites = basename(worktree) === 'focused' ? REQUIRED_PERMISSION_SUITES : fullSuites;
  for (const name of suites) write(
    join(worktree, MODELING_CORE_MODULE, `target/surefire-reports/TEST-${name}.xml`), xml(name));
  write(join(worktree, CLOUD_CORE_MODULE, `target/surefire-reports/TEST-${cloudCore}.xml`), xml(cloudCore, 5));
  fs.writeSync(options.stdio[1], 'CONTROLLED FIXTURE; NO JAVA EXECUTED\n');
      return { status: 0, signal: null };
    },
  });
  assert.equal(permission.report.unitRegression, true, permission.report.errors.join('\n'));
  const output = join(workspace, '.artifacts/package');
  let onBuild = () => {};
  let onCommand = () => {};
  const commands = [];
  const options = {
    workspace, permissionReport: permission.reportPath, output,
    execute(executable, args, options) {
      commands.push({ executable, args });
      const override = onCommand(executable, args, options);
      if (override) return override;
      if (executable === 'rsync') return spawnSync(executable, args, options);
      if (args[0] === 'image') return image(options);
      if (args[0] === 'rm') return { status: 0, signal: null };
      const worktree = worktreeOf(args);
      assert.equal(fs.existsSync(join(worktree, GENERATED_DEPLOYMENT_ARCHIVES[0])), false);
      assert.equal(fs.existsSync(join(worktree, MODELING_CORE_MODULE, 'target')), false);
      packageOutputs(worktree);
      fs.writeSync(options.stdio[1], 'CONTROLLED FIXTURE ONLY; NO JAVA/MAVEN EXECUTED\nBUILD SUCCESS\n');
      return onBuild({ worktree, args, options }) ?? { status: 0, signal: null };
    },
  };
  return {
    workspace, source, cache, output, permission, commands, options,
    run: () => runBackendSourcePackage(options),
    verify: reportPath => verifyBackendSourcePackage({ workspace, reportPath }),
    build: callback => { onBuild = callback; },
    command: callback => { onCommand = callback; },
  };
}

function mutateReport(path, callback) {
  const report = JSON.parse(fs.readFileSync(path, 'utf8'));
  callback(report);
  write(path, `${JSON.stringify(report, null, 2)}\n`);
}

test('isolated package command pins Maven, has no network/shared cache mounts and enables tests', () => {
  const command = backendPackageCommand({
    worktree: '/new/worktree', snapshot: '/new/snapshot', repository: '/new/repository',
    containerName: 'backend-package-00000000-0000-0000-0000-000000000000', uid: 1000, gid: 1000,
  });
  assert.equal(command.executable, 'docker');
  for (const flag of ['--network=none', '--read-only', '--pull=never', '--cap-drop=ALL',
    '-o', '-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false',
    '-Dsurefire.skipAfterFailureCount=0']) assert.ok(command.args.includes(flag));
  assert.ok(command.args.includes(PINNED_MAVEN_IMAGE));
  assert.equal(command.args.at(-1), 'package');
  assert.ok(command.args.includes('runtime,gateway,runner'));
  assert.deepEqual(command.args.filter(arg => arg.startsWith('type=bind,')), [
    'type=bind,source=/new/worktree,target=/workspace/ibiz-service-hub',
    'type=bind,source=/new/snapshot,target=/snapshot,readonly',
    'type=bind,source=/new/repository,target=/maven-repository,readonly',
  ]);
});

test('controlled integrated success verifies archives, XML and unchanged originals without claiming native acceptance', t => {
  const f = fixture(t);
  const originals = fs.readFileSync(join(f.source, GENERATED_DEPLOYMENT_ARCHIVES[0]));
  const result = f.run();
  assert.equal(result.report.status, 'passed-package-and-unit-only', result.report.errors.join('\n'));
  assert.equal(result.report.results.tests, 74);
  assert.deepEqual(result.report.results.modules.map(item => item.tests), [5, 9, 24, 36]);
  assert.equal(result.report.results.placeholders.length, 3);
  assert.ok(result.report.results.placeholders.every(item => item.tests === 0 && item.coverage.includes('none')));
  assert.equal(result.report.packages.archives.length, 3);
  const runtime = result.report.packages.archives.find(item => item.module === 'ibiz-ebsx-runtime');
  assert.equal(runtime.reactorDependencies.length, 2);
  assert.ok(runtime.reactorDependencies.some(item => item.module === additionalReactor));
  assert.equal(runtime.embeddedLibraries.length, 3);
  const extraLibrary = runtime.embeddedLibraries.find(item =>
    item.path.endsWith(`/${basename(additionalReactor)}-8.1.0.584.1.jar`));
  assert.equal(extraLibrary.classification, 'reactor-source');
  assert.deepEqual(extraLibrary.sourcePom, {
    path: `${additionalReactor}/pom.xml`,
    sha256: result.report.packages.coordinates.find(item => item.module === additionalReactor).pomSha256,
    groupId: 'cn.ibizlab.plugin',
    artifactId: basename(additionalReactor),
    version: '8.1.0.584.1',
  });
  assert.deepEqual(extraLibrary.freshTarget, {
    path: `${additionalReactor}/target/${basename(additionalReactor)}-8.1.0.584.1.jar`,
    bytes: extraLibrary.targetBytes,
    sha256: extraLibrary.targetSha256,
  });
  assert.equal(runtime.unknownOwnDependencies.length, 1);
  assert.match(runtime.unknownOwnDependencies[0].evidence, /binary-dependency-only/);
  assert.equal(runtime.unknownOwnDependencies[0].sourcePom, null);
  assert.equal(runtime.unknownOwnDependencies[0].classification, 'unknown-own-binary');
  for (const item of result.report.packages.archives) {
    assert.ok(GENERATED_DEPLOYMENT_ARCHIVES.includes(item.path));
    assert.ok(item.applicationEntries.files > 0);
    const target = result.report.packages.targets.find(target => target.module === item.module);
    assert.notEqual(item.sha256, target.sha256, 'Deployments are repackage archives, not thin target JARs');
  }
  const runtimeArchive = result.report.packages.archives.find(item => item.module === 'ibiz-ebsx-runtime');
  assert.equal(runtimeArchive.relocatedApplicationEntries.length, 1);
  assert.equal(runtimeArchive.relocatedApplicationEntries[0].archivePath,
    'META-INF/spring-configuration-metadata.json');
  for (const field of ['nativeAcceptance', 'sourceClosure', 'acceptedForProduction']) assert.equal(result.report[field], false);
  const verified = f.verify(result.reportPath);
  assert.equal(verified.reportSha256, hash(fs.readFileSync(result.reportPath)));
  assert.deepEqual(fs.readFileSync(join(f.source, GENERATED_DEPLOYMENT_ARCHIVES[0])), originals);
  assert.match(fs.readFileSync(join(f.output, 'package.log'), 'utf8'), /NO JAVA\/MAVEN EXECUTED/);
});

test('zero-test placeholders are preserved without weakening the existing positive-suite parser', () => {
  const parsed = parseBackendSuites(validXml());
  assert.equal(parsed.suites.length, 12);
  assert.equal(parsed.placeholders.length, 3);
  assert.ok(parsed.suites.every(item => item.tests > 0));
});

for (const [name, mutate, pattern] of [
  ['unknown zero suite', xmls => {
    xmls.push({ path: `${SAAS_MODULE}/target/surefire-reports/TEST-controlled.UnknownTest.xml`,
      data: xml('controlled.UnknownTest', 0) });
  }, /Unknown empty suite/],
  ['required suite empty', xmls => { xmls[0].data = xml(fullSuites[0], 0); }, /Unknown empty suite/],
  ['missing placeholder', xmls => { xmls.pop(); }, /placeholder inventory mismatch/],
  ['duplicate placeholder', xmls => { xmls.push(xmls.at(-1)); }, /placeholder inventory mismatch/],
  ['placeholder with hidden testcase', xmls => {
    xmls.at(-1).data = xmls.at(-1).data.replace('</testsuite>', '<testcase name="hidden"/></testsuite>');
  }, /Placeholder contains testcases/],
  ['placeholder wrong identity', xmls => {
    xmls.at(-1).data = xml('controlled.UnrelatedTest', 0);
  }, /Placeholder identity mismatch/],
  ['DTD XML', xmls => { xmls[0].data = '<!DOCTYPE testsuite><testsuite/>'; }, /DTD\/entities/],
  ['counter-only success', xmls => {
    xmls[0].data = xmls[0].data.replace('tests="1"', 'tests="124"');
  }, /testcase count mismatch/],
]) {
  test(`structured XML rejects ${name}`, () => {
    const xmls = validXml();
    mutate(xmls);
    assert.throws(() => parseBackendSuites(xmls), pattern);
  });
}

for (const [name, change, pattern] of [
  ['missing required suite', ({ worktree }) => {
    fs.rmSync(join(worktree, `${MODELING_CORE_MODULE}/target/surefire-reports/TEST-${fullSuites[0]}.xml`));
  }, /suite inventory mismatch/],
  ['skipped required suite', ({ worktree }) => {
    write(join(worktree, `${MODELING_CORE_MODULE}/target/surefire-reports/TEST-${fullSuites[0]}.xml`),
      xml(fullSuites[0], 1, 'skipped'));
  }, /Failures\/errors\/skips/],
  ['failed required suite', ({ worktree }) => {
    write(join(worktree, `${MODELING_CORE_MODULE}/target/surefire-reports/TEST-${fullSuites[0]}.xml`),
      xml(fullSuites[0], 1, 'failure'));
  }, /Failures\/errors\/skips/],
  ['same count renamed modeling testcase', ({ worktree }) => {
    write(join(worktree, `${MODELING_CORE_MODULE}/target/surefire-reports/TEST-${fullSuites[0]}.xml`),
      xml(fullSuites[0]).replace('case0', 'unrelatedCase'));
  }, /do not match permission receipt/],
  ['SaaS count drift', ({ worktree }) => {
    write(join(worktree, `${SAAS_MODULE}/target/surefire-reports/TEST-${saas}.xml`), xml(saas, 23));
  }, /test count mismatch/],
  ['Maven nonzero exit with success-looking outputs', () => ({ status: 1, signal: null }), /Maven package command failed/],
  ['Maven timeout with success-looking outputs', () =>
    ({ status: null, signal: 'SIGTERM', error: new Error('timeout') }), /Maven package command failed/],
  ['dump crash evidence', ({ worktree }) => {
    write(join(worktree, MODELING_CORE_MODULE, 'target/surefire-reports/crash.dumpstream'), 'crash');
  }, /Surefire crash evidence/],
  ['thin target substituted for deployment', ({ worktree }) => {
    fs.copyFileSync(join(worktree, 'ibiz-ebsx-gateway/target/ibiz-ebsx-gateway-8.1.0.584.1.jar'),
      join(worktree, GENERATED_DEPLOYMENT_ARCHIVES[0]));
  }, /Thin target JAR/],
  ['missing deployment', ({ worktree }) => {
    fs.rmSync(join(worktree, GENERATED_DEPLOYMENT_ARCHIVES[1]));
  }, /ENOENT/],
  ['fresh compiled class drift', ({ worktree }) => {
    const item = deployments[0];
    fs.appendFileSync(join(worktree, item.module, 'target/classes', `${item.startClass.replaceAll('.', '/')}.class`), 'drift');
  }, /application files differ/],
  ['fresh resource drift', ({ worktree }) => {
    write(join(worktree, deployments[0].module, 'target/classes/application.yml'), 'changed: true');
  }, /application files differ/],
  ['embedded source-built library drift', ({ worktree }) => {
    fs.appendFileSync(join(worktree, SAAS_MODULE, 'target/ibiz-cloud-saas-core-8.1.0.584.1.jar'), 'drift');
  }, /Embedded source-built module mismatch/],
  ['nonrequired reactor embedded library drift', ({ worktree }) => {
    fs.appendFileSync(join(worktree, additionalReactor, 'target/ibiz-extra-8.1.0.584.1.jar'), 'drift');
  }, /Embedded reactor dependency bytes mismatch/],
  ['missing nonrequired reactor target', ({ worktree }) => {
    fs.rmSync(join(worktree, additionalReactor, 'target'), { recursive: true });
  }, /Embedded reactor dependency has no fresh target/],
]) {
  test(`package gate rejects ${name}`, t => {
    const f = fixture(t);
    f.build(change);
    const result = f.run();
    assert.equal(result.report.status, 'failed');
    assert.ok(result.report.errors.some(error => pattern.test(error)), result.report.errors.join('\n'));
    assert.equal(result.report.sourcePackageVerified, false);
    assert.throws(() => f.verify(result.reportPath));
  });
}

for (const name of ['source', 'snapshot', 'repository', 'cache', 'original-archive']) {
  test(`build rejects ${name} input mutation`, t => {
    const f = fixture(t);
    f.build(({ worktree }) => {
      const file = `${MODELING_CORE_MODULE}/src/main/java/Controlled.java`;
      const path = {
        source: join(worktree, file),
        snapshot: join(f.output, 'snapshot', file),
        repository: join(f.output, 'repository/controlled/dependency.pom'),
        cache: join(f.cache, 'controlled/dependency.pom'),
        'original-archive': join(f.source, GENERATED_DEPLOYMENT_ARCHIVES[0]),
      }[name];
      fs.appendFileSync(path, '\nDRIFT');
    });
    const result = f.run();
    assert.equal(result.report.sourcePackageVerified, false);
    assert.ok(result.report.errors.some(error => /drift/i.test(error)), result.report.errors.join('\n'));
  });
}

test('invalid permission input rejects before any Docker package execution', t => {
  const f = fixture(t);
  mutateReport(f.permission.reportPath, report => { report.stages[0].results.suiteCount = 7; });
  assert.throws(() => f.run(), /receipt mismatch/);
  assert.equal(f.commands.length, 0);
  assert.equal(fs.existsSync(f.output), false);
});

test('stale worktree target cannot be accepted even though source inventory excludes targets', t => {
  const f = fixture(t);
  f.command((executable, args, options) => {
    if (executable !== 'rsync' || args.at(-1) !== `${f.output}/worktree/`) return;
    const result = spawnSync(executable, args, options);
    write(join(f.output, 'worktree', MODELING_CORE_MODULE, 'target/stale.jar'), 'old output');
    return result;
  });
  const result = f.run();
  assert.equal(result.report.sourcePackageVerified, false);
  assert.ok(result.report.errors.some(error => /Stale target outputs/.test(error)));
  assert.equal(f.commands.filter(item => item.executable === 'docker' && item.args[0] === 'run').length, 0);
});

test('rsync failure is retained as failed evidence', t => {
  const f = fixture(t);
  f.command(executable => executable === 'rsync' ? { status: 1, signal: null } : undefined);
  const result = f.run();
  assert.equal(result.report.status, 'failed');
  assert.ok(result.report.errors.some(error => /copy failed/.test(error)));
});

for (const [name, mutate, pattern] of [
  ['skip command flag', report => {
    report.commands.at(-1).args = report.commands.at(-1).args.filter(arg => arg !== '-Dmaven.test.skip=false');
  }, /commands mismatch/],
  ['native promotion', report => { report.nativeAcceptance = true; }, /strictly equal/],
  ['source closure promotion', report => { report.sourceClosure = true; }, /strictly equal/],
  ['forged archive identity', report => { report.packages.archives[0].sha256 = '0'.repeat(64); }, /Archive receipt drift/],
  ['forged XML counts', report => { report.results.tests = 312; }, /result receipt mismatch/],
  ['forged placeholder coverage', report => { report.results.placeholders[0].coverage = 'passed'; }, /result receipt mismatch/],
  ['forged input list', report => { report.sourceInputs.before.entries.pop(); }, /input inventory drift/],
]) {
  test(`verifier rejects ${name}`, t => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.report.sourcePackageVerified, true, result.report.errors.join('\n'));
    mutateReport(result.reportPath, mutate);
    assert.throws(() => f.verify(result.reportPath), pattern);
  });
}

test('verifier rejects changed package log, XML and output bytes', t => {
  const f = fixture(t);
  const result = f.run();
  const log = join(f.output, 'package.log');
  const before = fs.readFileSync(log);
  fs.appendFileSync(log, 'changed');
  assert.throws(() => f.verify(result.reportPath), /Command log drift/);
  write(log, before);
  fs.appendFileSync(join(f.output, 'worktree', GENERATED_DEPLOYMENT_ARCHIVES[0]), 'changed');
  assert.throws(() => f.verify(result.reportPath), /Archive receipt drift/);
});

test('existing artifact destination and symlink ancestors are never overwritten', t => {
  const f = fixture(t);
  fs.mkdirSync(f.output);
  write(join(f.output, 'sentinel'), 'keep');
  assert.throws(() => f.run(), /must not be overwritten/);
  assert.equal(fs.readFileSync(join(f.output, 'sentinel'), 'utf8'), 'keep');
  const real = join(f.workspace, 'real-output');
  fs.mkdirSync(real);
  fs.symlinkSync(real, join(f.workspace, '.artifacts/link'));
  assert.throws(() => runBackendSourcePackage({ ...f.options, output: '.artifacts/link' }), /must not be overwritten/);
});

test('structured ZIP inspection rejects path traversal, duplicate entries and empty files', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'backend-package-zip-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'archive.jar');
  const manifest = { path: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\n\r\n' };
  for (const entries of [
    [manifest, { path: '../escape', data: 'bad' }],
    [manifest, manifest],
  ]) {
    zip(path, entries);
    assert.throws(() => inspectBackendArchive(path), /Unsafe\/duplicate/);
  }
  write(path, '');
  assert.throws(() => inspectBackendArchive(path), /Empty\/oversized/);
});

test('CLI help is executable and does not run Docker', () => {
  const result = spawnSync(process.execPath, [harness, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /permission-report/);
  assert.match(result.stdout, /--verify/);
});
