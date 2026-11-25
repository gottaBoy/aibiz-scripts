import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  loginImageProxyBlock, mqttProxyBlock, planPlmLoginImageRoutes, planPlmMqttRoute,
} from '../repair-existing-plm-appdata-route.mjs';

test('the exact MQTT WebSocket location preserves the existing portal and all other bytes', () => {
  const before = fs.readFileSync(new URL('../../plm-web/nginx-local.conf', import.meta.url));
  const text = before.toString().replace(mqttProxyBlock, '');
  const result = planPlmMqttRoute(Buffer.from(text));
  assert.equal(result.candidate.toString().replace(mqttProxyBlock, ''), text);
  assert.ok(result.candidate.toString().indexOf(mqttProxyBlock) <
    result.candidate.toString().indexOf('location ^~ /api/ibizplm__plmweb/portal/ {'));
  assert.match(mqttProxyBlock, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.doesNotMatch(mqttProxyBlock, /srfuserid|srfusername|Authorization|return 200/);
  assert.equal(result.changes.applicationMqttEnabled, false);
});

test('a duplicate or missing MQTT route cannot be adopted', () => {
  const marker = '    location ^~ /api/ibizplm__plmweb/portal/ {';
  assert.throws(() => planPlmMqttRoute(Buffer.from('server {}')));
  assert.throws(() => planPlmMqttRoute(Buffer.from(`${marker}\n${marker}`)));
  assert.throws(() => planPlmMqttRoute(Buffer.from(`${mqttProxyBlock}${marker}`)));
});

test('the two existing login images receive only precise static aliases', () => {
  const before = fs.readFileSync(new URL('../../plm-web/nginx-local.conf', import.meta.url))
    .toString().replace(loginImageProxyBlock, '');
  const plan = planPlmLoginImageRoutes(Buffer.from(before));
  assert.equal(plan.candidate.toString().replace(loginImageProxyBlock, ''), before);
  assert.equal((loginImageProxyBlock.match(/location = /g) ?? []).length, 2);
  assert.doesNotMatch(loginImageProxyBlock, /proxy_pass|rewrite|Authorization|srfuser|return 200/);
  assert.throws(() => planPlmLoginImageRoutes(plan.candidate));
  for (const name of plan.changes.staticImageAliases) {
    const published = fs.readFileSync(new URL(`../../plm-web/dist/assets/images/${name}`, import.meta.url));
    const source = fs.readFileSync(new URL(`../../plm-web/public/assets/images/${name}`, import.meta.url));
    assert.deepEqual(published, source);
    assert.ok(published.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  }
});
