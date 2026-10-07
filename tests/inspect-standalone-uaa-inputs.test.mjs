import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  EXTRACTED_ROOT, inspectStandaloneUaaInputs, OUTER_JAR, OUTPUT_ROOT, OWN_JARS,
  verifyStandaloneUaaInventory, writeStandaloneUaaInventory,
} from '../inspect-standalone-uaa-inputs.mjs';

const script = fileURLToPath(new URL('../inspect-standalone-uaa-inputs.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const secret = 'CONTROLLED-SECRET-NEVER-IN-REPORT';
const classBytes = 'controlled class-shaped fixture, not compiled source';
const write = (path, data) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
};

// Standard-library ZIP fixtures exercise rosters only, never Java or a service.
function zip(entries) {
  return execFileSync('python3', ['-I', '-c', String.raw`
import base64, io, json, stat, sys, warnings, zipfile
warnings.simplefilter("ignore", UserWarning)
output = io.BytesIO()
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for entry in json.load(sys.stdin):
        info = zipfile.ZipInfo(entry["path"])
        info.compress_type = zipfile.ZIP_DEFLATED
        if entry.get("symlink"):
            info.create_system = 3
            info.external_attr = stat.S_IFLNK << 16
        archive.writestr(info, base64.b64decode(entry["data"]))
sys.stdout.buffer.write(output.getvalue())
`], { input: JSON.stringify(entries.map(({ path, data = '', symlink }) => ({
    path, symlink, data: Buffer.from(data).toString('base64'),
  }))), maxBuffer: 16 * 1024 * 1024 });
}

function maven({ artifactId, groupId, version }, overrides = {}) {
  const root = `META-INF/maven/${groupId}/${artifactId}`;
  return [
    { path: `${root}/pom.xml`, data: overrides.pom ?? [
      '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>',
      `<parent><groupId>${groupId}</groupId><artifactId>fixture-parent</artifactId><version>${version}</version></parent>`,
      `<artifactId>${artifactId}</artifactId>`,
      '<scm><url>https://example.invalid/unverified-source</url>',
      `<connection>scm:git:https://fixture:${secret}@example.invalid/private</connection></scm>`,
      `<properties><secret>${secret}</secret></properties>`,
      '<dependencies><dependency><groupId>org.fixture</groupId><artifactId>dependency</artifactId>',
      '<version>${project.version}</version><scope>compile</scope></dependency></dependencies></project>',
    ].join('') },
    { path: `${root}/pom.properties`, data: overrides.properties ??
      `# comment ${secret}\ngroupId=${groupId}\nartifactId=${artifactId}\nversion=${version}\nprivate.secret=${secret}\n` },
  ];
}

function fixture(t, { nestedChange = () => {}, outerChange = () => {} } = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'standalone-uaa-inputs-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const blobs = [];
  const contents = [];
  for (const [index, item] of OWN_JARS.entries()) {
    const entries = [
      { path: 'META-INF/', data: '' },
      { path: 'cn/ibizlab/Shared.class', data: index < 2 ? classBytes : `controlled distinct class ${index}` },
      { path: `cn/ibizlab/${item.artifactId}/Outer.class`, data: classBytes },
      { path: `cn/ibizlab/${item.artifactId}/Outer$Nested.class`, data: classBytes },
      { path: 'mapper/auth/AuthMapper.xml', data: '<mapper namespace="controlled-fixture"/>' },
      { path: 'application.yml', data: `password: ${secret}` },
      { path: 'keypair/private.pem', data: secret },
      ...maven(item),
    ];
    nestedChange(entries, item, index);
    const bytes = zip(entries);
    blobs.push(bytes);
    contents.push(entries);
    write(join(workspace, EXTRACTED_ROOT, item.filename), bytes);
  }
  const outer = [
    { path: 'BOOT-INF/', data: '' },
    { path: 'BOOT-INF/classes/cn/ibizlab/Shared.class', data: classBytes },
    { path: 'BOOT-INF/classes/cn/ibizlab/BootApplication.class', data: classBytes },
    { path: 'org/springframework/boot/loader/JarLauncher.class', data: 'controlled third-party fixture' },
    { path: 'BOOT-INF/classes/application-api.yml', data: `credentials: ${secret}` },
    { path: 'BOOT-INF/classes/static/index.html', data: '<html>controlled static fixture</html>' },
    { path: 'BOOT-INF/lib/third-party.jar', data: zip([
      { path: 'org/fixture/NotInOwnRoster.class', data: 'controlled dependency fixture' },
    ]) },
    ...OWN_JARS.map((item, index) => ({ path: `BOOT-INF/lib/${item.filename}`, data: blobs[index] })),
    ...maven({ groupId: 'cn.ibizlab', artifactId: 'uaa-api', version: '2.0.0-SNAPSHOT' }),
  ];
  outerChange(outer);
  const outerBytes = zip(outer);
  write(join(workspace, OUTER_JAR), outerBytes);
  return { workspace, blobs, contents, outer, outerBytes };
}

function inspect(fixture, options = {}) {
  return inspectStandaloneUaaInputs({ workspace: fixture.workspace, ...options });
}

test('exact ZIP class/resource/Maven rosters observe five inputs without readiness promotion', t => {
  const data = fixture(t);
  const report = inspect(data);
  assert.deepEqual(report.errors, []);
  assert.equal(report.status, 'observed-inputs-only');
  assert.equal(report.target, 'uaa-standalone-sys-person');
  assert.equal(report.inputs.length, 5);
  assert.equal(report.inputs[0].sha256, hash(data.outerBytes));
  for (const field of ['readinessPromoted', 'originalSourceRecovered', 'sourceAuthenticityVerified',
    'sourceClosureVerified', 'compilerBuildVerified', 'nativeAcceptance', 'acceptedForProduction']) {
    assert.equal(report[field], false, field);
  }
  assert.deepEqual(report.counts, {
    jars: 5, classes: 15, ownClasses: 14, resources: 24,
    exactNestedBindings: 4, ownClassDuplicates: 1, innerClasses: 4, errors: 0,
  });
  const outer = report.archives[0];
  assert.deepEqual(outer.zipEntries.map(item => item.path), data.outer.map(item => item.path).sort());
  assert.deepEqual(outer.classes.map(item => item.path), data.outer.filter(item =>
    item.path.endsWith('.class')).map(item => item.path).sort());
  assert.deepEqual(outer.resources.map(item => item.path), data.outer.filter(item =>
    !item.path.endsWith('/') && !item.path.endsWith('.jar') && !item.path.endsWith('.class'))
    .map(item => item.path).sort());
  assert.equal(report.archives.flatMap(item => item.classes).some(item =>
    item.binaryName === 'org.fixture.NotInOwnRoster'), false, 'No third-party nested expansion');
  for (const [index, archive] of report.archives.slice(1).entries()) {
    assert.deepEqual(archive.zipEntries.map(item => item.path), data.contents[index].map(item => item.path).sort());
    assert.equal(archive.input.sha256, hash(data.blobs[index]));
    assert.deepEqual(archive.maven.coordinates, {
      groupId: OWN_JARS[index].groupId, artifactId: OWN_JARS[index].artifactId, version: OWN_JARS[index].version,
    });
    assert.equal(archive.maven.coordinatesMatch, true);
    for (const kind of ['pom', 'properties']) {
      const original = data.contents[index].find(item => item.path === archive.maven[kind].path);
      assert.equal(archive.maven[kind].sha256, hash(Buffer.from(original.data)));
    }
    assert.equal(archive.sourceLookup.originalSourceRecovered, false);
    assert.match(archive.sourceLookup.expectedSourceArchive, /-sources\.jar$/);
    assert.equal(archive.parentSourceLookup.state, 'lookup-clues-only-not-authenticated-source');
    assert.deepEqual(archive.maven.dependencies, [{
      groupId: 'org.fixture', artifactId: 'dependency', version: '${project.version}',
      scope: 'compile', type: null, classifier: null,
    }]);
  }
});

test('published starter source handoff is exact-coordinate lookup evidence, not source recovery', t => {
  const report = inspect(fixture(t));
  const expected = [
    'fd8ea741daf620cb2f263bd134350e8cd81b938df35108f44119068978993f75',
    '87d45ef2cde4709686d623845a0d4e2685a3c59dc964417eebf25bcb85e94a37',
  ];
  for (const archive of report.archives.slice(0, 3)) {
    assert.equal('publishedSourceHandoff' in archive.sourceLookup, false);
  }
  for (const [index, archive] of report.archives.slice(3).entries()) {
    assert.deepEqual(archive.sourceLookup.publishedSourceHandoff, {
      repository: 'Maven Central', claimedSha256: expected[index],
      evidence: 'main-thread-source-acquisition-handoff', verifiedByThisInventory: false,
    });
    assert.equal(archive.sourceLookup.sourceJarObserved, false);
    assert.equal(archive.sourceLookup.originalSourceRecovered, false);
    assert.equal('publishedSourceHandoff' in archive.parentSourceLookup, false);
  }
  assert.match(report.sourceIdentityBoundary, /ibiz-cloud-uaa.*do not establish standalone/);
  assert.equal(report.sourceAuthenticityVerified, false);
  assert.equal(report.sourceClosureVerified, false);
});

test('resource/descriptor secrets and credential-bearing lookup URLs never appear in report', t => {
  const report = inspect(fixture(t));
  assert.equal(report.status, 'observed-inputs-only');
  assert.equal(JSON.stringify(report).includes(secret), false);
  const resources = report.archives.flatMap(item => item.resources);
  assert.ok(resources.some(item => item.path === 'keypair/private.pem'));
  assert.ok(resources.every(item => !('content' in item) && !('text' in item) && !('data' in item)));
  assert.deepEqual(report.archives[0].maven.declaredSourceLookupUrls, [
    { field: 'scm/url', state: 'unverified-declared-url', url: 'https://example.invalid/unverified-source' },
    { field: 'scm/connection', state: 'withheld-nonpublic-url' },
  ]);
});

test('own class duplicates include outer/nested occurrences and distinguish conflicting bytes', t => {
  const report = inspect(fixture(t));
  const duplicate = report.ownClassDuplicates[0];
  assert.equal(duplicate.identity, 'cn.ibizlab.Shared@base');
  assert.equal(duplicate.locations.length, 5);
  assert.equal(duplicate.identicalBytes, false);
  assert.equal(duplicate.locations[0].archive, 'uaa-api');
  assert.equal(duplicate.locations[1].sha256, duplicate.locations[2].sha256);
  assert.ok(report.innerClasses.every(item => item.outerPresentInSameArchive));
  assert.ok(report.innerClasses.every(item => item.evidence.includes('heuristic')));
  assert.equal(report.archives[1].classes.find(item => item.binaryName.endsWith('$Nested'))
    .inferredSourcePath, 'cn/ibizlab/uaa-core/Outer.java');
});

test('missing enclosing class is retained as an acquisition clue, not silently declared present', t => {
  const report = inspect(fixture(t, { nestedChange(entries, _item, index) {
    if (index === 0) entries.splice(entries.findIndex(item => item.path.endsWith('/Outer.class')), 1);
  } }));
  assert.equal(report.status, 'observed-inputs-only');
  assert.equal(report.innerClasses.find(item => item.archive === 'uaa-core').outerPresentInSameArchive, false);
});

test('multi-release variants do not become base-class duplicate identities', t => {
  const report = inspect(fixture(t, { nestedChange(entries, _item, index) {
    if (index === 0) entries.push({
      path: 'META-INF/versions/11/cn/ibizlab/Shared.class', data: 'controlled Java 11 variant',
    });
  } }));
  assert.equal(report.status, 'observed-inputs-only');
  assert.equal(report.ownClassDuplicates.length, 1);
  assert.equal(report.archives[1].classes.find(item => item.release === 11).binaryName, 'cn.ibizlab.Shared');
});

for (const [label, entries] of [
  ['duplicate entry names', [{ path: 'cn/ibizlab/Repeated.class', data: 'one' },
    { path: 'cn/ibizlab/Repeated.class', data: 'two' }]],
  ['path traversal', [{ path: '../Own.class', data: 'fixture' }]],
  ['absolute path', [{ path: '/Own.class', data: 'fixture' }]],
  ['backslash path', [{ path: 'cn\\ibizlab\\Own.class', data: 'fixture' }]],
  ['ambiguous archive delimiter', [{ path: 'own!entry.class', data: 'fixture' }]],
  ['symlink entry', [{ path: 'linked.class', data: 'elsewhere', symlink: true }]],
  ['empty class', [{ path: 'cn/ibizlab/Empty.class', data: '' }]],
  ['unexpected nested own archive', [{ path: 'hidden.jar', data: zip([]) }]],
]) {
  test(`malformed/ambiguous archive fails closed: ${label}`, t => {
    const report = inspect(fixture(t, { nestedChange(items, _item, index) {
      if (index === 0) items.push(...entries);
    } }));
    assert.equal(report.status, 'incomplete-input-observation');
    assert.equal(report.errors.length, 1);
    assert.equal(report.nativeAcceptance, false);
  });
}

for (const label of ['missing nested JAR', 'wrong extracted bytes', 'missing extracted JAR', 'wrong version']) {
  test(`exact own identities reject ${label}`, t => {
    const data = fixture(t, { outerChange(entries) {
      if (label === 'missing nested JAR') entries.splice(entries.findIndex(item =>
        item.path === `BOOT-INF/lib/${OWN_JARS[0].filename}`), 1);
    }, nestedChange(entries, item, index) {
      if (label === 'wrong version' && index === 0) {
        const root = `META-INF/maven/${item.groupId}/${item.artifactId}`;
        entries.splice(entries.findIndex(entry => entry.path === `${root}/pom.xml`), 1);
        entries.splice(entries.findIndex(entry => entry.path === `${root}/pom.properties`), 1);
        entries.push(...maven({ ...item, version: '0.0.0-WRONG' }));
      }
    } });
    const extracted = join(data.workspace, EXTRACTED_ROOT, OWN_JARS[0].filename);
    if (label === 'wrong extracted bytes') write(extracted, zip([{ path: 'different.txt', data: 'fixture' }]));
    if (label === 'missing extracted JAR') fs.rmSync(extracted);
    const report = inspect(data);
    assert.equal(report.status, 'incomplete-input-observation');
    assert.equal(report.errors.length, 1);
  });
}

for (const [label, change] of [
  ['POM/properties version mismatch', entries => {
    const item = entries.find(item => item.path.endsWith('/pom.properties'));
    item.data = item.data.replace('version=2.0.0-SNAPSHOT', 'version=1.0.0');
  }],
  ['duplicate coordinate fields', entries => {
    entries.find(item => item.path.endsWith('/pom.properties')).data += '\nartifactId=other\n';
  }],
  ['missing metadata pair', entries => entries.splice(entries.findIndex(item => item.path.endsWith('/pom.xml')), 1)],
  ['multiple metadata pairs', entries => entries.push(...maven({
    artifactId: 'another', groupId: 'cn.ibizlab', version: '1.0.0',
  }))],
  ['DTD/XXE', entries => {
    entries.find(item => item.path.endsWith('/pom.xml')).data =
      '<!DOCTYPE project [<!ENTITY stolen SYSTEM "file:///etc/passwd">]><project>&stolen;</project>';
  }],
  ['malformed XML', entries => { entries.find(item => item.path.endsWith('/pom.xml')).data = '<project>'; }],
]) {
  test(`Maven receipts reject ${label}`, t => {
    const report = inspect(fixture(t, { nestedChange(entries, _item, index) {
      if (index === 0) change(entries);
    } }));
    assert.equal(report.status, 'incomplete-input-observation');
    assert.equal(report.errors.length, 1);
    assert.equal(JSON.stringify(report).includes(secret), false);
  });
}

test('input symlinks and non-ZIP bytes cannot yield an observed roster', t => {
  const data = fixture(t);
  const path = join(data.workspace, EXTRACTED_ROOT, OWN_JARS[0].filename);
  fs.rmSync(path);
  fs.symlinkSync(join(data.workspace, EXTRACTED_ROOT, OWN_JARS[1].filename), path);
  assert.match(inspect(data).errors[0].message, /Non-regular JAR/);
  fs.rmSync(path);
  write(path, data.blobs[0]);
  write(join(data.workspace, OUTER_JAR), 'not an archive');
  assert.match(inspect(data).errors[0].message, /Invalid archive observation/);
});

test('input drift during parsing is rejected despite the original extracted binding', t => {
  const data = fixture(t);
  const report = inspect(data, { execute(...args) {
    const result = spawnSync(...args);
    write(join(data.workspace, EXTRACTED_ROOT, OWN_JARS[0].filename), 'changed during parsing');
    return result;
  } });
  assert.equal(report.status, 'incomplete-input-observation');
  assert.match(report.errors[0].message, /drifted/);
});

test('artifact reports are hashed, read-only, exclusive and independently replayable', t => {
  const data = fixture(t);
  const before = [OUTER_JAR, ...OWN_JARS.map(item => `${EXTRACTED_ROOT}/${item.filename}`)]
    .map(path => ({ path, sha256: hash(fs.readFileSync(join(data.workspace, path))) }));
  const report = inspect(data);
  const output = join(data.workspace, OUTPUT_ROOT, 'controlled-run');
  const receipt = writeStandaloneUaaInventory(report, { output });
  const bytes = fs.readFileSync(receipt.reportPath);
  assert.equal(receipt.reportSha256, hash(bytes));
  assert.equal(fs.readFileSync(join(output, 'report.sha256'), 'utf8'), `${hash(bytes)}\n`);
  assert.equal(fs.statSync(receipt.reportPath).mode & 0o777, 0o444);
  assert.equal(verifyStandaloneUaaInventory(receipt).status, 'observed-inputs-only');
  assert.throws(() => writeStandaloneUaaInventory(report, { output }), /Existing destination/);
  assert.throws(() => writeStandaloneUaaInventory(report, { output: data.workspace }), /Output must/);
  assert.throws(() => writeStandaloneUaaInventory(report, { output: join(data.workspace, OUTPUT_ROOT) }), /Output must/);
  for (const entry of before) assert.equal(hash(fs.readFileSync(join(data.workspace, entry.path))), entry.sha256);
  const external = fs.mkdtempSync(join(tmpdir(), 'uaa-artifact-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, join(data.workspace, OUTPUT_ROOT, 'linked'));
  assert.throws(() => writeStandaloneUaaInventory(report, {
    output: join(data.workspace, OUTPUT_ROOT, 'linked/run'),
  }), /Symlink directory/);
  assert.equal(fs.existsSync(join(external, 'run')), false);
});

for (const [label, mutate] of [
  ['readiness promotion', report => { report.readinessPromoted = true; }],
  ['source recovery claim', report => { report.originalSourceRecovered = true; }],
  ['native acceptance claim', report => { report.nativeAcceptance = true; }],
  ['omitted class roster', report => { report.archives[1].classes = []; }],
  ['forged binding', report => { report.nestedBindings[0].entry.sha256 = '0'.repeat(64); }],
]) {
  test(`replay rejects refreshed report hash with ${label}`, t => {
    const data = fixture(t);
    const report = inspect(data);
    mutate(report);
    const receipt = writeStandaloneUaaInventory(report);
    assert.throws(() => verifyStandaloneUaaInventory(receipt), /differs from current inputs or boundary/);
  });
}

test('verification rejects post-observation artifact drift and stale report digests', t => {
  const data = fixture(t);
  const receipt = writeStandaloneUaaInventory(inspect(data));
  write(join(data.workspace, EXTRACTED_ROOT, OWN_JARS[0].filename), 'new bytes');
  assert.throws(() => verifyStandaloneUaaInventory(receipt), /incomplete archive observation/);
  fs.chmodSync(receipt.reportPath, 0o600);
  write(receipt.reportPath, '{}\n');
  assert.throws(() => verifyStandaloneUaaInventory(receipt), /Report hash differs/);
});

test('CLI writes a unique artifact and exits zero only for completed observations, not readiness', t => {
  const data = fixture(t);
  const args = ['--workspace', data.workspace, '--output', `${OUTPUT_ROOT}/cli-run`];
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.nativeAcceptance, false);
  assert.equal(receipt.readinessPromoted, false);
  const verified = spawnSync(process.execPath, [script, '--verify', receipt.reportPath], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }).status, 1);
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not readiness or native acceptance/);
  assert.equal(spawnSync(process.execPath, [script, '--promote'], { encoding: 'utf8' }).status, 1);
  fs.rmSync(join(data.workspace, OUTER_JAR));
  const missing = spawnSync(process.execPath, [script, '--workspace', data.workspace], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).status, 'incomplete-input-observation');
});
