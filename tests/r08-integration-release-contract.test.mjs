import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(relativePath) {
  return fs.readFileSync(resolve(workspace, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function hasEvery(source, values) {
  return values.every(value => source.includes(value));
}

const thirdAuthSources = [
  'ibiz-app-hub/packages/runtime/src/service/service/third-auth/third-auth.service.ts',
  'modelingweb/packages-latest/@ibiz-template/runtime/src/service/service/third-auth/third-auth.service.ts',
];
const thirdAuthLocaleSources = [
  'ibiz-app-hub/packages/runtime/src/locale/en/index.ts',
  'ibiz-app-hub/packages/runtime/src/locale/zh-CN/index.ts',
  'modelingweb/packages-latest/@ibiz-template/runtime/src/locale/en/index.ts',
  'modelingweb/packages-latest/@ibiz-template/runtime/src/locale/zh-CN/index.ts',
];
const thirdAuthMessages = [
  'noSupported',
  'corpidError',
  'dingTalkCodeErrir',
  'dingTalkAuthError',
  'appIdError',
  'oauthOpenAccessIdError',
];

test('R08 third-party auth keeps separate DingTalk/WeCom/OAuth paths and localized failures', () => {
  for (const path of thirdAuthSources) {
    const source = read(path);
    assert.ok(hasEvery(source, [
      "case 'DINGTALK':",
      "case 'WXWORK':",
      "case 'OAUTH':",
      "mode === 'EMBED'",
      '/uaa/open/dingtalk/auth/',
      '/uaa/open/dingtalk/appid',
      '/uaa/open/wxwork/appid',
      '/uaa/open/oauth2-',
      'encodeURIComponent(redirectUri)',
      "srfthird_auth_success=false",
    ]), `${path} lost an explicit auth route or failure branch`);
    assert.doesNotMatch(
      source,
      /(?:accesskey|secretkey|client_secret|app_secret)\s*[:=]\s*['"][^'"]{8,}/i,
      `${path} must not carry third-party credentials`,
    );
  }
  for (const path of thirdAuthLocaleSources) {
    const source = read(path);
    assert.ok(hasEvery(source, thirdAuthMessages), `${path} is missing a third-auth message key`);
  }

  const english = read('ibiz-app-hub/packages/runtime/src/locale/en/index.ts');
  const chinese = read('ibiz-app-hub/packages/runtime/src/locale/zh-CN/index.ts');
  assert.match(english, /noSupported:\s*'Login with \{type\} is not supported'/);
  assert.match(chinese, /noSupported:\s*'暂不支持\{type\}登录'/);
  assert.match(english, /dingTalkCodeErrir:[\s\S]{0,120}DingTalk authorization code/);
  assert.match(chinese, /dingTalkCodeErrir:\s*'获取钉钉授权码异常'/);
});

test('R08 PLM model preserves provider identity fields and explicit WeCom-to-PLM binding', () => {
  const employee = readJson(
    'plm/model/PSSYSMODELGROUPS/ebsx/PSMODULES/ebsx/PSDATAENTITIES/SysEmployee.json',
  );
  const employeeFields = new Set(employee.getAllPSDEFields.map(field => field.name));
  for (const field of ['PHONE', 'DDUNIONID', 'DDUSERID', 'WXWORKUNIONID', 'WXWORKUSERID']) {
    assert.ok(employeeFields.has(field), `SysEmployee is missing ${field}`);
  }

  const openUser = readJson(
    'plm/model/PSSYSMODELGROUPS/ebsx/PSMODULES/ebsx/PSDATAENTITIES/openuser.json',
  );
  assert.ok(openUser.getAllPSDEFields.some(field => field.name === 'OPEN_TYPE'));
  assert.ok(openUser.getAllPSDEDataSets.some(dataset => dataset.codeName === 'wxwork'));

  const userForm = read(
    'plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/user/PSFORMS/main_view.json',
  );
  assert.match(userForm, /企业微信用户与PLM用户需手动绑定对应关系/);
  assert.match(userForm, /SRFNAVPARAM\.N_OPEN_TYPE_EQ/);
  assert.match(userForm, /"value"\s*:\s*"wxwork"/);
  assert.match(userForm, /"open_user_tag"/);
  assert.match(
    userForm,
    /企业微信绑定/,
    'WeCom identity must remain an explicit user binding, not a phone guess',
  );
});

test('R08 MQTT deployment and console capability states are explicit and bilingual', () => {
  const coreEnvironment = read('ibiz-app-hub/packages/core/src/environment/environment.ts');
  assert.match(coreEnvironment, /enableMqtt:\s*false/);
  assert.match(read('modelingweb/environment.config'), /enableMqtt:ENABLEMQTT/);
  for (const path of [
    'plm/deploy/compose/docker-compose-modeling-native.yml',
    'plm/deploy/compose/docker-compose-modeling-native-candidate.yml',
  ]) {
    assert.match(read(path), /ENABLEMQTT:\s*"false"/, `${path} must keep MQTT disabled by default`);
  }

  const consoleSource = read('modelingweb/local-plugins/console-layout/src/console.ts');
  assert.ok(hasEvery(consoleSource, [
    'MQTT is disabled in this deployment.',
    'Authenticated application data does not contain an MQTT topic.',
    'Authenticated host MQTT service is unavailable.',
    'MQTT broker did not grant the exact console topic.',
    '当前部署未启用 MQTT，实时日志不可用。',
    '登录后的应用数据未配置 MQTT 主题。',
    '已登录的宿主 MQTT 服务不可用。',
    'MQTT 服务未授权当前控制台主题。',
  ]));
  assert.match(consoleSource, /environment\?\.enableMqtt !== false && host\?\.env\?\.enableMqtt === true/);
  assert.match(consoleSource, /receivedTopic !== topic \|\| message\?\.type !== 'CONSOLE'/);
  assert.match(consoleSource, /client\.subscribe\(topic/);

  const overrideDoc = read('modelingweb/docs/MQTT-DEPLOYMENT-OVERRIDE-20261109.md');
  assert.match(overrideDoc, /not live\s+browser or production acceptance/i);
  assert.match(overrideDoc, /CollaborateRoom\.created\(\)/);
  assert.match(overrideDoc, /does not alter or claim acceptance/i);
});

test('R08 release and rollback documentation remains fail-closed', () => {
  const remaining = read('scripts/docs/REMAINING-EXECUTION-20261108.md');
  assert.match(remaining, /\|\s*K03\s*\|\s*Offline update and rollback\s*\|\s*OPEN\s*\|/);
  assert.match(remaining, /\|\s*O03\s*\|\s*Reviewed shared deployment\s*\|\s*OPEN\s*\|/);

  const blockers = read('scripts/docs/OWNED-RUNTIME-BLOCKERS-20261115.md');
  assert.match(blockers, /\|\s*R08\s*\|[\s\S]{0,500}real third-party delivery[\s\S]{0,500}rollout\/rollback evidence/);
  assert.match(blockers, /Supply\/review real inputs/);

  const lock = read('scripts/docs/AIBIZ-RUNTIME-LOCK-20261113.md');
  assert.match(lock, /not a\s+registry manifest digest, a new deployment or an accepted release/i);
  assert.match(lock, /not a tested whole-stack automatic rollback/i);

  const embedded = read('scripts/docs/EMBEDDED-MODELING-20261116.md');
  assert.match(embedded, /Review a rollback-bound frontend delivery/);
  assert.match(embedded, /MQTT delivery is a separate gate/);
});

test('R08 source-level status vocabulary documents the external gates without claiming delivery', () => {
  const guide = read('scripts/docs/R08-INTEGRATION-RELEASE-20261116.md');
  for (const state of [
    'not-configured',
    'configured-pending-validation',
    'sync-failed',
    'sync-succeeded-unbound',
    'notification-verified',
  ]) assert.match(guide, new RegExp(`\\b${state}\\b`));
  assert.match(guide, /真实凭据|real credentials/);
  assert.match(guide, /真实 MQTT broker|real MQTT broker/i);
  assert.match(guide, /不关闭|must remain open/i);
  assert.match(guide, /不构成真实投递|does not constitute real delivery/i);
});
