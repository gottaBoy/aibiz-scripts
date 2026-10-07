import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  auditTaskBytecodeInputs, TASK_OWN_CLASS_PREFIXES, verifyTaskBytecodeAudit, writeTaskBytecodeAudit,
} from '../audit-task-bytecode-inputs.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';

const script = fileURLToPath(new URL('../audit-task-bytecode-inputs.mjs', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const antPath = 'SAPAAS/resources/classes/build.xml';
const ant = [
  '<?xml version="1.0"?>',
  '<project name="SAPAAS" basedir="../.." default="war">',
  '<property name="resources.classes.dir" location="${basedir}/resources/classes"/>',
  '<path id="compile.classpath"><pathelement location="${resources.classes.dir}"/></path>',
  '<target name="compile"><javac srcdir="${src.dir}">',
  '<exclude name="shadow/SA/Duplicate.java"/></javac></target>',
  '<target name="prepare-webapp" depends="compile"><copy todir="${staging.dir}/WEB-INF/classes">',
  '<fileset dir="${resources.classes.dir}" excludes="build.xml,.gitignore"/></copy></target>',
  '<target name="war" depends="prepare-webapp"/></project>',
].join('\n');

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

// Controlled archive contents exercise parsing only; no compiler or Java runs.
function archive(entries) {
  const result = execFileSync('python3', ['-I', '-c', String.raw`
import base64, io, json, sys, warnings, zipfile
warnings.simplefilter("ignore", UserWarning)
output = io.BytesIO()
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for entry in json.load(sys.stdin):
        info = zipfile.ZipInfo(entry["name"])
        if entry.get("symlink"):
            info.create_system = 3
            info.external_attr = 0o120777 << 16
        archive.writestr(info, base64.b64decode(entry["data"]))
sys.stdout.buffer.write(output.getvalue())
`], { input: JSON.stringify(entries.map(({ name, data, symlink }) => ({
    name, symlink, data: Buffer.from(data).toString('base64'),
  }))), maxBuffer: 16 * 1024 * 1024 });
  return result;
}

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'task-bytecode-inputs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(join(root, antPath), ant);
  write(join(root, 'Dockerfile.source'), 'FROM scratch\n');
  write(join(root, 'SAPAAS/src/module/SA/Framework/Action.java'),
    'package SA.Framework; public class Action {}\n');
  write(join(root, 'SAPAAS/lib/vendor.jar'), archive([
    { name: 'org/vendor/External.class', data: 'controlled external class-shaped fixture' },
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\n' },
  ]));
  return root;
}

function save(root) {
  const report = auditTaskBytecodeInputs({ root });
  const reportPath = writeTaskBytecodeAudit(report, join(root, '.artifacts/input-screen/report.json'));
  return { report, reportPath };
}

test('input screen records exact inventories and Ant declarations, never source/native closure', t => {
  const root = fixture(t);
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'passed-input-screen-only');
  assert.deepEqual(report.sourceInputs.before, sourceBuildInputs(root));
  assert.deepEqual(report.sourceInputs.before, report.sourceInputs.after);
  assert.deepEqual(report.counts, {
    looseClasses: 0, archives: 1, archiveClasses: 1, nestedArchives: 0,
    ownArchiveClasses: 0, findings: 0, errors: 0,
  });
  assert.deepEqual(report.ownClassPrefixes, ['SA/', 'net/ibizsys/', 'cn/ibizlab/']);
  assert.deepEqual(report.ownClassPrefixes, TASK_OWN_CLASS_PREFIXES);
  assert.equal(report.ant.input.sha256, hash(Buffer.from(ant)));
  assert.deepEqual(report.ant.declarations.paths[0].elements, [{
    tag: 'pathelement', attributes: { location: '${resources.classes.dir}' },
  }]);
  assert.deepEqual(report.ant.declarations.targets[0].javac[0].excludes,
    [{ name: 'shadow/SA/Duplicate.java' }]);
  assert.deepEqual(report.ant.declarations.targets[1].copies[0].filesets,
    [{ dir: '${resources.classes.dir}', excludes: 'build.xml,.gitignore' }]);
  const compiled = report.archives[0].classes[0];
  assert.equal(compiled.sha256, hash(Buffer.from('controlled external class-shaped fixture')));
  assert.equal(compiled.own, false);
  assert.deepEqual(compiled.sourceCandidates, []);
  assert.equal(report.sourceClosureVerified, false);
  assert.equal(report.compilerBuildInDockerVerified, false);
  assert.equal(report.nativeAcceptance, false);
});

