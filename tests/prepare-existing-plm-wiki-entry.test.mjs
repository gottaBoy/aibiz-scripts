import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  deriveWikiNginx, inspectCachedWikiAuthentication, inspectWikiGuestContract, parseWikiEnvironment,
  sanitizeWikiEnvironment, validateDisabledWikiGuestConfiguration, validateWikiAssetPath, validateWikiNginxDelta,
} from '../prepare-existing-plm-wiki-entry.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const environment = {
  baseUrl: 'ibizplm__plmwiki', appId: 'ibizplm__plmwiki', BaseUrl: '/api',
  enableAnonymous: false, anonymousUser: 'owned-old-user', anonymousPwd: 'owned-old-password',
  pluginBaseUrl: './plugins', enableMqtt: false, AppLabel: '百科🙂 e\u0301 " \\\nSecond line',
};
const encoded = value => `window.Environment = ${JSON.stringify(value)};\n`;

test('static environment parsing clears only the old credentials and preserves the real namespace and Unicode', () => {
  const result = sanitizeWikiEnvironment(encoded(environment));
  assert.equal(result.after.enableAnonymous, false);
  assert.equal(result.after.anonymousUser, '');
  assert.equal(result.after.anonymousPwd, '');
  assert.deepEqual(result.after, { ...environment, anonymousUser: '', anonymousPwd: '' });
  assert.equal(parseWikiEnvironment(result.output).AppLabel, environment.AppLabel);
});

test('executable, duplicated, computed, prototype and changed namespace environments are rejected', () => {
  for (const value of [
    `${encoded(environment)}window.Environment.enableAnonymous = true;`,
    'window.Environment = {baseUrl: calculate()};',
    'window.Environment = {...other};',
    'window.Environment = {get anonymousUser(){return "x"}};',
    'window.Environment = {["appId"]:"ibizplm__plmwiki"};',
    'window.Environment = {"__proto__": {}};',
    'window.Environment = {a:1,a:2};',
    'window.Environment = {value: /test/};',
    encoded({ ...environment, appId: 'ibizplm__plmweb' }),
    encoded({ ...environment, baseUrl: '/api/other' }),
    encoded({ ...environment, enableAnonymous: true }),
  ]) assert.throws(() => sanitizeWikiEnvironment(value));
});

test('nginx delta adds only the two exact static locations and keeps every previous byte', () => {
  const before = fs.readFileSync(path.join(workspace, 'plm-web/nginx-local.conf'), 'utf8');
  const after = deriveWikiNginx(before);
  assert.deepEqual(validateWikiNginxDelta(before, after), {
    addedLocations: ['= /plmwiki', '^~ /plmwiki/'], APIChanges: false, identityHeadersAdded: false,
  });
  for (const changed of [
    `${after}\nlocation /api/ { allow all; }\n`,
    after.replace('alias /dist/plmwiki/;', 'alias /dist/;'),
    after.replace('index index.html;', 'autoindex on;'),
  ]) assert.throws(() => validateWikiNginxDelta(before, changed));
  assert.throws(() => deriveWikiNginx(`${before}\n`));
});

test('asset targets reject traversal, absolute paths and ambiguous components', () => {
  assert.equal(validateWikiAssetPath('extras/js/@ibiz-template/runtime/index.system.min.js'),
    'extras/js/@ibiz-template/runtime/index.system.min.js');
  for (const value of ['', '/etc/passwd', '../outside', 'a/../../outside', 'a//b', 'a/./b', 'a\\b', 'a\0b']) {
    assert.throws(() => validateWikiAssetPath(value));
  }
});

test('cached native auth is parsed without execution and retains its normal login dependency', () => {
  const source = `class V7Auth {
    async anonymousLogin() {
      const {anonymousUser, anonymousPwd} = ibiz.env;
      if (!anonymousUser || !anonymousPwd) return false;
      return this.login(anonymousUser, anonymousPwd);
    }
    async login(user,pwd) { return ibiz.net.post('/v7/login', {user,pwd}); }
  }`;
  const result = inspectCachedWikiAuthentication(source);
  assert.equal(result.credentialFreeAnonymousBootstrap, false);
  assert.equal(result.methods[0].delegatesToNormalV7Login, true);
  assert.throws(() => inspectCachedWikiAuthentication(source.replace('/v7/login', '/fake-login')));
  assert.throws(() => inspectCachedWikiAuthentication('class Other {}'));
});

test('current authority exposes unresolved guest gates instead of granting access', () => {
  const read = relative => fs.readFileSync(path.join(workspace, relative), 'utf8');
  const model = relative => JSON.parse(read(relative));
  const value = inspectWikiGuestContract({
    entity: model('plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json'),
    appEntity: model('plm/model/PSSYSAPPS/plmwiki/PSAPPDATAENTITIES/article_page.json'),
    serviceAPI: model('plm/model/PSSYSSERVICEAPIS/ServiceAPI.json'),
    sharedView: model('plm/model/PSSYSAPPS/plmwiki/PSAPPDEVIEWS/article_page_wiki_shared_view.json'),
    subtreeView: model('plm/model/PSSYSAPPS/plmwiki/PSAPPDEVIEWS/article_page_shared_with_sub_view.json'),
    displayForm: model('plm/model/PSSYSAPPS/plmwiki/PSAPPDATAENTITIES/article_page/PSFORMS/wiki_show_edit_view_form.json'),
    sharedAction: model('plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDEACTIONS/shared.json'),
    sharedInfo: model('plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/get_shared_info.json'),
    authSource: read('ibiz-app-hub/packages/runtime/src/service/service/auth/v7-auth.service.ts'),
    cloudAPISource: read('ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/service/SysServiceAPIRuntime.java'),
    APILevelSource: read('ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/service/SysServiceAPILevels.java'),
  });
  assert.equal(value.status, 'GUEST_ACTIVATION_BLOCKED_CURRENT_CONTRACT');
  assert.equal(value.currentModel.defaultDTOIncludesDraftContent, true);
  assert.equal(value.currentModel.internalSharedLogicCopiesPassword, true);
  validateDisabledWikiGuestConfiguration(value.activeGuestConfiguration);
  for (const mutate of [
    candidate => { candidate.enableAnonymous = true; },
    candidate => { candidate.anonymousUser = 'owner'; },
    candidate => { candidate.anonymousPwd = 'old-embedded'; },
    candidate => { candidate.APILevelOverride = 4; },
    candidate => { candidate.ignoreAuthPatterns = ['/**']; },
    candidate => { candidate.newAccounts = ['visitor']; },
    candidate => { candidate.roleGrants = ['READ']; },
  ]) {
    const candidate = structuredClone(value.activeGuestConfiguration);
    mutate(candidate);
    assert.throws(() => validateDisabledWikiGuestConfiguration(candidate));
  }
});
