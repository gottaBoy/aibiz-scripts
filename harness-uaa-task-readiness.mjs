#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { verifyTaskBytecodeAudit } from './audit-task-bytecode-inputs.mjs';
import { sourceBuildInputs, verifyCommittedSource, verifyRecordedBuildInputs } from './source-build-identity.mjs';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const commandOptions = {
  encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_OPTIONAL_LOCKS: '0',
  },
};
const readOnlyGit = (command, args, options) =>
  execFileSync(command, args, { ...options, env: commandOptions.env });

export const STANDALONE_UAA_EDITABLE_INPUTS = Object.freeze([
  'cn/ibizlab/BootApplication.java',
  'cn/ibizlab/config/BootSecurityConfig.java',
  'cn/ibizlab/api/rest/AuthResource.java',
  'cn/ibizlab/api/rest/AbstractAuthResource.java',
  'cn/ibizlab/api/rest/AuthResourceImpl.java',
  'cn/ibizlab/api/dto/AuthLoginRequestDTO.java',
  'cn/ibizlab/api/dto/AuthLoginResponseDTO.java',
  'cn/ibizlab/api/dto/AuthInfoDTO.java',
  'cn/ibizlab/core/authentication/service/impl/AuthLoginServiceImpl.java',
  'cn/ibizlab/core/authentication/service/impl/AuthUserServiceImpl.java',
  'cn/ibizlab/core/authentication/mapping/AuthInfoMapping.java',
  'cn/ibizlab/core/ad/domain/SysPerson.java',
  'cn/ibizlab/core/ad/domain/SysDomain.java',
  'cn/ibizlab/core/ad/domain/SysOrganization.java',
  'cn/ibizlab/core/authorization/domain/SysRole.java',
  'cn/ibizlab/core/authorization/domain/SysRoleMember.java',
  'cn/ibizlab/core/authorization/domain/SysGrantedAuthority.java',
  'cn/ibizlab/util/security/SM3PasswordEncoder.java',
  'cn/ibizlab/util/web/Sm3Util.java',
  'mapper/ad/SysPerson/SysPersonMapper.xml',
  'mapper/authorization/SysRoleMember/SysRoleMemberMapper.xml',
]);

// Input presence is a necessary diagnostic, never source/runtime provenance.
export function standaloneUaaEditableSourceReadiness(inputs) {
  const entries = Array.isArray(inputs?.entries) ? inputs.entries : [];
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const safeEntry = entry => typeof entry?.path === 'string'
    && !entry.path.includes('\\') && !entry.path.startsWith('/')
    && entry.path.split('/').every(part => part && part !== '.' && part !== '..')
    && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && digest(entry.sha256);
  const valid = inputs?.fingerprintKind === 'relative-file-set' && digest(inputs.fingerprint)
    && entries.length > 0 && entries.every(safeEntry)
    && new Set(entries.map(entry => entry.path)).size === entries.length;
  const presentInputs = [];
  const missingInputs = [];
  for (const required of STANDALONE_UAA_EDITABLE_INPUTS) {
    const matches = valid ? entries.filter(entry =>
      entry.path === required || entry.path.endsWith(`/${required}`)) : [];
    if (matches.length !== 1 || matches[0].bytes === 0) missingInputs.push(required);
    else presentInputs.push({ required, ...matches[0] });
  }
  return {
    ok: valid && missingInputs.length === 0,
    reason: valid && missingInputs.length === 0
      ? 'Standalone sys_person authentication candidate inputs are present; input presence is not source, compiler or native provenance'
      : 'Editable standalone sys_person authentication inputs are missing or ambiguous; legacy IBZUSER source cannot satisfy the target UAA contract',
    evidence: {
      contract: 'uaa-standalone-editable-inputs-v1',
      target: 'uaa-standalone-sys-person',
      verification: 'input-presence-only-not-source-or-native-provenance',
      ...(valid ? { currentInputFingerprint: inputs.fingerprint } : {}),
      requiredInputs: [...STANDALONE_UAA_EDITABLE_INPUTS], presentInputs, missingInputs,
      legacyInputs: entries.filter(entry => safeEntry(entry)
        && /(?:^|\/)IBZUser\.java$/i.test(entry.path)).map(entry => entry.path),
    },
  };
}

