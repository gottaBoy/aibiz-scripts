#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configuration = '/etc/nginx/conf.d/nginx.conf';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = 'location = /api/ibizplm__plmweb/appdata {';

export function planPlmAppDataRoute(bytes) {
  const text = bytes.toString('utf8');
  assert.equal(text.split(marker).length, 2, 'Exactly one native PLM appdata location is required');
  const start = text.indexOf(marker);
  const end = text.indexOf('}', start);
  assert.ok(end > start);
  const block = text.slice(start, end + 1);
  assert.equal(block.indexOf('{'), block.lastIndexOf('{'), 'Nested appdata directives require separate review');
  for (const directive of ['rewrite ^ /appdata break;', 'proxy_set_header Authorization $http_authorization;',
    'proxy_set_header srfsystemid ibizplm;', 'proxy_set_header srforgid $plm_srforgid;']) {
    assert.ok(block.includes(directive), `The native appdata contract changed: ${directive}`);
  }
  const oldRoute = block.includes('proxy_pass $uaa_upstream;');
  assert.ok(oldRoute || block.includes('proxy_pass $allinone_upstream;'),
    'Only the observed native appdata upstreams are eligible');
  assert.ok(text.includes('set $allinone_upstream http://ibiz-ebsx-allinone:30000;'));
  const replacement = block.replace('proxy_pass $uaa_upstream;', 'proxy_pass $allinone_upstream;');
  let candidateText = text.slice(0, start) + replacement + text.slice(end + 1);
  const mapMarker = 'map $http_srforgid $plm_srforgid {';
  assert.equal(candidateText.split(mapMarker).length, 2, 'Exactly one native organization map is required');
  const mapStart = candidateText.indexOf(mapMarker);
  const mapEnd = candidateText.indexOf('}', mapStart);
  const map = candidateText.slice(mapStart, mapEnd + 1);
  assert.ok(map.includes('default $http_srforgid;'));
  assert.ok(!map.includes('{', mapMarker.length), 'Nested organization map requires review');
  const dropsOrganization = /^\s*000000 "";[ \t]*$/m.test(map);
  assert.ok(dropsOrganization || map.trim() === `${mapMarker}\n    default $http_srforgid;\n}`,
    'Unknown organization rewrite cannot be adopted');
  if (dropsOrganization) {
    const corrected = map.replace(/^[ \t]*000000 "";[ \t]*\r?\n/m, '');
    candidateText = candidateText.slice(0, mapStart) + corrected + candidateText.slice(mapEnd + 1);
  }
  assert.ok(oldRoute || dropsOrganization, 'The observed appdata route is already repaired');
  const candidate = Buffer.from(candidateText);
  return { beforeSha256: digest(bytes), candidateSha256: digest(candidate), candidate,
    changes: { upstreamChanged: oldRoute, organizationPreserved: dropsOrganization } };
}

const internalMessageStub = `    location = /api/ibizplm__plmweb/extension/internal_messages/fetch_cur_receiver {
        add_header X-Total 0 always;
        default_type application/json;
        return 200 '[]';
    }`;
const internalMessageProxy = `    location ^~ /api/ibizplm__plmweb/extension/internal_messages/ {
        rewrite ^/api/ibizplm__plmweb/extension/internal_messages/(.*)$ /extension/api/internal_messages/$1 break;
        proxy_pass $allinone_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header srfsystemid ibizplm;
        proxy_set_header srforgid $plm_srforgid;
    }`;

export function planPlmInternalMessageRoute(bytes) {
  const text = bytes.toString('utf8');
  assert.equal(text.split(internalMessageStub).length, 2,
    'Exactly one observed empty internal-message stub is required');
  assert.ok(!text.includes('location ^~ /api/ibizplm__plmweb/extension/internal_messages/'),
    'An existing message proxy requires a new review');
  assert.ok(text.includes('set $allinone_upstream http://ibiz-ebsx-allinone:30000;'));
  assert.ok(text.includes('default $http_srforgid;'));
  assert.ok(!/^\s*000000 "";[ \t]*$/m.test(text), 'The actual organization must be preserved');
  const candidate = Buffer.from(text.replace(internalMessageStub, internalMessageProxy));
  return { beforeSha256: digest(bytes), candidateSha256: digest(candidate), candidate,
    changes: { emptyMessageStubRemoved: true, nativeUserApi: '/extension/api/internal_messages/' } };
}

