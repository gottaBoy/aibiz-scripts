#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(workspace, '.artifacts/allinone-local-portal-candidate-20261124-r5/allinone.candidate.private.jar');
const originalSha = '563824e4fd2cb378c1cc6db86b9a023554b1f513631e510cf440f96631d82ad4';
const source = 'ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/java/'
  + 'net/ibizsys/central/cloud/saas/extension/runtime/dataentity/security/DataEntityAccessManager.java';
const modelRoot = 'ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension';
const entity = 'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json';
const role = 'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme/PSDEUSERROLES/SystemRead.json';
const helper = 'scripts/fixtures/PrepareRuntimeArchiveOverlay.java';
const classEntry = 'net/ibizsys/central/cloud/saas/extension/runtime/dataentity/security/DataEntityAccessManager.class';
const errorSource = 'ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/'
  + 'net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.java';
const errorClassEntry = 'net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.class';
const jdk = path.join(workspace, '.artifacts/local-java-toolchain-20261122-r1/openjdk');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = filename => hash(fs.readFileSync(filename));
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const run = (executable, args) => {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw Object.assign(new Error(`View preference preparation failed: ${path.basename(executable)}`),
    { privateOutput: `${result.stdout ?? ''}${result.stderr ?? ''}` });
  return result.stdout;
};

export function prepare(output) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^allinone-view-theme-candidate-[a-z0-9-]+$/);
  assert.equal(fileHash(original), originalSha);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, bytes) => fs.writeFileSync(path.join(output, name), bytes, { mode: 0o600, flag: 'wx' });
  const sources = [source, errorSource, `${modelRoot}/${entity}`, `${modelRoot}/${role}`,
    'scripts/sync-view-theme-system-read-role.mjs'];
  const report = { contract: 'existing-allinone-view-theme-access-candidate-v1', status: 'FAILED',
    original: { path: original, sha256: originalSha },
    sources: sources.map(relative => ({ path: relative, sha256: fileHash(path.join(workspace, relative)) })),
    helper: { path: helper, sha256: fileHash(path.join(workspace, helper)) },
    preparer: { path: fileURLToPath(import.meta.url), sha256: fileHash(fileURLToPath(import.meta.url)) },
    deployed: false, serviceRestarted: false, businessAcceptance: false };
  try {
    for (const dir of ['tools', 'dependencies', 'classes']) fs.mkdirSync(path.join(output, dir), { mode: 0o700 });
    const helperSource = fs.readFileSync(path.join(workspace, helper), 'utf8');
    let derived = helperSource.replaceAll('PrepareRuntimeArchiveOverlay', 'PrepareViewThemeArchiveOverlay');
    for (const [from, to] of [
      ['if (!item.getKey().endsWith(".class")) throw new IllegalArgumentException("Only classes may be added");',
        'if (!item.getKey().endsWith(".class") && !item.getKey().endsWith(".json")) throw new IllegalArgumentException("Only reviewed classes or model JSON may be added");'],
      ['if (classVersions.size() != 1 || !classVersions.contains(major(bytes))) {',
        'if (item.getKey().endsWith(".class") && (classVersions.size() != 1 || !classVersions.contains(major(bytes)))) {'],
      ['(class|jar)', '(class|jar|json)'],
    ]) {
      assert.equal(derived.split(from).length, 2);
      derived = derived.replace(from, to);
    }
    write('PrepareViewThemeArchiveOverlay.java', derived);
    report.helper.derivedSha256 = hash(derived);
    const java = path.join(jdk, 'bin/java'), javac = path.join(jdk, 'bin/javac');
    report.java = { path: java, sha256: fileHash(java), javacSha256: fileHash(javac) };
    run(javac, ['-d', path.join(output, 'tools'), path.join(output, 'PrepareViewThemeArchiveOverlay.java')]);
    const archive = args => run(java, ['-Xmx768m', '-cp', path.join(output, 'tools'),
      'PrepareViewThemeArchiveOverlay', ...args]);
    const dependencies = JSON.parse(archive(['extract', original, path.join(output, 'dependencies')])).dependencies;
    report.dependencies = dependencies;
    const extension = dependencies.find(item => /\/ibiz-cloud-saas-extension-[^/]+\.jar$/.test(item.file));
    const core = dependencies.find(item => /\/ibiz-cloud-core-[^/]+\.jar$/.test(item.file));
    assert.ok(extension);
    assert.ok(core);
    const compileArgs = ['--release', '11', '-encoding', 'UTF-8', '-proc:none',
      '-cp', dependencies.map(item => item.file).join(path.delimiter), '-d', path.join(output, 'classes'),
      path.join(workspace, source), path.join(workspace, errorSource)];
    write('compile.private.log', run(javac, compileArgs));
    report.compilation = { executable: javac, args: compileArgs };
    const candidateExtension = path.join(output, 'ibiz-cloud-saas-extension.candidate.private.jar');
    const overlays = [
      `${classEntry}=${path.join(output, 'classes', classEntry)}`,
      `sysmodel/saas-extension/${entity}=${path.join(workspace, modelRoot, entity)}`,
      `sysmodel/saas-extension/${role}=${path.join(workspace, modelRoot, role)}`,
    ];
    report.innerAudit = JSON.parse(archive(['overlay', extension.file, candidateExtension, ...overlays]));
    const candidateCore = path.join(output, 'ibiz-cloud-core.candidate.private.jar');
    report.errorAudit = JSON.parse(archive(['overlay', core.file, candidateCore,
      `${errorClassEntry}=${path.join(output, 'classes', errorClassEntry)}`]));
    const candidate = path.join(output, 'allinone.candidate.private.jar');
    report.outerAudit = JSON.parse(archive(['overlay', original, candidate,
      `${extension.entry}=${candidateExtension}`, `${core.entry}=${candidateCore}`]));
    assert.deepEqual(report.innerAudit.entries.filter(item => item.changed).map(item => item.entry).sort(),
      overlays.map(item => item.slice(0, item.indexOf('='))).sort());
    assert.deepEqual(report.errorAudit.entries.filter(item => item.changed).map(item => item.entry), [errorClassEntry]);
    assert.deepEqual(report.outerAudit.entries.filter(item => item.changed).map(item => item.entry).sort(),
      [extension.entry, core.entry].sort());
    report.candidate = { path: candidate, sha256: fileHash(candidate), bytes: fs.statSync(candidate).size };
    const script = String.raw`
import groovy.json.JsonOutput
import net.ibizsys.central.cloud.saas.extension.runtime.dataentity.security.DataEntityAccessManager
import net.ibizsys.central.cloud.core.security.IEmployeeContext
import net.ibizsys.central.util.EntityDTO
import net.ibizsys.runtime.security.DataAccessActions
import net.ibizsys.runtime.dataentity.action.CheckKeyStates
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.dataentity.IPSDataEntity

class ThemeAccessProbe extends DataEntityAccessManager {
  net.ibizsys.central.cloud.core.dataentity.IDataEntityRuntime fixture
  net.ibizsys.central.cloud.core.dataentity.IDataEntityRuntime getDataEntityRuntime() { fixture }
  boolean scope(actor,key,input,action) { testViewThemeScope(actor,key,input,action) }
}
def cases = [
 [name:'ordinary-personal-create',action:'CREATE',pass:true],
 [name:'ordinary-system-create',action:'CREATE',input:[owner_type:'SYSTEM'],pass:false],
 [name:'ordinary-foreign-create-man',action:'CREATE',input:[create_man:'other'],pass:false],
 [name:'ordinary-foreign-system',action:'CREATE',input:[system_tag:'other-system'],pass:false],
 [name:'ordinary-unknown-owner',action:'CREATE',input:[owner_type:'UNKNOWN'],pass:false],
 [name:'anonymous',action:'CREATE',anonymous:true,pass:false],
 [name:'missing-system',action:'CREATE',noSystem:true,pass:false],
 [name:'missing-user',action:'CREATE',noUser:true,pass:false],
 [name:'own-update',action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'owner',system_tag:'owned-system'],pass:true],
 [name:'foreign-update',action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'other',system_tag:'owned-system'],pass:false],
 [name:'system-update',action:'UPDATE',stored:[owner_type:'SYSTEM',create_man:'owner',system_tag:'owned-system'],pass:false],
 [name:'self-promote',action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'owner',system_tag:'owned-system'],input:[owner_type:'SYSTEM'],pass:false],
 [name:'change-creator',action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'owner',system_tag:'owned-system'],input:[create_man:'other'],pass:false],
 [name:'change-system',action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'owner',system_tag:'owned-system'],input:[system_tag:'other-system'],pass:false],
 [name:'change-key',action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'owner',system_tag:'owned-system'],input:[id:'other'],pass:false],
 [name:'own-delete',action:'DELETE',stored:[owner_type:'PERSONAL',create_man:'owner',system_tag:'owned-system'],pass:true],
 [name:'foreign-delete',action:'DELETE',stored:[owner_type:'PERSONAL',create_man:'other',system_tag:'owned-system'],pass:false],
 [name:'save-foreign-existing',action:'CREATE',stored:[owner_type:'PERSONAL',create_man:'other',system_tag:'owned-system'],input:[id:'owned'],pass:false],
 [name:'admin-system-create',admin:true,action:'CREATE',input:[owner_type:'SYSTEM'],pass:true],
 [name:'admin-system-update',admin:true,action:'UPDATE',stored:[owner_type:'SYSTEM',create_man:'other',system_tag:'owned-system'],pass:true],
 [name:'admin-promote-personal',admin:true,action:'UPDATE',stored:[owner_type:'PERSONAL',create_man:'other',system_tag:'owned-system'],input:[owner_type:'SYSTEM'],pass:true],
 [name:'admin-cross-system',admin:true,action:'UPDATE',stored:[owner_type:'SYSTEM',create_man:'other',system_tag:'other-system'],pass:false],
 [name:'admin-creator-immutable',admin:true,action:'UPDATE',stored:[owner_type:'SYSTEM',create_man:'other',system_tag:'owned-system'],input:[create_man:'owner'],pass:false],
 [name:'missing-existing-update',action:'UPDATE',pass:false]
]
def rows=cases.collect { row ->
 def actor=[getUserid:{ -> row.noUser ? null : 'owner' },getDcsystemid:{ -> row.noSystem ? null : 'owned-system' },
  isAnonymoususer:{ -> row.anonymous==true },isSuperuser:{ -> row.admin==true },isSystemadmin:{ -> row.admin==true }] as IEmployeeContext
 def input=new EntityDTO()
 (row.input ?: [:]).each { k,v -> input.set(k,v) }
 def before=new LinkedHashMap(input.any() ?: [:])
 def stored=new EntityDTO()
 (row.stored ?: [:]).each { k,v -> stored.set(k,v) }
 if(row.stored)stored.set('id','owned')
 def persisted=new LinkedHashMap(stored.any() ?: [:])
 def runtime=[getName:{ -> 'APP_VIEW_THEME' },
   checkKeyState:{ key -> key=='owned' && row.stored ? CheckKeyStates.EXIST : CheckKeyStates.NOTEXIST },
   getSimpleEntity:{ key -> assert key=='owned'; stored }
 ] as net.ibizsys.central.cloud.core.dataentity.IDataEntityRuntime
 def probe=new ThemeAccessProbe(fixture:runtime)
 def key=row.stored && row.action!='CREATE' ? 'owned' : null
 def accepted=probe.scope(actor,key,input,row.action)
 assert accepted==row.pass:row.name
 assert (input.any() ?: [:])==before
 assert (stored.any() ?: [:])==persisted
 [name:row.name,accepted:accepted,unmodified:true]
}
def models=new PSModelServiceImpl()
models.setPSModelFolderPath(args[0])
def entity=models.getPSModelObject(null,IPSDataEntity.class,
  'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json')
def shared=entity.allPSDEUserRoles.find { it.roleTag=='SystemRead' }
assert shared!=null && shared.defaultMode
assert shared.PSDEDataSetMust.codeName=='cur_system'
assert shared.PSDEUserRoleOPPrivs*.dataAccessAction==['READ']
assert !shared.allData
assert entity.allPSDEUserRoles.find { it.roleTag=='CurUser' }.PSDEDataSetMust.codeName=='cur_user'
println JsonOutput.toJson([status:'PASS-VIEW-THEME-SCOPE-AND-SHARED-READ-MODEL',
  rows:rows,sharedReadOnly:true,personalRoleUnchanged:true,
  candidateClass:DataEntityAccessManager.protectionDomain.codeSource.location.toString(),
  httpExecuted:false,businessAcceptance:false])
`;
    write('access-probe.private.groovy', script);
    const classpath = [candidateExtension, candidateCore,
      ...dependencies.filter(item => item.file !== extension.file && item.file !== core.file).map(item => item.file)];
    const result = run(java, ['-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
      '-cp', classpath.join(path.delimiter), 'groovy.ui.GroovyMain', '-e', script, path.join(workspace, modelRoot)]);
    write('access-probe.private.log', result);
    report.accessProbe = JSON.parse(result.trim().split('\n').at(-1));
    assert.equal(report.accessProbe.rows.length, 24);
    assert.equal(fileURLToPath(report.accessProbe.candidateClass), candidateExtension);
    const errorProbe = fs.readFileSync(path.join(workspace,
      '.artifacts/plm-notfound-provider-candidate-20261124-r2/handler-probe.private.groovy'), 'utf8');
    write('error-probe.private.groovy', errorProbe);
    report.errorProbeSourceSha256 = hash(errorProbe);
    const errors = run(java, ['-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
      '-cp', classpath.join(path.delimiter), 'groovy.ui.GroovyMain', '-e', errorProbe, '404']);
    write('error-probe.private.log', errors);
    report.errorProbe = JSON.parse(errors.trim().split('\n').at(-1));
    assert.equal(report.errorProbe.rows.length, 10);
    assert.equal(fileURLToPath(report.errorProbe.handlerSource), candidateCore);
    for (const item of report.sources) assert.equal(fileHash(path.join(workspace, item.path)), item.sha256);
    for (const item of dependencies) assert.equal(fileHash(item.file), item.sha256);
    assert.equal(fileHash(path.join(workspace, helper)), report.helper.sha256);
    assert.equal(fileHash(fileURLToPath(import.meta.url)), report.preparer.sha256);
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
      scopeCases: report.accessProbe.rows.length, sharedReadOnly: report.accessProbe.sharedReadOnly }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
