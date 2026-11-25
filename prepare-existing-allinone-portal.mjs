#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(workspace, '.artifacts/mqtt-publisher-diagnostic-20261124-r1/allinone.private.jar');
const originalSha = '45655061236257781f4482a80d0e54d9e023d214d34b03fcd170e18814f2ad64';
const jdk = path.join(workspace, '.artifacts/local-java-toolchain-20261122-r1/openjdk');
const helper = 'scripts/fixtures/PrepareRuntimeArchiveOverlay.java';
const base = 'ibiz-service-hub/libs/ibiz-plugin-cloud/src/main/java/';
const sources = [
  `${base}net/ibizsys/central/plugin/cloud/service/client/LocalCloudPortalClient.java`,
  `${base}net/ibizsys/central/plugin/cloud/sysutil/SysCloudClientUtilRuntimeBase.java`,
];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const fileHash = filename => hash(fs.readFileSync(filename));

function run(executable, args, input) {
  const result = spawnSync(executable, args, { input, encoding: 'utf8',
    timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw Object.assign(new Error(`Local preparation failed: ${path.basename(executable)}`),
    { privateOutput: `${result.stdout ?? ''}${result.stderr ?? ''}` });
  return result.stdout;
}

export function prepare(output) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^allinone-local-portal-candidate-[a-z0-9-]+$/);
  assert.equal(fileHash(original), originalSha);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, bytes) => fs.writeFileSync(path.join(output, name), bytes, { mode: 0o600, flag: 'wx' });
  const report = { contract: 'existing-allinone-local-portal-candidate-v1', status: 'FAILED',
    original: { path: original, sha256: originalSha }, sources: sources.map(relative =>
      ({ path: relative, sha256: fileHash(path.join(workspace, relative)) })),
    helper: { path: helper, sha256: fileHash(path.join(workspace, helper)) },
    preparer: { path: fileURLToPath(import.meta.url), sha256: fileHash(fileURLToPath(import.meta.url)) },
    externalPortalControllerSha256: fileHash(path.join(workspace,
      'ibiz-service-hub/libs/ibiz-cloud-portal-core/src/main/java/net/ibizsys/central/cloud/portal/core/spring/controller/PortalRestController.java')),
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
    const plugin = dependencies.find(item => /\/ibiz-plugin-cloud-[^/]+\.jar$/.test(item.file));
    assert.ok(plugin);
    report.plugin = plugin;
    const compileArgs = ['--release', '11', '-encoding', 'UTF-8', '-proc:none',
      '-cp', dependencies.map(item => item.file).join(path.delimiter),
      '-d', path.join(output, 'classes'), ...sources.map(relative => path.join(workspace, relative))];
    write('compile.private.log', run(javac, compileArgs));
    report.compilation = { executable: javac, args: compileArgs, target: 'Java 11 matching the installed module' };
    const entries = [
      ...sources.map(relative => relative.slice(base.length).replace(/\.java$/, '.class')),
      ...[1, 2, 3].map(index =>
        `net/ibizsys/central/plugin/cloud/sysutil/SysCloudClientUtilRuntimeBase$${index}.class`),
    ];
    const compiled = [];
    const listClasses = (directory, prefix = '') => {
      for (const item of fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })) {
        const relative = path.posix.join(prefix, item.name);
        if (item.isDirectory()) listClasses(directory, relative); else compiled.push(relative);
      }
    };
    listClasses(path.join(output, 'classes'));
    assert.deepEqual(compiled.sort(), [...entries].sort(), 'No hidden or unrelated classes may be overlaid');
    const candidatePlugin = path.join(output, 'ibiz-plugin-cloud.candidate.private.jar');
    report.innerAudit = JSON.parse(archive(['overlay', plugin.file, candidatePlugin,
      ...entries.map(entry => `${entry}=${path.join(output, 'classes', entry)}`)]));
    const candidate = path.join(output, 'allinone.candidate.private.jar');
    report.outerAudit = JSON.parse(archive(['overlay', original, candidate,
      `${plugin.entry}=${candidatePlugin}`]));
    assert.deepEqual(report.innerAudit.entries.filter(item => item.changed).map(item => item.entry).sort(), entries.sort());
    assert.deepEqual(report.outerAudit.entries.filter(item => item.changed).map(item => item.entry), [plugin.entry]);
    report.candidatePlugin = { path: candidatePlugin, sha256: fileHash(candidatePlugin) };
    report.candidate = { path: candidate, sha256: fileHash(candidate), bytes: fs.statSync(candidate).size };
    const classpath = [candidatePlugin, ...dependencies.filter(item => item.file !== plugin.file).map(item => item.file)];
    const probe = String.raw`
import groovy.json.JsonOutput
import net.ibizsys.central.plugin.cloud.service.client.LocalCloudPortalClient
import net.ibizsys.central.plugin.cloud.sysutil.SysCloudClientUtilRuntimeBase
import net.ibizsys.central.cloud.core.cloudutil.ICloudPortalUtilRuntime
import net.ibizsys.central.cloud.core.cloudutil.ICloudUtilRuntime
import net.ibizsys.central.cloud.core.cloudutil.client.ICloudPortalClient
import net.ibizsys.central.cloud.core.cloudutil.client.ICloudExtensionClient
import net.ibizsys.central.cloud.core.util.domain.Employee
import net.ibizsys.central.cloud.core.util.domain.PortalMessage
import net.ibizsys.central.cloud.core.util.domain.PortalAsyncAction
import net.ibizsys.central.service.client.IWebClient

class LocalPortalProbeRuntime extends SysCloudClientUtilRuntimeBase {
  ICloudPortalUtilRuntime portal
  int remoteReads = 0
  int proxyReads = 0
  protected void onPrepareSubSysServiceAPIRuntime() {}
  protected ICloudPortalUtilRuntime getLocalCloudPortalRuntime() { portal }
  IWebClient getServiceClient(String type) {
    remoteReads++
    [getProxyClient:{ cls -> proxyReads++; [getAsyncAction:{ id -> new PortalAsyncAction() }] as ICloudPortalClient }] as IWebClient
  }
}
def calls = []
def action = new PortalAsyncAction()
action.set('id','owned-action')
def employee = new Employee()
employee.setUserId('owned-user')
def message = new PortalMessage()
message.setType('COMMAND')
def portal = [
  createAsyncAction:{ params -> calls.add(['create', params]); action },
  executeAsyncAction:{ id, params -> calls.add(['execute',id,params]); action },
  errorAsyncAction:{ id, params -> calls.add(['error',id,params]); action },
  cancelAsyncAction:{ id, params -> calls.add(['cancel',id,params]); action },
  finishAsyncAction:{ id, params -> calls.add(['finish',id,params]); action },
  getAsyncAction:{ id -> calls.add(['get',id]); action },
  registerEmployee:{ value -> assert value.is(employee); calls.add(['register']) },
  notifyEmployee:{ id, dc, value -> assert value.is(message); calls.add(['notify',id,dc]) },
  notifyEmployees:{ mode, id, value -> assert value.is(message); calls.add(['notify-many',mode,id]) }
] as ICloudPortalUtilRuntime
def fixture = new LocalPortalProbeRuntime(portal:portal)
[ICloudUtilRuntime.CLOUDSERVICE_PORTAL,ICloudUtilRuntime.CLOUDSERVICEURL_PORTAL].each { kind ->
  assert fixture.getServiceClient(kind,ICloudPortalClient,true) instanceof LocalCloudPortalClient
}
assert fixture.remoteReads==0
def client = fixture.getServiceClient(ICloudUtilRuntime.CLOUDSERVICE_PORTAL,ICloudPortalClient,true)
assert client.createAsyncAction(action).is(action)
assert client.executeAsyncAction('owned-action',action).is(action)
assert client.errorAsyncAction('owned-action',action).is(action)
assert client.cancelAsyncAction('owned-action',action).is(action)
assert client.finishAsyncAction('owned-action',action).is(action)
assert client.getAsyncAction('owned-action').is(action)
client.registerEmployee(employee)
client.notifyEmployee('owned-user','owned-system',message)
client.notifyEmployees('DCSYSTEM','owned-system',message)
assert calls.size()==9
assert calls[0][1].is(action.any())
assert fixture.remoteReads==0
fixture.getServiceClient(ICloudUtilRuntime.CLOUDSERVICE_PORTAL,ICloudPortalClient,false)
assert fixture.remoteReads==1
fixture.getServiceClient(ICloudUtilRuntime.CLOUDSERVICE_EXTENSION,ICloudExtensionClient,true)
assert fixture.remoteReads==2
fixture.portal=null
fixture.getServiceClient(ICloudUtilRuntime.CLOUDSERVICE_PORTAL,ICloudPortalClient,true)
assert fixture.remoteReads==3
boolean refused=false
try { new LocalCloudPortalClient(null) } catch(NullPointerException expected) { refused=true }
assert refused
println JsonOutput.toJson([status:'PASS-LOCAL-PORTAL-DISPATCH-AND-REMOTE-FALLBACK',
  forwardedMethods:calls.size(),remoteFallbackPaths:3,
  candidateClass:LocalCloudPortalClient.protectionDomain.codeSource.location.toString(),
  credentialChanges:false,httpExecuted:false,businessAcceptance:false])
`;
    write('dispatch-probe.private.groovy', probe);
    const probeOutput = run(java, ['-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
      '-cp', classpath.join(path.delimiter), 'groovy.ui.GroovyMain', '-e', probe]);
    write('dispatch-probe.private.log', probeOutput);
    report.dispatchProbe = JSON.parse(probeOutput.trim().split('\n').at(-1));
    assert.equal(report.dispatchProbe.status, 'PASS-LOCAL-PORTAL-DISPATCH-AND-REMOTE-FALLBACK');
    assert.equal(fileURLToPath(report.dispatchProbe.candidateClass), candidatePlugin);
    for (const item of report.sources) assert.equal(fileHash(path.join(workspace, item.path)), item.sha256);
    assert.equal(fileHash(fileURLToPath(import.meta.url)), report.preparer.sha256);
    assert.equal(fileHash(path.join(workspace, helper)), report.helper.sha256);
    for (const item of dependencies) assert.equal(fileHash(item.file), item.sha256);
    assert.equal(fileHash(original), originalSha);
    report.status = 'PREPARED-NOT-DEPLOYED';
    return report;
  } catch (error) {
    if (error.privateOutput) write('failure.private.log', error.privateOutput);
    report.error = error.message;
    throw error;
  } finally { write('report.private.json', json(report)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  try {
    const report = prepare(values.output);
    console.log(JSON.stringify({ status: report.status, candidate: report.candidate,
      forwardedMethods: report.dispatchProbe.forwardedMethods,
      changedArchives: report.outerAudit.entries.filter(item => item.changed).length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
