#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';

export const COMPILER_DOCKER_CONTRACT = 'independent-jdk-compiler-in-docker-v1';
export const DEFAULT_COMPILER_IMAGE = 'eclipse-temurin:17-jdk';
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = Object.freeze(['.git', '.artifacts', 'target']);
const digestPattern = /^[a-f0-9]{64}$/;
const imageIdPattern = /^sha256:[a-f0-9]{64}$/;
const label = 'io.aibiz.independent-compiler';
const java = '/opt/java/openjdk/bin/java';
const liveResults = new WeakMap();
const liveUaaReplays = new WeakMap();
const failedUaaReplays = new WeakMap();
const uaaModules = Object.freeze(['uaa-core', 'uaa-user', 'uaa-api']);
export const UAA_COMPILER_REPLAY_CONTRACT = 'independent-recovered-uaa-compiler-output-replay-v1';
export const MAINTAINED_UAA_COMPILER_REPLAY_CONTRACT = 'independent-maintained-uaa-compiler-output-replay-v1';
export const MAINTAINED_UAA_BUILD_CONTRACT = 'standalone-uaa-maintained-source-compilation-v1';
const maintainedUaaRoot = join(workspace, 'standalone-uaa');
const maintainedUaaReceiptPattern = /^\.artifacts\/standalone-uaa-source-build\/build-[A-Za-z0-9]+\/report\.json$/;
const focusedUaaTests = Object.freeze([
  'sm3KnownVectorAndEmptyInput', 'sm3Preserves64CharacterAndCaseSensitiveContract',
  'usernameLookupUsesUidAndDcRatherThanLegacyUser', 'absentDomainDoesNotAddDcPredicate',
  'missingAndDisabledPersonCannotAuthenticate', 'existingSm3StorageIsNotRehashed',
  'loginRouteAndRequestMappingAreExact', 'responseMappingRetainsTokenAndUserContract',
  'passwordFallbackRetainsOriginalNoOpContract', 'recoveredRethrowKeepsSameCheckedExceptionObject',
  'mapperSchemaParsesWithActualMybatisApi', 'roleMemberSqlUsesPersonIdNotLoginUid',
  'actualHttpLoginUsesRecoveredServiceAndSignedJwt',
  'actualHttpAcceptsUppercaseSm3AndRejectsIncorrectOrLowercaseHash',
  'roleAssemblyUsesPersonDomainAndExactFineGrants', 'emptyRoleMembershipDoesNotGrantSystems',
  'userInfoSelfRouteAndMappingAreExact', 'actualHttpSelfUsesSourceTokenFilterAndPersonRoles',
  'actualHttpSelfRejectsMissingExpiredAndWrongSignatureTokens',
]);
export const MAINTAINED_UAA_OAUTH2_TESTS = Object.freeze([
  'serverIssuedStoredTokenIsPositiveControl',
  'storedTamperedSignatureIsRejectedWithoutDeletingStoreEntry',
  'storedWrongKeySignatureIsRejectedWithoutDeletingStoreEntry',
  'malformedMissingExpiryAndNullTokensFailClosed',
  'sameIssuedTokenExpiresWhileItsStoreEntryRemains',
  'unstoredSignedTokenIsNotCryptographicEvidence',
  'revokedIssuedTokenIsDeniedWhileSignatureAndExpiryRemainValid',
  'logoutRevokesAllUserTokensAndRefreshTokensOnlyForThisClientUser',
  'thresholdRevocationPreservesLongLivedTokens',
  'sourceFilterReturns401ForStoredInvalidAndRevokedTokens',
  'storeAuthenticationMustMatchJwtSubjectAndUser',
  'centralCacheInitializationWritesUserAndTokenHash',
  'resourceServerLoadAuthenticationRejectsStoredInvalidTokens',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyMaintainedOauth2Evidence(receipt) {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.contract, 'standalone-uaa-real-oauth2-security-regression-v1');
  assert.equal(receipt.suite, 'OAuth2TokenSecurityTests');
  assert.equal(receipt.tests, MAINTAINED_UAA_OAUTH2_TESTS.length);
  assert.deepEqual([...receipt.executed].sort(), [...MAINTAINED_UAA_OAUTH2_TESTS].sort(),
    'Maintained OAuth2 required test roster differs');
  assert.equal(receipt.failures, 0);
  assert.equal(receipt.skipped, 0);
  assert.deepEqual(receipt.errors, []);
  assert.equal(receipt.nativeAcceptance, false);
  assert.ok(Array.isArray(receipt.tokenEvidence) && receipt.tokenEvidence.length >= 8);
  assert.equal(receipt.fixture,
    'real-source-oauth2-service-adapter-filter; real-library-in-memory-token-store; no-boot-or-db');
  assert.equal(receipt.classOrigins?.['cn.ibizlab.core.oauth2.config.OAuth2TokenAdapter'],
    'file:/packages/uaa-user-reconstructed.jar');
  assert.equal(receipt.classOrigins?.['cn.ibizlab.util.security.AuthorizationTokenFilter'],
    'file:/starters/ibizlab-boot-starter-2.6.12.10.jar');
}

// The helper never runs project code, scripts, annotation processors or Maven.
// Its ephemeral MAC binds observations to this invocation, not to a static JSON claim.
const helper = String.raw`import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.*;
import java.io.*;
import java.util.jar.JarFile;

class CompilerVerifier {
  static Path out = Path.of("/output");
  static Path input = Path.of("/input");
  static String javac = "/opt/java/openjdk/bin/javac";
  static TreeMap<String,String> proof = new TreeMap<>();
  static String hex(byte[] data) { return HexFormat.of().formatHex(data); }
  static String digest(byte[] data) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(data));
  }
  static String digest(Path path) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    try (InputStream in = Files.newInputStream(path)) {
      byte[] block = new byte[65536]; int n;
      while ((n = in.read(block)) != -1) md.update(block, 0, n);
    }
    return hex(md.digest());
  }
  static String manifest(Path root) throws Exception {
    List<Path> paths;
    try (var stream = Files.walk(root)) {
      paths = stream.filter(p -> !p.equals(root)).sorted().toList();
    }
    StringBuilder value = new StringBuilder();
    for (Path p : paths) {
      if (Files.isSymbolicLink(p)) throw new IOException("symlink");
      if (Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS)) continue;
      if (!Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS)) throw new IOException("nonregular");
      value.append(root.relativize(p)).append('\t').append(Files.size(p)).append('\t')
        .append(digest(p)).append('\n');
    }
    return value.toString();
  }
  static int run(List<String> args, String name) throws Exception {
    ProcessBuilder builder = new ProcessBuilder(args);
    builder.directory(Path.of("/tmp").toFile());
    builder.environment().clear();
    builder.environment().put("LANG", "C.UTF-8");
    builder.environment().put("HOME", "/tmp");
    builder.redirectOutput(out.resolve(name + ".stdout").toFile());
    builder.redirectError(out.resolve(name + ".stderr").toFile());
    return builder.start().waitFor();
  }
  static List<String> compiler(int release, Path dest, String cp) throws Exception {
    Files.createDirectories(dest);
    return new ArrayList<>(List.of(javac, "--release", "" + release, "-encoding", "UTF-8",
      "-proc:none", "-implicit:none", "-classpath", cp, "-sourcepath", "/tmp/empty-source",
      "-d", dest.toString()));
  }
  static void rejectImplicitClasspath(String cp) throws Exception {
    StringBuilder rejected = new StringBuilder();
    int count = 0;
    for (String value : cp.split(File.pathSeparator)) {
      if (!value.endsWith(".jar")) continue;
      try (JarFile jar = new JarFile(value, false)) {
        var manifest = jar.getManifest();
        String extension = manifest == null ? null
          : manifest.getMainAttributes().getValue("Class-Path");
        if (extension != null && !extension.isBlank()) {
          rejected.append(input.relativize(Path.of(value))).append('\t')
            .append(digest(extension.getBytes(StandardCharsets.UTF_8))).append('\t')
            .append(extension.strip().split("\\s+").length).append('\n');
          count++;
        }
      }
    }
    String findings = rejected.toString();
    Files.writeString(out.resolve("classpath-rejections.tsv"), findings);
    proof.put("classpathRejectionsSha256", digest(findings.getBytes(StandardCharsets.UTF_8)));
    proof.put("classpathRejectionsCount", "" + count);
    proof.put("classpathManifestCheck", count == 0 ? "passed" : "failed");
    if (count != 0) throw new IOException("implicit-classpath");
  }
  static void classHeader(byte[] data, int release) throws Exception {
    if (data.length < 10 || data[0] != (byte)0xca || data[1] != (byte)0xfe
      || data[2] != (byte)0xba || data[3] != (byte)0xbe
      || (((data[6] & 255) << 8) | (data[7] & 255)) != release + 44)
      throw new IOException("invalid-class");
  }
  public static void main(String[] ignored) throws Exception {
    Properties config = new Properties();
    try (var in = Files.newInputStream(Path.of("/verifier/config"))) { config.load(in); }
    int release = Integer.parseInt(config.getProperty("release"));
    String nonce = config.getProperty("nonce");
    proof.put("contract", "independent-jdk-compiler-proof-v1");
    proof.put("nonce", nonce);
    proof.put("release", "" + release);
    proof.put("status", "failed");
    proof.put("errorCode", "not-started");
    try {
      Files.createDirectories(Path.of("/tmp/empty-source"));
      Files.createDirectories(Path.of("/tmp/empty-classpath"));
      String expected = Files.readString(Path.of("/verifier/expected.tsv"));
      String before = manifest(input);
      Files.writeString(out.resolve("source.tsv"), before);
      proof.put("inputManifestSha256", digest(before.getBytes(StandardCharsets.UTF_8)));
      if (!before.equals(expected)) throw new IOException("input-manifest-mismatch");
      proof.put("helperSha256", digest(Path.of("/verifier/CompilerVerifier.java")));
      proof.put("javacSha256", digest(Path.of(javac)));
      proof.put("jdkModulesSha256", digest(Path.of("/opt/java/openjdk/lib/modules")));
      if (run(List.of(javac, "-version"), "version") != 0) throw new IOException("version-failed");
      proof.put("compilerVersion", (Files.readString(out.resolve("version.stdout"))
        + Files.readString(out.resolve("version.stderr"))).strip());
      Path good = Path.of("/tmp/DockerCompilerChallenge.java");
      Files.writeString(good, "public final class DockerCompilerChallenge { public static final String NONCE = \""
        + nonce + "\"; }\n");
      List<String> positive = compiler(release, out.resolve("control"), "/tmp/empty-classpath");
      positive.add(good.toString());
      int positiveExit = run(positive, "positive");
      proof.put("positiveExitCode", "" + positiveExit);
      if (positiveExit != 0) throw new IOException("positive-failed");
      byte[] control = Files.readAllBytes(out.resolve("control/DockerCompilerChallenge.class"));
      classHeader(control, release);
      if (!new String(control, StandardCharsets.ISO_8859_1).contains(nonce))
        throw new IOException("positive-nonce-missing");
      proof.put("positiveClassSha256", digest(control));
      Path bad = Path.of("/tmp/InvalidCompilerChallenge.java");
      Files.writeString(bad, "public class InvalidCompilerChallenge { this is not valid Java; }\n");
      List<String> negative = compiler(release, Path.of("/tmp/negative"), "/tmp/empty-classpath");
      negative.add(bad.toString());
      int negativeExit = run(negative, "negative");
      proof.put("negativeExitCode", "" + negativeExit);
      if (negativeExit == 0 || !manifest(Path.of("/tmp/negative")).isEmpty())
        throw new IOException("negative-failed");
      String cp = config.getProperty("classpath");
      if (cp.isEmpty()) cp = "/tmp/empty-classpath";
      rejectImplicitClasspath(cp);
      proof.put("classpathManifestCheck", "passed");
      List<String> compile = compiler(release, out.resolve("classes"), cp);
      compile.add("@/verifier/sources.args");
      int exit = run(compile, "compiler");
      proof.put("compileExitCode", "" + exit);
      if (exit != 0) throw new IOException("javac-failed");
      String classes = manifest(out.resolve("classes"));
      if (classes.isEmpty()) throw new IOException("empty-classes");
      for (String line : classes.split("\n")) {
        String name = line.split("\t")[0];
        if (!name.endsWith(".class")) throw new IOException("non-class-output");
        classHeader(Files.readAllBytes(out.resolve("classes").resolve(name)), release);
      }
      Files.writeString(out.resolve("classes.tsv"), classes);
      proof.put("outputManifestSha256", digest(classes.getBytes(StandardCharsets.UTF_8)));
      String after = manifest(input);
      if (!after.equals(before)) throw new IOException("input-changed");
      proof.put("inputAfterSha256", digest(after.getBytes(StandardCharsets.UTF_8)));
      proof.put("status", "passed");
      proof.put("errorCode", "none");
    } catch (Exception error) {
      proof.put("errorCode", error instanceof IOException ? error.getMessage() : "helper-failed");
    }
    StringBuilder payload = new StringBuilder();
    for (var entry : proof.entrySet())
      payload.append(entry.getKey()).append('=').append(entry.getValue()).append('\n');
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(HexFormat.of().parseHex(config.getProperty("secret")), "HmacSHA256"));
    String signature = hex(mac.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8)));
    Files.writeString(out.resolve("proof.properties"), payload + "proofHmacSha256=" + signature + "\n");
  }
}
`;
const helperSha256 = hash(helper);

function safeRelative(path, compiler = false) {
  assert.equal(typeof path, 'string', 'Expected relative path');
  assert.ok(/^[A-Za-z0-9._/$@+={} -]+$/.test(path) && !path.startsWith('/')
    && path.split('/').every(part => part && part !== '.' && part !== '..'),
  `Unsafe relative path: ${path}`);
  if (compiler) assert.match(path, /^[A-Za-z0-9._/-]+$/, `Unsafe compiler path: ${path}`);
}

function inventory(root, { allowEmpty = false, excluded = excludedDirectories } = {}) {
  const directories = new PinnedDirectories();
  const entries = [];
  let bytes = 0;
  function visit(dir, prefix = '') {
    directories.verify(dir);
    for (const name of fs.readdirSync(dir.access)) {
      safeRelative(name);
      const path = prefix ? `${prefix}/${name}` : name;
      const info = fs.lstatSync(directories.entry(dir, name));
      assert.ok(!info.isSymbolicLink(), `Symlink compiler input rejected: ${path}`);
      if (info.isDirectory()) {
        if (!excluded.includes(name)) visit(directories.open(join(dir.path, name)), path);
      } else {
        const { data } = readPinnedFile(directories, dir, name, info);
        bytes += data.length;
        assert.ok(bytes <= 1024 * 1024 * 1024, 'Compiler input tree is too large');
        entries.push({ path, bytes: data.length, sha256: hash(data) });
      }
    }
    directories.verify(dir);
  }
  try { visit(directories.open(resolve(root))); }
  finally { directories.close(); }
  entries.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.ok(allowEmpty || entries.length, 'Compiler input inventory is empty');
  return {
    ...fingerprint(entries), entries,
    manifestSha256: hash(manifest(entries)),
  };
}

export function collectCompilerInputs(root) {
  assert.ok(root, 'Compiler root is required');
  return inventory(root);
}

function manifest(entries) {
  return entries.map(entry => `${entry.path}\t${entry.bytes}\t${entry.sha256}\n`).join('');
}

function pinnedRead(path) {
  const directories = new PinnedDirectories();
  try {
    return readPinnedFile(directories, directories.open(dirname(path)), relative(dirname(path), path)).data;
  } finally { directories.close(); }
}

function parseProof(data) {
  const proof = Object.create(null);
  for (const line of String(data).split('\n').filter(Boolean)) {
    const index = line.indexOf('=');
    assert.ok(index > 0, 'Malformed compiler proof');
    const key = line.slice(0, index);
    assert.match(key, /^[A-Za-z][A-Za-z0-9]*$/, 'Malformed proof key');
    assert.ok(!Object.hasOwn(proof, key), 'Duplicate proof key');
    proof[key] = line.slice(index + 1);
  }
  return proof;
}

function canonicalProof(proof) {
  return Object.keys(proof).filter(key => key !== 'proofHmacSha256').sort()
    .map(key => `${key}=${proof[key]}\n`).join('');
}

function manifestClasspathDiagnostic(proof, path, classpath, inputs, authentic) {
  assert.match(proof.classpathRejectionsSha256 ?? '', digestPattern, 'Missing manifest audit digest');
  assert.match(proof.classpathRejectionsCount ?? '', /^(?:0|[1-9][0-9]*)$/,
    'Missing manifest audit count');
  const bytes = pinnedRead(path);
  assert.equal(hash(bytes), proof.classpathRejectionsSha256, 'Manifest audit bytes differ');
  const lines = bytes.toString().split('\n');
  assert.equal(lines.pop(), '', 'Malformed manifest audit termination');
  const rejectedJars = lines.map(line => {
    const fields = line.split('\t');
    assert.equal(fields.length, 3, 'Malformed manifest audit row');
    const [path, classPathSha256, targetCount] = fields;
    safeRelative(path, true);
    assert.ok(classpath.includes(path), 'Manifest audit JAR is not an explicit input');
    assert.match(classPathSha256, digestPattern, 'Malformed manifest Class-Path digest');
    assert.match(targetCount, /^[1-9][0-9]*$/, 'Malformed manifest target count');
    assert.ok(Number.isSafeInteger(Number(targetCount)), 'Manifest target count is too large');
    return { path, jarSha256: inputs.entries.find(entry => entry.path === path).sha256,
      classPathSha256, targetCount: Number(targetCount) };
  });
  assert.equal(rejectedJars.length, Number(proof.classpathRejectionsCount), 'Manifest audit count differs');
  assert.deepEqual(rejectedJars.map(item => item.path),
    classpath.filter(path => rejectedJars.some(item => item.path === path)),
    'Manifest audit order or duplicate JAR differs');
  const status = rejectedJars.length ? 'fail' : 'pass';
  assert.equal(proof.classpathManifestCheck, status === 'pass' ? 'passed' : 'failed');
  return {
    contract: 'independent-docker-jdk-manifest-classpath-audit-v1', status,
    evidenceOrigin: authentic ? 'live-independent-docker-jdk-manifest-inspection'
      : 'controlled-runner-not-required-gate-evidence',
    rejectedJars, auditSha256: proof.classpathRejectionsSha256,
  };
}

function docker(execute, args, timeout) {
  let result;
  try {
    result = execute('docker', args, {
      encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`docker ${args[0]} launch failed`);
  }
  assert.ok(result && !result.error && !result.signal && result.status === 0,
    `docker ${args[0]} failed (status=${result?.status ?? 'null'}, signal=${result?.signal ?? 'none'})`);
  return String(result.stdout ?? '');
}

function inspect(execute, target, timeout) {
  return JSON.parse(docker(execute, ['inspect', '--format', '{{json .}}', '--', target], timeout));
}

function assertOwned(container, expected) {
  assert.match(container.Id ?? '', /^[a-f0-9]{64}$/);
  assert.equal(container.Name, `/${expected.name}`, 'Container name differs');
  assert.equal(container.Config?.Labels?.[label], expected.runId, 'Container ownership differs');
  assert.equal(container.Image, expected.imageId, 'Container image differs');
  if (expected.id) assert.equal(container.Id, expected.id, 'Container identity differs');
}

function assertIsolation(container, expected) {
  assertOwned(container, expected);
  assert.equal(container.Config.Image, expected.imageId);
  assert.equal(container.Config.User, expected.user);
  assert.equal(container.Config.WorkingDir, '/tmp');
  assert.deepEqual(container.Config.Entrypoint, [java]);
  assert.deepEqual(container.Config.Cmd, ['--source', '17', '/verifier/CompilerVerifier.java']);
  for (const [key, value] of Object.entries(expected.env)) {
    const matches = container.Config.Env.filter(entry => entry.startsWith(`${key}=`));
    assert.deepEqual(matches, [`${key}=${value}`], `Container environment differs: ${key}`);
  }
  const host = container.HostConfig;
  assert.equal(host.NetworkMode, 'none');
  assert.equal(host.ReadonlyRootfs, true);
  assert.equal(host.Privileged, false);
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.CapAdd ?? [], []);
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges:true']);
  assert.equal(host.Memory, 1024 * 1024 * 1024);
  assert.equal(host.NanoCpus, 1_000_000_000);
  assert.equal(host.PidsLimit, 128);
  assert.deepEqual(host.Binds ?? [], []);
  assert.deepEqual(host.Devices ?? [], []);
  assert.deepEqual(host.Tmpfs, { '/tmp': 'rw,noexec,nosuid,nodev,size=256m,mode=1777' });
  const mounts = container.Mounts.map(item => ({
    source: item.Source, destination: item.Destination, rw: item.RW, type: item.Type,
  })).sort((a, b) => a.destination.localeCompare(b.destination));
  assert.deepEqual(mounts, expected.mounts.map(item => ({ ...item, type: 'bind' }))
    .sort((a, b) => a.destination.localeCompare(b.destination)), 'Container mounts differ');
}

function classesInventory(root, release) {
  const output = inventory(root, { excluded: [] });
  for (const entry of output.entries) {
    assert.ok(entry.path.endsWith('.class'), 'Non-class compiler output');
    const data = pinnedRead(join(root, entry.path));
    assert.ok(data.length >= 10 && data.readUInt32BE(0) === 0xcafebabe
      && data.readUInt16BE(6) === release + 44, 'Invalid compiler bytecode');
  }
  return output;
}

function writeSnapshot(directories, snapshot, root, inputs) {
  for (const entry of inputs.entries) {
    const bytes = pinnedRead(join(root, entry.path));
    assert.equal(bytes.length, entry.bytes, 'Input bytes changed during snapshot');
    assert.equal(hash(bytes), entry.sha256, 'Input hash changed during snapshot');
    directories.write(directories.open(dirname(join(snapshot.path, entry.path)), { create: true }),
      relative(dirname(entry.path), entry.path), bytes);
  }
  assert.deepEqual(inventory(snapshot.path), inputs, 'Snapshot differs from source inventory');
}

function outputShape(report) {
  const { relativePath, ...result } = report.output;
  assert.equal(relativePath, 'build/classes', 'Invalid compiler output path');
  return result;
}

function assertReceiptArtifacts(path, report) {
  assert.deepEqual(inventory(join(dirname(path), 'snapshot')), report.source.inputs,
    'Receipt snapshot inputs differ');
  assert.deepEqual(classesInventory(join(dirname(path), 'build/classes'), report.compiler.release),
    outputShape(report), 'Receipt bytecode outputs differ');
}

// A copied or injected result cannot acquire this capability, even with matching booleans.
export function isLiveCompilerResult(result, { root, inputFingerprint, expectedImageId } = {}) {
  const expected = liveResults.get(result);
  if (!expected) return false;
  try {
    const { report } = result;
    assert.equal(result.exitCode, 0);
    assert.equal(result.receiptPath, expected.path);
    assert.equal(result.receiptSha256, expected.digest);
    assert.equal(hash(JSON.stringify(report)), expected.reportDigest);
    assert.equal(hash(pinnedRead(result.receiptPath)), expected.digest);
    assert.equal(pinnedRead(join(dirname(result.receiptPath), 'receipt.sha256')).toString().trim(), expected.digest);
    if (expected.candidate) {
      const candidate = expected.candidate;
      assert.equal(result.verificationStatus, 'fresh-docker-replay-passed');
      assert.equal(result.verifiedReceiptPath, candidate.path);
      assert.equal(result.verifiedReceiptSha256, candidate.digest);
      assert.equal(hash(pinnedRead(candidate.path)), candidate.digest);
      assert.equal(pinnedRead(join(dirname(candidate.path), 'receipt.sha256')).toString().trim(), candidate.digest);
      assertReceiptArtifacts(candidate.path, candidate.report);
    } else {
      for (const key of ['verificationStatus', 'verifiedReceiptPath', 'verifiedReceiptSha256']) {
        assert.ok(!(key in result), 'Direct compilation has no authenticated replay provenance');
      }
    }
    if (root !== undefined) assert.equal(resolve(root), report.source.root);
    if (inputFingerprint !== undefined) assert.equal(inputFingerprint, report.source.inputs.fingerprint);
    if (expectedImageId !== undefined) assert.equal(report.compiler.imageId, expectedImageId);
    assert.deepEqual(collectCompilerInputs(report.source.root), report.source.inputs);
    assertReceiptArtifacts(result.receiptPath, report);
    return true;
  } catch { return false; }
}

export function runCompilerInDocker(options = {}) {
  const allowed = ['root', 'output', 'image', 'expectedImageId', 'release', 'classpath', 'sourceLabel', 'execute', 'timeout'];
  for (const key of Object.keys(options)) assert.ok(allowed.includes(key), `Unknown compiler option: ${key}`);
  const {
    root: rawRoot, output, image = DEFAULT_COMPILER_IMAGE, expectedImageId,
    release = 17, classpath = [], sourceLabel = null, execute = spawnSync, timeout = 120_000,
  } = options;
  assert.ok(rawRoot, 'Compiler source root is required');
  const root = resolve(rawRoot);
  assert.ok(Number.isSafeInteger(release) && release >= 8 && release <= 17, 'JDK17 release must be 8..17');
  assert.ok(Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 600_000, 'Invalid compiler timeout');
  assert.equal(typeof execute, 'function', 'Invalid Docker runner');
  assert.match(image, /^(?:[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255})$/, 'Invalid compiler image');
  if (expectedImageId !== undefined) assert.match(expectedImageId, imageIdPattern);
  assert.ok(sourceLabel === null || (typeof sourceLabel === 'string'
    && /^[A-Za-z0-9._/-]{1,128}$/.test(sourceLabel)), 'Invalid source label');
  assert.ok(Array.isArray(classpath) && new Set(classpath).size === classpath.length, 'Invalid classpath');
  const inputs = collectCompilerInputs(root);
  const sources = inputs.entries.filter(entry => entry.path.endsWith('.java'));
  assert.ok(sources.length, 'No Java compiler sources');
  for (const entry of inputs.entries) assert.ok(!entry.path.endsWith('.class'), 'Loose input bytecode rejected');
  for (const entry of sources) safeRelative(entry.path, true);
  for (const path of classpath) {
    safeRelative(path, true);
    assert.ok(path.endsWith('.jar') && inputs.entries.some(entry => entry.path === path && entry.bytes > 0),
      'Classpath must be an inventoried nonempty relative JAR');
  }
  const destination = resolve(output ?? join(workspace, '.artifacts/compiler-in-docker', `run-${randomUUID()}`));
  assert.ok(!/[,\r\n]/.test(destination), 'Unsafe Docker mount path');
  const overlap = (a, b) => a === b || a.startsWith(`${b}/`);
  assert.ok(!overlap(destination, root) && !overlap(root, destination), 'Source/output overlap rejected');
  assert.ok(process.geteuid() > 0 && process.getegid() > 0, 'Compiler verifier must use a non-root host user');
  const directories = new PinnedDirectories();
  let report;
  let persisted;
  try {
    const run = directories.open(destination, { create: true, exclusive: true });
    const snapshot = directories.open(join(destination, 'snapshot'), { create: true, exclusive: true });
    const build = directories.open(join(destination, 'build'), { create: true, exclusive: true });
    const privateDir = directories.open(join(destination, 'private'), { create: true, exclusive: true });
    const runId = randomUUID();
    const expected = {
      runId, name: `aibiz-compiler-${runId}`, imageId: null,
      user: `${process.geteuid()}:${process.getegid()}`,
      env: { JAVA_TOOL_OPTIONS: '', JDK_JAVA_OPTIONS: '', _JAVA_OPTIONS: '', CLASSPATH: '', HOME: '/tmp' },
      mounts: [
        { source: snapshot.path, destination: '/input', rw: false },
        { source: build.path, destination: '/output', rw: true },
        { source: privateDir.path, destination: '/verifier', rw: false },
      ],
    };
    report = {
      schemaVersion: 1, contract: COMPILER_DOCKER_CONTRACT, status: 'failed',
      generatedAt: new Date().toISOString(), nativeAcceptance: false,
      compilerBuildInDockerVerified: false, fullSourceClosureVerified: false, evidenceOrigin: 'unverified',
      source: { root, label: sourceLabel, excludedDirectories: [...excludedDirectories], inputs },
      compiler: { executable: 'javac', release, classpath: [...classpath], image, helperSha256, sourceFiles: sources.length },
      output: { relativePath: 'build/classes' },
      checks: [], errors: [], summary: { passed: 0, failed: 1, skipped: 0 },
      limitations: [
        'Only independent Java compiler/source projection mechanics; not native acceptance or S06 source/protocol closure.',
        'Explicit JAR inputs are tracked, not proven editable dependency source closure; no project scripts or processors run.',
        'Trusts the host, Docker daemon and selected immutable JDK image; JSON, MAC and sidecar are not offline authenticity.',
        'Persisted receipt acceptance requires fresh Docker replay; no static booleans or fixture promotion.',
      ],
    };
    let created = false;
    let compiledOutput;
    try {
      writeSnapshot(directories, snapshot, root, inputs);
      const nonce = randomBytes(32).toString('hex');
      const secret = randomBytes(32);
      directories.write(privateDir, 'config', [
        `nonce=${nonce}`, `secret=${secret.toString('hex')}`, `release=${release}`,
        `classpath=${classpath.map(path => `/input/${path}`).join(':')}`, '',
      ].join('\n'));
      directories.write(privateDir, 'expected.tsv', manifest(inputs.entries));
      directories.write(privateDir, 'sources.args', sources.map(entry => `/input/${entry.path}\n`).join(''));
      directories.write(privateDir, 'CompilerVerifier.java', helper);
      const imageInfo = JSON.parse(docker(execute, [
        'image', 'inspect', '--format', '{{json .}}', '--', image,
      ], timeout));
      assert.match(imageInfo.Id, imageIdPattern, 'Invalid inspected image ID');
      assert.equal(imageInfo.Os, 'linux', 'Compiler image must be Linux');
      assert.match(imageInfo.Architecture ?? '', /^[A-Za-z0-9_-]+$/, 'Invalid image architecture');
      assert.ok(!Object.keys(imageInfo.Config?.Volumes ?? {}).length, 'Image volumes rejected');
      if (expectedImageId) assert.equal(imageInfo.Id, expectedImageId, 'Expected compiler image differs');
      expected.imageId = imageInfo.Id;
      report.compiler.imageId = imageInfo.Id;
      report.compiler.platform = `${imageInfo.Os}/${imageInfo.Architecture}`;
      const createArgs = [
        'create', '--pull=never', '--name', expected.name, '--label', `${label}=${runId}`,
        '--network=none', '--read-only', '--user', expected.user, '--workdir=/tmp',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
        '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=1g', '--cpus=1', '--pids-limit=128',
        ...Object.entries(expected.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        ...expected.mounts.flatMap(mount => [
          '--mount', `type=bind,src=${mount.source},dst=${mount.destination}${mount.rw ? '' : ',readonly'}`,
        ]),
        '--entrypoint', java, expected.imageId, '--source', '17', '/verifier/CompilerVerifier.java',
      ];
      // Record an attempted create before invoking the client: it may fail after daemon creation.
      created = true;
      expected.id = docker(execute, createArgs, timeout).trim();
      assert.match(expected.id, /^[a-f0-9]{64}$/, 'Invalid created container ID');
      const before = inspect(execute, expected.id, timeout);
      assertIsolation(before, expected);
      assert.equal(before.State.Status, 'created', 'Container was already started');
      assert.equal(before.State.Running, false);
      docker(execute, ['start', '-a', expected.id], timeout);
      const after = inspect(execute, expected.id, timeout);
      assertIsolation(after, expected);
      assert.equal(after.State.Status, 'exited');
      assert.equal(after.State.Running, false);
      assert.equal(after.State.OOMKilled, false);
      assert.equal(after.State.Error, '');
      assert.equal(after.State.ExitCode, 0, 'Compiler container exit differs');
      assert.ok(Date.parse(after.State.StartedAt) > 0
        && Date.parse(after.State.FinishedAt) >= Date.parse(after.State.StartedAt), 'Invalid execution timestamps');
      const proof = parseProof(pinnedRead(join(build.path, 'proof.properties')));
      const signature = createHmac('sha256', secret).update(canonicalProof(proof)).digest('hex');
      assert.equal(proof.proofHmacSha256, signature, 'Invocation compiler proof MAC differs');
      assert.equal(proof.contract, 'independent-jdk-compiler-proof-v1');
      assert.equal(proof.nonce, nonce, 'Compiler challenge differs');
      if (proof.classpathRejectionsSha256 !== undefined || proof.classpathRejectionsCount !== undefined) {
        report.compiler.manifestClasspath = manifestClasspathDiagnostic(proof,
          join(build.path, 'classpath-rejections.tsv'), classpath, inputs, execute === spawnSync);
      }
      assert.equal(proof.status, 'passed', `Compiler helper failed: ${proof.errorCode}`);
      assert.equal(proof.errorCode, 'none');
      assert.equal(proof.release, String(release));
      assert.equal(proof.helperSha256, helperSha256);
      assert.equal(proof.inputManifestSha256, inputs.manifestSha256);
      assert.equal(proof.inputAfterSha256, inputs.manifestSha256);
      assert.match(proof.compilerVersion, /^javac 17(?:\.|$)/);
      assert.match(proof.javacSha256, digestPattern);
      assert.match(proof.jdkModulesSha256, digestPattern);
      assert.equal(proof.compileExitCode, '0');
      assert.equal(proof.classpathManifestCheck, 'passed');
      assert.equal(proof.positiveExitCode, '0');
      assert.match(proof.negativeExitCode, /^[1-9][0-9]*$/);
      const control = pinnedRead(join(build.path, 'control/DockerCompilerChallenge.class'));
      assert.equal(hash(control), proof.positiveClassSha256, 'Positive compiler control differs');
      assert.equal(control.readUInt32BE(0), 0xcafebabe);
      assert.equal(control.readUInt16BE(6), release + 44);
      assert.ok(control.includes(Buffer.from(nonce)), 'Compiler control missing invocation nonce');
      compiledOutput = classesInventory(join(build.path, 'classes'), release);
      assert.equal(compiledOutput.manifestSha256, proof.outputManifestSha256);
      assert.equal(pinnedRead(join(build.path, 'classes.tsv')).toString(), manifest(compiledOutput.entries));
      assert.equal(pinnedRead(join(build.path, 'source.tsv')).toString(), manifest(inputs.entries));
      report.compiler = {
        ...report.compiler, version: proof.compilerVersion, javacSha256: proof.javacSha256,
        jdkModulesSha256: proof.jdkModulesSha256, exitCode: 0,
      };
      report.output = { relativePath: 'build/classes', ...compiledOutput };
      report.container = { id: expected.id, imageId: expected.imageId, startedAt: after.State.StartedAt,
        finishedAt: after.State.FinishedAt, exitCode: 0 };
      report.controls = { positive: 'pass', negative: 'pass', nonce, proofHmacSha256: signature };
      report.checks = [
        'snapshot-input-manifest', 'immutable-jdk-image', 'docker-isolation',
        'positive-and-negative-compiler-controls', 'independent-javac-execution', 'bytecode-output-manifest',
      ].map(id => ({ id, status: 'pass' }));
    } catch (error) {
      report.errors.push(error.message ?? String(error));
    } finally {
      try {
        if (created) {
          // Inspect the uniquely owned name even if the create client lost its response.
          const owned = inspect(execute, expected.name, timeout);
          assertOwned(owned, expected);
          docker(execute, ['rm', '--force', '--volumes', owned.Id], timeout);
          const remaining = JSON.parse(docker(execute, [
            'container', 'ls', '--all', '--no-trunc', '--format', '{{json .ID}}',
            '--filter', `id=${owned.Id}`,
          ], timeout).trim() || 'null');
          assert.equal(remaining, null, 'Compiler container remains after cleanup');
        }
        report.cleanup = { status: 'pass', containerRemoved: created };
      } catch (error) {
        report.cleanup = { status: 'fail', containerRemoved: false };
        report.errors.push(`Cleanup failed: ${error.message}`);
      }
      try {
        directories.verify(privateDir);
        fs.rmSync(privateDir.path, { recursive: true });
      } catch (error) { report.errors.push(`Private config cleanup failed: ${error.message}`); }
    }
    try {
      assert.deepEqual(collectCompilerInputs(root), inputs, 'Current source changed during Docker compilation');
      assert.deepEqual(inventory(snapshot.path), inputs, 'Snapshot changed during Docker compilation');
      if (compiledOutput) assert.deepEqual(classesInventory(join(build.path, 'classes'), release),
        compiledOutput, 'Output changed after Docker cleanup');
      report.checks.push({ id: 'post-cleanup-input-output-recheck', status: 'pass' });
    } catch (error) { report.errors.push(error.message); }
    const passed = report.errors.length === 0 && Boolean(compiledOutput);
    const authentic = passed && execute === spawnSync;
    report.status = passed ? 'passed' : 'failed';
    report.compilerBuildInDockerVerified = authentic;
    report.evidenceOrigin = authentic ? 'live-independent-docker-javac'
      : execute !== spawnSync ? 'controlled-runner-not-required-gate-evidence' : 'failed-live-docker';
    report.summary = { passed: passed ? 1 : 0, failed: passed ? 0 : 1, skipped: 0 };
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    directories.write(run, 'receipt.json', bytes);
    directories.write(run, 'receipt.sha256', `${hash(bytes)}\n`);
    persisted = { receiptPath: join(destination, 'receipt.json'), receiptSha256: hash(bytes) };
  } finally { directories.close(); }
  const result = { report, ...persisted, exitCode: report.compilerBuildInDockerVerified ? 0 : 1 };
  if (report.compilerBuildInDockerVerified) liveResults.set(result, {
    path: result.receiptPath, digest: result.receiptSha256, reportDigest: hash(JSON.stringify(report)),
  });
  return result;
}

// Static digest checks are integrity checks only. Re-execute Docker before issuing a live capability.
export function verifyCompilerReceipt(options = {}) {
  for (const key of Object.keys(options)) assert.ok([
    'receiptPath', 'root', 'expectedImageId', 'output', 'execute', 'timeout',
  ].includes(key), `Unknown receipt verifier option: ${key}`);
  const { receiptPath: rawPath, root, expectedImageId, output, execute = spawnSync, timeout } = options;
  const receiptPath = resolve(rawPath);
  const bytes = pinnedRead(receiptPath);
  assert.equal(pinnedRead(join(dirname(receiptPath), 'receipt.sha256')).toString().trim(), hash(bytes),
    'Receipt sidecar differs');
  const report = JSON.parse(bytes);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.contract, COMPILER_DOCKER_CONTRACT);
  assert.equal(report.status, 'passed');
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.compilerBuildInDockerVerified, true);
  if (Object.hasOwn(report, 'fullSourceClosureVerified')) assert.equal(report.fullSourceClosureVerified, false,
    'Scoped compiler receipts cannot claim full source closure');
  assert.equal(report.evidenceOrigin, 'live-independent-docker-javac');
  assert.equal(report.compiler.helperSha256, helperSha256, 'Current verifier helper differs');
  assert.deepEqual(report.source.excludedDirectories, [...excludedDirectories], 'Receipt exclusions differ');
  assert.match(report.compiler.imageId, imageIdPattern);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.checks, [
    'snapshot-input-manifest', 'immutable-jdk-image', 'docker-isolation',
    'positive-and-negative-compiler-controls', 'independent-javac-execution', 'bytecode-output-manifest',
    'post-cleanup-input-output-recheck',
  ].map(id => ({ id, status: 'pass' })), 'Receipt required checks differ');
  assert.equal(report.cleanup.status, 'pass');
  assert.equal(report.cleanup.containerRemoved, true);
  const sourceRoot = resolve(root ?? report.source.root);
  assert.equal(sourceRoot, report.source.root, 'Receipt source root differs');
  assert.deepEqual(collectCompilerInputs(sourceRoot), report.source.inputs, 'Receipt source inputs differ');
  assertReceiptArtifacts(receiptPath, report);
  if (expectedImageId) assert.equal(report.compiler.imageId, expectedImageId, 'Expected image differs');
  const replay = runCompilerInDocker({
    root: sourceRoot, output, image: report.compiler.imageId, expectedImageId: report.compiler.imageId,
    release: report.compiler.release, classpath: report.compiler.classpath, execute,
    ...(timeout === undefined ? {} : { timeout }),
    sourceLabel: 'receipt-replay',
  });
  if (replay.report.status === 'passed') {
    try {
      assert.equal(replay.report.compilerBuildInDockerVerified, true,
        'Controlled runner cannot authenticate a persisted compiler receipt');
      assert.equal(hash(pinnedRead(receiptPath)), hash(bytes), 'Original receipt changed during fresh replay');
      assert.equal(pinnedRead(join(dirname(receiptPath), 'receipt.sha256')).toString().trim(), hash(bytes),
        'Original receipt sidecar changed during fresh replay');
      assertReceiptArtifacts(receiptPath, report);
      for (const key of ['version', 'helperSha256', 'javacSha256', 'jdkModulesSha256', 'sourceFiles',
        'manifestClasspath']) {
        assert.deepEqual(replay.report.compiler[key], report.compiler[key], `Fresh compiler ${key} differs`);
      }
      assert.deepEqual(replay.report.source.inputs, report.source.inputs, 'Fresh compiler inputs differ');
      assert.deepEqual(replay.report.output, report.output, 'Fresh compiler outputs differ');
    } catch (error) {
      liveResults.delete(replay);
      // Preserve the actual compile receipt, but persist the failed claim binding separately.
      const failed = {
        ...replay.report, status: 'failed', compilerBuildInDockerVerified: false,
        evidenceOrigin: 'failed-receipt-docker-replay',
        checks: [...replay.report.checks, { id: 'receipt-replay-binding', status: 'fail' }],
        errors: [...replay.report.errors, error.message],
        summary: { passed: 0, failed: 1, skipped: 0 },
        verification: { status: 'failed', candidatePath: receiptPath, candidateSha256: hash(bytes) },
      };
      const directories = new PinnedDirectories();
      const data = Buffer.from(`${JSON.stringify(failed, null, 2)}\n`);
      try {
        const parent = directories.open(dirname(replay.receiptPath));
        directories.write(parent, 'verification.json', data);
        directories.write(parent, 'verification.sha256', `${hash(data)}\n`);
      } finally { directories.close(); }
      return {
        report: failed, exitCode: 1, verificationStatus: 'failed',
        receiptPath: join(dirname(replay.receiptPath), 'verification.json'),
        receiptSha256: hash(data), compilerReceiptPath: replay.receiptPath,
      };
    }
  }
  replay.verificationStatus = replay.report.compilerBuildInDockerVerified ? 'fresh-docker-replay-passed' : 'failed';
  replay.verifiedReceiptPath = receiptPath;
  replay.verifiedReceiptSha256 = hash(bytes);
  const capability = liveResults.get(replay);
  if (capability) capability.candidate = { path: receiptPath, digest: hash(bytes), report };
  return replay;
}

