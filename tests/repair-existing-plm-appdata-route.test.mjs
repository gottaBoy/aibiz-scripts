import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  planPlmAppDataRoute, planPlmInternalMessageRoute, planPlmPersonalConfigRoutes,
  planPlmAppViewThemeRoutes, repairExistingPlmAppData,
} from '../repair-existing-plm-appdata-route.mjs';

const source = `map $http_srforgid $plm_srforgid {
    default $http_srforgid;
    000000 "";
}
set $allinone_upstream http://ibiz-ebsx-allinone:30000;
location = /api/ibizplm__plmweb/appdata {
 rewrite ^ /appdata break;
 proxy_pass $uaa_upstream;
 proxy_set_header Authorization $http_authorization;
 proxy_set_header srfsystemid ibizplm;
 proxy_set_header srforgid $plm_srforgid;
}
location /unrelated { return 403; }
`;
const messageStub = `    location = /api/ibizplm__plmweb/extension/internal_messages/fetch_cur_receiver {
        add_header X-Total 0 always;
        default_type application/json;
        return 200 '[]';
    }`;
const messageSource = planPlmAppDataRoute(Buffer.from(source)).candidate.toString()
  + `${messageStub}\nlocation /other-stub { return 200 '{}'; }\n`;
const configStubs = ['customtheme', 'menu', 'dynafilter'].map(folder =>
  `    location ^~ /api/ibizplm__plmweb/configs/${folder}/ {
        default_type application/json;
        return 200 '${folder === 'dynafilter' ? '{}' : ''}';
    }`).join('\n');
const configSource = `${messageSource}\n${configStubs}\n`;
const viewThemeStub = `    location = /api/ibizplm__plmweb/extension/app_view_themes/fetch_cur_user_all {
        add_header X-Total 0 always;
        default_type application/json;
        return 200 '[]';
    }`;
