#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export const A04_SOURCES = Object.freeze({
  alias: 'owned-nacos-service-alias.mjs',
  nativePlatform: 'harness-owned-native-platform.mjs',
  backendLauncher: 'launch-run-owned-native-backend.mjs',
  configuration: 'run-owned-backend-configuration.mjs',
  baseline: 'harness-baseline.sh',
});

export const A04_TESTS = Object.freeze({
  alias: 'tests/owned-nacos-service-alias.test.mjs',
  startup: 'tests/launch-run-owned-native-backend.test.mjs',
  baseline: 'tests/harness-baseline-contract.test.mjs',
});

const read = (workspace, path) => {
  const absolute = resolve(workspace, 'scripts', path);
  const bytes = fs.readFileSync(absolute);
  return { path: `scripts/${path}`, absolute, bytes, text: bytes.toString('utf8'), sha256: hash(bytes) };
};

const requireAll = (text, fragments, label) => {
  for (const fragment of fragments) assert.ok(text.includes(fragment), `${label}: missing ${fragment}`);
};

const bindings = (workspace, table) => Object.fromEntries(Object.entries(table).map(([key, path]) => {
  const file = read(workspace, path);
  return [key, { path: file.path, sha256: file.sha256, bytes: file.bytes.length }];
}));

export function inspectA04Sources({ sources, tests }) {
  const alias = sources.alias;
  const platform = sources.nativePlatform;
  const launcher = sources.backendLauncher;
  const configuration = sources.configuration;
  const baseline = sources.baseline;
  requireAll(alias, [
    "serviceName: 'uaa-api'",
    'groupName: `nf_${runId}`',
    'ephemeral: false',
    'healthy: true',
    'Owned UAA alias target or policy differs',
  ], 'A04 alias source');
  requireAll(platform, [
    'publishOwnedUaaAlias',
    'removeOwnedUaaAlias',
    '/uaa/oauth/userinfo',
    'boundedRefreshAcceptance',
    'tokenExpirationChanged: false',
  ], 'A04 platform harness');
  requireAll(launcher, [
    'verifyBackendStartupLog',
    'Backend reported a fatal initialization error after opening its HTTP port',
    'publishOwnedUaaAlias',
    'publishOwnedNacos',
  ], 'A04 startup source');
  requireAll(configuration, [
    'Gateway UNISTATE must use the explicitly owned ZooKeeper peer',
    'RTJWTCloudUAAUtilRuntime requires an exact owned lb://uaa-api Nacos alias',
    'Cloud service OAuth credentials are not provisioned',
    'spring.cloud.nacos.discovery.enabled',
  ], 'A04 configuration boundary');
  requireAll(baseline, [
    'check_allinone_oauth()',
    'AIBIZ_OAUTH_CLIENT_ID=${AIBIZ_OAUTH_CLIENT_ID:-}',
    'AIBIZ_OAUTH_CLIENT_SECRET=${AIBIZ_OAUTH_CLIENT_SECRET:-}',
    'client_credentials',
    'OAuth client configuration requires both',
    'SKIP allinone POST',
  ], 'A04 OAuth baseline');

  requireAll(tests.alias, [
    'alias creation guards every request and verifies the real healthy instance',
    'foreign or changed',
    'registration cannot claim readiness from missing or unhealthy readback',
    'cleanup removes only the verified exact instance',
  ], 'A04 alias tests');
  requireAll(tests.startup, [
    'ZooKeeper readiness requires a successful exact standalone status',
    'delayed ApplicationRunner failure',
    'retained-peer guard rejects',
  ], 'A04 startup tests');
  requireAll(tests.baseline, [
    'baseline keeps ordinary login separate from optional OAuth API-client verification',
    'OAuth sends client credentials as encoded form fields',
    'partial OAuth configuration fails before curl',
  ], 'A04 OAuth tests');

  const oauthConfiguredOnly = baseline.includes('client_credentials')
    && baseline.includes('SKIP allinone POST')
    && baseline.includes('OAuth client configuration requires both');
  const aliasBound = alias.includes('passed-exact-owned-alias-readback')
    && platform.includes('publishOwnedUaaAlias');
  const startupBound = launcher.includes('verifyBackendStartupLog')
    && launcher.includes('publishOwnedNacos');

  return {
    contract: 'authorization-a04-service-oauth-alias-startup-receipt-v1',
    generatedAt: new Date().toISOString(),
    nativeAcceptance: false,
    httpAcceptance: false,
    items: {
      A04: {
        status: 'PARTIAL',
        title: 'Service OAuth, aliases and startup stabilization',
        aliasReadback: aliasBound,
        startupFatalGuard: startupBound,
        oauthClientCredentialContract: oauthConfiguredOnly,
        evidence: [
          'Owned Nacos uaa-api alias exact private target, group, metadata and non-ephemeral readback',
          'Owned startup guards for ZooKeeper standalone readiness and delayed ApplicationRunner failures',
          'Baseline OAuth client-credentials validation rejects partial config and skips absent optional credentials',
        ],
        blocker: 'No complete current owned service-OAuth exchange receipt proves client token issuance, downstream service use, alias resolution through RTJWTCloudUAAUtilRuntime and stabilized application startup together.',
        nonClaims: [
          'Ordinary user login is not service OAuth.',
          'Alias registration/readback is not OAuth authorization.',
          'A listening port or initial Started line is not delayed-startup acceptance.',
        ],
      },
    },
  };
}

export function readA04Sources({ workspace = workspaceDefault } = {}) {
  workspace = resolve(workspace);
  const sources = Object.fromEntries(Object.entries(A04_SOURCES)
    .map(([key, path]) => [key, read(workspace, path).text]));
  const tests = Object.fromEntries(Object.entries(A04_TESTS)
    .map(([key, path]) => [key, read(workspace, path).text]));
  return { sources, tests, workspace };
}

export function buildA04Receipt({ workspace = workspaceDefault } = {}) {
  const loaded = readA04Sources({ workspace });
  const report = inspectA04Sources(loaded);
  return {
    ...report,
    sourceBindings: bindings(workspace, A04_SOURCES),
    testBindings: bindings(workspace, A04_TESTS),
  };
}

function outputPath(workspace, output) {
  const absolute = resolve(workspace, output);
  const child = relative(resolve(workspace, '.artifacts'), absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'A04 receipt output must remain under .artifacts');
  assert.match(absolute, /authorization-a04-[a-z0-9][a-z0-9-]*\/report\.json$/);
  return absolute;
}

export function writeA04Receipt(report, {
  workspace = workspaceDefault, output = '.artifacts/authorization-a04-20261111/report.json',
} = {}) {
  workspace = resolve(workspace);
  const absolute = outputPath(workspace, output);
  fs.mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  assert.ok(!fs.existsSync(absolute), 'A04 receipt output is immutable and exclusive');
  const bytes = Buffer.from(json(report));
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
  const report = buildA04Receipt();
  const binding = writeA04Receipt(report, { output: options.output });
  console.log(json({ path: binding.path, sha256: binding.sha256,
    status: report.items.A04.status, alias: report.items.A04.aliasReadback,
    startup: report.items.A04.startupFatalGuard, oauth: report.items.A04.oauthClientCredentialContract }));
  return { report, binding };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch {
    console.error('A04 authorization receipt refused; source details suppressed.');
    process.exitCode = 1;
  }
}