// ZIP parsing is isolated; candidate build tools and Java classes are never executed.
const uaaJarInspector = String.raw`
import hashlib, io, json, stat, sys, zipfile
entries, seen, total = [], set(), 0
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as jar:
    if len(jar.infolist()) > 100000:
        raise ValueError("Too many JAR entries")
    for item in jar.infolist():
        name = item.filename
        if (not name or name.startswith("/") or "\\" in name or name in seen
            or any(p in ("", ".", "..") or ":" in p for p in name.rstrip("/").split("/"))
            or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1):
            raise ValueError("Unsafe or duplicate JAR entry")
        seen.add(name)
        if item.is_dir():
            continue
        total += item.file_size
        if total > 1024**3 or item.file_size > 256 * 1024**2:
            raise ValueError("Oversized JAR entry")
        data = jar.read(item)
        entries.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
json.dump(sorted(entries, key=lambda e: e["path"]), sys.stdout)
`;

function uaaJarEntries(path) {
  const result = spawnSync('python3', ['-I', '-c', uaaJarInspector], {
    input: pinnedRead(path), timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.ok(!result.error && !result.signal && result.status === 0, 'Invalid UAA JAR input');
  return JSON.parse(result.stdout);
}

function maintainedUaaBindings(receiptPath, report) {
  assert.match(relative(workspace, receiptPath), maintainedUaaReceiptPattern,
    'Maintained UAA receipt must be under its canonical build output');
  assert.equal(report.reconstructionInputs, null, 'Maintained build cannot substitute historical reconstruction inputs');
  const base = dirname(receiptPath);
  const sourceRoot = join(maintainedUaaRoot, 'source');
  const starterRoot = join(maintainedUaaRoot, 'starters');
  assert.equal(report.maintainedInputs?.sourceRoot, sourceRoot, 'Maintained UAA source root differs');
  assert.equal(report.maintainedInputs?.starterRoot, starterRoot, 'Maintained UAA starter root differs');
  const source = sourceBuildInputs(sourceRoot);
  const starters = sourceBuildInputs(starterRoot);
  for (const [name, inputs] of [['source', source], ['starter', starters]]) {
    assert.deepEqual(report.maintainedInputs[`${name}Before`], inputs, `Current maintained ${name} inputs differ`);
    assert.deepEqual(report.maintainedInputs[`${name}After`], inputs, `Post-build maintained ${name} inputs differ`);
  }
  assert.deepEqual(sourceBuildInputs(join(base, 'source')), source, 'Maintained source snapshot differs');
  assert.deepEqual(sourceBuildInputs(join(base, 'starter-source')), starters, 'Maintained starter snapshot differs');
  assert.ok(starters.entries.some(entry => entry.path.endsWith('/src/main/java/cn/ibizlab/util/security/AuthorizationTokenFilter.java')),
    'Maintained starter source does not include the token filter');
  assert.ok(starters.entries.every(entry => !/\.(?:class|jar|war|zip|ear|aar|jmod)$/i.test(entry.path)),
    'Opaque maintained starter source inputs rejected');
  const provenancePath = join(maintainedUaaRoot, 'provenance.json');
  const provenanceBytes = pinnedRead(provenancePath);
  const provenance = JSON.parse(provenanceBytes);
  assert.equal(provenance.contract, 'standalone-uaa-maintained-source-origin-v1');
  for (const key of ['originalSourceRecovered', 'sourceAuthenticityVerified', 'sourceClosureVerified', 'nativeAcceptance']) {
    assert.equal(provenance[key], false, `Maintained origin cannot promote ${key}`);
  }
  assert.equal(provenance.originalLicenseProvenance, 'unknown');
  assert.deepEqual(report.receipts, [{ path: provenancePath, sha256: hash(provenanceBytes) }],
    'Maintained provenance binding differs');
  const settings = pinnedRead(join(maintainedUaaRoot, 'settings.xml'));
  assert.equal(hash(settings), provenance.settingsSha256, 'Current maintained settings differ');
  assert.equal(hash(pinnedRead(join(base, 'settings.xml'))), hash(settings), 'Maintained settings snapshot differs');
  const tools = ['build.mjs', 'dependencies.mjs', 'BootControllerMappingTests.java', 'SourceContractTests.java',
    'OAuth2TokenSecurityTests.java', 'receipt.mjs', 'receipt.test.mjs'].map(name => {
    const path = join(maintainedUaaRoot, 'tools', name);
    const digest = hash(pinnedRead(path));
    assert.equal(hash(pinnedRead(join(base, 'tool-source', name))), digest, 'Maintained tool snapshot differs');
    return { path, snapshotPath: `tool-source/${name}`, sha256: digest };
  });
  assert.deepEqual(report.tools, tools, 'Current maintained tool bindings differ');
  assert.deepEqual(report.orchestrator, { path: tools[0].path, sha256: tools[0].sha256 },
    'Maintained orchestrator differs');
  const helpers = ['native-candidate-files.mjs', 'source-build-identity.mjs'].map(name => {
    const path = join(workspace, 'scripts', name);
    return { path, sha256: hash(pinnedRead(path)) };
  });
  assert.deepEqual(report.importedHelpers, helpers, 'Current maintained helper bindings differ');
  const toolInputs = sourceBuildInputs(join(base, 'tool-source'));
  assert.equal(toolInputs.files, tools.length, 'Untracked maintained tool snapshot inputs rejected');
  assert.deepEqual(report.toolInputs?.before, toolInputs, 'Maintained tool inventory differs');
  assert.deepEqual(report.toolInputs?.after, toolInputs, 'Post-build maintained tool inventory differs');
  const focusedBytes = pinnedRead(join(base, 'focused/report.json'));
  const focused = JSON.parse(focusedBytes);
  assert.deepEqual(report.focused, { path: 'focused/report.json', sha256: hash(focusedBytes), ...focused },
    'Maintained focused report bytes differ');
  assert.equal(focused.schemaVersion, 2);
  assert.equal(focused.contract, 'standalone-uaa-recovered-source-focused-regression-v2');
  assert.equal(focused.suite, 'SourceContractTests');
  assert.equal(focused.tests, focusedUaaTests.length);
  assert.deepEqual([...focused.executed].sort(), [...focusedUaaTests].sort(), 'Focused UAA required test roster differs');
  assert.equal(focused.failures, 0);
  assert.equal(focused.skipped, 0);
  assert.deepEqual(focused.errors, []);
  assert.equal(focused.nativeAcceptance, false);
  const oauth2SecurityBytes = pinnedRead(join(base, 'focused/oauth2-security-report.json'));
  const oauth2Security = JSON.parse(oauth2SecurityBytes);
  assert.deepEqual(report.oauth2Security,
    { path: 'focused/oauth2-security-report.json', sha256: hash(oauth2SecurityBytes), ...oauth2Security },
    'Maintained OAuth2 security report bytes differ');
  verifyMaintainedOauth2Evidence(oauth2Security);
  assert.ok(Array.isArray(report.commands) && report.commands.length, 'Missing maintained build commands');
  assert.equal(new Set(report.commands.map(item => item.log?.path)).size, report.commands.length,
    'Duplicate maintained command logs rejected');
  for (const command of report.commands) {
    assert.equal(command.exitCode, 0, 'Failed maintained build command rejected');
    assert.equal(command.signal, null);
    assert.equal(command.error, null);
    safeRelative(command.log.path);
    const bytes = pinnedRead(join(base, command.log.path));
    assert.equal(bytes.length, command.log.bytes, 'Maintained command log length differs');
    assert.equal(hash(bytes), command.log.sha256, 'Maintained command log hash differs');
  }
  for (const name of ['receipt-tests.log', 'starter-maven.log', 'boot-mapping-tests.log', 'focused-tests.log',
    'oauth2-security-tests.log',
    ...uaaModules.map(module => `${module}-compile.log`)]) {
    assert.ok(report.commands.some(command => command.log.path === name), `Missing maintained command: ${name}`);
  }
  assert.deepEqual(report.dependencies?.excludedOriginalOwn, provenance.dependencies?.excludedOriginalOwn,
    'Maintained original own binary exclusions differ');
  const originals = new Map(provenance.dependencies.thirdParty.map(item => [item.path, item]));
  const transforms = new Map((provenance.dependencies.compilerInputTransforms ?? [])
    .map(item => [item.path, item]));
  const normalizeThirdParty = item => ({
    path: item.path,
    bytes: item.compilerInputTransform?.compilerInputBytes ?? item.bytes,
    sha256: item.compilerInputTransform?.compilerInputSha256 ?? item.sha256,
    compilerInputTransform: item.compilerInputTransform ?? null,
    originalSha256: item.compilerInputTransform?.originalSha256 ?? item.sha256,
    originalBytes: item.compilerInputTransform?.originalBytes ?? item.bytes,
  });
  const byPath = (a, b) => Buffer.from(a.path).compare(Buffer.from(b.path));
  assert.deepEqual(report.dependencies.thirdParty.map(normalizeThirdParty).sort(byPath),
    provenance.dependencies.thirdParty.map(item => normalizeThirdParty({
      ...item, compilerInputTransform: transforms.get(item.path) ?? null,
    })).sort(byPath),
    'Maintained third-party compiler inputs differ from provenance');
  const expectedStarters = [
    ['ibizlab-boot-starter', '2.6.12.10'], ['ibizlab-boot-starter-data', '2.6.12.10'],
  ];
  assert.deepEqual(provenance.starterPackages.map(({ artifact, version }) => [artifact, version]), expectedStarters,
    'Maintained starter roster differs');
  assert.deepEqual(report.dependencies.starters.map(({ path, sourceRoot: root, buildReceiptPath }) => ({
    path, sourceRoot: root, buildReceiptPath,
  })), expectedStarters.map(([artifact, version]) => ({
    path: `starters/${artifact}-${version}.jar`, sourceRoot: join(starterRoot, artifact), buildReceiptPath: receiptPath,
  })), 'Maintained starter source/build binding differs');
  assert.deepEqual(provenance.businessPackages.map(item => item.module), [...uaaModules],
    'Maintained origin module roster differs');
  return { sourceFingerprint: source.fingerprint, starterFingerprint: starters.fingerprint,
    provenanceSha256: hash(provenanceBytes), settingsSha256: hash(settings),
    toolFingerprint: toolInputs.fingerprint, focusedSha256: hash(focusedBytes), provenance };
}

function uaaCandidate(receiptPath, kind) {
  const bytes = pinnedRead(receiptPath);
  const digest = hash(bytes);
  assert.equal(pinnedRead(join(dirname(receiptPath), 'report.sha256')).toString().trim(), digest,
    'UAA candidate receipt sidecar differs');
  const report = JSON.parse(bytes);
  assert.equal(report.schemaVersion, 1);
  const maintained = kind === 'maintained';
  assert.equal(report.contract, maintained ? MAINTAINED_UAA_BUILD_CONTRACT
    : 'standalone-uaa-recovered-source-compilation-experiment-v1');
  assert.equal(report.target, 'uaa-standalone-sys-person');
  assert.equal(report.status, maintained ? 'maintained-source-built-focused-fixture-tested-not-native-accepted'
    : 'recovered-source-built-focused-fixture-tested-not-native-accepted');
  for (const key of ['originalSourceRecovered', 'sourceAuthenticityVerified', 'sourceClosureVerified',
    'standaloneSourceBuildVerified', 'protocolRuntimeParityVerified', 'nativeAcceptance']) {
    assert.equal(report[key], false, `Reconstructed compiler evidence must not promote ${key}`);
  }
  if (Object.hasOwn(report, 'fullSourceClosureVerified')) assert.equal(report.fullSourceClosureVerified, false,
    'Reconstructed compiler evidence must not promote fullSourceClosureVerified');
  assert.deepEqual(report.errors, []);
  assert.match(report.image?.id ?? '', imageIdPattern);
  let maintainedBindings;
  if (maintained) {
    for (const key of ['javaCompilationVerified', 'compilerBuildInDockerVerified', 'focusedSourceContractVerified']) {
      assert.equal(report[key], true, `Missing maintained build eligibility: ${key}`);
    }
    maintainedBindings = maintainedUaaBindings(receiptPath, report);
  }
  const base = dirname(receiptPath);
  const sourceRoot = join(base, 'source');
  assert.equal(report.sourceInputs?.contract, 'source-build-input-inventory-v1');
  const source = sourceBuildInputs(sourceRoot);
  assert.deepEqual(source, report.sourceInputs.before, 'UAA source inputs differ');
  assert.deepEqual(source, report.sourceInputs.after, 'UAA post-build source inputs differ');
  const compilerInputs = inventory(sourceRoot, { excluded: [] });
  assert.equal(compilerInputs.files, source.files, 'Untracked UAA source inputs rejected');
  assert.ok(compilerInputs.entries.every(entry =>
    !/\.(?:class|jar|war|zip|ear|aar|jmod)$/i.test(entry.path)), 'Opaque UAA source inputs rejected');
  const javaSources = compilerInputs.entries.filter(entry => entry.path.endsWith('.java'));
  assert.ok(javaSources.length && javaSources.every(entry =>
    uaaModules.some(module => entry.path.startsWith(`${module}/src/main/java/`))),
  'Only the three complete production UAA Java modules can be replayed');
  const dependencies = ['third-party', 'starters'].map((name, index) => {
    const root = join(base, name);
    const inputs = sourceBuildInputs(root);
    assert.deepEqual(inputs, report.dependencyInputs?.[index === 0 ? 'thirdParty' : 'starters'],
      `UAA ${name} inputs differ`);
    const files = inventory(root, { excluded: [] });
    assert.equal(files.files, inputs.files, 'Untracked dependency inputs rejected');
    assert.ok(files.entries.every(entry => entry.path.endsWith('.jar') && entry.bytes > 0),
      'Only explicit dependency JAR inputs are supported');
    const recorded = report.dependencies?.[index === 0 ? 'thirdParty' : 'starters'];
    assert.ok(Array.isArray(recorded), 'Missing UAA dependency inventory');
    assert.deepEqual(recorded.map(entry => ({
      path: entry.path, bytes: entry.bytes, sha256: entry.sha256,
    })).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path))),
    files.entries.map(entry => ({ ...entry, path: `${name}/${entry.path}` })),
    `UAA ${name} dependency receipt differs`);
    if (maintained && name === 'third-party') {
      for (const entry of files.entries) {
        const members = uaaJarEntries(join(root, entry.path));
        assert.ok(members.every(member => {
          const path = member.path.replace(/^(?:BOOT-INF|WEB-INF)\/classes\//, '')
            .replace(/^META-INF\/versions\/[0-9]+\//, '');
          return !/\.(?:jar|war|zip|ear|aar|jmod)$/i.test(path)
            && !(path.endsWith('.class') && /^(?:cn\/ibizlab\/|net\/ibizsys\/)/.test(path));
        }), 'Opaque own or nested compiled fallback in maintained third-party JAR rejected');
      }
    }
    return { name, root, files };
  });
  assert.deepEqual(report.packages?.map(item => item.module), [...uaaModules],
    'UAA module roster differs');
  const expectedClasses = [];
  for (const item of report.packages) {
    const classes = classesInventory(join(base, 'classes', item.module), 8);
    assert.deepEqual(classes.entries, item.compiledClasses, `UAA ${item.module} class inventory differs`);
    assert.equal(item.javaSources, javaSources.filter(entry =>
      entry.path.startsWith(`${item.module}/src/main/java/`)).length, 'UAA Java source count differs');
    if (maintained) {
      const origin = maintainedBindings.provenance.businessPackages.find(entry => entry.module === item.module);
      assert.deepEqual(classes.entries.map(entry => entry.path).sort(),
        origin.originalOwnClasses.map(entry => `${entry.binaryName.replaceAll('.', '/')}.class`).sort(),
        'Maintained original class roster differs');
      assert.deepEqual(item.classSourceMappings, origin.classSourceMappings.map(mapping => ({
        originalClass: mapping.originalClass,
        source: source.entries.find(entry => entry.path === mapping.source.path),
        compiledClass: classes.entries.find(entry =>
          entry.path === `${mapping.originalClass.binaryName.replaceAll('.', '/')}.class`),
        relationship: 'original-binary-name-to-restored-editable-source-to-javac-output-not-semantic-parity',
      })), 'Maintained source-to-class mapping differs');
      assert.ok(item.classSourceMappings.every(mapping => mapping.source && mapping.compiledClass),
        'Missing maintained source-to-class mapping');
      assert.equal(item.artifactPath, `packages/${item.module}-reconstructed.jar`, 'Maintained package path differs');
      const jar = pinnedRead(join(base, item.artifactPath));
      assert.equal(jar.length, item.bytes, 'Maintained package length differs');
      assert.equal(hash(jar), item.sha256, 'Maintained package hash differs');
      const prefix = `${item.module}/src/main/resources/`;
      const resources = source.entries.filter(entry => entry.path.startsWith(prefix))
        .map(({ path, bytes: length, sha256 }) => ({ path: path.slice(prefix.length), bytes: length, sha256 }));
      const expected = [...classes.entries, ...resources].sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
      assert.equal(new Set(expected.map(entry => entry.path)).size, expected.length, 'Duplicate maintained JAR member');
      assert.deepEqual(uaaJarEntries(join(base, item.artifactPath)), expected, 'Maintained JAR class/resource bytes differ');
      assert.equal(item.classes, classes.files, 'Maintained package class count differs');
      assert.equal(item.resources, resources.length, 'Maintained package resource count differs');
    }
    expectedClasses.push(...classes.entries);
  }
  if (maintained) {
    const packages = sourceBuildInputs(join(base, 'packages'));
    assert.deepEqual(packages, report.packageInputs, 'Maintained package inventory differs');
    assert.equal(packages.files, uaaModules.length, 'Untracked maintained packages rejected');
  }
  expectedClasses.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  assert.equal(new Set(expectedClasses.map(entry => entry.path)).size, expectedClasses.length,
    'Duplicate UAA class outputs rejected');
  if (maintainedBindings) delete maintainedBindings.provenance;
  return { receiptPath, digest, kind, imageId: report.image.id, sourceRoot,
    source, compilerInputs, dependencies, expectedClasses,
    ...(maintained ? { maintainedBindings } : {}) };
}

function assertUaaCandidateUnchanged(before) {
  assert.deepEqual(uaaCandidate(before.receiptPath, before.kind), before,
    'UAA candidate source, dependencies, outputs or receipt changed during replay');
}

// Replay never executes candidate scripts, classes, tests, normalizers or package commands.
// Matching class bytes proves this compilation experiment only, not S06/native closure.
function replayUaaCompilerOutputs(options, kind) {
  for (const key of Object.keys(options)) assert.ok([
    'receiptPath', 'expectedImageId', 'output', 'execute', 'timeout',
  ].includes(key), `Unknown UAA replay option: ${key}`);
  const { receiptPath: rawPath, expectedImageId, output, execute = spawnSync, timeout = 600_000 } = options;
  assert.equal(typeof rawPath, 'string', 'UAA receipt path is required');
  assert.match(expectedImageId ?? '', imageIdPattern, 'An independently selected immutable JDK image is required');
  const receiptPath = resolve(rawPath);
  const destination = resolve(output ?? join(workspace, '.artifacts/compiler-in-docker', `uaa-replay-${randomUUID()}`));
  const base = dirname(receiptPath);
  assert.ok(destination !== base && !destination.startsWith(`${base}/`) && !base.startsWith(`${destination}/`),
    'UAA candidate/replay output overlap rejected');
  const directories = new PinnedDirectories();
  const report = {
    schemaVersion: 1, contract: kind === 'maintained' ? MAINTAINED_UAA_COMPILER_REPLAY_CONTRACT
      : UAA_COMPILER_REPLAY_CONTRACT, status: 'failed',
    generatedAt: new Date().toISOString(), compilerOutputReplayVerified: false,
    sourceClosureVerified: false, fullSourceClosureVerified: false, standaloneSourceBuildVerified: false,
    protocolRuntimeParityVerified: false, nativeAcceptance: false,
    checks: [], errors: [], summary: { passed: 0, failed: 1, skipped: 0 },
    limitations: [
      'Three-module Java compilation and exact class bytes only; not original-source authenticity.',
      'Starter and third-party JARs are inventoried binary inputs, not recursively replayed editable dependency sources.',
      'No candidate scripts, annotation processors, package commands, runtime protocol, deployment or native tests executed.',
      'Passing this experiment never closes S06 UAA, Task or all-component D01.',
    ],
  };
  let candidate;
  let compiler;
  let reportPath;
  let reportSha256;
  try {
    const run = directories.open(destination, { create: true, exclusive: true });
    try {
      candidate = uaaCandidate(receiptPath, kind);
      assert.equal(candidate.imageId, expectedImageId, 'UAA candidate and independently selected JDK image differ');
      report.candidate = { path: receiptPath, sha256: candidate.digest,
        sourceFingerprint: candidate.source.fingerprint, imageId: candidate.imageId,
        ...(candidate.maintainedBindings ? { maintainedInputs: candidate.maintainedBindings } : {}) };
      report.dependencies = candidate.dependencies.map(item => ({
        name: item.name, fingerprint: item.files.fingerprint, files: item.files.files,
      }));
      const input = directories.open(join(destination, 'input'), { create: true, exclusive: true });
      for (const item of [
        { name: 'source', root: candidate.sourceRoot, files: candidate.compilerInputs },
        ...candidate.dependencies,
      ]) {
        const target = directories.open(join(input.path, item.name), { create: true, exclusive: true });
        writeSnapshot(directories, target, item.root, item.files);
      }
      report.checks.push({ id: 'candidate-complete-input-and-class-inventory', status: 'pass' });
      const inputs = collectCompilerInputs(input.path);
      report.replayInputs = { root: input.path, fingerprint: inputs.fingerprint, files: inputs.files };
      compiler = runCompilerInDocker({
        root: input.path, output: join(destination, 'compiler'), image: expectedImageId, expectedImageId,
        release: 8, sourceLabel: kind === 'maintained' ? 'uaa-maintained-three-module-scoped-replay'
          : 'uaa-reconstructed-three-module-experiment',
        classpath: candidate.dependencies.flatMap(item =>
          item.files.entries.map(entry => `${item.name}/${entry.path}`)),
        execute, timeout,
      });
      report.compilerReceipt = { path: compiler.receiptPath, sha256: compiler.receiptSha256 };
      if (compiler.report.compiler.manifestClasspath) {
        report.manifestClasspathDiagnostic = compiler.report.compiler.manifestClasspath;
      }
      assert.ok(isLiveCompilerResult(compiler, { root: input.path,
        inputFingerprint: inputs.fingerprint, expectedImageId }),
      `Fresh independent Docker compiler did not authenticate: ${compiler.report.errors.join('; ') || compiler.report.evidenceOrigin}`);
      report.checks.push({ id: 'fresh-independent-docker-javac', status: 'pass' });
      assert.deepEqual(compiler.report.output.entries, candidate.expectedClasses,
        'Fresh UAA class outputs differ from recorded module outputs');
      report.checks.push({ id: 'exact-three-module-class-output-binding', status: 'pass' });
      assertUaaCandidateUnchanged(candidate);
      report.checks.push({ id: 'post-replay-candidate-recheck', status: 'pass' });
      report.output = { classes: candidate.expectedClasses.length,
        fingerprint: compiler.report.output.fingerprint };
      report.status = 'passed-compiler-output-experiment-only';
      report.compilerOutputReplayVerified = true;
      report.summary = { passed: 1, failed: 0, skipped: 0 };
    } catch (error) {
      report.errors.push(typeof error?.message === 'string' ? error.message : 'UAA independent replay failed');
      report.checks.push({ id: 'independent-uaa-compiler-output-replay', status: 'fail' });
    }
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    reportPath = join(destination, 'verification.json');
    reportSha256 = hash(bytes);
    directories.write(run, 'verification.json', bytes);
    directories.write(run, 'verification.sha256', `${reportSha256}\n`);
  } finally { directories.close(); }
  const result = { report, reportPath, reportSha256, exitCode: report.compilerOutputReplayVerified ? 0 : 1 };
  if (result.exitCode === 0) liveUaaReplays.set(result, {
    candidate, compiler, path: reportPath, digest: reportSha256, reportDigest: hash(JSON.stringify(report)),
  });
  else if (execute === spawnSync) failedUaaReplays.set(result, {
    receiptPath, expectedImageId, kind, path: reportPath, digest: reportSha256,
    reportDigest: hash(JSON.stringify(report)),
  });
  return result;
}

export function verifyRecoveredUaaCompilerOutputs(options = {}) {
  return replayUaaCompilerOutputs(options, 'recovered');
}

export function verifyMaintainedUaaCompilerOutputs(options = {}) {
  return replayUaaCompilerOutputs(options, 'maintained');
}

// Failure diagnostics authenticate this invocation only and never issue a passing replay capability.
function uaaReplayFailureEvidence(result, { receiptPath, expectedImageId } = {}, kind) {
  const attempted = failedUaaReplays.get(result);
  if (!attempted || attempted.kind !== kind) return null;
  try {
    assert.equal(resolve(receiptPath), attempted.receiptPath);
    assert.equal(expectedImageId, attempted.expectedImageId);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, 'failed');
    assert.equal(result.reportPath, attempted.path);
    assert.equal(result.reportSha256, attempted.digest);
    assert.equal(hash(JSON.stringify(result.report)), attempted.reportDigest);
    assert.equal(hash(pinnedRead(result.reportPath)), attempted.digest);
    assert.equal(pinnedRead(join(dirname(result.reportPath), 'verification.sha256')).toString().trim(),
      attempted.digest);
    const evidence = {
      verification: kind === 'maintained' ? 'failed-independent-maintained-uaa-replay-not-source-closure'
        : 'failed-independent-reconstructed-uaa-replay-not-source-closure',
      reportPath: result.reportPath, reportSha256: result.reportSha256,
    };
    const receipt = result.report.compilerReceipt;
    if (receipt) {
      assert.equal(receipt.path, join(dirname(result.reportPath), 'compiler/receipt.json'));
      assert.equal(hash(pinnedRead(receipt.path)), receipt.sha256);
      assert.equal(pinnedRead(join(dirname(receipt.path), 'receipt.sha256')).toString().trim(), receipt.sha256);
      const compiler = JSON.parse(pinnedRead(receipt.path));
      assert.equal(compiler.contract, COMPILER_DOCKER_CONTRACT);
      assert.equal(compiler.nativeAcceptance, false);
      evidence.compilerReceipt = { ...receipt };
      if (result.report.manifestClasspathDiagnostic) {
        assert.deepEqual(result.report.manifestClasspathDiagnostic, compiler.compiler.manifestClasspath);
        const diagnostic = compiler.compiler.manifestClasspath;
        assert.equal(hash(pinnedRead(join(dirname(receipt.path), 'build/classpath-rejections.tsv'))),
          diagnostic.auditSha256);
        evidence.manifestClasspathDiagnostic = structuredClone(diagnostic);
      }
    }
    return evidence;
  } catch { return null; }
}

