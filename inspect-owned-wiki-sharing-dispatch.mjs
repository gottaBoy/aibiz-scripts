#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { repairGeneratedWikiSharingSource, wikiDispatchTargets } from './repair-generated-wiki-sharing-dispatch.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const receiptPath = '.artifacts/plm-publication-provider-candidate-20261123-r4/report.private.json';
const receiptHash = '57b4be760a3f0ec4e90d14fa851bee318ad337206b65fe5df74fa2fbabe65b24';
const javaHash = '0cd543f9949605b5eccb1d2b98c2b8637bb0953f0b5087208393b4b7ded73c1a';
const entityPath = 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json';
const sources = [
  'scripts/inspect-owned-wiki-sharing-dispatch.mjs',
  'scripts/repair-generated-wiki-sharing-dispatch.mjs',
  'scripts/tests/inspect-owned-wiki-sharing-dispatch.test.mjs',
  'scripts/tests/repair-generated-wiki-sharing-dispatch.test.mjs',
  'scripts/fixtures/OwnedWikiSharingDispatchProbe.groovy',
  entityPath,
  ...wikiDispatchTargets.flatMap(target => [target.sourcePath, target.modelPath]),
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function readRegular(filename) {
  assert.equal(fs.realpathSync(filename), path.resolve(filename));
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && before.nlink === 1 && before.size < 64 * 1024 * 1024);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(fd);
    for (const after of [fs.fstatSync(fd), fs.lstatSync(filename)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

function write(directory, relative, bytes) {
  assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
  const filename = path.join(directory, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o600 });
  return { path: relative, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
}

export function inspectOwnedWikiSharingDispatch({ output }) {
  const directory = path.resolve(output);
  assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(artifacts));
  assert.match(path.basename(directory), /^owned-wiki-dispatch-[A-Za-z0-9-]+$/);
  assert.equal(fs.existsSync(directory), false);
  fs.mkdirSync(directory, { mode: 0o700 });
  const report = {
    contract: 'owned-wiki-native-sharing-dispatch-v1', status: 'FAILED',
    startedAt: new Date().toISOString(), sourceBindings: [], executions: [],
    HTTPExecuted: false, databaseExecuted: false, sharedRuntimeModified: false,
    businessAcceptance: false, startNode: 'RAWSFCODE1',
  };
  let failure;
  try {
    report.repositories = ['scripts', 'plm', 'plm/backend'].map(repo => ({
      path: repo,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(workspace, repo), encoding: 'utf8' }).trim(),
      dirtyStatusSha256: hash(execFileSync('git', ['status', '--porcelain=v1', '-z'],
        { cwd: path.join(workspace, repo) })),
    }));
    for (const relative of sources) {
      const bytes = readRegular(path.join(workspace, relative));
      const snapshot = write(directory, `source/${relative}`, bytes);
      report.sourceBindings.push({ path: relative, sha256: snapshot.sha256, snapshot: snapshot.path });
    }
    const snapshot = relative => readRegular(path.join(directory, 'source', relative));
    const entity = JSON.parse(snapshot(entityPath));
    for (const target of wikiDispatchTargets) {
      assert.equal(repairGeneratedWikiSharingSource({
        target, source: snapshot(target.sourcePath).toString('utf8'),
        modelBytes: snapshot(target.modelPath), entity,
      }).changed, false, 'Only the reviewed repaired sources may be compiled');
    }
    const receiptBytes = readRegular(path.join(workspace, receiptPath));
    assert.equal(hash(receiptBytes), receiptHash);
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.contract, 'plm-publication-provider-candidate-v1');
    const dependencies = receipt.dependencies;
    assert.equal(dependencies.length, 488);
    const bytecodeArguments = receipt.compilation.command.args.filter(item => item.startsWith('-Dgroovy.target.bytecode='));
    assert.deepEqual(bytecodeArguments, ['-Dgroovy.target.bytecode=1.8']);
    report.bytecodeTarget = '1.8';
    const java = receipt.compilation.command.executable;
    assert.equal(hash(readRegular(java)), javaHash);
    const verify = () => {
      assert.equal(hash(readRegular(path.join(workspace, receiptPath))), receiptHash);
      assert.equal(hash(readRegular(java)), javaHash);
      for (const item of dependencies) assert.equal(hash(readRegular(item.file)), item.sha256);
      for (const item of report.sourceBindings) {
        assert.equal(hash(readRegular(path.join(workspace, item.path))), item.sha256);
        assert.equal(hash(readRegular(path.join(directory, item.snapshot))), item.sha256);
      }
    };
    verify();
    report.receipt = { path: receiptPath, sha256: receiptHash };
    report.dependencies = dependencies.map(item => ({ file: item.file, sha256: item.sha256 }));
    report.java = { path: java, sha256: javaHash };
    const classpath = dependencies.map(item => item.file).join(path.delimiter);
    const classes = path.join(directory, 'classes');
    fs.mkdirSync(classes, { mode: 0o700 });
    report.classesDirectory = classes;
    const run = (name, args) => {
      const command = { executable: java, args: ['-Xmx768m', '-XX:ActiveProcessorCount=2',
        '-Dgroovy.grape.enable=false', ...args], cwd: directory };
      const result = spawnSync(command.executable, command.args, {
        cwd: directory, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      });
      const stdout = write(directory, `${name}.stdout.private.log`, result.stdout ?? '');
      const stderr = write(directory, `${name}.stderr.private.log`, result.stderr ?? '');
      report.executions.push({ name, command, status: result.status, signal: result.signal, stdout, stderr });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, `${name} failed; inspect its private stderr`);
      verify();
      return result.stdout;
    };
    const args = mode => ['groovy.ui.GroovyMain',
      path.join(directory, 'source/scripts/fixtures/OwnedWikiSharingDispatchProbe.groovy'),
      path.join(directory, 'source/plm/model'), mode];
    const sealedNative = JSON.parse(run('sealed-native', ['-cp', classpath, ...args('sealed-native')])
      .trim().split('\n').at(-1));
    run('compile-current-source', [...bytecodeArguments, '-cp', classpath,
      'org.codehaus.groovy.tools.FileSystemCompiler', '--classpath', classpath, '-d', classes,
      ...wikiDispatchTargets.map(target => path.join(directory, 'source', target.sourcePath))]);
    const currentSource = JSON.parse(run('current-source', ['-cp', `${classes}${path.delimiter}${classpath}`,
      ...args('current-source')]).trim().split('\n').at(-1));
    const sealed = new Set(dependencies.map(item => path.resolve(item.file)));
    for (const [mode, observed] of [['sealed', sealedNative], ['source', currentSource]]) {
      assert.equal(observed.rows.length, 8);
      for (const [role, location] of Object.entries(observed.classes)) {
        const filename = path.resolve(fileURLToPath(location));
        if (mode === 'source' && ['checkShared', 'accessPassword'].includes(role)) assert.equal(filename, classes);
        else assert.ok(sealed.has(filename), `${role} class loaded outside the sealed dependencies`);
      }
    }
    report.compiledClasses = wikiDispatchTargets.map(target => {
      const relative = `classes/cn/ibizlab/plm/wiki/articlepage/logic/${target.className}.class`;
      const filename = path.join(directory, relative);
      fs.chmodSync(filename, 0o600);
      const bytes = readRegular(filename);
      assert.equal(bytes.subarray(0, 4).toString('hex'), 'cafebabe');
      assert.equal(bytes.readUInt16BE(6), 52);
      return { name: target.className, path: filename, sha256: hash(bytes), classMajor: 52 };
    });
    report.observed = { sealedNative, currentSource };
    report.primaryCells = sealedNative.rows.length + currentSource.rows.length;
    report.sourceInputsStable = true;
    assert.ok(sealedNative.rows.every(row => row.resultNull && !row.resultIsOriginalDTO && row.trace.length === 0));
    assert.ok(currentSource.rows.every(row => !row.resultNull && row.resultIsOriginalDTO && row.trace.at(-1) === 'END1'));
    verify();
    report.status = 'PASS_16_NATIVE_DISPATCH_CELLS';
  } catch (error) {
    failure = error;
    report.failure = { name: error.name, message: error.message };
  } finally {
    report.finishedAt = new Date().toISOString();
    write(directory, 'report.private.json', json(report));
  }
  if (failure) throw failure;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
    const report = inspectOwnedWikiSharingDispatch({ output: values.output });
    console.log(json({ status: report.status, primaryCells: report.primaryCells,
      classesDirectory: report.classesDirectory, compiledClasses: report.compiledClasses,
      businessAcceptance: false }));
  } catch (error) {
    console.error(json({ status: 'FAILED_NATIVE_WIKI_DISPATCH', message: error.message }));
    process.exitCode = 1;
  }
}