const personalConfigFolders = ['customtheme', 'menu', 'dynafilter'];
const personalConfigStub = folder => `    location ^~ /api/ibizplm__plmweb/configs/${folder}/ {
        default_type application/json;
        return 200 '${folder === 'dynafilter' ? '{}' : ''}';
    }`;
const personalConfigProxy = folder => `    location ^~ /api/ibizplm__plmweb/configs/${folder}/ {
        rewrite ^/api/ibizplm__plmweb/(configs/.*)$ /$1 break;
        proxy_pass $allinone_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header srfsystemid ibizplm;
        proxy_set_header srforgid $plm_srforgid;
    }`;

export function planPlmPersonalConfigRoutes(bytes) {
  const text = bytes.toString('utf8');
  assert.ok(text.includes('set $allinone_upstream http://ibiz-ebsx-allinone:30000;'));
  assert.ok(text.includes('default $http_srforgid;'));
  assert.ok(!/^\s*000000 "";[ \t]*$/m.test(text));
  let candidate = text;
  for (const folder of personalConfigFolders) {
    const stub = personalConfigStub(folder);
    assert.equal(text.split(stub).length, 2, `Exactly one observed ${folder} stub is required`);
    assert.equal(text.split(`location ^~ /api/ibizplm__plmweb/configs/${folder}/`).length, 2);
    candidate = candidate.replace(stub, personalConfigProxy(folder));
  }
  const candidateBytes = Buffer.from(candidate);
  return { beforeSha256: digest(bytes), candidateSha256: digest(candidateBytes), candidate: candidateBytes,
    changes: { personalConfigStubsRemoved: [...personalConfigFolders], nativeController: '/configs/' } };
}

const appViewThemeStub = `    location = /api/ibizplm__plmweb/extension/app_view_themes/fetch_cur_user_all {
        add_header X-Total 0 always;
        default_type application/json;
        return 200 '[]';
    }`;
const appViewThemeProxy = `    location = /api/ibizplm__plmweb/extension/app_view_themes {
        rewrite ^ /extension/api/app_view_themes break;
        proxy_pass $allinone_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header srfsystemid ibizplm;
        proxy_set_header srforgid $plm_srforgid;
    }

    location ^~ /api/ibizplm__plmweb/extension/app_view_themes/ {
        rewrite ^/api/ibizplm__plmweb/extension/app_view_themes/(.*)$ /extension/api/app_view_themes/$1 break;
        proxy_pass $allinone_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header srfsystemid ibizplm;
        proxy_set_header srforgid $plm_srforgid;
    }`;

export function planPlmAppViewThemeRoutes(bytes) {
  const text = bytes.toString('utf8');
  assert.equal(text.split(appViewThemeStub).length, 2, 'Exactly one observed empty view-theme stub is required');
  for (const marker of [
    'location = /api/ibizplm__plmweb/extension/app_view_themes {',
    'location ^~ /api/ibizplm__plmweb/extension/app_view_themes/',
  ]) assert.ok(!text.includes(marker), 'An existing view-theme route requires separate review');
  assert.ok(text.includes('set $allinone_upstream http://ibiz-ebsx-allinone:30000;'));
  assert.ok(text.includes('default $http_srforgid;'));
  assert.ok(!/^\s*000000 "";[ \t]*$/m.test(text), 'The actual organization must be preserved');
  const candidate = Buffer.from(text.replace(appViewThemeStub, appViewThemeProxy));
  return { beforeSha256: digest(bytes), candidateSha256: digest(candidate), candidate,
    changes: { emptyAppViewThemeStubRemoved: true,
      nativeUserApi: '/extension/api/app_view_themes', collectionAndItemRoutes: true } };
}

