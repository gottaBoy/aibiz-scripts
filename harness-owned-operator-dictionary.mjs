#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { ownedPlatformRequest } from './owned-platform-http.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import {
  modelingContextFromIdentity, verifyModelingAppData, verifyUAAIdentity,
} from './run-owned-native-permission-http.mjs';
import { verifyNoDeniedIdentity } from './harness-run-owned-uaa-runtime.mjs';

const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const OPERATOR_PATH = '/dictionaries/codelist/SysOperator';
const sourcePaths = [
  'libs/ibiz-cloud-conf-core/src/main/java/net/ibizsys/central/cloud/conf/core/spring/controller/ConfRestController.java',
  'libs/ibiz-cloud-conf-core/src/main/java/net/ibizsys/central/cloud/conf/core/cloudutil/CloudConfUtilRuntimeBase.java',
  'libs/ibiz-cloud-saas-core/src/main/java/net/ibizsys/central/cloud/saas/core/cloudutil/CloudSaaSUtilRuntimeBase.java',
  'libs/ibiz-cloud-saas-ebsx/src/main/java/net/ibizsys/central/cloud/saas/ebsx/cloudutil/EBSXCloudSaaSUtilRuntime.java',
  'ibiz-ebsx-runtime/src/main/resources/sysmodel/saas-ebsx/PSMODULES/ou/PSDATAENTITIES/Employee/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json',
  'libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/util/domain/CodeItem.java',
];

export function verifyOperatorSourceDefinitions(sources) {
  assert.equal(sources.length, sourcePaths.length);
  assert.ok(sources[0].includes('"/dictionaries/codelist/{code}"'));
  assert.ok(sources[1].includes('CODELIST_SYSOPERATOR.equalsIgnoreCase(strCodeListTag)'));
  assert.ok(sources[1].includes('getEmployeesByOrg(EmployeeContext.getCurrentMust().getOrgid())'));
  assert.ok(sources[1].includes('codeItem.setValue(employee.getUserId())'));
  assert.ok(sources[1].includes('codeItem.setText(employee.getPersonName())'));
  assert.ok(sources[2].includes('getCloudDataCat(iEmployeeContext.getTenant(), Employee.class.getSimpleName())'));
  assert.ok(sources[2].includes('.tags("org", strOrgId)'));
  assert.ok(sources[3].includes('.eq(IEmployeeService.FIELD_ORGID, strOrgId).sort("showorder")'));
  assert.ok(sources[5].includes('this.set("id", val)'));
  assert.ok(sources[5].includes('this.set("label", val)'));
  const model = JSON.parse(sources[4]);
  assert.ok(typeof model.queryCode === 'string' && model.queryCode.startsWith('SELECT\n'));
  assert.ok(model.queryCode.includes('t1.ID as USERID'));
  assert.ok(model.queryCode.includes('t1.DISPLAY_NAME as PERSONNAME'));
  assert.ok(model.queryCode.includes('t1.EMPLOYEE_NUMBER as USERCODE'));
  assert.ok(!/[;]|--|\/\*/.test(model.queryCode));
  return model.queryCode;
}

export function operatorDirectorySQL(manifest, query) {
  validateMatrixFixture(manifest);
  assert.ok(query.startsWith('SELECT\n') && !/[;]|--|\/\*/.test(query));
  assert.ok(query.includes('t1.ID as USERID') && query.includes('FROM sys_person t1'));
  const schema = manifest.schemas.uaa;
  return [
    `SELECT JSON_OBJECT('kind','source','personId',ID,'centerId',DC,'organizationId',ORGANIZATION_ID,`
      + `'text',DISPLAY_NAME,'loginname',UID,'employeeNumber',EMPLOYEE_NUMBER,'enabled',ENABLED)`
      + ` FROM \`${schema}\`.sys_person ORDER BY ID;`,
    `SELECT JSON_OBJECT('kind','operator','personId',e.USERID,'centerId',e.SRFDCID,'organizationId',e.ORGID,`
      + `'text',e.PERSONNAME,'loginname',e.LOGINNAME,'employeeNumber',e.USERCODE,'enabled',e.ENABLE)`
      + ` FROM (${query}) e ORDER BY e.USERID;`,
  ].join('\n');
}