test('loose resource bytecode fails despite candidate source and retains exact entry hashes', t => {
  const root = fixture(t);
  const path = 'SAPAAS/resources/classes/net/ibizsys/psts/web/WebContext.class';
  write(join(root, path), 'controlled own loose bytecode input');
  write(join(root, 'SAPAAS/src/web/net/ibizsys/psts/web/WebContext.java'),
    'package net.ibizsys.psts.web; public class WebContext {}\n');
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'blocked');
  assert.equal(report.counts.looseClasses, 1);
  assert.equal(report.counts.findings, 1);
  assert.equal(report.findings[0].kind, 'unproven-loose-class-input');
  assert.equal(report.findings[0].own, true);
  assert.equal(report.findings[0].input.path, path);
  assert.equal(report.findings[0].input.sha256, hash(Buffer.from('controlled own loose bytecode input')));
  assert.deepEqual(report.findings[0].sourceCandidates.map(entry => entry.path),
    ['SAPAAS/src/web/net/ibizsys/psts/web/WebContext.java']);
});

test('unknown loose classes are unproven instead of silently allowlisted', t => {
  const root = fixture(t);
  write(join(root, 'SAPAAS/resources/classes/other/Unknown.class'), 'unknown fixture');
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'blocked');
  assert.equal(report.findings[0].own, false);
  assert.equal(report.findings[0].kind, 'unproven-loose-class-input');
});

for (const name of [
  'SA/Framework/NoEditableSource.class',
  'net/ibizsys/hidden/Own.class',
  'cn/ibizlab/hidden/Own.class',
  'WEB-INF/classes/net/ibizsys/hidden/Own.class',
  'BOOT-INF/classes/cn/ibizlab/hidden/Own.class',
  'META-INF/versions/9/SA/Framework/NoEditableSource.class',
  'SA/Framework/Action$1.class',
]) {
  test(`own bytecode is detected in renamed archives: ${name}`, t => {
    const root = fixture(t);
    write(join(root, 'SAPAAS/lib/completely-renamed.jar'), archive([
      { name, data: 'controlled own class-shaped fixture' },
    ]));
    const report = auditTaskBytecodeInputs({ root });
    assert.equal(report.status, 'blocked');
    assert.equal(report.counts.ownArchiveClasses, 1);
    assert.equal(report.findings[0].input.path, 'SAPAAS/lib/completely-renamed.jar');
    assert.equal(report.findings[0].entry, name);
    assert.equal(report.findings[0].sha256, hash(Buffer.from('controlled own class-shaped fixture')));
  });
}

test('editable source outside known prefixes detects shaded source-matching bytecode', t => {
  const root = fixture(t);
  write(join(root, 'SAPAAS/src/alternate/com/example/Local.java'),
    'package com.example; public class Local {}\n');
  write(join(root, 'SAPAAS/lib/shaded.jar'), archive([
    { name: 'com/example/Local$Nested.class', data: 'controlled nested class fixture' },
  ]));
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'blocked');
  assert.equal(report.findings[0].ownPrefix, null);
  assert.deepEqual(report.findings[0].sourceCandidates.map(entry => entry.path),
    ['SAPAAS/src/alternate/com/example/Local.java']);
});