export const mqttProxyBlock = `    location = /api/ibizplm__plmweb/portal/mqtt/mqtt {
        proxy_pass http://emqx:8085/mqtt;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }

`;

export function planPlmMqttRoute(bytes) {
  const text = bytes.toString('utf8');
  const portal = '    location ^~ /api/ibizplm__plmweb/portal/ {';
  assert.equal(text.split(portal).length, 2, 'Exactly one existing portal proxy is required');
  assert.ok(!text.includes('location = /api/ibizplm__plmweb/portal/mqtt/mqtt'),
    'An existing MQTT route requires a new review');
  const candidate = Buffer.from(text.replace(portal, `${mqttProxyBlock}${portal}`));
  assert.equal(candidate.toString().replace(mqttProxyBlock, ''), text);
  return { beforeSha256: digest(bytes), candidateSha256: digest(candidate), candidate,
    changes: { exactMqttWebSocketRoute: '/api/ibizplm__plmweb/portal/mqtt/mqtt',
      upstream: 'http://emqx:8085/mqtt', identityHeadersAdded: false,
      applicationMqttEnabled: false } };
}

export const loginImageProxyBlock = `    location = /assets/images/login-header.png {
        alias /dist/assets/images/login-header.png;
    }

    location = /assets/images/login-avatar.png {
        alias /dist/assets/images/login-avatar.png;
    }

`;

export function planPlmLoginImageRoutes(bytes) {
  const text = bytes.toString('utf8');
  const entry = '    location = /ibizplm-plmweb {';
  assert.equal(text.split(entry).length, 2, 'Exactly one existing PLM static entry is required');
  for (const name of ['login-header', 'login-avatar']) {
    assert.ok(!text.includes(`location = /assets/images/${name}.png`),
      'An existing login image route requires a new review');
  }
  const candidate = Buffer.from(text.replace(entry, `${loginImageProxyBlock}${entry}`));
  assert.equal(candidate.toString().replace(loginImageProxyBlock, ''), text);
  return { beforeSha256: digest(bytes), candidateSha256: digest(candidate), candidate,
    changes: { staticImageAliases: ['login-header.png', 'login-avatar.png'],
      apiChanges: false, identityHeadersAdded: false } };
}

const planners = {
  appdata: planPlmAppDataRoute,
  'internal-messages': planPlmInternalMessageRoute,
  'personal-config': planPlmPersonalConfigRoutes,
  'app-view-themes': planPlmAppViewThemeRoutes,
  mqtt: planPlmMqttRoute,
  'login-images': planPlmLoginImageRoutes,
};