export function standaloneUaaProtocolClosureReadiness(inputs) {
  return {
    ok: false,
    reason: 'Independent standalone UAA source/runtime protocol closure verifier is missing; legacy v7/login or uaa/login, IBZUSER and pwencrymode builds cannot replace sys_person /auths/login',
    evidence: {
      contract: 'uaa-standalone-protocol-closure-v1',
      target: 'uaa-standalone-sys-person',
      state: 'unverified',
      ...(inputs?.fingerprint ? { currentInputFingerprint: inputs.fingerprint } : {}),
      requiredContract: {
        method: 'POST', path: '/auths/login',
        requestDto: 'cn.ibizlab.api.dto.AuthLoginRequestDTO',
        requestFields: ['loginname', 'password', 'dc'],
        responseDto: 'cn.ibizlab.api.dto.AuthLoginResponseDTO',
        responseFields: ['token', 'user'],
        principalTable: 'sys_person', loginField: 'UID', passwordField: 'USER_PASSWORD',
        passwordStorageProperty: 'ibiz.auth.passwordStorageMode',
        passwordEncoder: {
          sm3ConditionValue: 'sm3', sm3Digest: 'uppercase-64-hex',
          sm3Charset: 'java-default', rawLength64: 'pass-through',
          storedLengthLessThan64: 'hash-before-matching', comparison: 'case-sensitive',
          fallback: 'NoOpPasswordEncoder-if-no-SM3-bean',
          effectiveRuntimeSelectionRequired: true,
        },
        principalOrganizationKey: 'sys_person.ORGANIZATION_ID -> sys_organization.ID',
        principalDomainKey: 'sys_person.DC -> sys_domain.ID',
        roleMemberPersonKey: 'sys_role_member.MEMBER_UID -> sys_person.ID',
        directRoleMemberType: 'inetOrgPerson',
        roleDeploySystemKey: 'sys_role.DEPLOY_SYSTEM_ID -> sys_deploy_system.ID',
        projectedSystemKey: 'sys_deploy_system.SYSTEM_ID',
        fineGrantFields: ['sys_granted_authority.ROLE_ID', 'AUTHORITY', 'PERMISSION_TYPE'],
        loginRoleAuthorities: 'cleared-not-fine-grant-evidence',
        authenticatedFineGrantReadPath: '/auths/user-info/self',
        privilegedRoleSelection: {
          uaaField: 'sys_role.AUTHORITY', rtField: 'AuthGrantedRole.roleId',
          reservedValues: ['ROLE_APIUSERS', 'ROLE_SUPERADMIN'],
        },
      },
      requiredVerification: [
        'running-image-entrypoint-artifact-binding',
        'source-build-to-runtime-class-binding',
        'registered-auths-login-request-response-contract',
        'effective-runtime-password-encoder',
        'sys-person-domain-organization-role-joins',
        'authenticated-user-info-fine-grants',
      ],
    },
  };
}

function check(id, service, ok, reason, evidence = []) {
  return { id, service, status: ok ? 'pass' : 'blocked', reason, evidence };
}

function probeCheck(id, service, probe, reason, evidence = []) {
  try { return check(id, service, Boolean(probe()), reason, evidence); }
  catch { return check(id, service, false, 'Source structure is unreadable or malformed', evidence); }
}

function inventorySummary(inputs) {
  return {
    files: inputs.files, bytes: inputs.bytes, fingerprint: inputs.fingerprint,
    fingerprintKind: inputs.fingerprintKind,
  };
}

export function ownSourceBytecodeClosureReadiness(inputs) {
  const compiledInputs = Array.isArray(inputs?.entries)
    ? inputs.entries.filter(entry => entry.path.endsWith('.class')).map(entry => ({
      path: entry.path, bytes: entry.bytes, sha256: entry.sha256,
    })) : [];
  const archiveInputs = Array.isArray(inputs?.entries)
    ? inputs.entries.filter(entry => /\.(?:jar|war)$/.test(entry.path)).length : 0;
  return {
    ok: false,
    reason: `${compiledInputs.length
      ? `${compiledInputs.length} loose .class build inputs require source provenance. ` : ''}Independent own-bytecode/dependency source closure verifier is missing; artifact and image hashes cannot exclude compiled-own fallback`,
    evidence: {
      contract: 'source-bytecode-closure-readiness-v1',
      state: 'unverified',
      ...(inputs?.fingerprint ? { currentInputFingerprint: inputs.fingerprint } : {}),
      compiledInputs,
      archiveInputs,
    },
  };
}

function readJsonEvidence(path) {
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(dirname(path));
    const { data } = readPinnedFile(directories, directory, basename(path));
    return { report: JSON.parse(data), sha256: hash(data) };
  } finally {
    directories.close();
  }
}

