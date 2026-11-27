import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveWikiArchiveHelper, nativeWikiClassBindings, validateLocalWikiConfiguration,
  validateNativeWikiProof, validateWikiClassOverlay, wikiOriginSetting,
} from '../prepare-existing-plm-wiki-settings.mjs';

const before = 'ibiz:\n  deploysystems:\n    master:\n      deploysystemid: ${system.name}\n'
  + '  servicehub:\n    initmode: auto\n    systemsettings:\n      cloudclientutil:\n        serviceurl: local\n';
const after = `${before}      param:\n        plm_wiki: ${wikiOriginSetting}\n`;

test('permits only the local system parameter and preserves configurable origin', () => {
  assert.equal(validateLocalWikiConfiguration(before, after).namespace,
    'ibiz.servicehub.systemsettings.param.plm_wiki');
});

test('refuses service mode, credentials, runtime loading and unrelated setting changes', () => {
  for (const changed of [
    after.replace('initmode: auto', 'initmode: manual'),
    after.replace('serviceurl: local', 'serviceurl: other'),
    after.replace('${system.name}', 'other-system'),
    after.replace(wikiOriginSetting, 'https://unreviewed.example'),
    `${after}      repo: unreviewed\n`,
  ]) assert.throws(() => validateLocalWikiConfiguration(before, changed));
});

test('refuses duplicate keys and an already configured original', () => {
  assert.throws(() => validateLocalWikiConfiguration(before, `${after}ibiz: {}\n`));
  assert.throws(() => validateLocalWikiConfiguration(after, after));
});

test('the derived helper extends only the exact YAML resource and rejects template drift', () => {
  const source = fs.readFileSync(new URL('../fixtures/PrepareRuntimeArchiveOverlay.java', import.meta.url), 'utf8');
  const derived = deriveWikiArchiveHelper(source);
  assert.match(derived, /entry\.equals\("BOOT-INF\/classes\/application-auto\.yml"\)/);
  assert.throws(() => deriveWikiArchiveHelper('unreviewed helper'));
  assert.throws(() => deriveWikiArchiveHelper(source + source));
});

function proofFixture() {
  const rows = source => ['check_shared', 'access_password'].flatMap(name =>
    [false, true].flatMap(expired => [false, true].map(passwordCase => {
      const trace = [];
      if (source) {
        trace.push('RAWSFCODE1');
        if (name === 'access_password' && !expired) trace.push(passwordCase ? 'PREPAREPARAM1' : 'PREPAREPARAM2');
        trace.push('END1');
      }
      return { name, expired, passwordCase, effective: expired ? 0 : 1, trace,
        resultNull: !source, resultIsOriginalDTO: source,
        checkPassword: name === 'check_shared' ? Number(passwordCase) : Number(source && !expired && passwordCase) };
    })));
  return {
    contract: 'owned-wiki-native-sharing-dispatch-v1', status: 'PASS_16_NATIVE_DISPATCH_CELLS',
    primaryCells: 16, bytecodeTarget: '1.8', sourceInputsStable: true, HTTPExecuted: false, databaseExecuted: false,
    sharedRuntimeModified: false, businessAcceptance: false, startNode: 'RAWSFCODE1',
    classesDirectory: '/owned/classes',
    dependencies: Array.from({ length: 488 }, (_, index) => ({ file: `/owned/dependencies/${index}.jar` })),
    sourceBindings: nativeWikiClassBindings.map(item => ({ path: item.sourcePath, sha256: item.sourceSha256 })),
    compiledClasses: nativeWikiClassBindings.map(item => ({
      name: item.name, path: path.join('/owned/classes', item.entry), sha256: item.sha256, classMajor: 52,
    })),
    observed: { sealedNative: { rows: rows(false) }, currentSource: { rows: rows(true) } },
  };
}

function overlayFixture() {
  return { entries: nativeWikiClassBindings.flatMap(item => [
    { entry: item.entry, changed: true, added: false, beforeSha256: item.oldSha256, afterSha256: item.sha256 },
    { entry: item.entry.slice(0, -6) + '$_executeRAWSFCODE1_closure1.class',
      changed: false, added: false, beforeSha256: 'c'.repeat(64), afterSha256: 'c'.repeat(64) },
  ]) };
}

test('native proof requires all old-negative and current-positive cells with exact source/class bindings', () => {
  assert.equal(validateNativeWikiProof(proofFixture()).primaryCells, 16);
  for (const mutate of [
    value => { value.primaryCells = 15; },
    value => { value.bytecodeTarget = '11'; },
    value => { value.sourceInputsStable = false; },
    value => { value.HTTPExecuted = true; },
    value => { value.compiledClasses[0].sha256 = '0'.repeat(64); },
    value => { value.compiledClasses[0].classMajor = 55; },
    value => { value.sourceBindings[0].sha256 = '0'.repeat(64); },
    value => { value.compiledClasses[0].path = '/owned/other.class'; },
    value => { value.dependencies[1].file = value.dependencies[0].file; },
    value => { value.observed.currentSource.rows[1] = structuredClone(value.observed.currentSource.rows[0]); },
    value => { value.observed.currentSource.rows[5].checkPassword = 0; },
    value => { value.observed.sealedNative.rows[0].resultNull = false; },
    value => { delete value.observed.sealedNative; },
  ]) {
    const value = proofFixture();
    mutate(value);
    assert.throws(() => validateNativeWikiProof(value));
  }
});

test('inner overlay changes only the two reviewed main classes and preserves legacy closures', () => {
  validateWikiClassOverlay(overlayFixture());
  for (const mutate of [
    value => { value.entries[0].entry = 'cn/ibizlab/plm/prodmgmt/idea/logic/GetCustomerScore.class'; },
    value => { value.entries[0].afterSha256 = '0'.repeat(64); },
    value => { value.entries[0].beforeSha256 = '0'.repeat(64); },
    value => { value.entries[0].added = true; },
    value => { value.entries[1].removed = true; },
    value => { value.entries[1].afterSha256 = '0'.repeat(64); },
    value => { value.entries = value.entries.filter(row => !row.entry.includes('CheckShared$')); },
    value => { value.entries.push(structuredClone(value.entries[0])); },
  ]) {
    const value = overlayFixture();
    mutate(value);
    assert.throws(() => validateWikiClassOverlay(value));
  }
});
