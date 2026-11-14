#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export const AUTHORIZATION_SOURCES = Object.freeze({
  systemAccessManager: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java',
  holder: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSDevSysUserHolder.java',
  actionSession: 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSessionManager.java',
});

export const AUTHORIZATION_TESTS = Object.freeze({
  cleanup: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/runtime/util/ActionSessionManagerCleanupTest.java',
  requestCache: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/security/SystemAccessManagerRequestCacheTest.java',
  jsonCache: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/security/SystemAccessManagerJsonCacheTest.java',
  holder: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/util/PSDevSysUserHolderTest.java',
  addin: 'ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/sysutil/addin/ModelSysUtilRTAddinAuthorizationTest.java',
});

const read = (workspace, path) => {
  const absolute = resolve(workspace, path);
  const bytes = fs.readFileSync(absolute);
  return { path, absolute, bytes, text: bytes.toString('utf8'), sha256: hash(bytes) };
};

const requireAll = (text, fragments, label) => {
  for (const fragment of fragments) assert.ok(text.includes(fragment), `${label}: missing ${fragment}`);
};

function sourceBindings(workspace) {
  return Object.fromEntries(Object.entries(AUTHORIZATION_SOURCES).map(([key, path]) => {
    const file = read(workspace, path);
    return [key, { path: file.path, sha256: file.sha256, bytes: file.bytes.length }];
  }));
}

function testBindings(workspace) {
  return Object.fromEntries(Object.entries(AUTHORIZATION_TESTS).map(([key, path]) => {
    const file = read(workspace, path);
    return [key, { path: file.path, sha256: file.sha256, bytes: file.bytes.length }];
  }));
}

export function inspectAuthorizationRemaining({ sources, tests, workspace = workspaceDefault }) {
  assert.ok(sources?.systemAccessManager && sources?.holder && sources?.actionSession);
  assert.ok(tests?.requestCache && tests?.jsonCache && tests?.holder && tests?.addin);
  const manager = sources.systemAccessManager;
  const holder = sources.holder;
  const actionSession = sources.actionSession;
  const requestCache = tests.requestCache;
  const jsonCache = tests.jsonCache;
  const holderTest = tests.holder;
  const addin = tests.addin;

  const a01Evidence = [
    'if (!(root instanceof String) || !isValidPSDevSlnSysId((String)root))',
    'private static boolean isValidPSDevSlnSysId(String root)',
    'Character.isWhitespace(character)',
    'Character.isSpaceChar(character)',
    'Character.isISOControl(character)',
    'requirePSDevSysUserForRoot',
    'Authorization root does not match the requested model library',
  ];
  requireAll(manager, a01Evidence, 'A01 source');
  requireAll(requestCache, [
    'malformedRequestRootsAreRejectedWithoutLookup',
    'freshAuthorizationMustMatchTheRequestedRootBeforeCaching',
    'actionCacheCannotSubstituteAnAuthorizationForAnotherRoot',
  ], 'A01 controlled tests');
  requireAll(addin, [
    'rawContextRootDoesNotBypassMissingAuthorization',
    'activeHolderStillNeedsANonemptyRoot',
    'missingContextRootPreservesCentralTryModeBehavior',
  ], 'A01 addin tests');

  const a02Evidence = [
    'CloudCacheTagUtils.getAuthenticationUserCat((String)iAuthenticationUser.getUsername(), (String)iAuthenticationUser.getToken())',
    'PSDevUserCacheCodec.decode',
    'iPSDevUserBase.isExpired()',
  ];
  requireAll(manager, a02Evidence, 'A02 source');
  requireAll(jsonCache, [
    'cachedCenterAndSystemAuthorizationCannotCrossAuthenticationTokenCategories',
    'expiredJsonCachedGrantsAreDeniedWithoutReauthorizing',
    'freshSystemGrantSurvivesConsecutiveProductionJsonCacheHits',
    'fixture.grants.clear()',
  ], 'A02 controlled tests');
  const sameTokenRetention = jsonCache.includes('fixture.grants.clear()')
    && jsonCache.includes('assertRepeatedJsonHits(fixture, type, fresh)');
  assert.equal(sameTokenRetention, true);

  const a03Evidence = [
    'ThreadLocal<Deque<IPSDevSysUser>>',
    'HOLDER.get().push(user)',
    'if (users.isEmpty())',
    'HOLDER.remove()',
  ];
  requireAll(holder, a03Evidence, 'A03 holder source');
  requireAll(holderTest, [
    'holderBehavesAsAThreadLocalStack',
    'holderDoesNotCrossThreadBoundaries',
  ], 'A03 holder tests');
  requireAll(requestCache, ['PSDevSysUserHolder.clear()', 'ActionSessionManager.closeSession(false)'],
    'A03 request cleanup tests');
  requireAll(actionSession, [
    'private static ThreadLocal<ActionSession> actionSession',
    'ActionSession currentSession = actionSession.get()',
    'if (currentSession == null)',
    '} finally {',
    'if (actionSession.get() == currentSession)',
    'actionSession.remove()',
  ], 'A03 action-session source');
  requireAll(tests.cleanup, [
    'commitCallbackFailurePropagatesTheSameExceptionAndRemovesTheSession',
    'rollbackCallbackFailurePropagatesTheSameExceptionAndRemovesTheSession',
    'callbackFailureCannotClearItsReplacementSession',
    'aReusedWorkerDoesNotInheritIdentityOrCachedPermissionAfterFailedClose',
  ], 'A03 cleanup tests');
  const actionSessionIsFlat = /static public ActionSession openSession\(String strName\)[\s\S]*?if \(currentSession == null\)[\s\S]*?return currentSession;/.test(actionSession);
  assert.equal(actionSessionIsFlat, true);
  const nestedActionSessionTested = /\bnestedActionSession\b|\bparent restoration\b|\bchild session\b/i.test(
    `${requestCache}\n${addin}`);

  return {
    contract: 'authorization-remaining-source-receipt-v2',
    generatedAt: new Date().toISOString(),
    nativeAcceptance: false,
    httpAcceptance: false,
    items: {
      A01: {
        status: 'PARTIAL',
        title: 'Malformed, typed and missing root context',
        evidence: ['SystemAccessManagerBase root validation', 'request-cache/addin denial tests'],
        denialContract: 'try mode returns null; required mode throws; no lookup/cache population',
        blocker: 'No fresh owned real HTTP receipt for every malformed/typed/missing root variant.',
      },
      A02: {
        status: 'BLOCKED',
        title: 'Same-token grant revocation and cache rotation',
        evidence: ['token-scoped cache category', 'expiry/negative grant tests', 'distinct-token isolation test'],
        sameTokenCacheRetentionObserved: sameTokenRetention,
        blocker: sameTokenRetention
          ? 'Existing same-token cache remains authorized after the backing grant list is cleared; no reviewed invalidation/version protocol is present.'
          : 'Same-token retention behavior was not bound by the controlled test set.',
      },
      A03: {
        status: 'BLOCKED',
        title: 'Nested session and holder lifecycle',
        evidence: ['ThreadLocal holder stack and cleanup tests', 'request cleanup'],
        holderStackIsolation: true,
        actionSessionIsFlat,
        nestedActionSessionTested,
        identityCheckedFinallyRemoval: true,
        cleanupTestsPresent: true,
        javaExecutionAcceptance: false,
        blocker: actionSessionIsFlat && !nestedActionSessionTested
          ? 'ActionSessionManager.openSession returns the existing session; nested push/pop, exception unwind and parent restoration are not implemented or tested.'
          : 'Nested session error/unwind and parent restoration are not bound by a reviewed receipt.',
      },
    },
    sourceBindings: sourceBindings(workspace),
    testBindings: testBindings(workspace),
  };
}

