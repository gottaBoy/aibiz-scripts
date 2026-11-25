#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(workspace, '.artifacts/plm-final-shared-provider-candidate-20261124-r2/plm-provider.candidate.private.jar');
const originalSha = '2b4d9064212bca8465f2351e5c34dcbf8b6ce27986e2b4edfa67ad223952fc38';
const source = 'ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.java';
const helper = 'scripts/fixtures/PrepareRuntimeArchiveOverlay.java';
const classEntry = 'net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.class';
const jdk = path.join(workspace, '.artifacts/local-java-toolchain-20261122-r1/openjdk');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = filename => hash(fs.readFileSync(filename));
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const run = (executable, args) => {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw Object.assign(new Error(`Local preparation failed: ${path.basename(executable)}`),
    { privateOutput: `${result.stdout ?? ''}${result.stderr ?? ''}` });
  return result.stdout;
};

export function prepare(output) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^plm-notfound-provider-candidate-[a-z0-9-]+$/);
  assert.equal(fileHash(original), originalSha);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(output, name), value, { mode: 0o600, flag: 'wx' });
  const report = { contract: 'existing-plm-notfound-provider-candidate-v1', status: 'FAILED',
    original: { path: original, sha256: originalSha },
    sources: [{ path: source, sha256: fileHash(path.join(workspace, source)) }],
    helper: { path: helper, sha256: fileHash(path.join(workspace, helper)) },
    preparer: { path: fileURLToPath(import.meta.url), sha256: fileHash(fileURLToPath(import.meta.url)) },
    deployed: false, serviceRestarted: false, businessAcceptance: false };
  try {
    for (const dir of ['tools', 'dependencies', 'classes']) fs.mkdirSync(path.join(output, dir), { mode: 0o700 });
    const java = path.join(jdk, 'bin/java');
    const javac = path.join(jdk, 'bin/javac');
    report.java = { path: java, sha256: fileHash(java), javacSha256: fileHash(javac) };
    run(javac, ['-d', path.join(output, 'tools'), path.join(workspace, helper)]);
    const archive = args => run(java, ['-Xmx768m', '-cp', path.join(output, 'tools'),
      'PrepareRuntimeArchiveOverlay', ...args]);
    const dependencies = JSON.parse(archive(['extract', original, path.join(output, 'dependencies')])).dependencies;
    report.dependencies = dependencies;
    const core = dependencies.find(item => /\/ibiz-cloud-core-[^/]+\.jar$/.test(item.file));
    assert.ok(core);
    const compileArgs = ['--release', '11', '-encoding', 'UTF-8', '-proc:none',
      '-cp', dependencies.map(item => item.file).join(path.delimiter),
      '-d', path.join(output, 'classes'), path.join(workspace, source)];
    write('compile.private.log', run(javac, compileArgs));
    report.compilation = { executable: javac, args: compileArgs };
    const candidateCore = path.join(output, 'ibiz-cloud-core.candidate.private.jar');
    report.innerAudit = JSON.parse(archive(['overlay', core.file, candidateCore,
      `${classEntry}=${path.join(output, 'classes', classEntry)}`]));
    const candidate = path.join(output, 'plm-provider.candidate.private.jar');
    report.outerAudit = JSON.parse(archive(['overlay', original, candidate, `${core.entry}=${candidateCore}`]));
    assert.deepEqual(report.innerAudit.entries.filter(item => item.changed).map(item => item.entry), [classEntry]);
    assert.deepEqual(report.outerAudit.entries.filter(item => item.changed).map(item => item.entry), [core.entry]);
    report.candidateCore = { path: candidateCore, sha256: fileHash(candidateCore) };
    report.candidate = { path: candidate, sha256: fileHash(candidate), bytes: fs.statSync(candidate).size };
    const script = String.raw`
import groovy.json.JsonOutput
import net.ibizsys.central.cloud.core.service.util.ResponseExceptionHandler
import net.ibizsys.runtime.dataentity.DataEntityRuntimeException
import net.ibizsys.runtime.SystemRuntimeException
import net.ibizsys.runtime.util.ErrorException
import net.ibizsys.runtime.util.Errors
def handler = new ResponseExceptionHandler()
def cases = [
 [name:'missing-native-data',error:new DataEntityRuntimeException(null,'owned missing row',Errors.INVALIDDATA),status:Integer.parseInt(args[0])],
 [name:'wrapped-native-missing',error:new SystemRuntimeException(null,'outer',new DataEntityRuntimeException(null,'owned missing row',Errors.INVALIDDATA)),status:Integer.parseInt(args[0])],
 [name:'access-denied',error:new DataEntityRuntimeException(null,'owned denied',Errors.ACCESSDENY),status:403],
 [name:'typed-access-denied',error:new ErrorException('owned denied',Errors.ACCESSDENY),status:403],
 [name:'generic-invalid-data',error:new ErrorException('owned validation',Errors.INVALIDDATA),status:500],
 [name:'invalid-key',error:new DataEntityRuntimeException(null,'owned key',Errors.INVALIDDATAKEYS),status:500],
 [name:'input-error',error:new DataEntityRuntimeException(null,'owned input',Errors.INPUTERROR),status:500],
 [name:'duplicate-data',error:new DataEntityRuntimeException(null,'owned duplicate',Errors.DUPLICATEDATA),status:500],
 [name:'internal-error',error:new DataEntityRuntimeException(null,'owned storage',new IllegalStateException('owned SQL error')),status:500],
 [name:'unknown-error',error:new IllegalArgumentException('owned unknown'),status:500]
]
def rows=cases.collect { row ->
 def response=handler.getResponseEntity(row.error)
 assert response.statusCodeValue==row.status:row.name
 assert response.body.get('message').asText().startsWith('owned')
 [name:row.name,status:response.statusCodeValue,code:response.body.get('code').asInt()]
}
println JsonOutput.toJson([rows:rows,handlerSource:ResponseExceptionHandler.protectionDomain.codeSource.location.toString(),
  httpExecuted:false,businessAcceptance:false])
`;
    write('handler-probe.private.groovy', script);
    const probe = (coreFile, expected) => JSON.parse(run(java, [
      '-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
      '-cp', [coreFile, ...dependencies.filter(item => item.file !== core.file).map(item => item.file)].join(path.delimiter),
      'groovy.ui.GroovyMain', '-e', script, String(expected),
    ]).trim().split('\n').at(-1));
    report.originalProbe = probe(core.file, 500);
    report.candidateProbe = probe(candidateCore, 404);
    assert.equal(report.candidateProbe.rows.length, 10);
    assert.equal(fileURLToPath(report.candidateProbe.handlerSource), candidateCore);
    for (const item of dependencies) assert.equal(fileHash(item.file), item.sha256);
    assert.equal(fileHash(path.join(workspace, source)), report.sources[0].sha256);
    assert.equal(fileHash(fileURLToPath(import.meta.url)), report.preparer.sha256);
    assert.equal(fileHash(path.join(workspace, helper)), report.helper.sha256);
    assert.equal(fileHash(original), originalSha);
    report.status = 'PREPARED-NOT-DEPLOYED';
    return report;
  } catch (error) {
    if (error.privateOutput) write('failure.private.log', error.privateOutput);
    report.error = error.message;
    throw error;
  } finally { write('report.private.json', encode(report)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  try {
    const report = prepare(values.output);
    console.log(JSON.stringify({ status: report.status, candidate: report.candidate,
      errorCases: report.candidateProbe.rows.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