export function recoveredUaaReplayFailureEvidence(result, options = {}) {
  return uaaReplayFailureEvidence(result, options, 'recovered');
}

export function maintainedUaaReplayFailureEvidence(result, options = {}) {
  return uaaReplayFailureEvidence(result, options, 'maintained');
}

function isLiveUaaCompilerReplay(result, { receiptPath, expectedImageId } = {}, kind) {
  const capability = liveUaaReplays.get(result);
  if (!capability || capability.candidate.kind !== kind) return false;
  try {
    assert.equal(result.exitCode, 0);
    assert.equal(result.reportPath, capability.path);
    assert.equal(result.reportSha256, capability.digest);
    assert.equal(hash(JSON.stringify(result.report)), capability.reportDigest);
    assert.equal(hash(pinnedRead(result.reportPath)), capability.digest);
    assert.equal(pinnedRead(join(dirname(result.reportPath), 'verification.sha256')).toString().trim(),
      capability.digest);
    assertUaaCandidateUnchanged(capability.candidate);
    assert.ok(isLiveCompilerResult(capability.compiler));
    if (receiptPath !== undefined) assert.equal(resolve(receiptPath), capability.candidate.receiptPath);
    if (expectedImageId !== undefined) assert.equal(expectedImageId, capability.candidate.imageId);
    return true;
  } catch { return false; }
}

