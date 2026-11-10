import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const classpath = '/opt/uaa/third-party/*:/opt/uaa/starters/*:/opt/uaa/packages/*';
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const witnessFields = ['tokenSha256', 'stored', 'expiresAt', 'authenticationUsername', 'storeClass', 'storeOrigin'];

export function ownedWitnessCommand(containerId, redisName) {
  assert.match(containerId, /^[a-f0-9]{64}$/);
  assert.match(redisName, /^nf-[a-f0-9]{12}-uaa-[a-z0-9][a-z0-9-]{0,48}-redis$/);
  return ['exec', '--interactive', '--user', '65532:65532', containerId, 'java',
    '-cp', `/opt/uaa/witness:${classpath}`, 'RedisTokenStoreWitness', redisName];
}

// The helper is a fixture mount only, never part of the application image.
export function prepareOwnedTokenWitness({ directories, output, workspace, imageId, runId, redisName, docker }) {
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.ok(redisName.startsWith(`nf-${runId}-uaa-`));
  ownedWitnessCommand('a'.repeat(64), redisName);
  const sourcePath = join(workspace, 'standalone-uaa/tools/RedisTokenStoreWitness.java');
  const source = readPinnedFile(directories, directories.open(dirname(sourcePath)),
    'RedisTokenStoreWitness.java').data;
  const helper = directories.open(join(output, 'token-witness-source'), { create: true, exclusive: true });
  const classes = directories.open(join(output, 'token-witness-classes'), { create: true, exclusive: true });
  directories.write(helper, 'RedisTokenStoreWitness.java', source);
  const command = ['run', '--rm', '--pull=never', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', `${process.geteuid()}:${process.getegid()}`,
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
    '--mount', `type=bind,src=${helper.path},dst=/helper,readonly`,
    '--mount', `type=bind,src=${classes.path},dst=/output`,
    '--entrypoint', 'javac', imageId, '--release', '8', '-proc:none', '-implicit:none',
    '-sourcepath', '', '-cp', classpath, '-d', '/output', '/helper/RedisTokenStoreWitness.java'];
  const result = docker(command, true);
  const log = Buffer.from(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  const destination = directories.open(output);
  directories.write(destination, 'token-witness-compile.log', log);
  assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned TokenStore witness compilation failed');
  fs.chmodSync(classes.path, 0o755);
  for (const entry of fs.readdirSync(classes.path, { withFileTypes: true })) {
    assert.ok(entry.isFile() && entry.name.endsWith('.class'), 'Unexpected compiled witness output');
    fs.chmodSync(directories.entry(classes, entry.name), 0o644);
  }
  const inventory = sourceBuildInputs(classes.path);
  assert.ok(inventory.entries.some(row => row.path === 'RedisTokenStoreWitness.class'));
  const recheck = () => {
    assert.deepEqual(readPinnedFile(directories, directories.open(dirname(sourcePath)),
      'RedisTokenStoreWitness.java').data, source, 'TokenStore witness source changed');
    assert.deepEqual(readPinnedFile(directories, helper, 'RedisTokenStoreWitness.java').data,
      source, 'Staged TokenStore witness source changed');
    assert.deepEqual(sourceBuildInputs(classes.path), inventory, 'TokenStore witness classes changed');
  };
  recheck();
  let sequence = 0;
  return {
    classesPath: classes.path, recheck,
    evidence: {
      sourcePath, sourceSha256: digest(source), compilerImageId: imageId, command,
      classes: inventory, compileLogSha256: digest(log), fixtureOnly: true,
    },
    forContainer(containerId, guard) {
      const args = ownedWitnessCommand(containerId, redisName);
      const invoke = request => {
        assert.ok(['read', 'retain', 'storeVariant'].includes(request.operation));
        assert.match(request.token, jwt);
        if (request.operation === 'storeVariant') assert.match(request.variant, jwt);
        guard();
        recheck();
        const result = docker(args, true, JSON.stringify(request));
        directories.write(destination, `token-witness-${sequence++}.private.log`, result.stderr ?? '');
        assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned TokenStore witness operation failed');
        let row;
        try { row = JSON.parse(result.stdout); }
        catch { throw new Error('Owned TokenStore witness returned invalid JSON'); }
        assert.deepEqual(Object.keys(row).sort(), [...witnessFields].sort());
        assert.equal(row.tokenSha256, digest(request.variant ?? request.token));
        assert.equal(row.storeClass, 'org.springframework.security.oauth2.provider.token.store.redis.RedisTokenStore');
        assert.equal(row.storeOrigin, 'file:/opt/uaa/third-party/spring-security-oauth2-2.3.4.RELEASE.jar');
        assert.equal(typeof row.stored, 'boolean');
        guard();
        recheck();
        return row;
      };
      return {
        read: token => invoke({ operation: 'read', token }),
        retain: token => invoke({ operation: 'retain', token }),
        storeVariant: (token, variant) => invoke({ operation: 'storeVariant', token, variant }),
      };
    },
  };
}
