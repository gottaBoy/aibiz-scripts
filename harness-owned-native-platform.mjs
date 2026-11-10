#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { ownedPlatformRequest } from './owned-platform-http.mjs';
import { ownedUaaAlias, publishOwnedUaaAlias, removeOwnedUaaAlias } from './owned-nacos-service-alias.mjs';
import { privateContainerOrigin, verifyNoDeniedIdentity } from './harness-run-owned-uaa-runtime.mjs';
import { publishOwnedNacos } from './launch-run-owned-native-backend.mjs';
import { ownedNacosContent } from './run-owned-backend-configuration.mjs';
import {
  modelingContextFromIdentity, moduleRequest, verifyDenied, verifyModelingAppData, verifyRead, verifyUAAIdentity,
} from './run-owned-native-permission-http.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function extendOwnedPlatformRouting(routing, allinoneName) {
  assert.match(allinoneName, /^nf-[a-f0-9]{12}-backend-[a-z0-9][a-z0-9-]{0,48}-allinone$/);
  assert.ok(routing && Array.isArray(routing.routes));
  const desired = {
    id: 'owned-platform-config', uri: `http://${allinoneName}:30000`, order: 3,
    predicates: [{ name: 'Path', args: { _genkey_0: '/configs/**', _genkey_1: '/dictionaries/**' } }],
    filters: [],
  };
  const copy = structuredClone(routing);
  const existing = copy.routes.filter(x => x.id === desired.id);
  if (existing.length) {
    assert.equal(existing.length, 1);
    assert.deepEqual(existing[0], desired, 'Existing platform route cannot be overwritten');
  } else copy.routes.push(desired);
  return copy;
}

export function verifyOwnedRefreshDenial(response) {
  assert.equal(response.error, null);
  assert.ok([400, 401, 403].includes(response.status), 'Invalid refresh requires an actual client denial');
  verifyNoDeniedIdentity(response.data);
}

export function ownedAuthenticationOriginContent({ runId, content, origin }) {
  ownedUaaAlias({ runId, origin });
  assert.ok(content.startsWith('---\n'));
  const original = JSON.parse(content.slice(4));
  assert.deepEqual(Object.keys(original).sort(), ['accesstokenurl', 'serviceurl']);
  assert.equal(original.accesstokenurl, '/auths/login');
  assert.match(original.serviceurl,
    new RegExp(`^http://nf-${runId}-uaa-[a-z0-9-]+:32666$`));
  return ownedNacosContent({ ...original, serviceurl: origin });
}

function physicalChecksums(context) {
  context.guard();
  const tables = context.manifest.roots.flatMap(root => ['t_srfpsmodule', 't_srfpssystem']
    .map(table => `\`${root.database}\`.\`${table}\``));
  const result = spawnSync('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names',
  ], { input: `CHECKSUM TABLE ${tables.join(',')} EXTENDED;\n`,
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned read-only checksum failed');
  const rows = result.stdout.trim().split('\n');
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => /\t[0-9]+$/.test(row)), 'Physical checksums must not be NULL');
  return hash(rows.sort().join('\n'));
}

