#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(workspace, '.artifacts/allinone-view-theme-candidate-20261124-r2/allinone.candidate.private.jar');
const originalSha = '2764f965f5b49a7b491fe38170112fa40f13d5be9320cb940f288038031277e8';
const modelRoot = 'ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension';
const entity = 'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json';
const resources = [entity, entity.replace('.json', '/PSDEACTIONS/Save.json'),
  'PSSYSSERVICEAPIS/api.json', 'PSSYSSERVICEAPIS/core.json'];
const helper = 'scripts/fixtures/PrepareRuntimeArchiveOverlay.java';
const jdk = path.join(workspace, '.artifacts/local-java-toolchain-20261122-r1/openjdk');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = filename => hash(fs.readFileSync(filename));
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const run = (executable, args) => {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw Object.assign(new Error(`Save model preparation failed: ${path.basename(executable)}`),
    { privateOutput: `${result.stdout ?? ''}${result.stderr ?? ''}` });
  return result.stdout;
};

export function prepare(output) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^allinone-view-theme-save-candidate-[a-z0-9-]+$/);
  assert.equal(fileHash(original), originalSha);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(output, name), value, { mode: 0o600, flag: 'wx' });
  const sources = [...resources.map(item => `${modelRoot}/${item}`), 'scripts/sync-view-theme-save-access.mjs'];
  const report = { contract: 'existing-allinone-view-theme-save-candidate-v1', status: 'FAILED',
    original: { path: original, sha256: originalSha },
    sources: sources.map(relative => ({ path: relative, sha256: fileHash(path.join(workspace, relative)) })),
    helper: { path: helper, sha256: fileHash(path.join(workspace, helper)) },
    preparer: { path: fileURLToPath(import.meta.url), sha256: fileHash(fileURLToPath(import.meta.url)) },
    deployed: false, serviceRestarted: false, businessAcceptance: false };
  try {
    for (const dir of ['tools', 'dependencies']) fs.mkdirSync(path.join(output, dir), { mode: 0o700 });
    const helperSource = fs.readFileSync(path.join(workspace, helper), 'utf8');
    assert.equal(helperSource.split('(class|jar)').length, 2);
    const derived = helperSource.replaceAll('PrepareRuntimeArchiveOverlay', 'PrepareViewThemeSaveArchive')
      .replace('(class|jar)', '(class|jar|json)');
    write('PrepareViewThemeSaveArchive.java', derived);
    report.helper.derivedSha256 = hash(derived);
    const java = path.join(jdk, 'bin/java'), javac = path.join(jdk, 'bin/javac');
    report.java = { path: java, sha256: fileHash(java), javacSha256: fileHash(javac) };
    run(javac, ['-d', path.join(output, 'tools'), path.join(output, 'PrepareViewThemeSaveArchive.java')]);
    const archive = args => run(java, ['-Xmx768m', '-cp', path.join(output, 'tools'),
      'PrepareViewThemeSaveArchive', ...args]);
    const dependencies = JSON.parse(archive(['extract', original, path.join(output, 'dependencies')])).dependencies;
    report.dependencies = dependencies;
    const extension = dependencies.find(item => /\/ibiz-cloud-saas-extension-[^/]+\.jar$/.test(item.file));
    assert.ok(extension);
    const candidateExtension = path.join(output, 'ibiz-cloud-saas-extension.candidate.private.jar');
    report.innerAudit = JSON.parse(archive(['overlay', extension.file, candidateExtension,
      ...resources.map(item => `sysmodel/saas-extension/${item}=${path.join(workspace, modelRoot, item)}`)]));
    const candidate = path.join(output, 'allinone.candidate.private.jar');
    report.outerAudit = JSON.parse(archive(['overlay', original, candidate, `${extension.entry}=${candidateExtension}`]));
    assert.deepEqual(report.innerAudit.entries.filter(item => item.changed).map(item => item.entry).sort(),
      resources.map(item => `sysmodel/saas-extension/${item}`).sort());
    assert.equal(report.innerAudit.entries.some(item => item.added), false);
    assert.deepEqual(report.outerAudit.entries.filter(item => item.changed).map(item => item.entry), [extension.entry]);
    report.candidate = { path: candidate, sha256: fileHash(candidate), bytes: fs.statSync(candidate).size };
    const classpath = [candidateExtension,
      ...dependencies.filter(item => item.file !== extension.file).map(item => item.file)];
    const script = String.raw`
import groovy.json.JsonOutput
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.service.IPSSysServiceAPI
def models=new PSModelServiceImpl()
models.setPSModelFolderPath(args[0])
def methods=['api','core'].collect { name ->
 def service=models.getPSModelObject(null,IPSSysServiceAPI.class,'PSSYSSERVICEAPIS/'+name+'.json')
 def entity=service.PSDEServiceAPIs.find { it.codeName.equalsIgnoreCase('app_view_theme') }
 assert entity!=null
 def method=entity.PSDEServiceAPIMethods.find { it.codeName=='save' }
 assert method!=null && method.needResourceKey
 assert method.requestPath=='/save' && method.requestMethod=='POST'
 assert method.dataAccessAction=='CREATE'
 assert method.PSDEActionMust.dataAccessAction=='CREATE'
 [service:name,resourceKeyRequired:method.needResourceKey,
  dataAccess:method.dataAccessAction,actionAccess:method.PSDEActionMust.dataAccessAction]
}
println JsonOutput.toJson([status:'PASS-EXPLICIT-KEYED-SAVE-CONTRACT',methods:methods])
`;
    write('save-probe.private.groovy', script);
    const args = ['-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
      '-cp', classpath.join(path.delimiter), 'groovy.ui.GroovyMain', '-e'];
    const result = run(java, [...args, script, path.join(workspace, modelRoot)]);
    write('save-probe.private.log', result);
    report.saveProbe = JSON.parse(result.trim().split('\n').at(-1));
    const scope = fs.readFileSync(path.join(workspace,
      '.artifacts/allinone-view-theme-candidate-20261124-r2/access-probe.private.groovy'), 'utf8');
    write('access-probe.private.groovy', scope);
    report.scopeProbeSourceSha256 = hash(scope);
    const scopeResult = run(java, [...args, scope, path.join(workspace, modelRoot)]);
    write('access-probe.private.log', scopeResult);
    report.accessProbe = JSON.parse(scopeResult.trim().split('\n').at(-1));
    assert.equal(report.accessProbe.rows.length, 24);
    assert.equal(fileURLToPath(report.accessProbe.candidateClass), candidateExtension);
    for (const item of report.sources) assert.equal(fileHash(path.join(workspace, item.path)), item.sha256);
    for (const item of dependencies) assert.equal(fileHash(item.file), item.sha256);
    assert.equal(fileHash(path.join(workspace, helper)), report.helper.sha256);
    assert.equal(fileHash(fileURLToPath(import.meta.url)), report.preparer.sha256);
    assert.equal(fileHash(original), originalSha);
    report.status = 'PREPARED-NOT-DEPLOYED';
    return report;
  } catch (error) {
    if (error.privateOutput) write('failure.private.log', error.privateOutput);
    report.error = error.message; throw error;
  } finally { write('report.private.json', encode(report)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  try {
    const report = prepare(values.output);
    console.log(JSON.stringify({ status: report.status, candidate: report.candidate,
      methods: report.saveProbe.methods.length, scopeCases: report.accessProbe.rows.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