export function verifyTaskOwnSourceClosureEvidence({
  taskEvidence, buildReceiptPath, inputScreenPath, inputClosurePath, warBindingPath,
}) {
  const failed = {
    ok: false,
    reason: 'Missing, stale, incomplete or inconsistent Task own-source closure evidence',
    evidence: {
      contract: 'task7-war-output-binding-v1',
      status: 'fail',
      scopedOwnSourceClosureVerified: false,
      fullSourceClosureVerified: false,
      nativeAcceptance: false,
    },
  };
  try {
    const currentInputs = taskEvidence?.evidence?.currentInputs;
    const fingerprint = currentInputs?.fingerprint;
    const commit = taskEvidence?.evidence?.recordedSourceCommit;
    const warSha256 = taskEvidence?.evidence?.artifactSha256;
    assert.equal(taskEvidence?.artifactReady, true, 'Current Task source build is not ready');
    assert.equal(taskEvidence?.imageReady, true, 'Current Task source image is not ready');
    assert.match(fingerprint ?? '', /^[a-f0-9]{64}$/, 'Invalid current Task source fingerprint');
    assert.match(commit ?? '', /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, 'Invalid current Task commit');
    assert.match(warSha256 ?? '', /^[a-f0-9]{64}$/, 'Invalid current Task WAR digest');

    const buildReceipt = readJsonEvidence(buildReceiptPath);
    assert.equal(buildReceipt.report.commit, commit,
      'Task source build receipt commit differs');
    assert.equal(buildReceipt.report.sourceInputs?.before?.fingerprint, fingerprint,
      'Task source build receipt fingerprint differs');
    assert.equal(buildReceipt.report.sha256, warSha256,
      'Task source build receipt WAR digest differs');

    const screen = verifyTaskBytecodeAudit({ reportPath: inputScreenPath });
    assert.equal(screen.status, 'passed-input-screen-only', 'Task input screen did not pass');
    assert.equal(screen.sourceClosureVerified, false, 'Input screen cannot claim full source closure');
    assert.equal(screen.compilerBuildInDockerVerified, false,
      'Input screen cannot replace the canonical Docker source build');
    assert.equal(screen.nativeAcceptance, false, 'Input screen cannot claim native acceptance');
    const screenEvidence = readJsonEvidence(inputScreenPath);
    const sourceInputs = screenEvidence.report.sourceInputs?.before;
    assert.equal(sourceInputs?.fingerprintKind, 'relative-file-set');
    assert.equal(sourceInputs?.fingerprint, fingerprint, 'Task input screen source fingerprint differs');
    assert.equal(sourceInputs?.files, currentInputs.files, 'Task input screen file count differs');
    assert.equal(sourceInputs?.bytes, currentInputs.bytes, 'Task input screen byte count differs');
    assert.equal(screen.reportSha256, screenEvidence.sha256,
      'Task input screen changed during closure verification');

    const closure = readJsonEvidence(inputClosurePath);
    assert.equal(closure.report.contract, 'task7-input-closure-audit-v1',
      'Unexpected Task input closure contract');
    assert.equal(closure.report.status, 'pass', 'Task input closure did not pass');
    assert.equal(closure.report.inputScreenVerified, true, 'Task input closure is not verified');
    assert.equal(closure.report.sourceClosureVerified, false, 'Task input closure cannot claim full closure');
    assert.equal(closure.report.nativeAcceptance, false, 'Task input closure cannot claim native acceptance');
    assert.equal(closure.report.counts?.looseClasses, 0, 'Loose Task class inputs remain');
    assert.equal(closure.report.counts?.ownArchiveClasses, 0, 'Precompiled own Task classes remain');
    assert.equal(closure.report.counts?.duplicateEntries, 0, 'Duplicate archive entries remain');
    assert.equal(closure.report.counts?.errors, 0, 'Task input closure errors remain');

    const war = readJsonEvidence(warBindingPath);
    const report = war.report;
    assert.equal(report.contract, 'task7-war-output-binding-v1',
      'Unexpected Task WAR output binding contract');
    assert.equal(report.status, 'pass', 'Task WAR output binding did not pass');
    assert.equal(report.verification, 'independent-compiler-output-byte-binding');
    assert.equal(report.nativeAcceptance, false, 'Task WAR binding cannot claim native acceptance');
    assert.equal(report.warSha256, warSha256, 'Task WAR binding hash differs from source build');
    for (const key of ['classes', 'jars', 'independentCompiledClasses', 'expectedRuntimeJars']) {
      assert.ok(Number.isSafeInteger(report[key]) && report[key] > 0,
        `Invalid Task WAR binding count: ${key}`);
    }
    assert.equal(report.classes, report.independentCompiledClasses,
      'Task WAR class count differs from independent compiler outputs');
    assert.equal(report.jars, report.expectedRuntimeJars,
      'Task WAR JAR count differs from expected runtime dependencies');
    assert.ok(Array.isArray(report.findings) && report.findings.length === 0,
      'Task WAR output binding has findings');

    return {
      ok: true,
      reason: 'Current Task source inputs, independent compiler outputs and WAR bytes are bound; scoped own-source closure only, not native acceptance',
      evidence: {
        contract: report.contract,
        status: 'pass',
        verification: report.verification,
        scopedOwnSourceClosureVerified: true,
        fullSourceClosureVerified: false,
        nativeAcceptance: false,
        sourceFingerprint: fingerprint,
        buildCommit: commit,
        warSha256,
        buildReceipt: {
          reportPath: buildReceiptPath,
          reportSha256: buildReceipt.sha256,
          commit,
          sourceFingerprint: fingerprint,
        },
        classes: report.classes,
        jars: report.jars,
        independentCompiledClasses: report.independentCompiledClasses,
        expectedRuntimeJars: report.expectedRuntimeJars,
        findings: [],
        inputScreen: {
          contract: screenEvidence.report.contract,
          status: screenEvidence.report.status,
          reportPath: inputScreenPath,
          reportSha256: screen.sha256,
          sourceFingerprint: fingerprint,
        },
        inputClosure: {
          contract: closure.report.contract,
          status: closure.report.status,
          reportPath: inputClosurePath,
          reportSha256: closure.sha256,
        },
        warBinding: {
          contract: report.contract,
          status: report.status,
          reportPath: warBindingPath,
          reportSha256: war.sha256,
        },
      },
    };
  } catch {
    return failed;
  }
}

function compilationStubLines(source) {
  if (!/Unresolved compilation problems?\b/i.test(source)) return [];
  // Keep literals as whole tokens so scanner fixtures are not executable code.
  const lexical = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_$][\w$]*|[^\s]/g;
  const tokens = [...source.matchAll(lexical)].filter(token =>
    !token[0].startsWith('//') && !token[0].startsWith('/*'));
  const lines = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index][0] !== 'throw' || tokens[index + 1]?.[0] !== 'new') continue;
    let type = index + 2;
    if (tokens[type]?.[0] === 'java' && tokens[type + 1]?.[0] === '.'
      && tokens[type + 2]?.[0] === 'lang' && tokens[type + 3]?.[0] === '.') type += 4;
    if (tokens[type]?.[0] !== 'Error' || tokens[type + 1]?.[0] !== '('
      || !/^"Unresolved compilation problems?\b/i.test(tokens[type + 2]?.[0] ?? '')) continue;
    lines.push(source.slice(0, tokens[index].index).split('\n').length);
  }
  return lines;
}

