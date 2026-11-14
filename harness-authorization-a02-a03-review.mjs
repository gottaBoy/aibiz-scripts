#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export const A02_A03_SOURCES = Object.freeze({
  accessManager: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java',
  cacheCodec: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/PSDevUserCacheCodec.java',
  actionSession: 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSessionManager.java',
  actionSessionModel: 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSession.java',
  holder: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSDevSysUserHolder.java',
});

export const A02_A03_TESTS = Object.freeze({
  cleanup: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/runtime/util/ActionSessionManagerCleanupTest.java',
  cache: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/security/SystemAccessManagerJsonCacheTest.java',
  request: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/security/SystemAccessManagerRequestCacheTest.java',
  holder: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/util/PSDevSysUserHolderTest.java',
  addin: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/sysutil/addin/ModelSysUtilRTAddinAuthorizationTest.java',
});

const read = (workspace, path) => {
  const absolute = resolve(workspace, path);
  const bytes = fs.readFileSync(absolute);
  return { path, absolute, text: bytes.toString('utf8'), bytes, sha256: hash(bytes) };
};

const requireAll = (text, fragments, label) => {
  for (const fragment of fragments) assert.ok(text.includes(fragment), `${label}: missing ${fragment}`);
};

const bindingTable = (workspace, table) => Object.fromEntries(Object.entries(table).map(([key, path]) => {
  const file = read(workspace, path);
  return [key, { path, sha256: file.sha256, bytes: file.bytes.length }];
}));

export function inspectA02A03({ sources, tests, workspace = workspaceDefault }) {
  const manager = sources.accessManager;
  const codec = sources.cacheCodec;
  const actionSession = sources.actionSession;
  const actionModel = sources.actionSessionModel;
  const holder = sources.holder;
  const cacheTests = tests.cache;
  const requestTests = tests.request;
  const holderTests = tests.holder;
  const addinTests = tests.addin;

  requireAll(manager, [
    'PSDevUserCacheCodec.decode(entry, strObjectType, strObjectId)',
    'if (iPSDevUserBase instanceof IPSDevSlnUser)',
    'return iPSDevUserBase;',
    'CloudCacheTagUtils.getAuthenticationUserCat((String)iAuthenticationUser.getUsername(), (String)iAuthenticationUser.getToken())',
    'this.getPSDevSlnUserDTO',
  ], 'A02 manager');
  requireAll(codec, [
    'SCHEMA_VERSION',
    'accMode',
    'expiredTimeMillis',
    'expiredTimeNanos',
  ], 'A02 codec');
  requireAll(cacheTests, [
    'fixture.grants.clear();',
    'assertRepeatedJsonHits(fixture, type, fresh);',
    'cachedCenterAndSystemAuthorizationCannotCrossAuthenticationTokenCategories',
  ], 'A02 tests');
  const cacheBypassesGrantLookup = /if \(iPSDevUserBase instanceof IPSDevSlnUser\)[\s\S]*?return iPSDevUserBase;/.test(manager)
    && cacheTests.includes('fixture.grants.clear();')
    && cacheTests.includes('assertRepeatedJsonHits(fixture, type, fresh);');
  assert.equal(cacheBypassesGrantLookup, true);

  requireAll(holder, [
    'ThreadLocal<Deque<IPSDevSysUser>>',
    'HOLDER.get().push(user)',
    'users.poll()',
    'HOLDER.remove()',
  ], 'A03 holder');
  requireAll(holderTests, [
    'holderBehavesAsAThreadLocalStack',
    'holderDoesNotCrossThreadBoundaries',
  ], 'A03 holder tests');
  requireAll(requestTests, [
    'PSDevSysUserHolder.clear();',
    'ActionSessionManager.closeSession(false);',
  ], 'A03 request cleanup');
  requireAll(actionSession, [
    'private static ThreadLocal<ActionSession> actionSession',
    'static public ActionSession openSession(String strName)',
    'if (currentSession == null)',
    '} finally {',
    'if (actionSession.get() == currentSession)',
    'actionSession.remove()',
  ], 'A03 session manager');
  requireAll(tests.cleanup, [
    'commitCallbackFailurePropagatesTheSameExceptionAndRemovesTheSession',
    'rollbackCallbackFailurePropagatesTheSameExceptionAndRemovesTheSession',
    'callbackFailureCannotClearItsReplacementSession',
    'aReusedWorkerDoesNotInheritIdentityOrCachedPermissionAfterFailedClose',
  ], 'A03 cleanup tests');
  requireAll(actionModel, [
    '//private ActionSession childActionSession',
    '//\tpublic ActionSession openChildSession',
    '//\tpublic int closeChildSession',
  ], 'A03 session model');
  const flatSession = /openSession\(String strName\)[\s\S]*?if \(currentSession == null\)[\s\S]*?return currentSession;/.test(actionSession);
  const nestedApiAbsent = !/\bopenNestedSession\b|\bcloseNestedSession\b|\bexecuteNestedSession\b/.test(
    `${actionSession}\n${actionModel}`);
  const nestedTestsAbsent = !/\bnestedActionSession\b|\bparent restoration\b|\bchild session\b/i.test(
    `${cacheTests}\n${requestTests}\n${holderTests}\n${addinTests}`);
  assert.equal(flatSession, true);
  assert.equal(nestedApiAbsent, true);
  assert.equal(nestedTestsAbsent, true);

  return {
    contract: 'authorization-a02-a03-threat-review-v2',
    generatedAt: new Date().toISOString(),
    nativeAcceptance: false,
    httpAcceptance: false,
    productionChanges: true,
    productionChangeScope: 'Exception-safe close cleanup only; no A02 invalidation or A03 nested API.',
    javaExecutionAcceptance: false,
    items: {
      A02: {
        status: 'BLOCKED',
        threat: 'A same-token cache entry can survive grant removal or demotion because cached IPSDevSlnUser values return before grant-source lookup.',
        observed: { cacheBypassesGrantLookup, expiryStillChecked: true, tokenScopedCategory: true },
        minimalSafeDesign: [
          'Add a monotonic authorization revision per grant principal/root in the authoritative mutation service.',
          'Publish the revision through the existing owned cache/event transport after every PSDevSlnUser create/update/remove, including native/admin mutation paths.',
          'Store revision with PSDevUserCacheCodec.Entry and reject cache hits whose revision differs before returning authorization.',
          'Prove cross-node ordering, failed event delivery, direct SQL/native writes and administrator/WXMP semantics before enabling.',
        ],
        compatibilityRisk: 'High: current source has no revision field or complete mutation hook; unconditional per-hit DB revalidation changes latency and special-role semantics.',
        blocker: 'No reviewed authoritative revision/invalidation protocol exists.',
      },
      A03: {
        status: 'BLOCKED',
        threat: 'ActionSessionManager is flat; nested callers cannot restore a parent session after child success or exception, while holder cleanup is independently stack-based.',
        observed: { flatSession, nestedApiAbsent, nestedTestsAbsent, holderStackVerified: true,
          identityCheckedFinallyRemoval: true, cleanupTestsPresent: true },
        minimalSafeDesign: [
          'Add explicit openNestedSession/closeNestedSession APIs backed by a per-thread stack; keep openSession idempotent for compatibility.',
          'Close nested sessions in finally blocks and restore parent on both commit and rollback.',
          'Add executeNestedSession helper and tests for success, exception, parent context restoration and thread isolation.',
          'Do not reinterpret existing openSession callers until every bOpenActionSession/closeSession pair is audited.',
        ],
        compatibilityRisk: 'High: changing openSession semantics would alter dozens of existing transaction guards and close behavior.',
        blocker: 'No nested API or error-unwind contract is present; production semantics must remain flat until explicit API is reviewed.',
      },
    },
    sourceBindings: bindingTable(workspace, A02_A03_SOURCES),
    testBindings: bindingTable(workspace, A02_A03_TESTS),
  };
}

