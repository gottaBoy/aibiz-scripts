#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const YAML = require(path.join(workspace, 'ibiz-app-hub/node_modules/.pnpm/yaml@2.8.0/node_modules/yaml'));
const original = path.join(workspace, '.artifacts/plm-notfound-provider-candidate-20261124-r2/plm-provider.candidate.private.jar');
const originalSha256 = '75b38f38badd32130d6306f49ea4534bee5ea3ffa329141a45d35c9d827a8f1e';
const resource = 'BOOT-INF/classes/application-auto.yml';
const moduleResource = 'BOOT-INF/lib/plm-core-v1.0.2.jar';
const source = 'plm/backend/plm-provider/src/main/resources/application-auto.yml';
const helper = 'scripts/fixtures/PrepareRuntimeArchiveOverlay.java';
const jdk = path.join(workspace, '.artifacts/local-java-toolchain-20261122-r1/openjdk');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const wikiOriginSetting = '${plm.wiki:http://127.0.0.1:30250}';
export const nativeWikiProofPath = '.artifacts/owned-wiki-dispatch-tests-7314b7706fdd/report.private.json';
export const nativeWikiProofSha256 = '9ef11502968b3d79e76b6916db2d7078239de8586e95dcfb7f8a7655c3a056e0';
export const nativeWikiClassBindings = Object.freeze([
  Object.freeze({
    name: 'CheckShared', entry: 'cn/ibizlab/plm/wiki/articlepage/logic/CheckShared.class',
    sourcePath: 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/wiki/articlepage/logic/CheckShared.groovy',
    sourceSha256: '3d947068f28fd3171c75648c346ec7260000e7c1f7b27517d5109014d35ef9ee',
    oldSha256: 'f3fb53a32b8927ca31dd8987a6b785148694a9cc4caffc18b33ef1f45d5e40da',
    sha256: '7f7dc564abca791f427ac39812d50602e43c4c2097391d5ff937e3b981f04acc',
  }),
  Object.freeze({
    name: 'AccessPassword', entry: 'cn/ibizlab/plm/wiki/articlepage/logic/AccessPassword.class',
    sourcePath: 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/wiki/articlepage/logic/AccessPassword.groovy',
    sourceSha256: '0fc8635eaa45ca5a2fd03156af7a2bc7efd1a72f32280eaf12de040ad9e03fef',
    oldSha256: '3c6c500a6b16b5cfaf587218d20cd1fdac6347a6dad3c8e0b0562d9cdd344eec',
    sha256: 'c2245434bda0fd13814ec27ae0a003d0e0b46a6cd05f24dcc1d40b07d013870a',
  }),
]);