test('nested WAR/JAR bytecode retains every archive hop and independent hash', t => {
  const root = fixture(t);
  const jar = archive([{ name: 'SA/Framework/Action.class', data: 'nested own fixture' }]);
  const war = archive([{ name: 'WEB-INF/lib/vendor.jar', data: jar }]);
  write(join(root, 'SAPAAS/lib/renamed.zip'), archive([{ name: 'bundles/hidden.war', data: war }]));
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'blocked');
  assert.equal(report.counts.nestedArchives, 2);
  assert.deepEqual(report.findings[0].archiveChain, ['bundles/hidden.war', 'WEB-INF/lib/vendor.jar']);
  assert.equal(report.archives.find(item => item.input.path.endsWith('renamed.zip'))
    .nestedArchives[1].sha256, hash(jar));
  assert.deepEqual(report.findings[0].sourceCandidates.map(entry => entry.path),
    ['SAPAAS/src/module/SA/Framework/Action.java']);
});

for (const [label, entries] of [
  ['duplicate names', [{ name: 'org/vendor/External.class', data: 'a' },
    { name: 'org/vendor/External.class', data: 'b' }]],
  ['path traversal', [{ name: '../SA/Framework/Own.class', data: 'a' }]],
  ['absolute paths', [{ name: '/SA/Framework/Own.class', data: 'a' }]],
  ['Windows path separators', [{ name: 'SA\\Framework\\Own.class', data: 'a' }]],
  ['ambiguous hop delimiters', [{ name: 'lib!evil.jar', data: 'a' }]],
  ['archive symlinks', [{ name: 'lib.jar', data: 'elsewhere', symlink: true }]],
  ['empty class entries', [{ name: 'org/vendor/Empty.class', data: '' }]],
  ['malformed nested JAR', [{ name: 'nested/vendor.jar', data: 'not an archive' }]],
]) {
  test(`archive errors fail closed: ${label}`, t => {
    const root = fixture(t);
    write(join(root, 'SAPAAS/lib/broken.jar'), archive(entries));
    const report = auditTaskBytecodeInputs({ root });
    assert.equal(report.status, 'blocked');
    assert.equal(report.counts.errors, 1);
    assert.equal(report.errors[0].path, 'SAPAAS/lib/broken.jar');
    assert.match(report.errors[0].message, /Invalid archive input/);
  });
}

test('non-ZIP archive bytes are rejected, not ignored by dependency filename', t => {
  const root = fixture(t);
  write(join(root, 'SAPAAS/lib/vendor.jar'), 'not ZIP');
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'blocked');
  assert.equal(report.counts.errors, 1);
});

test('nested archive depth limit fails closed', t => {
  const root = fixture(t);
  let content = archive([{ name: 'org/vendor/External.class', data: 'fixture' }]);
  for (let index = 0; index < 5; index++) content = archive([{ name: 'nested.jar', data: content }]);
  write(join(root, 'SAPAAS/lib/deep.jar'), content);
  const report = auditTaskBytecodeInputs({ root });
  assert.equal(report.status, 'blocked');
  assert.match(report.errors[0].message, /depth limit/);
});

for (const [label, content] of [
  ['malformed XML', '<project>'],
  ['wrong root schema', '<other/>'],
  ['DTD declarations', '<!DOCTYPE project [<!ENTITY x "input">]>' + ant],
  ['duplicate targets', ant.replace('</project>', '<target name="war"/></project>')],
  ['missing compilation target', ant.replace('name="compile"', 'name="renamed"')],
]) {
  test(`Ant descriptor rejects ${label}`, t => {
    const root = fixture(t);
    write(join(root, antPath), content);
    const report = auditTaskBytecodeInputs({ root });
    assert.equal(report.status, 'blocked');
    assert.equal(report.counts.errors, 1);
  });
}

test('missing Ant descriptor or editable Java cannot yield an empty clean audit', t => {
  const root = fixture(t);
  fs.rmSync(join(root, antPath));
  assert.match(auditTaskBytecodeInputs({ root }).errors[0].message, /descriptor is missing/);
  write(join(root, antPath), ant);
  fs.rmSync(join(root, 'SAPAAS/src'), { recursive: true });
  assert.match(auditTaskBytecodeInputs({ root }).errors[0].message, /Java source is missing/);
});

