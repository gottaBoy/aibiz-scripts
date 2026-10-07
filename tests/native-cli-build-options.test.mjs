import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileFunction } from 'node:vm';
import { main } from '../harness-native-cli-source-build.mjs';

const tool = fileURLToPath(new URL('../harness-native-cli-source-build.mjs', import.meta.url));
// Execute the production entry function without staging files or running compilers.
const executeMain = compileFunction(`return (${main.toString()})(argv);`, [
  'argv', 'assert', 'parseArgs', 'runNativeCliSourceBuild', 'verifyNativeCliSourceBuild',
  'process', 'console',
], { filename: tool });

function fixture() {
  const builds = [];
  const verifications = [];
  const messages = [];
  const process = { argv: ['node', tool], exitCode: undefined };
  const build = options => {
    builds.push(options);
    return { report: { status: 'fixture-build-not-accepted', errors: [] },
      reportPath: 'fixture/report.json', exitCode: 2 };
  };
  const verify = options => {
    verifications.push(options);
    return { reportPath: options.sourceReport, reportSha256: 'fixture-only',
      cliSourceBuildVerified: true };
  };
  return {
    builds, verifications, messages, process,
    invoke: argv => executeMain(argv, assert, parseArgs, build, verify, process, {
      log: text => messages.push(JSON.parse(text)),
    }),
  };
}

const pairs = (flag, values) => values.flatMap(value => [flag, value]);

for (const version of ['0.3.0', '0.3.23', '0.3.30']) {
  test(`CLI forwards ordered repeated owners for source version ${version}`, () => {
    const f = fixture();
    const thirdPartyOwners = {
      root: ['root-first', 'root-second', 'root-first'],
      core: ['core-second', 'core-first'],
      cli: ['cli-first', 'cli-third', 'cli-second'],
    };
    const dependencyOwners = ['supplemental-first', 'supplemental-second'];
    f.invoke([
      '--workspace', 'fixture-workspace', '--version', version,
      '--fetch-report', 'fixture-fetch/report.json', '--output', 'fresh-fixture-output',
      ...pairs('--root-owner', thirdPartyOwners.root),
      ...pairs('--core-owner', thirdPartyOwners.core),
      ...pairs('--cli-owner', thirdPartyOwners.cli),
      ...pairs('--dependency-owner', dependencyOwners),
    ]);
    assert.deepEqual(f.builds, [{
      workspace: 'fixture-workspace', version, fetchReport: 'fixture-fetch/report.json',
      output: 'fresh-fixture-output', thirdPartyOwners, dependencyOwners,
    }]);
    assert.deepEqual(f.verifications, []);
    assert.equal(f.process.exitCode, 2);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].nativeAccepted, false);
  });
}

test('CLI preserves single-owner and default argv compatibility', () => {
  const f = fixture();
  f.process.argv.push('--root-owner', 'root-only', '--core-owner', 'core-only',
    '--cli-owner', 'cli-only');
  f.invoke();
  assert.equal(f.builds.length, 1);
  assert.deepEqual(f.builds[0].thirdPartyOwners, {
    root: ['root-only'], core: ['core-only'], cli: ['cli-only'],
  });
  assert.equal(f.builds[0].dependencyOwners, undefined);
  assert.deepEqual(f.verifications, []);
  assert.equal(f.process.exitCode, 2);
});

const conflictingOptions = [
  ['output', ['fresh-output']],
  ['version', ['0.3.30']],
  ['fetch-report', ['fixture-fetch/report.json']],
  ...['root-owner', 'core-owner', 'cli-owner', 'dependency-owner']
    .flatMap(flag => [[flag, ['first']], [flag, ['first', 'second']]]),
];

for (const [flag, values] of conflictingOptions) {
  test(`CLI verify-report rejects ${flag} with ${values.length} value(s) before execution`, () => {
    const f = fixture();
    assert.throws(() => f.invoke([
      '--verify-report', 'unused/report.json', ...pairs(`--${flag}`, values),
    ]), /--verify-report cannot be combined with build options/);
    assert.deepEqual(f.builds, []);
    assert.deepEqual(f.verifications, []);
    assert.deepEqual(f.messages, []);
    assert.equal(f.process.exitCode, undefined);
  });
}

test('CLI verify-report alone forwards workspace without invoking a build', () => {
  const f = fixture();
  f.invoke(['--workspace', 'fixture-workspace', '--verify-report', 'fixture/report.json']);
  assert.deepEqual(f.builds, []);
  assert.deepEqual(f.verifications, [{
    workspace: 'fixture-workspace', sourceReport: 'fixture/report.json',
  }]);
  assert.equal(f.process.exitCode, 2);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].status, 'verified-cli-source-build-not-accepted');
  assert.equal(f.messages[0].nativeAccepted, false);
});

for (const flag of ['root-owner', 'core-owner', 'cli-owner']) {
  test(`real CLI rejects repeated ${flag} with verify-report before reading the report`, () => {
    const result = spawnSync(process.execPath, [
      tool, '--verify-report', 'unused/report.json',
      `--${flag}`, 'first', `--${flag}`, 'second',
    ], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--verify-report cannot be combined with build options/);
    assert.doesNotMatch(result.stderr, /ENOENT|report path|third-party owner/i);
  });

  test(`CLI rejects missing ${flag} value before execution`, () => {
    const f = fixture();
    assert.throws(() => f.invoke([`--${flag}`]), error =>
      error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE');
    assert.deepEqual(f.builds, []);
    assert.deepEqual(f.verifications, []);
    assert.deepEqual(f.messages, []);
  });
}