export function readAuthorizationSources({ workspace = workspaceDefault } = {}) {
  workspace = resolve(workspace);
  const sources = Object.fromEntries(Object.entries(AUTHORIZATION_SOURCES)
    .map(([key, path]) => [key, read(workspace, path).text]));
  const tests = Object.fromEntries(Object.entries(AUTHORIZATION_TESTS)
    .map(([key, path]) => [key, read(workspace, path).text]));
  return { sources, tests, workspace };
}

export function buildAuthorizationRemainingReceipt({ workspace = workspaceDefault } = {}) {
  const loaded = readAuthorizationSources({ workspace });
  return inspectAuthorizationRemaining(loaded);
}

function outputPath(workspace, value) {
  assert.equal(typeof value, 'string');
  const absolute = resolve(workspace, value);
  const child = relative(resolve(workspace, '.artifacts'), absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'Receipt output must remain under workspace .artifacts');
  assert.match(absolute, /authorization-remaining-[a-z0-9][a-z0-9-]*\/report\.json$/);
  return absolute;
}

export function writeAuthorizationRemainingReceipt(receipt, {
  workspace = workspaceDefault, output = '.artifacts/authorization-remaining-20261111/report.json',
} = {}) {
  workspace = resolve(workspace);
  const absolute = outputPath(workspace, output);
  fs.mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  assert.ok(!fs.existsSync(absolute), 'Receipt output must be immutable and exclusive');
  const bytes = Buffer.from(json(receipt));
  const descriptor = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return { path: absolute, sha256: hash(bytes), bytes: bytes.length };
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    const match = /^--output=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, 'output'), 'Only --output=... is accepted');
    options.output = match[1];
  }
  const receipt = buildAuthorizationRemainingReceipt();
  const binding = writeAuthorizationRemainingReceipt(receipt, { output: options.output });
  console.log(json({ path: binding.path, sha256: binding.sha256, statuses:
    Object.fromEntries(Object.entries(receipt.items).map(([key, item]) => [key, item.status])) }));
  return { receipt, binding };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch {
    console.error('Authorization remaining receipt refused; source details suppressed.');
    process.exitCode = 1;
  }
}