test('source and archive symlinks are rejected without invoking parsers', t => {
  const root = fixture(t);
  fs.symlinkSync('vendor.jar', join(root, 'SAPAAS/lib/link.jar'));
  const commands = [];
  const report = auditTaskBytecodeInputs({ root, execute: (...args) => {
    commands.push(args);
    return spawnSync(...args);
  } });
  assert.equal(report.status, 'blocked');
  assert.match(report.errors[0].message, /Symlink source input rejected/);
  assert.equal(commands.length, 0);
});

test('source edits during archive parsing cannot bind to the original fingerprint', t => {
  const root = fixture(t);
  const report = auditTaskBytecodeInputs({ root, execute: (command, args, options) => {
    const result = spawnSync(command, args, options);
    if (args.at(-1) === 'archive') {
      write(join(root, 'SAPAAS/src/module/SA/Framework/Action.java'), 'changed during scan\n');
    }
    return result;
  } });
  assert.equal(report.status, 'blocked');
  assert.match(report.errors[0].message, /Source inputs changed during bytecode audit/);
  assert.notEqual(report.sourceInputs.before.fingerprint, report.sourceInputs.after.fingerprint);
});

test('replaced archive bytes fail pinned digest verification before parsing', t => {
  const root = fixture(t);
  const report = auditTaskBytecodeInputs({ root, execute: (command, args, options) => {
    const result = spawnSync(command, args, options);
    if (args.at(-1) === 'ant') write(join(root, 'SAPAAS/lib/vendor.jar'), 'replaced');
    return result;
  } });
  assert.equal(report.status, 'blocked');
  assert.ok(report.errors.some(error => /Input (?:size|bytes) changed/.test(error.message)));
});

test('missing parser or failed process cannot become a clean screen', t => {
  const root = fixture(t);
  for (const result of [
    { status: 17, stderr: 'parser failed' }, { status: null, signal: 'SIGTERM' },
    { status: null, error: new Error('ENOENT') },
  ]) {
    const report = auditTaskBytecodeInputs({ root, execute: () => result });
    assert.equal(report.status, 'blocked');
    assert.equal(report.counts.errors, 1);
  }
});

test('blocked bytecode evidence is replayable but never becomes closure acceptance', t => {
  const root = fixture(t);
  write(join(root, 'SAPAAS/resources/classes/net/ibizsys/Own.class'), 'controlled own fixture');
  const { report, reportPath } = save(root);
  const verified = verifyTaskBytecodeAudit({ reportPath });
  assert.equal(verified.status, 'blocked');
  assert.deepEqual(verified.counts, report.counts);
  assert.equal(verified.reportSha256, hash(fs.readFileSync(reportPath)));
  assert.equal(verified.nativeAcceptance, false);
});

test('passing input screen is independently replayed without running Docker or compilers', t => {
  const root = fixture(t);
  const { reportPath } = save(root);
  const commands = [];
  const verified = verifyTaskBytecodeAudit({ reportPath, execute: (command, args, options) => {
    commands.push([command, args.at(-1)]);
    return spawnSync(command, args, options);
  } });
  assert.equal(verified.status, 'passed-input-screen-only');
  assert.deepEqual(commands, [['python3', 'ant'], ['python3', 'archive']]);
});

for (const [label, mutate, expected] of [
  ['Java source', root => write(join(root, 'SAPAAS/src/module/SA/Framework/Action.java'), 'drift'),
    /Recorded source inputs drifted/],
  ['loose bytecode', root => write(join(root, 'SAPAAS/resources/classes/added/Own.class'), 'drift'),
    /Recorded source inputs drifted/],
  ['dependency archive', root => write(join(root, 'SAPAAS/lib/vendor.jar'), 'drift'),
    /Recorded source inputs drifted/],
  ['Ant descriptor', root => write(join(root, antPath), ant + '\n<!-- drift -->'),
    /Recorded source inputs drifted/],
]) {
  test(`receipt verifier rejects post-recording ${label} drift`, t => {
    const root = fixture(t);
    const { reportPath } = save(root);
    mutate(root);
    assert.throws(() => verifyTaskBytecodeAudit({ reportPath }), expected);
  });
}

