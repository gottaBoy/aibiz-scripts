#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inspectNativeActorSources } from './prepare-existing-native-actors.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const containerName = 'ibizlab-uaa-api';
const directories = ['/opt/uaa/third-party', '/opt/uaa/starters', '/opt/uaa/packages'];
const classpath = directories.map(path => `${path}/*`).join(':');
const jdk = '/opt/java/openjdk/bin';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const person = 'cn.ibizlab.core.ad.domain.SysPerson';
const personDescriptor = 'Lcn/ibizlab/core/ad/domain/SysPerson;';
const resourcePrefix = 'cn.ibizlab.api.rest.';
const annotationPrefix = 'org.springframework.web.bind.annotation.';
const preAuthorize = 'org.springframework.security.access.prepost.PreAuthorize';
const postAuthorize = 'org.springframework.security.access.prepost.PostAuthorize';
const extraSources = [
  'standalone-uaa/source/uaa-api/src/main/java/cn/ibizlab/config/BootSecurityConfig.java',
  'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/core/ad/filter/SysPersonSearchContext.java',
];

export const NATIVE_ACTOR_CLASSES = Object.freeze([
  ...['SysPerson', 'SysRoleMember', 'SysMember'].flatMap(entity => [
    `${resourcePrefix}${entity}Resource`, `${resourcePrefix}${entity}ResourceImpl`,
    `${resourcePrefix}Abstract${entity}Resource`, `cn.ibizlab.api.dto.${entity}DTO`,
  ]),
  person, 'cn.ibizlab.core.ad.service.impl.SysPersonServiceImpl',
  'cn.ibizlab.core.ad.service.impl.AbstractSysPersonService',
  'cn.ibizlab.core.ad.service.impl.AbstractSysMemberService',
  'cn.ibizlab.core.authentication.service.impl.AuthUserServiceImpl',
  'cn.ibizlab.core.ad.filter.SysPersonSearchContext', 'cn.ibizlab.config.BootSecurityConfig',
]);
const classEntries = NATIVE_ACTOR_CLASSES.map(name => `${name.replaceAll('.', '/')}.class`);
const classEntrySet = new Set(classEntries);

export function nativeActorRuntimeIdentity(row, root = workspace) {
  assert.equal(row.Name, `/${containerName}`, 'Only the existing UAA container is permitted');
  assert.match(row.Id, /^[a-f0-9]{64}$/, 'A complete container ID is required');
  assert.match(row.Image, /^sha256:[a-f0-9]{64}$/);
  assert.equal(row.State?.Status, 'running', 'The existing UAA must already be running');
  const labels = row.Config?.Labels;
  const compose = join(root, 'plm/deploy/compose');
  assert.equal(labels?.['com.docker.compose.service'], containerName);
  assert.equal(labels?.['com.docker.compose.project.working_dir'], compose,
    'Existing UAA ownership must point to this workspace');
  const configs = labels?.['com.docker.compose.project.config_files']?.split(',');
  assert.ok(configs?.length && configs.every(path => dirname(path) === compose
    && /^docker-compose-[a-z0-9-]+\.yml$/.test(basename(path))),
  'Compose inputs must belong to this workspace');
  assert.equal(row.Config.WorkingDir, '/opt/uaa');
  assert.deepEqual(row.Mounts, [], 'This verifier reviews the observed unmounted classpath deployment');
  return {
    containerId: row.Id, imageId: row.Image, startedAt: row.State.StartedAt,
    restartCount: row.RestartCount,
    configSha256: sha(json(row.Config)), hostConfigSha256: sha(json(row.HostConfig)),
    mountsSha256: sha(json(row.Mounts)),
    ownership: { project: labels['com.docker.compose.project'],
      service: labels['com.docker.compose.service'], workingDirectory: compose,
      composeFiles: configs, packagingAcceptance: labels['aibiz.acceptance'] ?? null,
      sourceBuildReceiptSha256: labels['aibiz.source-build-receipt-sha256'] ?? null,
      sourceFingerprint: labels['aibiz.source-fingerprint'] ?? null },
  };
}