export function verifyOperatorDirectory(manifest, rows) {
  validateMatrixFixture(manifest);
  assert.equal(manifest.scenario, 'two-center', 'Tenant isolation requires two owned centers');
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 12, 'Exactly six authoritative persons and six native employee projections are required');
  const directory = [];
  for (const user of manifest.users) {
    const matches = rows.filter(row => row.personId === user.personId);
    assert.equal(matches.length, 2);
    const source = matches.find(row => row.kind === 'source');
    const operator = matches.find(row => row.kind === 'operator');
    assert.ok(source && operator);
    for (const row of matches) {
      assert.equal(row.centerId, user.centerId);
      assert.equal(row.organizationId, `${user.centerId}_org`);
      assert.equal(row.loginname, user.loginname);
      assert.equal(row.text, user.loginname);
      assert.equal(row.enabled, 1);
      assert.ok(typeof row.employeeNumber === 'string' && row.employeeNumber.trim());
    }
    assert.deepEqual({ ...operator, kind: 'source' }, source, 'Native projection must preserve the authoritative person fields');
    directory.push({ personId: user.personId, centerId: user.centerId, organizationId: source.organizationId,
      value: user.personId, text: source.text, employeeNumber: source.employeeNumber });
  }
  return directory;
}

export function verifyOperatorResponse(response, user, directory) {
  assert.equal(response.status, 200);
  assert.equal(response.error, null);
  const body = response.data;
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.equal(body.code, 'SysOperator');
  assert.deepEqual(Object.keys(body).sort(), ['code', 'items']);
  assert.ok(Array.isArray(body.items) && body.items.length > 0, 'An empty operator list is not acceptance');
  const expected = directory.filter(row => row.centerId === user.centerId
    && row.organizationId === `${user.centerId}_org`);
  assert.equal(expected.length, 3);
  assert.equal(body.items.length, expected.length);
  assert.equal(new Set(body.items.map(item => item.value)).size, expected.length, 'Duplicate operators are not a complete directory');
  for (const item of body.items) {
    assert.ok(item && typeof item === 'object' && !Array.isArray(item));
    assert.ok(Object.keys(item).every(key => ['id', 'label', 'value', 'text', 'iconclass'].includes(key)),
      'Only the source-defined public code item fields are permitted');
    if (Object.hasOwn(item, 'iconclass')) assert.ok(item.iconclass === null || typeof item.iconclass === 'string');
    const target = expected.find(row => row.value === item.value);
    assert.ok(target, 'Foreign tenant/org or unknown operator value');
    assert.equal(item.text, target.text);
    assert.equal(item.id, item.value, 'Native id alias must equal the authoritative person value');
    assert.equal(item.label, item.text, 'Native label alias must equal the authoritative display text');
  }
  const serialized = JSON.stringify(body);
  for (const foreign of directory.filter(row => row.centerId !== user.centerId)) {
    assert.ok(!serialized.includes(foreign.personId) && !serialized.includes(foreign.text),
      'No foreign-tenant identity may be returned');
  }
  return body.items.map(({ value, text }) => ({ value, text })).sort((a, b) => a.value.localeCompare(b.value));
}

export function guardedOperatorRuntime(context, bindings, directories) {
  const live = context.guard();
  for (const binding of bindings) {
    assert.equal(hash(readPinnedFile(directories, binding.parent, binding.name).data), binding.sha256,
      'Operator source/evidence drift');
  }
  return live;
}