export function validateNativeWikiProof(proof) {
  assert.equal(proof.contract, 'owned-wiki-native-sharing-dispatch-v1');
  assert.equal(proof.status, 'PASS_16_NATIVE_DISPATCH_CELLS');
  assert.equal(proof.primaryCells, 16);
  assert.equal(proof.bytecodeTarget, '1.8');
  assert.equal(proof.sourceInputsStable, true);
  for (const key of ['HTTPExecuted', 'databaseExecuted', 'sharedRuntimeModified', 'businessAcceptance']) {
    assert.equal(proof[key], false);
  }
  assert.equal(proof.startNode, 'RAWSFCODE1');
  assert.equal(proof.dependencies.length, 488);
  assert.equal(new Set(proof.dependencies.map(item => item.file)).size, 488);
  assert.equal(proof.compiledClasses.length, 2);
  for (const item of nativeWikiClassBindings) {
    const compiled = proof.compiledClasses.filter(row => row.name === item.name);
    assert.equal(compiled.length, 1);
    assert.equal(compiled[0].sha256, item.sha256);
    assert.equal(compiled[0].classMajor, 52);
    assert.equal(compiled[0].path, path.join(proof.classesDirectory, item.entry));
    const boundSource = proof.sourceBindings.filter(row => row.path === item.sourcePath);
    assert.equal(boundSource.length, 1);
    assert.equal(boundSource[0].sha256, item.sourceSha256);
  }
  for (const [mode, observed] of Object.entries(proof.observed)) {
    assert.ok(['sealedNative', 'currentSource'].includes(mode));
    assert.equal(observed.rows.length, 8);
    const cases = new Set();
    for (const row of observed.rows) {
      assert.ok(['check_shared', 'access_password'].includes(row.name));
      assert.equal(typeof row.expired, 'boolean');
      assert.equal(typeof row.passwordCase, 'boolean');
      cases.add(`${row.name}:${row.expired}:${row.passwordCase}`);
      assert.equal(row.effective, row.expired ? 0 : 1);
      if (mode === 'sealedNative') {
        assert.equal(row.resultNull, true);
        assert.equal(row.resultIsOriginalDTO, false);
        assert.deepEqual(row.trace, []);
      } else {
        const trace = ['RAWSFCODE1'];
        if (row.name === 'access_password' && !row.expired) trace.push(row.passwordCase ? 'PREPAREPARAM1' : 'PREPAREPARAM2');
        trace.push('END1');
        assert.deepEqual(row.trace, trace);
        assert.equal(row.resultNull, false);
        assert.equal(row.resultIsOriginalDTO, true);
        assert.equal(String(row.checkPassword), row.name === 'check_shared'
          ? (row.passwordCase ? '1' : '0') : (!row.expired && row.passwordCase ? '1' : '0'));
      }
    }
    assert.equal(cases.size, 8);
  }
  assert.deepEqual(Object.keys(proof.observed).sort(), ['currentSource', 'sealedNative']);
  return proof;
}

export function verifyNativeWikiProofBinding(binding) {
  assert.equal(binding.path, nativeWikiProofPath);
  assert.equal(binding.sha256, nativeWikiProofSha256);
  const bytes = fs.readFileSync(path.join(workspace, binding.path));
  assert.equal(digest(bytes), nativeWikiProofSha256);
  const proof = validateNativeWikiProof(JSON.parse(bytes));
  for (const item of proof.sourceBindings) {
    assert.equal(digest(fs.readFileSync(path.join(workspace, item.path))), item.sha256);
    assert.equal(digest(fs.readFileSync(path.join(workspace, path.dirname(nativeWikiProofPath), item.snapshot))), item.sha256);
  }
  for (const item of [...proof.dependencies, ...proof.compiledClasses]) {
    assert.equal(digest(fs.readFileSync(item.file ?? item.path)), item.sha256);
  }
  assert.equal(digest(fs.readFileSync(proof.java.path)), proof.java.sha256);
  assert.equal(digest(fs.readFileSync(path.join(workspace, proof.receipt.path))), proof.receipt.sha256);
  return proof;
}

export function validateWikiClassOverlay(audit) {
  const changed = audit.entries.filter(row => row.changed);
  assert.deepEqual(changed.map(row => row.entry).sort(), nativeWikiClassBindings.map(row => row.entry).sort());
  assert.equal(new Set(audit.entries.map(row => row.entry)).size, audit.entries.length);
  assert.ok(!audit.entries.some(row => row.added || row.removed || !row.afterSha256));
  for (const item of nativeWikiClassBindings) {
    const row = changed.find(entry => entry.entry === item.entry);
    assert.equal(row.beforeSha256, item.oldSha256);
    assert.equal(row.afterSha256, item.sha256);
    const closures = audit.entries.filter(entry => entry.entry.startsWith(item.entry.slice(0, -6) + '$'));
    assert.ok(closures.length > 0, 'Legacy closure classes must be retained byte-for-byte');
    assert.ok(closures.every(entry => !entry.changed && entry.beforeSha256 === entry.afterSha256));
  }
  assert.ok(audit.entries.filter(row => !row.changed).every(row => row.beforeSha256 === row.afterSha256));
}