export async function executeOwnedPlatform({
  runId, deploymentInput, label, verifyConfig = false, configurePlatformRoute = false,
  configureAuthOrigin = false,
}) {
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  let target;
  const report = {
    contract: 'owned-native-platform-http-v1', runId, label, status: 'running',
    startedAt: new Date().toISOString(), checks: [], unresolved: [], cleanup: [],
    inputs: context.bindings, nativeAcceptance: false, permissionAcceptance: false,
    boundedRefreshAcceptance: false, boundedConfigurationAcceptance: false,
    tokenExpirationChanged: false, sharedServicesChanged: false,
    generator: { path: 'scripts/harness-owned-native-platform.mjs',
      sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) },
  };
  let alias;
  let aliasCreated = false;
  let baseline;
  let nacosOrigin;
  const output = join(context.base, `platform-http-${label}`);
  const nacosRequest = async (origin, path, options = {}) => {
    context.guard();
    assert.equal(origin, nacosOrigin);
    assert.ok(path.startsWith('/nacos/v1/ns/') || path.startsWith('/nacos/v1/cs/'));
    const response = await fetch(origin + path, {
      ...options, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length <= 1024 * 1024);
    return { status: response.status, bytes };
  };
  const observe = async (id, spec, verify) => {
    const row = { id, status: 'failed', httpStatus: null };
    report.checks.push(row);
    const response = await ownedPlatformRequest(context, spec);
    Object.assign(row, { httpStatus: response.status, responseSha256: response.responseSha256,
      error: response.error });
    assert.equal(response.error, null);
    verify(response);
    row.status = 'passed';
    return response;
  };
  const login = async (user, applicationContext) => {
    const response = await observe(`${user.loginname}-backend-login`, {
      peer: 'backend', path: '/v7/login', method: 'POST',
      data: { loginname: user.loginname, password: context.credentials.users[user.loginname] },
    }, r => {
      assert.equal(r.status, 200);
      assert.equal(typeof r.data?.token, 'string');
      assert.match(r.data?.refresh_token ?? '', /^[a-f0-9-]{36}$/);
    });
    const session = { user, applicationContext, token: response.data.token,
      refresh: response.data.refresh_token };
    await bootstrap(session);
    return session;
  };
  const bootstrap = async session => {
    await observe(`${session.user.loginname}-appdata`, {
      peer: 'backend', path: '/appdata', token: session.token,
      applicationContext: session.applicationContext,
    }, r => verifyModelingAppData(r, session.user, session.applicationContext));
  };
  const refresh = async session => {
    const response = await observe(`${session.user.loginname}-refresh`, {
      peer: 'backend', path: `/uaa/refresh_token/${session.refresh}`,
    }, r => {
      assert.equal(r.status, 200);
      assert.match(r.data?.token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.match(r.data?.refresh_token ?? '', /^[a-f0-9-]{36}$/);
      assert.ok(Number.isInteger(r.data.expirein) && r.data.expirein > 0 && r.data.expirein <= 20);
    });
    session.token = response.data.token;
    session.refresh = response.data.refresh_token;
    await bootstrap(session);
  };
  try {
    target = directories.open(output, { create: true, exclusive: true });
    baseline = physicalChecksums(context);
    const live = context.guard();
    const nacos = context.deployment.auxiliaryContainers.find(x => x.role === 'nacos');
    nacosOrigin = privateContainerOrigin(live.containers.find(x => x.Id === nacos.containerId), live.network, 8848);
    alias = ownedUaaAlias({ runId, origin: live.origins.uaa });
    const registration = await publishOwnedUaaAlias(nacosOrigin, alias,
      { request: nacosRequest, guard: context.guard, onCreated: () => { aliasCreated = true; } });
    aliasCreated = registration.created;
    report.alias = registration;

    if (configureAuthOrigin) {
      const startup = directories.open(dirname(resolve(workspace, deploymentInput)));
      const rows = JSON.parse(readPinnedFile(directories, startup, 'nacos-configs.private.json').data);
      const row = rows.find(row => row.dataId === 'cloud-auth-agent-rt');
      const startupReport = JSON.parse(readPinnedFile(directories, startup, 'report.json').data);
      assert.equal(row.group, `nf_${runId}`);
      assert.equal(hash(row.content), startupReport.nacosConfigurationBindings
        .find(recorded => recorded.dataId === row.dataId)?.sha256);
      const desired = ownedAuthenticationOriginContent({ runId, content: row.content, origin: live.origins.uaa });
      const query = new URLSearchParams({ dataId: row.dataId, group: row.group });
      const current = await nacosRequest(nacosOrigin, `/nacos/v1/cs/configs?${query}`);
      assert.equal(current.status, 200);
      assert.ok([row.content, desired].includes(current.bytes.toString('utf8')),
        'Unrecognized authentication configuration cannot be overwritten');
      report.authenticationRouting = {
        originalSha256: hash(row.content), previousLiveSha256: hash(current.bytes),
        bindings: await publishOwnedNacos(nacosOrigin, [{ ...row, content: desired }],
          { request: nacosRequest }),
        readiness: [],
      };
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const user = context.manifest.users[0];
        const response = await ownedPlatformRequest(context, {
          peer: 'backend', path: '/v7/login', method: 'POST',
          data: { loginname: user.loginname, password: context.credentials.users[user.loginname] },
        });
        report.authenticationRouting.readiness.push({
          httpStatus: response.status, error: response.error, responseSha256: response.responseSha256,
        });
        if (response.error === null && response.status === 200
          && typeof response.data?.token === 'string') { ready = true; break; }
        assert.ok(response.error !== null || [500, 502, 503].includes(response.status),
          'Authentication rebind received an unexpected non-readiness response');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(ready, true, 'Owned authentication origin did not become ready');
    }

    if (configurePlatformRoute) {
      const startup = directories.open(dirname(resolve(workspace, deploymentInput)));
      const source = readPinnedFile(directories, startup, 'nacos-configs.private.json').data;
      const rows = JSON.parse(source);
      const row = rows.find(x => x.dataId === 'appgateway-default');
      assert.equal(row.group, `nf_${runId}`);
      const startupReport = JSON.parse(readPinnedFile(directories, startup, 'report.json').data);
      const recorded = startupReport.nacosConfigurationBindings.find(x => x.dataId === row.dataId);
      assert.equal(hash(row.content), recorded.sha256, 'Original owned Nacos configuration binding drift');
      const query = new URLSearchParams({ dataId: row.dataId, group: row.group });
      const current = await nacosRequest(nacosOrigin, `/nacos/v1/cs/configs?${query}`);
      assert.equal(current.status, 200);
      assert.ok(row.content.startsWith('---\n'));
      const allinone = live.containers.find(x => x.Id === context.deployment.services.allinone.containerId);
      const desired = ownedNacosContent(extendOwnedPlatformRouting(JSON.parse(row.content.slice(4)),
        allinone.Name.slice(1)));
      assert.ok([row.content, desired].includes(current.bytes.toString('utf8')),
        'An unrecognized live route configuration cannot be overwritten');
      report.platformRouting = {
        originalSha256: hash(row.content), previousLiveSha256: hash(current.bytes),
        bindings: await publishOwnedNacos(nacosOrigin, [{ ...row, content: desired }],
          { request: nacosRequest }),
      };
    }

    const sessions = [];
    for (const user of context.manifest.users) {
      const native = await observe(`${user.loginname}-uaa-identity`, {
        peer: 'uaa', path: '/auths/login', method: 'POST',
        data: { loginname: user.loginname, password: context.credentials.users[user.loginname], dc: user.centerId },
      }, r => { assert.equal(r.status, 200); verifyUAAIdentity(r.data.user, user); });
      sessions.push(await login(user, modelingContextFromIdentity(native.data.user, user)));
    }
    const expiration = session => JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url')).exp * 1000;
    const until = Math.max(...sessions.map(expiration)) + 100 - Date.now();
    assert.ok(until >= 0 && until <= 30_000, 'This replay requires the unmodified short-TTL fixture');
    report.naturalExpiryWaitMs = until;
    await new Promise(resolve => setTimeout(resolve, until));
    for (const session of sessions) {
      await observe(`${session.user.loginname}-old-token-expired`, {
        peer: 'backend', path: '/uaa/oauth/userinfo', token: session.token,
      }, r => { assert.equal(r.status, 401); verifyNoDeniedIdentity(r.data); });
      await refresh(session);
      await observe(`${session.user.loginname}-refreshed-uaa-self`, {
        peer: 'uaa', path: '/auths/user-info/self', token: session.token,
      }, r => { assert.equal(r.status, 200); verifyUAAIdentity(r.data, session.user); });
      await observe(`${session.user.loginname}-refreshed-backend-self`, {
        peer: 'backend', path: '/uaa/oauth/userinfo', token: session.token,
      }, r => { assert.equal(r.status, 200); assert.equal(r.data?.sub, session.user.loginname); });
      for (const root of context.manifest.roots) {
        await observe(`${session.user.loginname}-${root.side}-refreshed-read`, {
          peer: 'backend', ...moduleRequest(root, 'FETCH_CUR_SYS'),
          token: session.token, applicationContext: session.applicationContext,
        }, r => {
          if (session.user.rootId === root.rootId && session.user.role !== 'no-access') {
            verifyRead(r, root, 'FETCH_CUR_SYS');
          } else verifyDenied(r, [], [], context.manifest.roots);
        });
      }
    }
    report.boundedRefreshAcceptance = true;

    let refreshDenialsPassed = true;
    const invalidSpec = {
      peer: 'uaa', path: `/auths/${randomUUID()}/refresh_token`,
    };
    for (const [peer, spec] of [
      ['native', invalidSpec],
      ['backend', { peer: 'backend', path: `/uaa/refresh_token/${randomUUID()}` }],
    ]) {
      try {
        const response = await observe(`invalid-${peer}-refresh-denied`, spec, verifyOwnedRefreshDenial);
        report[`invalid${peer === 'native' ? 'Native' : 'Backend'}Refresh`] = {
          httpStatus: response.status, responseSha256: response.responseSha256,
        };
      } catch {
        refreshDenialsPassed = false;
        report.unresolved.push(`Invalid ${peer} refresh is not a verified client denial; error mapping remains open.`);
      }
    }

    if (verifyConfig) {
      report.configurationActors = [];
      report.globalConfigurationAcceptance = false;
      for (const selected of sessions) {
        const owner = await login(selected.user, selected.applicationContext);
        const tag = `nf_${runId}_platform_${randomBytes(6).toString('hex')}`;
        const path = `/configs/customtheme/${tag}?share=false`;
        let writeAttempted = false;
        const cleanup = { tag, actor: owner.user.loginname, status: 'not-needed' };
        report.cleanup.push(cleanup);
        const cfgSpec = (session, method = 'GET', data) => ({
          peer: 'backend', path, method, data,
          ...(session ? { token: session.token, applicationContext: session.applicationContext } : {}),
        });
        try {
          await observe('private-config-initially-absent', cfgSpec(owner),
            r => { assert.equal(r.status, 200); assert.equal(r.data, null); });
          await observe('anonymous-private-config-read-denied', cfgSpec(null),
            r => { assert.equal(r.status, 401); verifyNoDeniedIdentity(r.data); });
          await observe('anonymous-private-config-write-denied', cfgSpec(null, 'PUT', { marker: tag }),
            r => { assert.equal(r.status, 401); verifyNoDeniedIdentity(r.data); });
          const initial = { marker: tag, locale: 'zh-CN', value: 'first' };
          writeAttempted = true;
          cleanup.status = 'required';
          await observe('private-config-save', cfgSpec(owner, 'PUT', initial),
            r => { assert.equal(r.status, 200); assert.equal(r.data, true); });
          await observe('private-config-same-session-readback', cfgSpec(owner),
            r => { assert.equal(r.status, 200); assert.deepEqual(r.data, initial); });
          const fresh = await login(owner.user, owner.applicationContext);
          await observe('private-config-fresh-login-readback', cfgSpec(fresh),
            r => { assert.equal(r.status, 200); assert.deepEqual(r.data, initial); });
          for (const different of sessions.filter(session => session.user.loginname !== owner.user.loginname)) {
            const other = await login(different.user, different.applicationContext);
            await observe(`${owner.user.loginname}-config-isolated-from-${other.user.loginname}`, cfgSpec(other),
              r => { assert.equal(r.status, 200); assert.equal(r.data, null); });
          }
          const existing = await login(fresh.user, fresh.applicationContext);
          const renewed = await login(fresh.user, fresh.applicationContext);
          const updated = { marker: tag, locale: 'en-US', value: 'updated' };
          await observe('private-config-update', cfgSpec(renewed, 'PUT', updated),
            r => { assert.equal(r.status, 200); assert.equal(r.data, true); });
          await observe('private-config-existing-session-sees-update', cfgSpec(existing),
            r => { assert.equal(r.status, 200); assert.deepEqual(r.data, updated); });
          await observe('private-config-new-session-sees-update', cfgSpec(renewed),
            r => { assert.equal(r.status, 200); assert.deepEqual(r.data, updated); });
          report.configurationActors.push({ actor: owner.user.loginname, role: owner.user.role,
            centerId: owner.user.centerId, otherUsersIsolated: sessions.length - 1 });
        } finally {
          if (writeAttempted) {
            const fresh = await login(owner.user, owner.applicationContext);
            await observe('private-config-native-cleanup', cfgSpec(fresh, 'PUT', null),
              r => { assert.equal(r.status, 200); assert.equal(r.data, true); });
            await observe('private-config-absent-after-cleanup', cfgSpec(fresh),
              r => { assert.equal(r.status, 200); assert.equal(r.data, null); });
            cleanup.status = 'removed-through-native-config-api';
          }
        }
      }
      assert.equal(report.configurationActors.length, context.manifest.users.length);
      report.boundedConfigurationAcceptance = true;
    } else report.unresolved.push('Configuration persistence was not requested by this invocation.');
    report.status = refreshDenialsPassed ? 'passed-bounded-platform-http' : 'failed-bounded-platform-http';
  } catch {
    report.status = 'failed-bounded-platform-http';
    report.boundedConfigurationAcceptance = false;
    report.unresolved.push('A required check failed; see its ID and owner-private service logs.');
  } finally {
    if (target) {
      try {
        report.physicalModelChecksumsUnchanged = physicalChecksums(context) === baseline;
        assert.equal(report.physicalModelChecksumsUnchanged, true);
        if (aliasCreated) report.aliasCleanup = await removeOwnedUaaAlias(nacosOrigin, alias,
          { request: nacosRequest, guard: context.guard });
      } catch {
        report.status = 'failed-bounded-platform-http';
        report.unresolved.push('Final physical integrity or owned alias cleanup failed.');
      }
      report.completedAt = new Date().toISOString();
      directories.write(target, 'report.json', json(report));
    }
    context.close();
    directories.close();
  }
  return { reportPath: join(output, 'report.json'), report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'execute-owned-platform': { type: 'boolean' }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, label: { type: 'string' },
      'verify-owned-config': { type: 'boolean' }, 'configure-owned-platform-route': { type: 'boolean' },
      'configure-owned-auth-origin': { type: 'boolean' },
    } });
    assert.equal(values['execute-owned-platform'], true);
    const result = await executeOwnedPlatform({ runId: values['run-id'],
      deploymentInput: values['deployment-input'], label: values.label,
      verifyConfig: values['verify-owned-config'] ?? false,
      configurePlatformRoute: values['configure-owned-platform-route'] ?? false,
      configureAuthOrigin: values['configure-owned-auth-origin'] ?? false });
    console.log(JSON.stringify({ reportPath: result.reportPath, status: result.report.status,
      checks: result.report.checks.length, refresh: result.report.boundedRefreshAcceptance,
      configuration: result.report.boundedConfigurationAcceptance }, null, 2));
    if (result.report.status.startsWith('failed')) process.exitCode = 1;
  } catch {
    console.error('Owned platform verification refused; private details suppressed.');
    process.exitCode = 1;
  }
}