function token(response) {
  assert.equal(response.status, 200);
  assert.equal(response.error, null);
  const value = response.data?.token ?? response.data?.access_token;
  assert.match(value ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return value;
}

export async function runOperatorDictionaryChecks({
  context, directory, send = ownedPlatformRequest, record = async () => {},
}) {
  validateMatrixFixture(context.manifest);
  const report = {
    contract: 'owned-native-sysoperator-http-v1', runId: context.manifest.runId,
    status: 'running', checks: [], actors: [], boundedOperatorDictionaryAcceptance: false,
    nativeAcceptance: false, permissionAcceptance: false, sourceClosureVerified: false,
    interleavedTenants: true, backendDataMutationsRequested: false,
    unresolved: [
      'Only the exact SysOperator GET path is covered; model-level USERCODE dictionaries and other catalogs are not accepted.',
      'Forged organization/context headers, cache invalidation, disabled employees and directory updates are not covered.',
      'The two centers have distinct organization IDs; a same-org-ID cache-collision fixture is not covered.',
      'No browser rendering, restart durability, language switching or full authorization acceptance is claimed.',
    ],
  };
  let serial = 0;
  const observe = async (id, spec, verify) => {
    const check = { id, peer: spec.peer, method: spec.method ?? 'GET', path: spec.path, status: 'failed' };
    report.checks.push(check);
    context.guard();
    const response = await send(context, spec);
    context.guard();
    Object.assign(check, { httpStatus: response.status, error: response.error,
      responseSha256: response.responseSha256 ?? hash(json(response.data ?? null)) });
    if (spec.path === OPERATOR_PATH) check.response = await record(
      `${String(++serial).padStart(3, '0')}-dictionary.private.json`, response);
    assert.equal(response.error, null);
    verify(response);
    check.status = 'passed';
    return response;
  };
  try {
    const users = [];
    for (const role of ['editor', 'viewer', 'no-access']) {
      for (const root of context.manifest.roots) {
        users.push(context.manifest.users.find(user => user.role === role && user.rootId === root.rootId));
      }
    }
    for (const user of users) {
      const login = await observe(`${user.loginname}-uaa-login`, {
        peer: 'uaa', path: '/auths/login', method: 'POST',
        data: { loginname: user.loginname, password: context.credentials.users[user.loginname], dc: user.centerId },
      }, response => { token(response); verifyUAAIdentity(response.data.user, user); });
      const applicationContext = modelingContextFromIdentity(login.data.user, user);
      await observe(`${user.loginname}-uaa-self`, {
        peer: 'uaa', path: '/auths/user-info/self', token: token(login),
      }, response => { assert.equal(response.status, 200); verifyUAAIdentity(response.data, user); });
      const backend = await observe(`${user.loginname}-backend-login`, {
        peer: 'backend', path: '/v7/login', method: 'POST',
        data: { loginname: user.loginname, password: context.credentials.users[user.loginname] },
      }, response => { token(response); });
      const backendToken = token(backend);
      await observe(`${user.loginname}-backend-self`, {
        peer: 'backend', path: '/uaa/oauth/userinfo', token: backendToken,
      }, response => { assert.equal(response.status, 200); assert.equal(response.data?.sub, user.loginname); });
      await observe(`${user.loginname}-appdata`, {
        peer: 'backend', path: '/appdata', token: backendToken, applicationContext,
      }, response => verifyModelingAppData(response, user, applicationContext));
      let first;
      for (const pass of ['initial', 'cached-repeat']) {
        await observe(`${user.loginname}-operators-${pass}`, {
          peer: 'backend', path: OPERATOR_PATH, token: backendToken, applicationContext,
        }, response => {
          const values = verifyOperatorResponse(response, user, directory);
          if (first) assert.deepEqual(values, first, 'Repeated dictionary must retain the same scoped membership');
          else first = values;
        });
      }
      report.actors.push({ personId: user.personId, role: user.role, centerId: user.centerId,
        organizationId: applicationContext.organization, operatorValues: first, repeatedReadVerified: true });
    }
    await observe('anonymous-operator-dictionary-denied', { peer: 'backend', path: OPERATOR_PATH },
      response => { assert.equal(response.status, 401); verifyNoDeniedIdentity(response.data); });
    assert.equal(report.actors.length, 6);
    report.boundedOperatorDictionaryAcceptance = true;
    report.status = 'passed-bounded-native-sysoperator';
  } catch {
    report.status = 'failed-native-sysoperator';
    report.unresolved.push('Execution stopped at the first failed check; inspect the owner-private dictionary response.');
  }
  return report;
}

export async function executeOwnedOperatorDictionary({
  workspace = workspaceDefault, runId, deploymentInput, label, execute = false,
}) {
  assert.equal(execute, true, 'Explicit owned dictionary execution is required');
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  let output;
  let report;
  let stage = 'output';
  let sqlSerial = 0;
  const bindings = [];
  const read = path => {
    const child = relative(resolve(workspace), path);
    assert.ok(child && !child.startsWith('../') && !child.startsWith('/'));
    const parent = directories.open(dirname(path));
    const name = path.split('/').at(-1);
    const file = readPinnedFile(directories, parent, name);
    const binding = { path, sha256: hash(file.data), bytes: file.data.length };
    bindings.push({ ...binding, parent, name });
    return file.data;
  };
  const guard = () => guardedOperatorRuntime(context, bindings, directories);
  const write = (name, value) => {
    const bytes = json(value);
    directories.write(output, name, bytes);
    return { path: join(output.path, name), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  };
  const sql = statement => {
    guard();
    const result = spawnSync('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      `test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --database=nf_${runId}_ebsx --default-character-set=utf8mb4 --batch --raw --skip-column-names`,
    ], { input: statement, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    write(`sql-${String(++sqlSerial).padStart(3, '0')}.private.json`, {
      statementSha256: hash(statement), exitCode: result.status, signal: result.signal,
      stdoutSha256: hash(result.stdout ?? ''), stderr: result.stderr ?? '',
    });
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned read-only directory SQL failed');
    guard();
    return result.stdout.trim();
  };
  try {
    output = directories.open(join(context.base, `operator-dictionary-${label}`), { create: true, exclusive: true });
    stage = 'source-binding';
    for (const path of ['scripts/harness-owned-operator-dictionary.mjs', 'scripts/owned-platform-http.mjs',
      'scripts/owned-native-runtime-context.mjs']) read(join(workspace, path));
    const images = JSON.parse(read(resolve(workspace, context.deployment.imageReceipt.path)));
    assert.equal(bindings.at(-1).sha256, context.deployment.imageReceipt.sha256);
    const build = JSON.parse(read(resolve(workspace, images.packageReceipt.path)));
    assert.equal(bindings.at(-1).sha256, images.packageReceipt.sha256);
    assert.equal(build.status, 'passed-package-and-unit-only');
    const sources = sourcePaths.map(path => {
      const bytes = read(join(build.worktree, path));
      const declared = build.sourceInputs.before.entries.find(entry => entry.path === path);
      assert.equal(hash(bytes), declared?.sha256, 'Operator definition must be the source-built runtime input');
      return bytes.toString('utf8');
    });
    const query = verifyOperatorSourceDefinitions(sources);
    const statement = operatorDirectorySQL(context.manifest, query);
    const snapshots = () => {
      const rows = sql(statement).split('\n').filter(Boolean).map(row => JSON.parse(row));
      const projection = verifyOperatorDirectory(context.manifest, rows);
      const targets = context.manifest.roots.flatMap(root => ['t_srfpsmodule', 't_srfpssystem']
        .map(table => `\`${root.database}\`.\`${table}\``));
      const checksums = sql(`CHECKSUM TABLE ${targets.join(',')} EXTENDED;`).split('\n').sort();
      assert.equal(checksums.length, 4);
      assert.ok(checksums.every(row => /\t[0-9]+$/.test(row)));
      return { rows, projection, checksums };
    };
    stage = 'initial-directory-and-model-projections';
    const before = snapshots();
    write('baseline.private.json', before);
    stage = 'native-six-user-http';
    report = await runOperatorDictionaryChecks({
      context: { ...context, guard }, directory: before.projection,
      record: async (name, response) => write(name, response),
    });
    stage = 'final-directory-and-model-projections';
    const after = snapshots();
    write('final.private.json', after);
    assert.deepEqual(after, before, 'Dictionary/identity projections and both physical model roots must remain unchanged');
    report.directoryProjectionUnchanged = true;
    report.physicalModelsUnchanged = true;
    report.inputs = [...context.bindings, ...bindings.map(({ parent, name, ...binding }) => binding)];
    report.sourceContract = {
      path: OPERATOR_PATH, valueField: 'Employee.USERID = sys_person.ID', textField: 'Employee.PERSONNAME = sys_person.DISPLAY_NAME',
      scope: 'EmployeeContext.ORGID; SaaS cache category includes tenant and organization tag',
      modelLevelEmployeeNumberIsDistinct: true,
      aliases: { id: 'value', label: 'text' },
    };
    report.stage = 'complete';
  } catch {
    report ??= { contract: 'owned-native-sysoperator-http-v1', runId, checks: [], actors: [],
      nativeAcceptance: false, permissionAcceptance: false, sourceClosureVerified: false, unresolved: [] };
    report.status = 'failed-native-sysoperator';
    report.stage = stage;
    report.boundedOperatorDictionaryAcceptance = false;
    report.unresolved.push('Source/owned topology, read-only snapshot or integrity gate failed; no acceptance.');
  } finally {
    if (output) {
      report.completedAt = new Date().toISOString();
      write('report.json', report);
    }
    directories.close();
    context.close();
  }
  return { report, reportPath: join(output.path, 'report.json') };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--execute-owned-operator-dictionary') {
      assert.ok(!options.execute); options.execute = true; continue;
    }
    const match = /^--(run-id|deployment-input|label)=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Only explicit non-duplicate owned options are allowed');
    options[match[1]] = match[2];
  }
  const result = await executeOwnedOperatorDictionary({
    runId: options['run-id'], deploymentInput: options['deployment-input'],
    label: options.label, execute: options.execute ?? false,
  });
  console.log(json({ reportPath: result.reportPath, status: result.report.status,
    checks: result.report.checks.length, boundedAcceptance: result.report.boundedOperatorDictionaryAcceptance }));
  if (!result.report.boundedOperatorDictionaryAcceptance) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Owned SysOperator verification refused; private details suppressed.');
    process.exitCode = 1;
  });
}