for (const [label, mutate, expected] of [
  ['native promotion', report => { report.nativeAcceptance = true; }, /native acceptance/],
  ['source closure promotion', report => { report.sourceClosureVerified = true; }, /source closure/],
  ['compiler promotion', report => { report.compilerBuildInDockerVerified = true; }, /compiler execution/],
  ['forged counts', report => { report.counts.archiveClasses = 99; }, /independently replayed inputs/],
  ['forged class hash', report => { report.archives[0].classes[0].sha256 = '0'.repeat(64); },
    /independently replayed inputs/],
  ['missing archive inventory', report => { report.archives = []; }, /independently replayed inputs/],
  ['missing post-audit inventory', report => { delete report.sourceInputs.after; }, /post-audit inputs/],
  ['changed contract', report => { report.contract = 'claimed-ready'; }, /contract/],
]) {
  test(`receipt verifier rejects ${label}`, t => {
    const root = fixture(t);
    const { report, reportPath } = save(root);
    mutate(report);
    write(reportPath, JSON.stringify(report));
    assert.throws(() => verifyTaskBytecodeAudit({ reportPath }), expected);
  });
}

test('verifier rejects failed/incomplete archive evidence even if errors are removed', t => {
  const root = fixture(t);
  write(join(root, 'SAPAAS/lib/vendor.jar'), 'invalid archive');
  const { report, reportPath } = save(root);
  report.errors = [];
  report.status = 'passed-input-screen-only';
  write(reportPath, JSON.stringify(report));
  assert.throws(() => verifyTaskBytecodeAudit({ reportPath }), /incomplete bytecode audit evidence/);
});

test('report replacement during independent replay is rejected', t => {
  const root = fixture(t);
  const { reportPath } = save(root);
  assert.throws(() => verifyTaskBytecodeAudit({ reportPath, execute: (command, args, options) => {
    const result = spawnSync(command, args, options);
    fs.appendFileSync(reportPath, ' ');
    return result;
  } }), /report changed during verification/);
});

test('reports are exclusive and symlink destinations/readers are rejected', t => {
  const root = fixture(t);
  const { report, reportPath } = save(root);
  assert.throws(() => writeTaskBytecodeAudit(report, reportPath), /EEXIST/);
  fs.symlinkSync(reportPath, join(root, '.artifacts/link.json'));
  assert.throws(() => verifyTaskBytecodeAudit({ reportPath: join(root, '.artifacts/link.json') }),
    /Symlink resource rejected/);
  fs.symlinkSync(join(root, '.artifacts'), join(root, 'redirect'));
  assert.throws(() => writeTaskBytecodeAudit(report, join(root, 'redirect/new.json')), /Symlink directory/);
});

test('CLI preserves blocked findings and returns nonzero on replay, help is side-effect free', t => {
  const root = fixture(t);
  const help = spawnSync(process.execPath, [script, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.equal(fs.existsSync(join(root, '.artifacts')), false);
  write(join(root, 'SAPAAS/resources/classes/net/ibizsys/Own.class'), 'fixture');
  const reportPath = join(root, '.artifacts/run/report.json');
  const run = spawnSync(process.execPath, [script, '--root', root, '--output', reportPath], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 1, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.counts.findings, 1);
  assert.equal(output.reportPath, resolve(reportPath));
  const verify = spawnSync(process.execPath, [script, '--verify', reportPath], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(verify.status, 1, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).status, 'blocked');
  const repeat = spawnSync(process.execPath, [script, '--root', root, '--output', reportPath], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(repeat.status, 1);
  assert.match(repeat.stderr, /EEXIST/);
});
