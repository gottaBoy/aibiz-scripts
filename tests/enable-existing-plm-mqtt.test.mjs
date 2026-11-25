import assert from 'node:assert/strict';
import test from 'node:test';
import { enabledEnvironment, readEnvironment } from '../enable-existing-plm-mqtt.mjs';

test('changes only the MQTT boolean while retaining generated startup overrides', () => {
  const bytes = Buffer.from('window.Environment = {enableMqtt: false, mqttUrl: "/portal/mqtt/mqtt", AppTitle: "PLM"};\n'
    + 'Object.assign(window.Environment, {AppTitle: "Actual title",customParams:"{\\"organization\\":true}"});\n');
  const result = enabledEnvironment(bytes);
  assert.deepEqual(readEnvironment(result), {
    enableMqtt: true, mqttUrl: '/portal/mqtt/mqtt', AppTitle: 'Actual title',
    customParams: '{"organization":true}',
  });
  assert.ok(result.toString().endsWith(bytes.toString().split('\n').slice(1).join('\n')));
});

test('refuses missing, duplicate, already enabled or overridden boolean declarations', () => {
  for (const text of [
    'window.Environment = {};',
    'window.Environment = {enableMqtt: true};',
    'window.Environment = {enableMqtt: false, enableMqtt: false};',
    'window.Environment = {enableMqtt: false}; Object.assign(window.Environment, {enableMqtt: false});',
    'window.Environment = {enableMqtt: "false"};',
  ]) assert.throws(() => enabledEnvironment(Buffer.from(text)));
});