export async function repairExistingPlmAppData({
  containerId, imageId, expectedBeforeSha256, output, execute, kind = 'appdata',
} = {}) {
  assert.ok(Object.hasOwn(planners, kind), 'Only reviewed route repairs are supported');
  assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
  assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.match(expectedBeforeSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(typeof execute, 'function');
  const run = (args, message) => {
    const result = execute(args);
    assert.equal(result.status, 0, message);
    return Buffer.from(result.stdout ?? '');
  };
  const inspect = () => {
    const containers = JSON.parse(run(['inspect', containerId], 'Existing PLM inspection failed'));
    assert.equal(containers.length, 1);
    const current = containers[0];
    assert.equal(current.Id, containerId);
    assert.equal(current.Image, imageId);
    assert.equal(current.Name, '/plmweb');
    assert.equal(current.Config?.Labels?.['com.docker.compose.project'], 'compose');
    assert.equal(current.Config?.Labels?.['com.docker.compose.service'], 'plmweb');
    assert.equal(current.State?.Status, 'running');
    assert.ok(!current.Mounts?.some(mount => configuration === mount.Destination ||
      configuration.startsWith(`${mount.Destination}/`)), 'The selected config must be the existing container file');
    return current;
  };
  const first = inspect();
  const lifecycle = { startedAt: first.State.StartedAt, restartCount: first.RestartCount };
  assert.ok(Number.isFinite(Date.parse(lifecycle.startedAt)));
  assert.ok(Number.isInteger(lifecycle.restartCount) && lifecycle.restartCount >= 0);
  const guard = () => {
    const current = inspect();
    assert.deepEqual({ startedAt: current.State.StartedAt, restartCount: current.RestartCount }, lifecycle,
      'PLM container lifecycle changed');
  };
  const readConfig = () => run(['exec', containerId, 'cat', configuration], 'Existing Nginx config read failed');
  const before = readConfig();
  assert.equal(digest(before), expectedBeforeSha256, 'The inspected configuration changed before preparation');
  const plan = planners[kind](before);
  const metadata = run(['exec', containerId, 'sh', '-c',
    'test -f /etc/nginx/conf.d/nginx.conf && test ! -L /etc/nginx/conf.d/nginx.conf && stat -c "%u:%g:%a" /etc/nginx/conf.d/nginx.conf'],
  'Existing config metadata was not established').toString().trim();
  assert.match(metadata, /^\d+:\d+:[0-7]{3,4}$/);
  const [uid, gid, mode] = metadata.split(':');
  const target = `${configuration}.aibiz-appdata-pending`;
  const beforePath = join(output, 'before.private.conf');
  const candidatePath = join(output, 'candidate.private.conf');
  const report = { contract: kind === 'appdata' ? 'existing-plm-appdata-proxy-repair-v1'
    : kind === 'internal-messages' ? 'existing-plm-internal-message-proxy-repair-v1'
      : kind === 'personal-config' ? 'existing-plm-personal-config-proxy-repair-v1'
        : kind === 'login-images' ? 'existing-plm-login-image-proxy-repair-v1'
          : kind === 'mqtt' ? 'existing-plm-mqtt-proxy-repair-v1'
          : 'existing-plm-app-view-theme-proxy-repair-v1', kind, status: 'prepared',
    containerId, imageId, lifecycle, configuration, metadata,
    executorSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
    beforeSha256: plan.beforeSha256, candidateSha256: plan.candidateSha256,
    changes: plan.changes,
    containerRecreated: false, imagePulled: false, containerRestartRequested: false,
    nginxReloadRequested: false, rollback: { input: beforePath, sha256: plan.beforeSha256 },
    functionalAcceptance: false, startedAt: new Date().toISOString() };
  fs.mkdirSync(output, { mode: 0o700 });
  const syncDirectory = path => {
    const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  };
  syncDirectory(dirname(output));
  const write = (name, bytes) => {
    const descriptor = fs.openSync(join(output, name), 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    syncDirectory(output);
  };
  write('before.private.conf', before);
  write('candidate.private.conf', plan.candidate);
  write('prepared.private.json', `${JSON.stringify(report, null, 2)}\n`);
  const install = (path, sha256, expectedCurrent, onInstalled = () => {}) => {
    guard();
    assert.equal(digest(readConfig()), expectedCurrent, 'Live config changed before upload');
    run(['exec', containerId, 'sh', '-c',
      'test ! -e /etc/nginx/conf.d/nginx.conf.aibiz-appdata-pending && test ! -L /etc/nginx/conf.d/nginx.conf.aibiz-appdata-pending'],
    'The temporary config path already exists and cannot be adopted');
    run(['cp', path, `${containerId}:${target}`], 'Exact prepared config upload failed');
    const uploaded = run(['exec', '--user', '0', containerId, 'cat', target], 'Prepared config upload could not be checked');
    assert.equal(digest(uploaded), sha256);
    run(['exec', '--user', '0', containerId, 'chown', `${uid}:${gid}`, target], 'Config owner preservation failed');
    run(['exec', '--user', '0', containerId, 'chmod', mode, target], 'Config mode preservation failed');
    guard();
    assert.equal(digest(readConfig()), expectedCurrent, 'Live config changed before atomic replacement');
    run(['exec', '--user', '0', containerId, 'mv', target, configuration], 'Atomic config replacement failed');
    onInstalled();
    assert.equal(digest(readConfig()), sha256);
  };
  let installed = false;
  try {
    guard();
    assert.equal(digest(readConfig()), plan.beforeSha256, 'Live config changed before upload');
    install(candidatePath, plan.candidateSha256, plan.beforeSha256, () => { installed = true; });
    run(['exec', containerId, 'nginx', '-t'], 'Nginx rejected the exact candidate');
    run(['exec', containerId, 'nginx', '-s', 'reload'], 'Nginx candidate reload failed');
    report.nginxReloadRequested = true;
    guard();
    assert.equal(digest(readConfig()), plan.candidateSha256);
    report.status = 'passed-existing-config-reload-only';
    return report;
  } catch (error) {
    report.status = 'failed-existing-config-repair';
    report.error = error.message;
    if (!installed) {
      try { guard(); installed = digest(readConfig()) === plan.candidateSha256; }
      catch { report.rollback.status = 'not-attempted-unverified-live-state'; }
    }
    if (installed) {
      try {
        install(beforePath, plan.beforeSha256, plan.candidateSha256);
        run(['exec', containerId, 'nginx', '-t'], 'Original Nginx config rollback validation failed');
        run(['exec', containerId, 'nginx', '-s', 'reload'], 'Original Nginx config reload failed');
        report.rollback.status = 'restored-exact-original';
      } catch (rollbackError) {
        report.rollback.status = 'failed';
        report.rollback.error = rollbackError.message;
        error.rollbackFailure = rollbackError;
      }
    }
    throw Object.assign(error, { evidence: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    write('report.private.json', `${JSON.stringify(report, null, 2)}\n`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'execute-existing-plm-appdata-repair': { type: 'boolean' }, 'container-id': { type: 'string' },
    'execute-existing-plm-message-route-repair': { type: 'boolean' },
    'execute-existing-plm-personal-config-route-repair': { type: 'boolean' },
    'execute-existing-plm-app-view-theme-route-repair': { type: 'boolean' },
    'execute-existing-plm-mqtt-route-repair': { type: 'boolean' },
    'execute-existing-plm-login-image-route-repair': { type: 'boolean' },
    'image-id': { type: 'string' }, 'before-sha256': { type: 'string' }, output: { type: 'string' },
  } });
  const selected = [
    ['execute-existing-plm-appdata-repair', 'appdata'],
    ['execute-existing-plm-message-route-repair', 'internal-messages'],
    ['execute-existing-plm-personal-config-route-repair', 'personal-config'],
    ['execute-existing-plm-app-view-theme-route-repair', 'app-view-themes'],
    ['execute-existing-plm-mqtt-route-repair', 'mqtt'],
    ['execute-existing-plm-login-image-route-repair', 'login-images'],
  ].filter(([flag]) => values[flag] === true);
  assert.equal(selected.length, 1, 'Exactly one reviewed route repair must be selected');
  const kind = selected[0][1];
  const output = resolve(values.output ?? '');
  assert.match(relative(join(workspace, '.artifacts'), output),
    kind === 'appdata' ? /^plm-appdata-route-repair-[a-z0-9-]+$/
      : kind === 'internal-messages' ? /^plm-message-route-repair-[a-z0-9-]+$/
        : kind === 'personal-config' ? /^plm-personal-config-route-repair-[a-z0-9-]+$/
          : kind === 'login-images' ? /^plm-login-image-route-repair-[a-z0-9-]+$/
            : kind === 'mqtt' ? /^plm-mqtt-route-repair-[a-z0-9-]+$/
            : /^plm-app-view-theme-route-repair-[a-z0-9-]+$/);
  const report = await repairExistingPlmAppData({ containerId: values['container-id'], imageId: values['image-id'],
    expectedBeforeSha256: values['before-sha256'], output, kind,
    execute: dockerArgs => spawnSync('docker', dockerArgs, {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
    }) });
  console.log(JSON.stringify({ status: report.status, output, functionalAcceptance: false }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