function verifyKnownDecompilationStubs(root, inputs) {
  const directories = new PinnedDirectories();
  const findings = [];
  const javaInputs = inputs.entries.filter(entry => entry.path.endsWith('.java'));
  // Recognize unresolved decompiler output, not legitimate unsupported APIs.
  const marker = /Decompilation failed|Method not decompiled|This method has failed to decompile|Exception decompiling/i;
  try {
    assert.ok(javaInputs.length > 0, 'No editable Java implementation');
    for (const entry of javaInputs) {
      const path = join(root, entry.path);
      const { data } = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
      assert.equal(hash(data), entry.sha256, 'Java input changed during stub audit');
      const source = data.toString('utf8');
      const lines = source.split('\n');
      const stubLines = new Set(compilationStubLines(source));
      for (let index = 0; index < lines.length; index++) {
        if (marker.test(lines[index])) stubLines.add(index + 1);
      }
      for (const line of [...stubLines].sort((left, right) => left - right)) {
        findings.push({ path: entry.path, line });
      }
    }
    return {
      ok: findings.length === 0,
      reason: findings.length === 0
        ? 'No known unresolved decompilation/compiler markers in current Java inputs; not semantic completeness'
        : 'Known unresolved decompilation/compiler markers remain in editable Java inputs',
      evidence: {
        contract: 'known-decompilation-stub-audit-v1',
        currentInputFingerprint: inputs.fingerprint,
        javaFiles: javaInputs.length, findings,
      },
    };
  } finally { directories.close(); }
}

function artifactSha256(directories, directory, name) {
  directories.verify(directory);
  const path = directories.entry(directory, name);
  const before = fs.lstatSync(path);
  assert.ok(before.isFile() && !before.isSymbolicLink(), 'Non-regular or symlink artifact rejected');
  const descriptor = fs.openSync(path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.dev, before.dev, 'Artifact changed while opening');
    assert.equal(opened.ino, before.ino, 'Artifact changed while opening');
    let bytes = 0;
    let size;
    while ((size = fs.readSync(descriptor, buffer, 0, buffer.length, null))) {
      digest.update(buffer.subarray(0, size));
      bytes += size;
    }
    const after = fs.fstatSync(descriptor);
    const current = fs.lstatSync(path);
    assert.ok(bytes > 0 && bytes === opened.size && after.size === opened.size,
      'Empty or changed source artifact');
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      assert.equal(after[key], opened[key], 'Artifact changed while reading');
      assert.equal(current[key], after[key], 'Artifact path changed while reading');
    }
  } finally { fs.closeSync(descriptor); }
  directories.verify(directory);
  return digest.digest('hex');
}

const uaaRuntimeContainer = 'ibizlab-uaa-api';
const uaaRuntimeInspect = '{"id":{{json .Id}},"imageId":{{json .Image}},'
  + '"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},'
  + '"entrypoint":{{json .Config.Entrypoint}},"command":{{json .Config.Cmd}},'
  + '"mountCount":{{len .Mounts}}}';
const uaaJavaJarProbe = [
  'for file in /proc/[0-9]*/comm; do',
  '  [ "$(cat "$file" 2>/dev/null)" = java ] || continue',
  '  tr "\\000" "\\n" < "${file%/comm}/cmdline" |',
  '    awk \'found { print; exit } $0 == "-jar" { found = 1 }\'',
  'done',
].join('\n');

// Observe only the fixed target's identity; never read full env or Java options.
export function observeStandaloneUaaRuntime({
  workspaceRoot = resolve(scriptsRoot, '..'), execute = execFileSync,
} = {}) {
  const directories = new PinnedDirectories();
  const evidence = {
    contract: 'uaa-standalone-runtime-artifact-observation-v1',
    target: 'uaa-standalone-sys-person',
    state: 'unverified',
    verification: 'runtime-artifact-identity-only-not-source-or-protocol',
    evidenceOrigin: execute === execFileSync
      ? 'live-read-only-runtime-observation' : 'controlled-runner-not-native-evidence',
    nativeAcceptance: false,
    sourceRuntimeCompatible: false,
    effectivePasswordEncoderVerified: false,
    container: uaaRuntimeContainer,
  };
  try {
    const inspect = () => {
      const value = JSON.parse(execute('docker', [
        'inspect', '--format', uaaRuntimeInspect, '--', uaaRuntimeContainer,
      ], commandOptions));
      assert.match(value.id, /^[a-f0-9]{64}$/);
      assert.match(value.imageId, /^sha256:[a-f0-9]{64}$/);
      assert.equal(value.running, true);
      assert.ok(typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)));
      assert.deepEqual(value.entrypoint, ['/entrypoint.sh']);
      assert.ok(value.command === null || Array.isArray(value.command) && value.command.length === 0);
      assert.equal(value.mountCount, 0, 'Mounted target requires independent artifact binding');
      return value;
    };
    const runtimeHashes = () => {
      const output = execute('docker', [
        'exec', uaaRuntimeContainer, 'sha256sum', '/entrypoint.sh', '/uaa-api.jar',
      ], commandOptions);
      const match = /^([a-f0-9]{64}) {2}\/entrypoint\.sh\n([a-f0-9]{64}) {2}\/uaa-api\.jar\n?$/.exec(output);
      assert.ok(match, 'Malformed runtime artifact hashes');
      return { entrypointSha256: match[1], runtimeJarSha256: match[2] };
    };
    const javaJar = () => execute('docker', [
      'exec', uaaRuntimeContainer, 'sh', '-c', uaaJavaJarProbe,
    ], commandOptions);
    const before = inspect();
    const platform = execute('docker', [
      'image', 'inspect', '--format', '{{.Id}} {{.Os}}/{{.Architecture}}', '--', before.imageId,
    ], commandOptions).trim();
    assert.equal(platform, `${before.imageId} linux/arm64`);
    assert.equal(execute('docker', [
      'exec', uaaRuntimeContainer, 'sh', '-c', 'printf "%s" "$JAR_FILENAME"',
    ], commandOptions), 'uaa-api');
    assert.equal(javaJar(), '/uaa-api.jar\n', 'Expected one live Java JAR target');
    const hashes = runtimeHashes();
    const localDirectory = directories.open(join(workspaceRoot, 'runtime-jars'));
    const localSha256 = artifactSha256(directories, localDirectory, 'ibizlab-uaa-api.jar');
    assert.equal(hashes.runtimeJarSha256, localSha256, 'Local inspected JAR differs from runtime');
    assert.deepEqual(runtimeHashes(), hashes, 'Runtime artifact changed during observation');
    assert.equal(javaJar(), '/uaa-api.jar\n', 'Live Java JAR target changed');
    assert.deepEqual(inspect(), before, 'Container binding changed during observation');
    assert.equal(artifactSha256(directories, localDirectory, 'ibizlab-uaa-api.jar'), localSha256);
    return {
      ok: true,
      reason: 'Stable live entrypoint/Java JAR identity matches the local binary; no editable-source, encoder, protocol or native acceptance proof',
      evidence: {
        ...evidence, state: 'observed-identity-only',
        containerId: before.id, imageId: before.imageId, platform: 'linux/arm64',
        startedAt: before.startedAt, entrypointPath: '/entrypoint.sh', jarFilename: 'uaa-api',
        runtimeJarPath: '/uaa-api.jar', localJarPath: 'runtime-jars/ibizlab-uaa-api.jar',
        ...hashes, localJarSha256: localSha256,
      },
    };
  } catch {
    return {
      ok: false,
      reason: 'Standalone runtime binding is missing, malformed, changed or differs from the local binary; no source/protocol proof',
      evidence,
    };
  } finally { directories.close(); }
}