export function deriveWikiArchiveHelper(text) {
  const previous = String.raw`if (!entry.matches("[A-Za-z0-9_.$+/-]+\\.(class|jar)") || entry.contains("..")) {`;
  const next = String.raw`if (!(entry.equals("BOOT-INF/classes/application-auto.yml") || entry.matches("[A-Za-z0-9_.$+/-]+\\.(class|jar)")) || entry.contains("..")) {`;
  assert.equal(text.split(previous).length, 2, 'The reviewed archive helper guard changed');
  return text.replace(previous, next);
}

export function validateLocalWikiConfiguration(before, after) {
  const parse = text => {
    const document = YAML.parseDocument(text, { uniqueKeys: true });
    assert.equal(document.errors.length, 0);
    return document.toJS();
  };
  const originalValue = parse(before);
  const nextValue = parse(after);
  assert.equal(originalValue.ibiz.servicehub.initmode, 'auto');
  assert.equal(originalValue.ibiz.deploysystems.master.deploysystemid, '${system.name}');
  assert.equal(originalValue.ibiz.servicehub.systemsettings.param?.plm_wiki, undefined);
  const expected = structuredClone(originalValue);
  expected.ibiz.servicehub.systemsettings.param = {
    ...expected.ibiz.servicehub.systemsettings.param, plm_wiki: wikiOriginSetting,
  };
  assert.deepEqual(nextValue, expected, 'Only the local system wiki parameter may change');
  return { namespace: 'ibiz.servicehub.systemsettings.param.plm_wiki', value: wikiOriginSetting };
}

const nativeProbe = String.raw`
import groovy.json.JsonOutput
import net.ibizsys.central.cloud.core.spring.configuration.ServiceHubProperties
import net.ibizsys.central.cloud.core.util.domain.DeploySystem
import net.ibizsys.central.SystemRuntimeSetting
import com.baomidou.dynamic.datasource.spring.boot.autoconfigure.DynamicDataSourceProperties
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
def origin='http://127.0.0.1:30250'
def env=new StandardEnvironment()
env.propertySources.addFirst(new MapPropertySource('owned-setting',[:]))
assert env.resolveRequiredPlaceholders(args[0])==origin
def rows=[]
for (boolean configured : [false,true]) {
  def properties=new ServiceHubProperties()
  def datasourceField=ServiceHubProperties.getDeclaredField('dataSourceProperties')
  datasourceField.setAccessible(true)
  datasourceField.set(properties,new DynamicDataSourceProperties())
  def hub=new ServiceHubProperties.ServiceHub()
  hub.put('localmode',true)
  hub.put('deploysystems',['gateway','ibizservicerunner'])
  hub.put('systemsettings',configured ? [param:[plm_wiki:env.resolveRequiredPlaceholders(args[0])]] : [:])
  properties.setServiceHub(hub)
  def master=new DeploySystem()
  master.setDeploySystemId('ibizservicerunner')
  master.setSettings([product:'ibizservicerunner'])
  def explicit=new DeploySystem()
  explicit.setModelPath('/app/model')
  explicit.setExtension(false)
  explicit.setUpdateDBSchema(false)
  properties.setDeploySystems([master:master,ibizservicerunner:explicit])
  def parsed=properties.getParsedDeploySystems().get('ibizservicerunner')
  assert parsed!=null
  def merged=[:]
  merged.putAll(properties.getParsedServiceHub().get('systemsettings'))
  merged.putAll(parsed.getSettings())
  def setting=new SystemRuntimeSetting(null,merged)
  def actual=setting.getParam('param.plm_wiki','')
  assert actual==(configured ? origin : '')
  assert parsed.getModelPath()=='/app/model'
  assert parsed.getExtension()=='false'
  assert parsed.getUpdateDBSchema()=='false'
  rows.add([configured:configured,resolved:actual==origin,localModelPreserved:true])
}
env.propertySources.addFirst(new MapPropertySource('owned-override',['plm.wiki':'http://127.0.0.1:39999']))
assert env.resolveRequiredPlaceholders(args[0])=='http://127.0.0.1:39999'
println JsonOutput.toJson([status:'PASS-LOCAL-SETTING-MERGE',rows:rows,overridePreserved:true,
  httpExecuted:false,businessAcceptance:false])
`;