const viewThemeSource = `${configSource}\n${viewThemeStub}\n`;
function fixture(t, initialSource = source) {
  const root = fs.mkdtempSync(join(tmpdir(), 'plm-route-repair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const containerId = 'a'.repeat(64), imageId = `sha256:${'b'.repeat(64)}`;
  let current = initialSource, uploaded, failTest = false;
  const commands = [];
  const container = { Id: containerId, Image: imageId, Name: '/plmweb',
    Config: { Labels: { 'com.docker.compose.project': 'compose', 'com.docker.compose.service': 'plmweb' } },
    State: { Status: 'running', StartedAt: '2026-11-22T00:00:00Z' }, RestartCount: 0, Mounts: [] };
  return { root, commands, container, containerId, imageId, output: join(root, 'new'),
    expectedBeforeSha256: createHash('sha256').update(initialSource).digest('hex'),
    failTest() { failTest = true; }, current: () => current,
    execute(args) {
      commands.push(args);
      let stdout = '';
      if (args[0] === 'inspect') stdout = JSON.stringify([container]);
      if (args[0] === 'cp') uploaded = fs.readFileSync(args[1], 'utf8');
      if (args.includes('cat')) stdout = args.at(-1).endsWith('-pending') ? uploaded : current;
      if (args.includes('mv')) current = uploaded;
      if (args.includes('stat -c') || args.at(-1).includes('stat -c')) stdout = '101:101:644';
      if (failTest && args.at(-1) === '-t' && current !== initialSource) return { status: 1, stdout: '' };
      return { status: 0, stdout };
    } };
}

test('the plan changes only the observed appdata upstream while preserving the request identity contract', () => {
  const plan = planPlmAppDataRoute(Buffer.from(source));
  assert.equal(plan.candidate.toString(), source.replace('proxy_pass $uaa_upstream;', 'proxy_pass $allinone_upstream;')
    .replace('    000000 "";\n', ''));
  assert.deepEqual(plan.changes, { upstreamChanged: true, organizationPreserved: true });
  for (const text of [source + source, source.replace('srfsystemid ibizplm', 'srfsystemid wrong'),
    source.replace('proxy_pass $uaa_upstream;', 'return 200 "{}";')]) {
    assert.throws(() => planPlmAppDataRoute(Buffer.from(text)));
  }
  const partial = source.replace('proxy_pass $uaa_upstream;', 'proxy_pass $allinone_upstream;');
  assert.deepEqual(planPlmAppDataRoute(Buffer.from(partial)).changes,
    { upstreamChanged: false, organizationPreserved: true });
  assert.throws(() => planPlmAppDataRoute(plan.candidate), /already repaired/);
});

test('the existing container gets an exact backed-up config and a tested reload without lifecycle replacement', async t => {
  const input = fixture(t);
  const result = await repairExistingPlmAppData(input);
  assert.equal(result.status, 'passed-existing-config-reload-only');
  assert.equal(result.functionalAcceptance, false);
  assert.equal(fs.readFileSync(join(input.output, 'before.private.conf'), 'utf8'), source);
  assert.equal(JSON.parse(fs.readFileSync(join(input.output, 'prepared.private.json'))).status, 'prepared');
  assert.ok(input.commands.every(args => ['inspect', 'exec', 'cp'].includes(args[0])));
  assert.ok(input.commands.some(args => args.at(-1) === 'reload'));
  assert.ok(!input.commands.some(args => ['restart', 'start', 'run', 'create', 'pull'].includes(args[0])));
});

test('a rejected candidate restores the exact original and preserves the failure rather than claiming success', async t => {
  const input = fixture(t);
  input.failTest();
  await assert.rejects(repairExistingPlmAppData(input), error => {
    assert.equal(error.evidence.status, 'failed-existing-config-repair');
    assert.equal(error.evidence.rollback.status, 'restored-exact-original');
    return true;
  });
  assert.equal(input.current(), source);
});

test('a private uploaded config is verified as root before restoring the original application ownership', async t => {
  const input = fixture(t);
  const execute = input.execute;
  input.execute = args => {
    if (args.includes('cat') && args.at(-1).endsWith('-pending') && !args.includes('--user')) {
      return { status: 1, stdout: '' };
    }
    return execute(args);
  };
  const report = await repairExistingPlmAppData(input);
  assert.equal(report.status, 'passed-existing-config-reload-only');
  const uploadRead = input.commands.findIndex(args => args.includes('cat') && args.at(-1).endsWith('-pending'));
  const ownerChange = input.commands.findIndex(args => args.includes('chown'));
  assert.ok(uploadRead >= 0 && ownerChange > uploadRead);
});

test('foreign container, replaced image or drifted input refuses any upload', async t => {
  for (const change of [
    value => { value.container.Name = '/another-project'; },
    value => { value.container.Image = `sha256:${'c'.repeat(64)}`; },
    value => { value.expectedBeforeSha256 = 'd'.repeat(64); },
  ]) {
    const input = fixture(t);
    change(input);
    await assert.rejects(repairExistingPlmAppData(input));
    assert.ok(!input.commands.some(args => args[0] === 'cp'));
  }
});

test('message routing replaces only the observed empty stub with the native user API and real identity headers', () => {
  const plan = planPlmInternalMessageRoute(Buffer.from(messageSource));
  const candidate = plan.candidate.toString();
  assert.ok(candidate.includes('/extension/api/internal_messages/$1 break;'));
  assert.ok(candidate.includes('proxy_set_header Authorization $http_authorization;'));
  assert.ok(candidate.includes('proxy_set_header srforgid $plm_srforgid;'));
  assert.ok(!candidate.includes('/extension/core/'));
  assert.ok(!candidate.includes('proxy_set_header srfuserid'));
  assert.equal(candidate.slice(0, candidate.indexOf('    location ^~ /api/ibizplm__plmweb/extension/')),
    messageSource.slice(0, messageSource.indexOf(messageStub)));
  assert.ok(candidate.endsWith("\nlocation /other-stub { return 200 '{}'; }\n"));
  for (const changed of [messageSource.replace("return 200 '[]';", "return 200 '[1]';"),
    messageSource + messageStub, candidate, messageSource.replace('default $http_srforgid;',
      'default $http_srforgid;\n    000000 "";')]) {
    assert.throws(() => planPlmInternalMessageRoute(Buffer.from(changed)));
  }
});

test('the native message proxy uses the same exact backup, identity and reload guards', async t => {
  const input = fixture(t, messageSource);
  const result = await repairExistingPlmAppData({ ...input, kind: 'internal-messages' });
  assert.equal(result.contract, 'existing-plm-internal-message-proxy-repair-v1');
  assert.equal(result.functionalAcceptance, false);
  assert.equal(fs.readFileSync(join(input.output, 'before.private.conf'), 'utf8'), messageSource);
  assert.equal(input.current(), planPlmInternalMessageRoute(Buffer.from(messageSource)).candidate.toString());
  assert.ok(!input.commands.some(args => ['restart', 'run', 'create', 'pull'].includes(args[0])));
});

test('a rejected message route restores its exact stub and preserves the failed receipt', async t => {
  const input = fixture(t, messageSource);
  input.failTest();
  await assert.rejects(repairExistingPlmAppData({ ...input, kind: 'internal-messages' }), error => {
    assert.equal(error.evidence.rollback.status, 'restored-exact-original');
    return true;
  });
  assert.equal(input.current(), messageSource);
});

test('personal configuration replaces only the three observed stubs with authenticated native routes', () => {
  const plan = planPlmPersonalConfigRoutes(Buffer.from(configSource));
  const candidate = plan.candidate.toString();
  assert.equal(candidate.slice(0, messageSource.length), messageSource);
  assert.equal(candidate.match(/rewrite \^\/api\/ibizplm__plmweb\/\(configs\/\.\*\)/g).length, 3);
  assert.ok(candidate.includes('proxy_set_header Authorization $http_authorization;'));
  assert.ok(candidate.includes('proxy_set_header srforgid $plm_srforgid;'));
  assert.ok(!candidate.includes('proxy_set_header srfuserid'));
  assert.deepEqual(plan.changes.personalConfigStubsRemoved, ['customtheme', 'menu', 'dynafilter']);
  for (const changed of [
    configSource.replace("return 200 '';", "return 200 'unexpected';"),
    configSource + configStubs,
    candidate,
    configSource.replace('default $http_srforgid;', 'default $http_srforgid;\n    000000 "";'),
  ]) assert.throws(() => planPlmPersonalConfigRoutes(Buffer.from(changed)));
});

test('the three personal configuration routes share atomic backup/reload and exact rollback guards', async t => {
  const input = fixture(t, configSource);
  const result = await repairExistingPlmAppData({ ...input, kind: 'personal-config' });
  assert.equal(result.contract, 'existing-plm-personal-config-proxy-repair-v1');
  assert.equal(result.functionalAcceptance, false);
  assert.equal(input.current(), planPlmPersonalConfigRoutes(Buffer.from(configSource)).candidate.toString());
  assert.equal(fs.readFileSync(join(input.output, 'before.private.conf'), 'utf8'), configSource);
  const rejected = fixture(t, configSource);
  rejected.failTest();
  await assert.rejects(repairExistingPlmAppData({ ...rejected, kind: 'personal-config' }), error => {
    assert.equal(error.evidence.rollback.status, 'restored-exact-original');
    return true;
  });
  assert.equal(rejected.current(), configSource);
});

test('view themes expose only the precise native user collection and descendants with real authentication', () => {
  const plan = planPlmAppViewThemeRoutes(Buffer.from(viewThemeSource));
  const candidate = plan.candidate.toString();
  assert.ok(candidate.startsWith(configSource));
  assert.ok(candidate.includes('location = /api/ibizplm__plmweb/extension/app_view_themes {'));
  assert.ok(candidate.includes('location ^~ /api/ibizplm__plmweb/extension/app_view_themes/ {'));
  assert.ok(candidate.includes('rewrite ^ /extension/api/app_view_themes break;'));
  assert.ok(candidate.includes('/extension/api/app_view_themes/$1 break;'));
  assert.equal((candidate.match(/proxy_set_header srfsystemid ibizplm;/g) ?? []).length,
    (viewThemeSource.match(/proxy_set_header srfsystemid ibizplm;/g) ?? []).length + 2);
  assert.ok(!candidate.includes('proxy_set_header srfuserid'));
  assert.ok(!candidate.includes('/extension/core/'));
  assert.ok(!candidate.includes(viewThemeStub));
  assert.ok(candidate.includes("location /other-stub { return 200 '{}'; }"));
});

test('view-theme repair refuses duplicate, changed, preexisting and organization-stripping inputs', () => {
  const candidate = planPlmAppViewThemeRoutes(Buffer.from(viewThemeSource)).candidate.toString();
  for (const changed of [
    viewThemeSource + viewThemeStub, candidate,
    viewThemeSource.replace(viewThemeStub, viewThemeStub.replace("return 200 '[]';", "return 200 '[1]';")),
    `${viewThemeSource}\nlocation = /api/ibizplm__plmweb/extension/app_view_themes { return 403; }`,
    viewThemeSource.replace('default $http_srforgid;', 'default $http_srforgid;\n    000000 "";'),
  ]) assert.throws(() => planPlmAppViewThemeRoutes(Buffer.from(changed)));
});

test('view-theme proxy retains exact backup, tested reload and failure rollback without a container restart', async t => {
  const input = fixture(t, viewThemeSource);
  const result = await repairExistingPlmAppData({ ...input, kind: 'app-view-themes' });
  assert.equal(result.contract, 'existing-plm-app-view-theme-proxy-repair-v1');
  assert.equal(result.functionalAcceptance, false);
  assert.equal(input.current(), planPlmAppViewThemeRoutes(Buffer.from(viewThemeSource)).candidate.toString());
  assert.ok(!input.commands.some(args => ['restart', 'run', 'create', 'pull'].includes(args[0])));
  const rejected = fixture(t, viewThemeSource);
  rejected.failTest();
  await assert.rejects(repairExistingPlmAppData({ ...rejected, kind: 'app-view-themes' }), error => {
    assert.equal(error.evidence.rollback.status, 'restored-exact-original');
    return true;
  });
  assert.equal(rejected.current(), viewThemeSource);
});