// Image inspection proves identity only. It does not prove compiler execution
// or that a runtime image contains the recorded source artifact.
export function verifyServiceBuildEvidence({
  root, receiptPath, artifactPath, generatedArtifacts = [], execute = execFileSync,
  requireStandaloneUaa = false,
}) {
  const result = {
    artifactReady: false, imageReady: false,
    sourceIdentity: { ok: false, reason: 'No successful source build receipt' },
    buildInputs: { ok: false, reason: 'No successful build-time input inventories' },
    knownDecompilationStubs: { ok: false, reason: 'No independently readable Java inputs' },
    ownSourceBytecodeClosure: ownSourceBytecodeClosureReadiness(),
    ...(requireStandaloneUaa ? {
      standaloneAuthSource: standaloneUaaEditableSourceReadiness(),
      standaloneAuthProtocol: standaloneUaaProtocolClosureReadiness(),
    } : {}),
    evidence: { receiptState: 'missing-or-unverifiable' },
  };
  const directories = new PinnedDirectories();
  try {
    const currentInputs = sourceBuildInputs(root, { generatedArtifacts });
    result.evidence.currentInputs = inventorySummary(currentInputs);
    if (requireStandaloneUaa) {
      result.standaloneAuthSource = standaloneUaaEditableSourceReadiness(currentInputs);
      result.evidence.standaloneAuthSource = result.standaloneAuthSource.evidence;
      result.standaloneAuthProtocol = standaloneUaaProtocolClosureReadiness(currentInputs);
      result.evidence.standaloneAuthProtocol = result.standaloneAuthProtocol.evidence;
    }
    result.ownSourceBytecodeClosure = ownSourceBytecodeClosureReadiness(currentInputs);
    result.evidence.ownSourceBytecodeClosure = result.ownSourceBytecodeClosure.evidence;
    result.knownDecompilationStubs = verifyKnownDecompilationStubs(root, currentInputs);
    result.evidence.knownStubAudit = result.knownDecompilationStubs.evidence;
    const directory = directories.open(dirname(receiptPath));
    const { data, identity } = readPinnedFile(directories, directory, basename(receiptPath));
    const receipt = JSON.parse(data);
    assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'Invalid receipt');
    result.evidence.receiptSha256 = hash(data);
    result.evidence.receiptState = 'parsed';
    result.sourceIdentity = verifyCommittedSource(root, receipt.commit, readOnlyGit);
    result.buildInputs = verifyRecordedBuildInputs(root, receipt, { generatedArtifacts });
    result.evidence.recordedInputContract = receipt.sourceInputs?.contract ?? null;
    if (!result.sourceIdentity.ok || !result.buildInputs.ok) return result;
    result.evidence.recordedSourceCommit = result.sourceIdentity.commit;
    assert.equal(receipt.status, 'ready', 'Source build receipt is not ready');
    assert.equal(receipt.exitCode, 0, 'Source compiler command did not record a successful numeric exit');
    assert.equal(receipt.platform, 'linux/arm64', 'Source build receipt platform differs');
    result.evidence.buildExitCode = 0;
    result.evidence.recordedPlatform = 'linux/arm64';
    assert.equal(receipt.artifact, artifactPath, 'Unexpected source artifact path');
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/, 'Invalid artifact digest');
    const artifactDirectory = directories.open(dirname(artifactPath));
    assert.equal(artifactSha256(directories, artifactDirectory, basename(artifactPath)), receipt.sha256,
      'Source artifact digest differs');
    result.evidence.artifactSha256 = receipt.sha256;
    result.artifactReady = true;
    let inspectImage;
    if (receipt.imageTag || receipt.imageId) {
      const observation = {
        contract: 'source-image-identity-observation-v1',
        state: 'unverified',
        verification: 'image-identity-only-not-compiler-or-artifact-binding',
        evidenceOrigin: execute === execFileSync
          ? 'live-read-only-image-inspection' : 'controlled-runner-not-native-evidence',
        currentInputFingerprint: currentInputs.fingerprint,
        sourceCommit: result.sourceIdentity.commit, artifactSha256: receipt.sha256,
      };
      result.evidence.sourceImageObservation = observation;
      try {
        assert.match(receipt.imageId, /^sha256:[a-f0-9]{64}$/, 'Invalid source image ID');
        assert.match(receipt.imageTag, /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/, 'Invalid source image reference');
        inspectImage = () => {
          const image = execute('docker', [
            'image', 'inspect', '--format', '{{.Id}} {{.Os}}/{{.Architecture}}', '--', receipt.imageTag,
          ], commandOptions).trim();
          assert.equal(image, `${receipt.imageId} linux/arm64`, 'Source image identity differs');
        };
        inspectImage();
        result.imageReady = true;
      } catch {
        result.evidence.imageState = 'missing-or-unverifiable';
      }
    }
    assert.deepEqual(sourceBuildInputs(root, { generatedArtifacts }), currentInputs,
      'Source build inputs changed during image verification');
    if (result.imageReady) {
      try {
        inspectImage();
        Object.assign(result.evidence.sourceImageObservation, {
          state: 'observed-identity-only', imageTag: receipt.imageTag,
          imageId: receipt.imageId, platform: 'linux/arm64', observations: 2,
        });
      } catch {
        result.imageReady = false;
        result.evidence.imageState = 'missing-malformed-or-changed';
      }
      assert.deepEqual(sourceBuildInputs(root, { generatedArtifacts }), currentInputs,
        'Source build inputs changed during image recheck');
    }
    assert.ok(verifyCommittedSource(root, receipt.commit, readOnlyGit).ok, 'Source Git identity changed during audit');
    const finalReceipt = readPinnedFile(directories, directory, basename(receiptPath), identity);
    assert.equal(hash(finalReceipt.data), hash(data), 'Source build receipt changed during audit');
    assert.equal(artifactSha256(directories, artifactDirectory, basename(artifactPath)), receipt.sha256,
      'Source artifact changed during audit');
    result.evidence.receiptState = 'verified-current-inputs';
    return result;
  } catch {
    result.artifactReady = false;
    result.imageReady = false;
    if (result.evidence.sourceImageObservation) {
      result.evidence.sourceImageObservation.state = 'unverified';
    }
    result.evidence.receiptState = 'missing-malformed-or-changed';
    result.buildInputs = { ok: false, reason: 'Missing, malformed, symlinked or changing build evidence rejected' };
    if (result.knownDecompilationStubs.ok) {
      result.knownDecompilationStubs = {
        ok: false, reason: 'Known-stub audit cannot be paired with stable, valid build evidence',
      };
    }
    return result;
  } finally { directories.close(); }
}