export function readA02A03Sources({ workspace = workspaceDefault } = {}) {
  workspace = resolve(workspace);
  const sources = Object.fromEntries(Object.entries(A02_A03_SOURCES)
    .map(([key, path]) => [key, read(workspace, path).text]));
  const tests = Object.fromEntries(Object.entries(A02_A03_TESTS)
    .map(([key, path]) => [key, read(workspace, path).text]));
  return { sources, tests, workspace };
}

export function buildA02A03Receipt({ workspace = workspaceDefault } = {}) {
  return inspectA02A03(readA02A03Sources({ workspace }));
}

function outputPath(workspace, output) {
  const absolute = resolve(workspace, output);
  const child = relative(resolve(workspace, '.artifacts'), absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'Receipt output must remain under .artifacts');
  assert.match(absolute, /authorization-a02-a03-[a-z0-9][a-z0-9-]*\/report\.json$/);
  return absolute;
}

export function writeA02A03Receipt(report, {
  workspace = workspaceDefault, output = '.artifacts/authorization-a02-a03-20261111/report.json',
} = {}) {
  workspace = resolve(workspace);
  const absolute = outputPath(workspace, output);
  fs.mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  assert.ok(!fs.existsSync(absolute), 'Receipt output must be exclusive');
  const bytes = Buffer.from(json(report));
  const descriptor = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  return { path: absolute, sha256: hash(bytes), bytes: bytes.length };
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    const match = /^--output=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, 'output'), 'Only --output=... is accepted');
    options.output = match[1];
  }
  const report = buildA02A03Receipt();
  const binding = writeA02A03Receipt(report, { output: options.output });
  console.log(json({ path: binding.path, sha256: binding.sha256,
    A02: report.items.A02.status, A03: report.items.A03.status }));
  return { report, binding };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch {
    console.error('A02/A03 threat receipt refused; source details suppressed.');
    process.exitCode = 1;
  }
}