export function isLiveRecoveredUaaCompilerReplay(result, options = {}) {
  return isLiveUaaCompilerReplay(result, options, 'recovered');
}

export function isLiveMaintainedUaaCompilerReplay(result, options = {}) {
  return isLiveUaaCompilerReplay(result, options, 'maintained');
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: 'string' }, output: { type: 'string' }, image: { type: 'string' },
      'expected-image-id': { type: 'string' }, release: { type: 'string' },
      classpath: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' },
      'uaa-receipt': { type: 'string' },
      'maintained-uaa-receipt': { type: 'string' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/harness-compiler-in-docker.mjs --root PATH [--output PATH] [--image IMAGE] [--expected-image-id sha256:...] [--release 8..17] [--classpath relative.jar]');
    console.log('Independent reconstructed UAA class replay: --uaa-receipt report.json --expected-image-id sha256:... [--output NEW_DIRECTORY]; never S06/native closure.');
    console.log('Canonical maintained UAA class replay: --maintained-uaa-receipt report.json --expected-image-id sha256:... [--output NEW_DIRECTORY]; current source binding, never full closure/native acceptance.');
    return 0;
  }
  if (values['uaa-receipt'] !== undefined || values['maintained-uaa-receipt'] !== undefined) {
    assert.ok(!(values['uaa-receipt'] && values['maintained-uaa-receipt']), 'Select only one UAA build contract');
    assert.ok(!values.root && !values.image && !values.release && !values.classpath,
      'UAA replay does not allow compiler input or release overrides');
    const verify = values['maintained-uaa-receipt'] !== undefined
      ? verifyMaintainedUaaCompilerOutputs : verifyRecoveredUaaCompilerOutputs;
    const result = verify({
      receiptPath: values['maintained-uaa-receipt'] ?? values['uaa-receipt'],
      expectedImageId: values['expected-image-id'], output: values.output,
    });
    console.log(JSON.stringify({ ...result.report, reportPath: result.reportPath,
      reportSha256: result.reportSha256 }, null, 2));
    return result.exitCode;
  }
  assert.ok(values.root, '--root is required');
  const result = runCompilerInDocker({
    root: values.root, output: values.output, image: values.image, expectedImageId: values['expected-image-id'],
    release: values.release === undefined ? 17 : Number(values.release), classpath: values.classpath ?? [],
  });
  console.log(JSON.stringify({
    status: result.report.status, nativeAcceptance: false,
    compilerBuildInDockerVerified: result.report.compilerBuildInDockerVerified,
    receiptPath: result.receiptPath, receiptSha256: result.receiptSha256, errors: result.report.errors,
  }, null, 2));
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