function gitValue(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], commandOptions).trim();
  } catch {
    return 'unknown';
  }
}

function countFiles(root, suffix) {
  if (!existsSync(root)) return 0;
  let count = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'target' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(suffix)) count++;
    }
  };
  visit(root);
  return count;
}

function runSourceBuild(root) {
  try {
    execFileSync(join(root, 'scripts/build-source.sh'), [], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

export function auditUaaTaskReadiness({
  workspaceRoot = resolve(scriptsRoot, '..'), runBuild = false, execute = execFileSync,
} = {}) {
const uaaRoot = join(workspaceRoot, 'vendor-upstream/ibizlab-runtime/ibzuaa');
const taskRoot = join(workspaceRoot, 'task7/SAPAAS');
const checks = [];
const uaaPom = join(uaaRoot, 'pom.xml');
const uaaBuild = join(uaaRoot, 'scripts/build-source.sh');
const uaaDockerfile = join(uaaRoot, 'scripts/Dockerfile.source');
const uaaBuildReport = join(uaaRoot, '.artifacts/source-build/source-build.json');
const expectedUaaArtifact = join(
  uaaRoot,
  '.artifacts/source-build/ibzuaa.jar',
);
const currentUaaCommit = gitValue(uaaRoot, ['rev-parse', 'HEAD']);

checks.push(probeCheck(
  'uaa-source-tree',
  'uaa',
  () => existsSync(uaaPom) && countFiles(uaaRoot, '.java') > 0,
  'Maven root POM and Java source are present',
  [relative(workspaceRoot, uaaPom)],
));
checks.push(probeCheck(
  'uaa-source-build-entrypoint',
  'uaa',
  () => existsSync(uaaBuild) && statSync(uaaBuild).isFile() && statSync(uaaBuild).mode & 0o111,
  'Dockerized source build entrypoint is executable',
  [relative(workspaceRoot, uaaBuild)],
));
checks.push(probeCheck(
  'uaa-source-dockerfile',
  'uaa',
  () => existsSync(uaaDockerfile) && /EXPOSE 32666/.test(readFileSync(uaaDockerfile, 'utf8')),
  'Source-built image contract exposes UAA port 32666',
  [relative(workspaceRoot, uaaDockerfile)],
));

// A normal audit verifies recorded evidence; --build additionally refreshes it.
const sourceBuildSucceeded = !runBuild || runSourceBuild(uaaRoot);
const uaa = verifyServiceBuildEvidence({
  root: uaaRoot, receiptPath: uaaBuildReport, artifactPath: expectedUaaArtifact,
  generatedArtifacts: ['ibzuaa.jar'], execute, requireStandaloneUaa: true,
});
const uaaArtifactReady = sourceBuildSucceeded && uaa.artifactReady;
const uaaImageReady = uaaArtifactReady && uaa.imageReady;
const runtimeTargetObservation = observeStandaloneUaaRuntime({ workspaceRoot, execute });
checks.push(check(
  'uaa-standalone-auth-source', 'uaa',
  uaa.standaloneAuthSource.ok, uaa.standaloneAuthSource.reason,
  uaa.standaloneAuthSource.evidence.missingInputs,
));
checks.push(check(
  'uaa-standalone-auth-protocol-closure', 'uaa',
  uaa.standaloneAuthProtocol.ok, uaa.standaloneAuthProtocol.reason,
));
checks.push(check(
  'uaa-standalone-runtime-binding', 'uaa',
  runtimeTargetObservation.ok, runtimeTargetObservation.reason,
));
checks.push(check(
  'uaa-known-decompilation-stubs', 'uaa',
  uaa.knownDecompilationStubs.ok, uaa.knownDecompilationStubs.reason,
));
checks.push(check(
  'uaa-own-source-bytecode-closure', 'uaa', uaa.ownSourceBytecodeClosure.ok,
  uaa.ownSourceBytecodeClosure.reason,
  uaa.ownSourceBytecodeClosure.evidence.compiledInputs.map(entry => entry.path),
));
checks.push(check(
  'uaa-source-identity',
  'uaa',
  uaa.sourceIdentity.ok,
  uaa.sourceIdentity.reason,
));
checks.push(check(
  'uaa-source-build-inputs',
  'uaa',
  uaa.buildInputs.ok,
  uaa.buildInputs.reason,
  uaa.evidence.currentInputs ? [`currentInputFingerprint=${uaa.evidence.currentInputs.fingerprint}`] : [],
));
checks.push(check(
  'uaa-source-build-evidence',
  'uaa',
  uaaArtifactReady,
  uaaArtifactReady
    ? 'Current UAA source commit produced the expected hash-verified artifact; artifact identity does not prove standalone sys_person protocol compatibility'
    : 'No hash-verified successful source build evidence; prebuilt image is not accepted',
  [
    relative(workspaceRoot, uaaBuildReport),
    `currentCommit=${currentUaaCommit}`,
    `expectedArtifact=${relative(workspaceRoot, expectedUaaArtifact)}`,
  ],
));
checks.push(check(
  'uaa-source-image-evidence',
  'uaa',
  uaaImageReady,
  uaaImageReady
    ? 'Two Docker image identity observations match the recorded digest and linux/arm64 platform; not compiler execution or image artifact binding'
    : 'No hash-verified source Docker image evidence; prebuilt image is not accepted',
  [relative(workspaceRoot, uaaBuildReport), 'platform=linux/arm64'],
));

const taskBuild = join(taskRoot, 'resources/classes/build.xml');
const taskSourceBuild = join(taskRoot, 'scripts/build-source.sh');
const taskBuildReport = join(workspaceRoot, 'task7/.artifacts/source-build/source-build.json');
const expectedTaskArtifact = join(
  workspaceRoot,
  'task7/.artifacts/source-build/SAPAAS.war',
);
const taskDockerfile = join(workspaceRoot, 'task7/Dockerfile.source');

checks.push(probeCheck(
  'task-source-tree',
  'task',
  () => existsSync(taskBuild) && countFiles(taskRoot, '.java') > 0,
  'Ant build descriptor and recovered Java source are present',
  [relative(workspaceRoot, taskBuild)],
));
checks.push(probeCheck(
  'task-local-dependencies',
  'task',
  () => !/I:\/J2EE\/commonlib/.test(readFileSync(taskBuild, 'utf8'))
    && statSync(join(taskRoot, 'lib')).isDirectory(),
  'Task source build must carry a local dependency closure; I:/J2EE/commonlib is not reproducible',
  ['resources/classes/build.xml'],
));
checks.push(probeCheck(
  'task-war-assembly',
  'task',
  () => /<war\b/.test(readFileSync(taskBuild, 'utf8')) && existsSync(join(taskRoot, 'WEB-INF')),
  'Task source must define WAR assembly and include the SAPAAS web application',
  ['resources/classes/build.xml', 'WEB-INF/'],
));
checks.push(probeCheck(
  'task-source-dockerfile',
  'task',
  () => statSync(taskDockerfile).isFile(),
  'A source-built Task Dockerfile is required before image claims are allowed',
  [relative(workspaceRoot, taskDockerfile)],
));

checks.push(probeCheck(
  'task-source-build-entrypoint',
  'task',
  () => statSync(taskSourceBuild).isFile() && Boolean(statSync(taskSourceBuild).mode & 0o111),
  'Dockerized Task source build entrypoint is executable',
  [relative(workspaceRoot, taskSourceBuild)],
));

const taskSourceBuildSucceeded = !runBuild || runSourceBuild(taskRoot);
const task = verifyServiceBuildEvidence({
  root: join(workspaceRoot, 'task7'), receiptPath: taskBuildReport,
  artifactPath: expectedTaskArtifact, execute,
});
const taskWarBindingPath = join(workspaceRoot,
  'task7/.artifacts/task7-independent-compiler-SyMo3p/war-output-binding.json');
const taskCurrentInputScreenPath = join(workspaceRoot,
  'task7/.artifacts/task7-independent-compiler-SyMo3p/current-input-screen.json');
const taskInputClosurePath = join(workspaceRoot,
  'task7/.artifacts/task7-independent-compiler-SyMo3p/input-screen.json');
const taskOwnSourceClosure = verifyTaskOwnSourceClosureEvidence({
  taskEvidence: task,
  buildReceiptPath: taskBuildReport,
  inputScreenPath: taskCurrentInputScreenPath,
  inputClosurePath: taskInputClosurePath,
  warBindingPath: taskWarBindingPath,
});
const taskArtifactReady = taskSourceBuildSucceeded && task.artifactReady;
const taskImageReady = taskArtifactReady && task.imageReady;
checks.push(check(
  'task-known-decompilation-stubs', 'task',
  task.knownDecompilationStubs.ok, task.knownDecompilationStubs.reason,
));
checks.push(check(
  'task-own-source-bytecode-closure', 'task', taskOwnSourceClosure.ok,
  taskOwnSourceClosure.ok
    ? taskOwnSourceClosure.reason
    : task.ownSourceBytecodeClosure.reason,
  task.ownSourceBytecodeClosure.evidence.compiledInputs.map(entry => entry.path),
));
checks.push(check(
  'task-source-identity',
  'task',
  task.sourceIdentity.ok,
  task.sourceIdentity.reason,
));
checks.push(check(
  'task-source-build-inputs',
  'task',
  task.buildInputs.ok,
  task.buildInputs.reason,
  task.evidence.currentInputs ? [`currentInputFingerprint=${task.evidence.currentInputs.fingerprint}`] : [],
));
checks.push(check(
  'task-source-build-evidence',
  'task',
  taskArtifactReady,
  taskArtifactReady
    ? 'Current Task source commit produced the expected hash-verified WAR'
    : 'No hash-verified successful Task source build evidence; prebuilt image is not accepted',
  [
    relative(workspaceRoot, taskBuildReport),
    `expectedArtifact=${relative(workspaceRoot, expectedTaskArtifact)}`,
  ],
));
checks.push(check(
  'task-source-image-evidence',
  'task',
  taskImageReady,
  taskImageReady
    ? 'Two Docker image identity observations match the recorded digest and linux/arm64 platform; not compiler execution or image artifact binding'
    : 'No hash-verified successful Task source Docker image evidence; prebuilt image is not accepted',
  [relative(workspaceRoot, taskBuildReport), 'platform=linux/arm64'],
));

return {
  schemaVersion: 1,
  contract: 'uaa-task-own-source-readiness',
  generatedAt: new Date().toISOString(),
  runBuild,
  nativeAcceptance: false,
  compilerBuildInDockerVerified: false,
  limitations: [
    'Commit-only receipts are insufficient; builders must record sourceInputs before/after using source-build-input-inventory-v1.',
    'Builder image pinning and compiler execution provenance require independent verification.',
    'Known decompilation marker checks are not semantic completeness; own-bytecode/dependency source closure remains blocked without an independent verifier.',
    'The target is standalone UAA /auths/login using sys_person, not the legacy IBZUSER implementation. Candidate source input paths alone cannot prove this binding.',
    'Standalone UAA source/runtime protocol closure remains unverified independently of source input presence and artifact/image identity.',
    'Runtime entrypoint/JAR observations are binary identity only, never editable-source or effective encoder/protocol evidence.',
    'Packaged SM3 configuration does not prove the effective running encoder; login role authorities are cleared and cannot prove fine-grant permission closure.',
    'Source/image readiness does not prove running-container identity, permissions, isolation or native UI workflows.',
  ],
  source: {
    uaaCommit: currentUaaCommit,
    taskCommit: gitValue(join(workspaceRoot, 'task7'), ['rev-parse', 'HEAD']),
  },
  sourceBuildEvidence: { uaa32666: uaa.evidence, task30088: task.evidence },
  taskOwnSourceClosure,
  runtimeTargetObservation,
  services: {
    uaa32666: checks.filter((item) => item.service === 'uaa'),
    task30088: checks.filter((item) => item.service === 'task'),
  },
  checks,
  readiness: {
    uaa32666: checks.filter((item) => item.service === 'uaa').every((item) => item.status === 'pass'),
    task30088: checks.filter((item) => item.service === 'task').every((item) => item.status === 'pass'),
  },
};
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, options: { build: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    console.log('Usage: node scripts/harness-uaa-task-readiness.mjs [--build]');
    console.log('Default: read-only current-source audit. --build additionally executes both service builders.');
    return 0;
  }
  const report = auditUaaTaskReadiness({ runBuild: values.build === true });
  const reportPath = process.env.UAA_TASK_READINESS_REPORT
    ? resolve(process.env.UAA_TASK_READINESS_REPORT)
    : join(resolve(scriptsRoot, '..'), '.artifacts/uaa-task-readiness', `audit-${randomUUID()}`, 'report.json');
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(dirname(reportPath), { create: true });
    directories.write(directory, basename(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  } finally { directories.close(); }
  console.log(JSON.stringify(report, null, 2));
  return report.readiness.uaa32666 && report.readiness.task30088 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch { console.error('UAA/Task readiness audit or immutable report write failed'); process.exitCode = 1; }
}