export function nativeActorProcessIdentity(bytes) {
  const args = Buffer.from(bytes).toString().split('\0').filter(Boolean);
  assert.equal(args.length, 5, 'An unreviewed Java startup shape requires a new review');
  assert.equal(args[0], 'java');
  assert.equal(args[1], '-Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true');
  assert.equal(args[2], '-cp');
  assert.equal(args[3], classpath, 'Use the actual, reviewed classpath rather than Config.Cmd');
  assert.equal(args[4], 'cn.ibizlab.BootApplication');
  return { sha256: sha(bytes), executable: args[0], classpath, mainClass: args[4],
    argumentCount: args.length, templateCommandUsedAsRuntimeEvidence: false };
}

export function parseNativeActorJarInventory(text) {
  const jars = [];
  const occurrences = new Map(classEntries.map(entry => [entry, []]));
  for (const line of text.trim().split('\n')) {
    if (line.startsWith('JAR\t')) {
      const match = /^JAR\t([a-f0-9]{64}) {2}(\/opt\/uaa\/(?:third-party|starters|packages)\/[A-Za-z0-9_.+-]+\.jar)$/.exec(line);
      assert.ok(match, 'Malformed or unreviewed classpath JAR inventory');
      assert.ok(!jars.some(jar => jar.path === match[2]), 'Duplicate classpath JAR');
      jars.push({ path: match[2], sha256: match[1] });
    } else {
      const match = /^CLASS\t([^\t]+)\t([^\t]+)$/.exec(line);
      assert.ok(match && occurrences.has(match[2]), 'Unexpected class inventory record');
      assert.ok(jars.some(jar => jar.path === match[1]), 'Class is not bound to an inventoried JAR');
      occurrences.get(match[2]).push(match[1]);
    }
  }
  assert.ok(jars.length >= 3 && jars.length <= 500, 'Unexpected classpath JAR count');
  for (const [entry, matches] of occurrences) {
    assert.equal(matches.length, 1, `Missing or ambiguous runtime class: ${entry}`);
  }
  return { jars, classes: [...occurrences].map(([entry, matches]) =>
    ({ entry, className: entry.slice(0, -6).replaceAll('/', '.'), jar: matches[0] })) };
}

function annotations(text) {
  const result = new Map();
  for (const match of text.matchAll(/^( {4}| {8})([A-Za-z0-9_.$]+)\(\n([\s\S]*?)^\1\)/gm)) {
    assert.ok(!result.has(match[2]), 'Repeated annotation needs a new review');
    const values = {};
    for (const line of match[3].trim().split('\n')) {
      const field = /^([a-zA-Z]+)=(.*)$/.exec(line.trim());
      if (!field) continue;
      let literal = '';
      for (let index = 0; index < field[2].length; index += 1) {
        const char = field[2][index];
        if (char === '\\' && index + 1 < field[2].length) {
          const next = field[2][++index];
          literal += next === "'" ? "'" : `${char}${next}`;
        } else literal += char;
      }
      try { values[field[1]] = JSON.parse(literal); }
      catch { values[field[1]] = { unparsed: true }; }
    }
    result.set(match[2], values);
  }
  return result;
}