export function prepare(output) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^plm-wiki-settings-candidate-[a-z0-9-]+$/);
  assert.equal(digest(fs.readFileSync(original)), originalSha256);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, bytes) => fs.writeFileSync(path.join(output, name), bytes, { mode: 0o600, flag: 'wx' });
  const commands = [];
  const run = (program, args, maxBuffer = 32 * 1024 * 1024) => {
    const result = spawnSync(program, args, { timeout: 120000, maxBuffer, encoding: 'utf8' });
    const sequence = commands.length + 1;
    const stdout = Buffer.from(result.stdout ?? '');
    const stderr = Buffer.from(result.stderr ?? '');
    write(`command-${sequence}.stdout.private.log`, stdout);
    write(`command-${sequence}.stderr.private.log`, stderr);
    commands.push({ program, args, status: result.status, signal: result.signal,
      stdoutSha256: digest(stdout), stderrSha256: digest(stderr) });
    if (result.status !== 0) throw Object.assign(new Error(`Owned preparation failed: ${path.basename(program)}`),
      { privateOutput: `${result.stdout ?? ''}${result.stderr ?? ''}` });
    return result.stdout;
  };
  const report = { contract: 'existing-plm-wiki-local-settings-and-dispatch-candidate-v2', status: 'FAILED',
    original: { path: original, sha256: originalSha256 }, sources: [],
    helper: { path: helper, sha256: digest(fs.readFileSync(path.join(workspace, helper))) },
    preparer: { path: fileURLToPath(import.meta.url), sha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))) },
    commands, deployed: false, serviceRestarted: false, businessAcceptance: false };
  try {
    for (const dir of ['tools', 'dependencies', 'class-overlay']) fs.mkdirSync(path.join(output, dir), { mode: 0o700 });
    const proofBinding = { path: nativeWikiProofPath, sha256: nativeWikiProofSha256 };
    const proof = verifyNativeWikiProofBinding(proofBinding);
    write('native-dispatch-proof.private.json', fs.readFileSync(path.join(workspace, nativeWikiProofPath)));
    report.dispatchProof = { ...proofBinding, status: proof.status, primaryCells: proof.primaryCells,
      bytecodeTarget: proof.bytecodeTarget, classesDirectory: proof.classesDirectory,
      compiledClasses: proof.compiledClasses };
    const before = run('unzip', ['-p', original, resource]);
    const after = fs.readFileSync(path.join(workspace, source));
    report.setting = validateLocalWikiConfiguration(before, after.toString());
    report.sources = [...new Set([source, 'scripts/tests/prepare-existing-plm-wiki-settings.test.mjs',
      ...proof.sourceBindings.map(item => item.path)])]
      .map(relative => ({ path: relative, sha256: digest(fs.readFileSync(path.join(workspace, relative))) }));
    write('before-application-auto.private.yml', before);
    write('application-auto.private.yml', after);
    write('native-probe.private.groovy', nativeProbe);
    const derivedHelper = deriveWikiArchiveHelper(fs.readFileSync(path.join(workspace, helper), 'utf8'));
    write('PrepareRuntimeArchiveOverlay.java', derivedHelper);
    report.helper.derivedSha256 = digest(Buffer.from(derivedHelper));
    const java = path.join(jdk, 'bin/java');
    const javac = path.join(jdk, 'bin/javac');
    report.java = { sha256: digest(fs.readFileSync(java)), javacSha256: digest(fs.readFileSync(javac)) };
    run(javac, ['-d', path.join(output, 'tools'), path.join(output, 'PrepareRuntimeArchiveOverlay.java')]);
    const archive = args => JSON.parse(run(java, ['-Xmx768m', '-cp', path.join(output, 'tools'),
      'PrepareRuntimeArchiveOverlay', ...args]));
    report.dependencies = archive(['extract', original, path.join(output, 'dependencies')]).dependencies;
    assert.equal(report.dependencies.length, 488);
    report.configurationProbe = JSON.parse(run(java, ['-Xmx512m', '-XX:ActiveProcessorCount=2',
      '-Dgroovy.grape.enable=false', '-cp', report.dependencies.map(item => item.file).join(path.delimiter),
      'groovy.ui.GroovyMain', '-e', nativeProbe, wikiOriginSetting]).trim().split('\n').at(-1));
    assert.equal(report.configurationProbe.status, 'PASS-LOCAL-SETTING-MERGE');
    const refused = spawnSync(java, ['-cp', path.join(output, 'tools'),
      'PrepareRuntimeArchiveOverlay', 'overlay', original, path.join(output, 'forbidden.private.jar'),
      `BOOT-INF/classes/other.yml=${path.join(output, 'application-auto.private.yml')}`],
    { timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Unsafe overlay entry/);
    assert.equal(fs.existsSync(path.join(output, 'forbidden.private.jar')), false);
    report.helper.unrelatedYamlRefused = true;
    const core = report.dependencies.filter(item => item.entry === moduleResource);
    assert.equal(core.length, 1);
    report.classInputs = nativeWikiClassBindings.map(item => {
      const compiled = proof.compiledClasses.find(row => row.name === item.name);
      const file = path.join(output, 'class-overlay', `${item.name}.class`);
      const bytes = fs.readFileSync(compiled.path);
      assert.equal(digest(bytes), item.sha256);
      write(`class-overlay/${item.name}.class`, bytes);
      return { name: item.name, entry: item.entry, path: file, sha256: item.sha256 };
    });
    const coreCandidate = path.join(output, 'plm-core.candidate.private.jar');
    report.innerAudit = archive(['overlay', core[0].file, coreCandidate,
      ...report.classInputs.map(item => `${item.entry}=${item.path}`)]);
    validateWikiClassOverlay(report.innerAudit);
    const candidate = path.join(output, 'plm-provider.candidate.private.jar');
    report.outerAudit = archive(['overlay', original, candidate,
      `${resource}=${path.join(output, 'application-auto.private.yml')}`, `${moduleResource}=${coreCandidate}`]);
    assert.deepEqual(report.outerAudit.entries.filter(item => item.changed).map(item => item.entry).sort(),
      [resource, moduleResource].sort());
    assert.ok(!report.outerAudit.entries.some(item => item.added || item.removed));
    fs.chmodSync(candidate, 0o600);
    report.candidate = { path: candidate, sha256: digest(fs.readFileSync(candidate)), bytes: fs.statSync(candidate).size };
    report.coreCandidate = { path: coreCandidate, sha256: digest(fs.readFileSync(coreCandidate)),
      bytes: fs.statSync(coreCandidate).size };
    assert.equal(report.outerAudit.entries.find(item => item.entry === moduleResource).beforeSha256, core[0].sha256);
    assert.equal(report.outerAudit.entries.find(item => item.entry === moduleResource).afterSha256,
      report.coreCandidate.sha256);
    for (const item of report.classInputs) assert.equal(digest(fs.readFileSync(item.path)), item.sha256);
    for (const item of report.dependencies) assert.equal(digest(fs.readFileSync(item.file)), item.sha256);
    for (const item of report.sources) assert.equal(digest(fs.readFileSync(path.join(workspace, item.path))), item.sha256);
    assert.equal(digest(fs.readFileSync(original)), originalSha256);
    assert.equal(digest(fs.readFileSync(path.join(output, 'PrepareRuntimeArchiveOverlay.java'))),
      report.helper.derivedSha256);
    assert.equal(digest(fs.readFileSync(path.join(output, 'native-dispatch-proof.private.json'))), nativeWikiProofSha256);
    verifyNativeWikiProofBinding(proofBinding);
    assert.equal(digest(fs.readFileSync(report.preparer.path)), report.preparer.sha256);
    assert.equal(digest(fs.readFileSync(path.join(workspace, helper))), report.helper.sha256);
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
      configurationProbe: report.configurationProbe }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
