import assert from 'node:assert/strict';
import test from 'node:test';
import { namespaceAcl } from '../protect-existing-mqtt-plm-namespace.mjs';

const original = { type: 'file', enable: true, rules: '{allow, all}.\n' };
const namespace = `/s${'a'.repeat(32)}/#`;

test('only the native exact PLM namespace is protected and original rules retain byte order', () => {
  const changed = namespaceAcl(original, namespace, '172.21.0.6');
  assert.equal(changed.rules,
    `{allow, {ipaddr, "172.21.0.6"}, publish, ["${namespace}"]}.\n`
    + `{deny, all, all, ["${namespace}"]}.\n${original.rules}`);
  assert.equal(original.rules, '{allow, all}.\n');
});

test('broad namespaces, wrong roots and unbound external publisher addresses are rejected', () => {
  for (const value of ['#', '/#', '/s+/#', '/sabc/#', `${namespace}/extra`, '/other/#']) {
    assert.throws(() => namespaceAcl(original, value, '172.21.0.6'));
  }
  for (const address of ['0.0.0.0', '127.0.0.1', '172.22.0.6', '172.21.0.6/16', '172.21.0.6"']) {
    assert.throws(() => namespaceAcl(original, namespace, address));
  }
});