export function parseNativeActorJavap(text, expectedName) {
  assert.equal(typeof text, 'string');
  assert.ok(text.length <= 4 * 1024 * 1024, 'Disassembly size limit exceeded');
  const opening = text.indexOf('\n{\n');
  const closing = text.lastIndexOf('\n}\n');
  assert.ok(opening > 0 && closing > opening, 'Incomplete javap output');
  const header = text.slice(0, opening);
  const classFile = /^Classfile jar:file:\/\/([^!]+)!\/([^\n]+)$/m.exec(header);
  const digest = /^  SHA-256 checksum ([a-f0-9]{64})$/m.exec(header);
  const declaration = new RegExp(`^public (?:abstract )?class ${expectedName.replaceAll('.', '\\.')}(?=[ <\\n])[^\\n]*`, 'm').exec(header);
  const superclass = declaration && / extends ([A-Za-z0-9_.$]+)/.exec(declaration[0])?.[1];
  assert.ok(classFile && digest && declaration, 'Unbound class name, origin or checksum');
  const body = text.slice(opening + 3, closing);
  const declarations = [...body.matchAll(/^  (\S[^\n]*(?:;|\{\}));?$/gm)];
  const members = declarations.map((match, index) => {
    const block = body.slice(match.index, declarations[index + 1]?.index ?? body.length);
    const descriptor = /^    descriptor: ([^\n]+)$/m.exec(block)?.[1];
    const name = /([A-Za-z0-9_.$]+)\(/.exec(match[1])?.[1]
      ?? /([A-Za-z0-9_$]+);$/.exec(match[1])?.[1] ?? '<static>';
    return { name, descriptor, declaration: match[1], text: block,
      annotations: annotations(block) };
  });
  assert.ok(members.length > 0 && members.every(member => member.descriptor));
  const attributes = text.slice(closing + 3);
  const bootstrapText = attributes.slice(attributes.indexOf('\nBootstrapMethods:\n') + 1);
  const bootstrapDeclarations = bootstrapText.startsWith('BootstrapMethods:\n')
    ? [...bootstrapText.matchAll(/^  ([0-9]+):[^\n]+$/gm)] : [];
  const bootstrapMethods = new Map(bootstrapDeclarations.map((match, index) =>
    [Number(match[1]), bootstrapText.slice(match.index,
      bootstrapDeclarations[index + 1]?.index ?? bootstrapText.length)]));
  return { name: expectedName, superclass: superclass ?? 'java.lang.Object',
    origin: { jar: classFile[1], entry: classFile[2], sha256: digest[1] },
    members, annotations: annotations(attributes), bootstrapMethods };
}

function method(view, name, descriptor) {
  const matches = view.members.filter(member => member.name === name && member.descriptor === descriptor);
  assert.equal(matches.length, 1, `Missing or ambiguous ${view.name}.${name} descriptor`);
  return matches[0];
}

function valueAnnotation(member, name, expected) {
  assert.deepEqual(member.annotations.get(name)?.value, expected,
    `Runtime annotation mismatch: ${member.name}.${name}`);
}

function fragments(text, required, label) {
  for (const value of required) {
    assert.ok(text.includes(value), `Runtime ${label} contract mismatch: ${value}`);
  }
}

function ordered(text, values, label) {
  let offset = 0;
  for (const value of values) {
    const index = text.indexOf(value, offset);
    assert.ok(index >= offset, `Runtime ${label} call order mismatch`);
    offset = index + value.length;
  }
}

function lambdaReferences(view, member) {
  return [...member.text.matchAll(/\/\/ InvokeDynamic #([0-9]+):/g)]
    .map(match => {
      const bootstrap = view.bootstrapMethods.get(Number(match[1]));
      assert.ok(bootstrap, 'Unbound lambda bootstrap');
      return bootstrap;
    }).join('\n');
}

function reviewedGetGuard(entity) {
  return entity === 'SysRoleMember' ? null
    : `hasAnyAuthority('ROLE_SUPERADMIN','uaa-${entity}-Get-all') or `
      + `hasPermission(this.${entity[0].toLowerCase()}${entity.slice(1)}DtoMapping.toDomain(returnObject.body),'uaa-${entity}-Get')`;
}

export function assessNativeActorClassContract(views, sourceFacts) {
  assert.equal(sourceFacts.runtimeContractVerified, false);
  assert.equal(views.size, NATIVE_ACTOR_CLASSES.length);
  const get = name => {
    assert.ok(views.has(name), 'A reviewed runtime class is missing');
    return views.get(name);
  };
  const entities = sourceFacts.uaaCollections.map(contract => {
    const { entity } = contract;
    const controller = get(`${resourcePrefix}${entity}Resource`);
    const implementation = get(`${resourcePrefix}${entity}ResourceImpl`);
    const base = get(`${resourcePrefix}Abstract${entity}Resource`);
    assert.equal(controller.superclass, implementation.name);
    assert.equal(implementation.superclass, base.name);
    for (const subclass of [controller, implementation]) {
      assert.ok(!subclass.members.some(member => ['create', 'getById', 'removeById'].includes(member.name)),
        'Runtime CRUD override requires a new authorization review');
    }
    valueAnnotation(controller, `${annotationPrefix}RequestMapping`, ['${ibiz.rest.basePath.api:/}']);
    valueAnnotation(controller, `${annotationPrefix}RestController`, `api-${entity.toLowerCase()}`);
    const dto = `Lcn/ibizlab/api/dto/${entity}DTO;`;
    const response = 'Lorg/springframework/http/ResponseEntity;';
    const create = method(base, 'create', `(${dto})${response}`);
    const read = method(base, 'getById', `(Ljava/lang/String;)${response}`);
    const remove = method(base, 'removeById', `(Ljava/lang/String;)${response}`);
    valueAnnotation(create, `${annotationPrefix}PostMapping`,
      [contract.collection.slice(1), contract.collection.slice(1)]);
    valueAnnotation(create, preAuthorize, contract.create.guard);
    valueAnnotation(read, `${annotationPrefix}GetMapping`, [`${contract.collection.slice(1)}/{id}`]);
    valueAnnotation(remove, `${annotationPrefix}DeleteMapping`, [`${contract.collection.slice(1)}/{id}`]);
    valueAnnotation(remove, preAuthorize, contract.remove.guard);
    const getGuard = reviewedGetGuard(entity);
    if (getGuard) valueAnnotation(read, postAuthorize, getGuard);
    else assert.ok(!read.annotations.has(preAuthorize) && !read.annotations.has(postAuthorize),
      'The observed no-local-GET-guard contract changed');
    const runtimeDto = get(`cn.ibizlab.api.dto.${entity}DTO`);
    const dtoFields = [...new Set(runtimeDto.members.flatMap(member => {
      const value = member.annotations.get('com.fasterxml.jackson.annotation.JsonProperty')?.value;
      return typeof value === 'string' ? [value] : [];
    }))].sort();
    assert.deepEqual(dtoFields, [...contract.dtoFields].sort(), 'Runtime DTO property set changed');
    return { entity, collection: contract.collection, inheritedCrudVerified: true,
      controllerBasePathPlaceholder: '${ibiz.rest.basePath.api:/}',
      createGuardMatches: true, removeGuardMatches: true, dtoPropertySetMatches: true,
      localGetGuard: getGuard ? 'matched-PostAuthorize' : 'no-local-method-guard-observed',
      globalHttpAuthorizationNotInferred: true };
  });
  const service = get('cn.ibizlab.core.ad.service.impl.SysPersonServiceImpl');
  assert.equal(service.superclass, 'cn.ibizlab.core.ad.service.impl.AbstractSysPersonService');
  const passwordMode = service.members.find(member => member.name === 'passwordStorageMode');
  assert.ok(passwordMode, 'Native password storage configuration field is missing');
  valueAnnotation(passwordMode, 'org.springframework.beans.factory.annotation.Value',
    '${ibiz.auth.passwordStorageMode:none}');
  const create = method(service, 'create', `(${personDescriptor})Z`).text;
  const remove = method(service, 'remove', `(${personDescriptor})Z`).text;
  const initialize = method(service, 'init', `(${personDescriptor})${personDescriptor}`);
  const roleLambda = service.members.filter(member => member.name.startsWith('lambda$init$')
    && member.text.includes('String ROLE_USERS'));
  assert.equal(roleLambda.length, 1, 'Automatic base role predicate is missing or ambiguous');
  fragments(roleLambda[0].text, ['SysRole.getAuthority:', 'java/lang/String.equalsIgnoreCase:'], 'base role predicate');
  fragments(create, ['SysPerson.getUserPassword:', 'SysPerson.getUid:', 'SysPerson.getDc:', 'SysPerson.getDefaultKey:',
    'Field defaultPassword:', 'Field passwordStorageMode:', 'String sm3', 'java/lang/String.equals:',
    'java/lang/String.length:', 'bipush        64', 'if_icmpeq',
    'cn/ibizlab/util/web/Sm3Util.encrypt:', 'SysPerson.setUserPassword:',
    'String delete from sys_person where enabled=0 and id =',
    'SysPerson.getOrganizationalRoleId:', 'SysPerson.setMemberOf:',
    'java/util/Collections.singletonList:'], 'person Create');
  ordered(create, ['Method execute:', 'AbstractSysPersonService.create:', 'Method init:'], 'person Create');
  fragments(initialize.text, ['SysRoleService.all:', 'java/util/stream/Stream.filter:',
    'SysRoleMemberService.count:', 'String inetOrgPerson', 'SysRoleMember.setMemberUid:',
    'SysPerson.getId:', 'SysRoleMemberService.create:'], 'automatic role initialization');
  fragments(lambdaReferences(service, initialize),
    [`SysPersonServiceImpl.${roleLambda[0].name}:`], 'automatic role predicate association');
  ordered(remove, ['SysRoleMemberService.remove:', 'AbstractSysPersonService.remove:'], 'person Remove');
  fragments(remove, ['SysPerson.getId:', 'String inetOrgPerson'], 'role member cleanup');
  const basePerson = get('cn.ibizlab.core.ad.service.impl.AbstractSysPersonService');
  fragments(method(basePerson, 'create', `(${personDescriptor})Z`).text,
    ['SysMemberService.saveByPerson:'], 'automatic organization membership');
  const baseRemove = method(basePerson, 'remove', `(${personDescriptor})Z`).text;
  ordered(baseRemove, ['SysMemberService.removeByPersonId:', 'Method remove:'], 'organization cleanup');
  const enabled = get(person).members.find(member => member.name === 'enabled');
  assert.ok(enabled, 'Native logical deletion field is missing');
  assert.deepEqual(enabled.annotations.get('com.baomidou.mybatisplus.annotation.TableLogic'),
    { value: '1', delval: '0' }, 'Native Person logical deletion changed');
  const memberService = get('cn.ibizlab.core.ad.service.impl.AbstractSysMemberService');
  method(memberService, 'removeByPersonId', '(Ljava/lang/String;)Z');
  method(memberService, 'saveByPerson', `(${personDescriptor}Ljava/util/List;)Z`);
  const loader = get('cn.ibizlab.core.authentication.service.impl.AuthUserServiceImpl');
  const load = method(loader, 'loadUserByUsername',
    '(Ljava/lang/String;)Lcn/ibizlab/core/authentication/domain/AuthUserImpl;');
  fragments(lambdaReferences(loader, load), ['SysPerson.getUid:', 'SysPerson.getDc:'],
    'UID and realm authentication lookup');
  const filter = get('cn.ibizlab.core.ad.filter.SysPersonSearchContext');
  for (const property of ['n_uid_eq', 'n_dc_eq']) {
    assert.ok(filter.members.some(member =>
      member.annotations.get('com.fasterxml.jackson.annotation.JsonProperty')?.value === property),
    'Native UID/realm filter property changed');
  }
  const security = get('cn.ibizlab.config.BootSecurityConfig');
  assert.equal(security.annotations.get(
    'org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity')?.prePostEnabled,
  true, 'Packaged pre/post method security declaration changed');
  return { classContract: 'native-actor-reviewed-class-subset-v1',
    runtimeClassContractVerified: true, runtimeContractVerified: false,
    sourceAuthenticityOrFullEquivalenceProven: false,
    entities, passwordBranchMatches: true, passwordModeEffectiveValueVerified: false,
    basePathEffectiveValueVerified: false, automaticRoleBranchMatches: true,
    automaticOrganizationMemberBranchMatches: true, nativeRemovalDependenciesMatch: true,
    nativeLogicalDeletionMatches: true, uidAndRealmLookupMatches: true,
    prePostMethodSecurityDeclarationMatches: true, actualAuthorizationTested: false };
}

function scanScript() {
  const wanted = classEntries.map(entry => `wanted["${entry}"]=1`).join(';');
  return `set -eu
for file in /opt/uaa/third-party/*.jar /opt/uaa/starters/*.jar /opt/uaa/packages/*.jar; do
  test -f "$file" && test ! -L "$file" || exit 21
  printf 'JAR\\t'
  sha256sum "$file"
  listing=$(${jdk}/jar -J-XX:-UsePerfData tf "$file") || exit 22
  printf '%s\\n' "$listing" | awk -v jar="$file" 'BEGIN{${wanted}} ($0 in wanted){printf "CLASS\\t%s\\t%s\\n",jar,$0}'
done`;
}

function durableFile(path, bytes) {
  const descriptor = fs.openSync(path,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function safeOutput(output, root) {
  assert.equal(typeof output, 'string', 'An exclusive private output is required');
  const path = resolve(output);
  assert.equal(dirname(path), join(root, '.artifacts'));
  assert.match(basename(path), /^native-actor-contract-[a-zA-Z0-9-]+$/);
  assert.ok(!fs.existsSync(path), 'An existing output cannot be overwritten');
  for (let current = dirname(path); ; current = dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Symlink output ancestry is refused');
    if (dirname(current) === current) break;
  }
  return path;
}

export function probeExistingNativeActorContract(options = {}) {
  assert.ok(Object.keys(options).every(key => ['output', 'execute', 'root'].includes(key)),
    'This verifier has no apply, network, account, or role options');
  const { root = workspace, execute = (program, args) => spawnSync(program, args,
    { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }) } = options;
  const output = safeOutput(options.output, root);
  const invoke = (program, args) => {
    const result = execute(program, args);
    assert.ok(!result.error && !result.signal && result.status === 0,
      `Read-only ${program} inspection failed; raw output withheld`);
    return Buffer.from(result.stdout);
  };
  const inspect = () => {
    const rows = JSON.parse(invoke('docker', ['inspect', containerName]).toString());
    assert.equal(rows.length, 1);
    return nativeActorRuntimeIdentity(rows[0], root);
  };
  const source = inspectNativeActorSources(path => fs.readFileSync(join(root, path)));
  const sources = [...source.files, ...extraSources.map(path =>
    ({ path, bytes: fs.readFileSync(join(root, path)) }))];
  for (const { entity } of source.facts.uaaCollections) {
    const resource = sources.find(file => file.path.endsWith(`/Abstract${entity}Resource.java`)).bytes.toString();
    const guard = reviewedGetGuard(entity);
    if (guard) assert.ok(resource.includes(`@PostAuthorize("${guard}")`),
      'Maintained native GET guard changed');
    else assert.ok(!resource.includes('PostAuthorize') && !resource.includes(`uaa-${entity}-Get`),
      'Maintained no-local-GET-guard contract changed');
  }
  const securitySource = sources.find(file => file.path === extraSources[0]).bytes.toString();
  assert.match(securitySource, /@EnableGlobalMethodSecurity\(\s*prePostEnabled = true\s*\)/);
  const initial = inspect();
  const processIdentity = nativeActorProcessIdentity(invoke('docker',
    ['exec', initial.containerId, 'cat', '/proc/1/cmdline']));
  fs.mkdirSync(output, { mode: 0o700 });
  for (const directory of ['jars', 'classes', 'javap', 'source']) {
    fs.mkdirSync(join(output, directory), { mode: 0o700 });
  }
  const report = { contract: 'existing-native-actor-readonly-class-probe-v1',
    status: 'RUNNING', startedAt: new Date().toISOString(), runtimeClassContractVerified: false,
    runtimeContractVerified: false, sourceAuthenticityProven: false,
    runtime: initial, process: processIdentity, httpRequests: 0, authenticationRequests: 0,
    databaseRequests: 0, usersCreated: 0, rolesChanged: 0, runtimeChanged: false,
    observedRuntimeIdentityStable: false, preparedCandidatesModified: false,
    authenticationUsable: false, bindings: [] };
  let phase = 'source-snapshot';
  try {
    for (const [index, file] of sources.entries()) {
      const path = `source/${index.toString().padStart(2, '0')}-${basename(file.path)}`;
      durableFile(join(output, path), file.bytes);
      report.bindings.push({ path, sourcePath: file.path, bytes: file.bytes.length, sha256: sha(file.bytes) });
    }
    for (const path of ['scripts/probe-existing-native-actor-contract.mjs',
      'scripts/tests/probe-existing-native-actor-contract.test.mjs',
      'scripts/prepare-existing-native-actors.mjs']) {
      const bytes = fs.readFileSync(join(root, path));
      const target = `source/${basename(path)}`;
      durableFile(join(output, target), bytes);
      report.bindings.push({ path: target, sourcePath: path, bytes: bytes.length, sha256: sha(bytes) });
    }
    phase = 'classpath-index';
    const inventoryBytes = invoke('docker', ['exec', initial.containerId, 'sh', '-c', scanScript()]);
    const inventory = parseNativeActorJarInventory(inventoryBytes.toString());
    durableFile(join(output, 'classpath.private.txt'), inventoryBytes);
    report.classpath = inventory;
    report.javapVersion = invoke('docker',
      ['exec', initial.containerId, `${jdk}/javap`, '-J-XX:-UsePerfData', '-version']).toString().trim();
    assert.match(report.javapVersion, /^[0-9.]+(?:-[A-Za-z0-9.+-]+)?$/);
    phase = 'runtime-jar-snapshots';
    const localJars = new Map();
    for (const jarPath of [...new Set(inventory.classes.map(item => item.jar))]) {
      const jar = inventory.jars.find(item => item.path === jarPath);
      const bytes = invoke('docker', ['exec', initial.containerId, 'cat', jarPath]);
      assert.equal(sha(bytes), jar.sha256, 'Runtime JAR changed during its private snapshot');
      const local = join(output, 'jars', basename(jarPath));
      assert.ok(![...localJars.values()].includes(local), 'Ambiguous JAR basename');
      durableFile(local, bytes);
      localJars.set(jarPath, local);
      const entries = invoke('unzip', ['-Z1', local]).toString().trim().split('\n');
      assert.equal(new Set(entries).size, entries.length, 'Duplicate ZIP entries are refused');
      assert.ok(entries.every(entry => !entry.startsWith('/') && !entry.includes('\\')
        && entry.replace(/\/$/, '').split('/').every(part => part && !['.', '..'].includes(part))),
      'Unsafe ZIP entry is refused');
      for (const entry of inventory.classes.filter(item => item.jar === jarPath)) {
        assert.equal(entries.filter(item => item === entry.entry).length, 1,
          'Runtime class missing from the copied JAR');
      }
      report.bindings.push({ path: `jars/${basename(local)}`, runtimePath: jarPath,
        bytes: bytes.length, sha256: jar.sha256 });
    }
    phase = 'runtime-class-disassembly';
    const views = new Map();
    for (const entry of inventory.classes) {
      assert.ok(classEntrySet.has(entry.entry));
      const bytes = invoke('unzip', ['-p', localJars.get(entry.jar), entry.entry]);
      assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024);
      const classPath = `classes/${entry.className}.class`;
      durableFile(join(output, classPath), bytes);
      const disassembly = invoke('docker', ['exec', initial.containerId, `${jdk}/javap`,
        '-J-XX:-UsePerfData', '-v', '-p', '-c', '-classpath', classpath, entry.className]);
      const view = parseNativeActorJavap(disassembly.toString(), entry.className);
      assert.deepEqual(view.origin, { jar: entry.jar, entry: entry.entry, sha256: sha(bytes) },
        'Disassembled runtime class is not the copied class');
      const javapPath = `javap/${entry.className}.private.txt`;
      durableFile(join(output, javapPath), disassembly);
      report.bindings.push({ path: classPath, bytes: bytes.length, sha256: sha(bytes),
        runtimeJar: entry.jar, entry: entry.entry });
      report.bindings.push({ path: javapPath, bytes: disassembly.length, sha256: sha(disassembly) });
      views.set(entry.className, view);
    }
    phase = 'class-contract-comparison';
    report.assessment = assessNativeActorClassContract(views, source.facts);
    phase = 'runtime-and-source-drift';
    assert.deepEqual(inspect(), initial, 'UAA lifecycle, ownership or configuration changed');
    assert.deepEqual(nativeActorProcessIdentity(invoke('docker',
      ['exec', initial.containerId, 'cat', '/proc/1/cmdline'])), processIdentity, 'UAA process changed');
    const finalInventory = parseNativeActorJarInventory(invoke('docker',
      ['exec', initial.containerId, 'sh', '-c', scanScript()]).toString());
    assert.deepEqual(finalInventory, inventory, 'Classpath JARs or class origins changed');
    for (const file of report.bindings.filter(binding => binding.sourcePath)) {
      assert.equal(sha(fs.readFileSync(join(root, file.sourcePath))), file.sha256,
        'Bound maintained source or verifier implementation changed');
    }
    report.observedRuntimeIdentityStable = true;
    report.runtimeClassContractVerified = true;
    report.status = 'CLASS_SUBSET_MATCHED_AUTHORIZATION_NOT_TESTED';
  } catch (error) {
    report.status = 'BLOCKED_CLASS_CONTRACT_NOT_VERIFIED';
    report.failedPhase = phase;
    report.failure = { type: error.name, message: error.message.slice(0, 500) };
  }
  report.remaining = [
    'The source remains maintained/reconstructed; this subset does not prove original-source authenticity or full binary equivalence',
    'Resolve effective controller prefix and password storage mode from current configuration, including external configuration sources',
    'Normally authenticate an authorized administrator and verify exact GET/Create/Remove permissions and denied-write side effects',
    'Resolve actual realm, ordinary organization role and the owned product; prove generated UID absence across active rows and tombstones',
    'Create no accounts until native authorization and identity preflight passes; prepared NOT_CREATED candidates remain immutable',
    'Verify automatic roles, organization membership, normal login and PLM user ID mapping after each eventual native create',
  ];
  report.finishedAt = new Date().toISOString();
  durableFile(join(output, 'report.private.json'), json(report));
  const directory = fs.openSync(output, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
  try {
    const report = probeExistingNativeActorContract(values);
    console.log(JSON.stringify({ status: report.status,
      runtimeClassContractVerified: report.runtimeClassContractVerified,
      runtimeContractVerified: false, httpRequests: 0, usersCreated: 0, rolesChanged: 0,
      ...(report.failedPhase ? { failedPhase: report.failedPhase, failure: report.failure } : {}) }));
    if (!report.runtimeClassContractVerified) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', message: error.message.slice(0, 500) }));
    process.exitCode = 1;
  }
}
