#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const parserPath = 'ibiz-app-hub/node_modules/.pnpm/acorn@8.15.0/node_modules/acorn/dist/acorn.js';
const acorn = require(path.join(workspace, parserPath));
const parserSha256 = 'fdb08546776ec6228b03e8d02b40d4ab3255bae5f401adba7ff5dad927ac5c9c';
const staticRoot = '.artifacts/plm-wiki-static-20261124-r1';
const inventoryPath = `${staticRoot}/inventory.private.json`;
const inventorySha256 = '0adfea566be5ce89245307e44794584b7f3b20ab3e7bc2eb2ad38755f3730c5f';
const sourceNginx = 'plm-web/nginx-local.conf';
const nginxSha256 = '64e92ebc923fb6bef7acc0ba296a92124d55c5f97db9f4e63779e585cee63e46';
const environmentPath = 'environments/environment.js';
const runtimeBundle = 'extras/js/@ibiz-template/runtime/index.system.min.js';
const artifacts = path.join(workspace, '.artifacts');
const containerId = '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612';
const imageId = 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c';
const runtimeNginx = '/etc/nginx/conf.d/nginx.conf';
const runtimeTarget = '/dist/plmwiki';
const hostTarget = path.join(workspace, 'plm-web/dist/plmwiki');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)])) : value;

export function validateWikiAssetPath(relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(relative.length > 0 && !path.posix.isAbsolute(relative) && !relative.includes('\\')
    && !relative.includes('\0') && !relative.split('/').some(part => ['', '.', '..'].includes(part)));
  assert.equal(path.posix.normalize(relative), relative);
  return relative;
}

function literal(node) {
  if (node.type === 'Literal' && !node.regex && !Object.hasOwn(node, 'bigint')) {
    assert.ok(node.value === null || ['string', 'boolean', 'number'].includes(typeof node.value));
    if (typeof node.value === 'number') assert.ok(Number.isFinite(node.value));
    return node.value;
  }
  if (node.type === 'ArrayExpression') {
    assert.ok(node.elements.every(Boolean));
    return node.elements.map(literal);
  }
  assert.equal(node.type, 'ObjectExpression', 'Environment values must be plain static literals');
  const result = Object.create(null);
  for (const property of node.properties) {
    assert.equal(property.type, 'Property');
    assert.equal(property.kind, 'init');
    assert.equal(property.computed, false);
    assert.equal(property.method, false);
    assert.equal(property.shorthand, false);
    const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
    assert.equal(typeof key, 'string');
    assert.ok(!['__proto__', 'constructor', 'prototype'].includes(key) && !Object.hasOwn(result, key));
    result[key] = literal(property.value);
  }
  return result;
}

export function parseWikiEnvironment(text) {
  assert.equal(acorn.version, '8.15.0');
  const tree = acorn.parse(text, { ecmaVersion: 2022, sourceType: 'script' });
  assert.equal(tree.body.length, 1, 'Only one environment assignment is allowed');
  assert.equal(tree.body[0].type, 'ExpressionStatement');
  const expression = tree.body[0].expression;
  assert.equal(expression.type, 'AssignmentExpression');
  assert.equal(expression.operator, '=');
  assert.equal(expression.left.type, 'MemberExpression');
  assert.equal(expression.left.computed, false);
  assert.equal(expression.left.object.type, 'Identifier');
  assert.equal(expression.left.object.name, 'window');
  assert.equal(expression.left.property.name, 'Environment');
  return literal(expression.right);
}

export function sanitizeWikiEnvironment(text) {
  const before = parseWikiEnvironment(text);
  assert.equal(before.baseUrl, 'ibizplm__plmwiki');
  assert.equal(before.appId, 'ibizplm__plmwiki');
  assert.equal(before.BaseUrl, '/api');
  assert.equal(before.enableAnonymous, false, 'A changed activation setting needs a new review');
  assert.equal(typeof before.anonymousUser, 'string');
  assert.equal(typeof before.anonymousPwd, 'string');
  const after = { ...before, enableAnonymous: false, anonymousUser: '', anonymousPwd: '' };
  const output = `window.Environment = ${JSON.stringify(after, null, 2)
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')};\n`;
  assert.deepEqual({ ...parseWikiEnvironment(output) }, after);
  return { output, before, after };
}

export const wikiStaticLocations = `    location = /plmwiki {
        return 302 /plmwiki/$is_args$args;
    }

    location ^~ /plmwiki/ {
        alias /dist/plmwiki/;
        index index.html;
    }

`;

export function deriveWikiNginx(text) {
  assert.equal(hash(text), nginxSha256, 'The observed nginx baseline changed');
  assert.equal(text.includes('/plmwiki'), false);
  const anchor = '    location = /assets/images/login-header.png {';
  assert.equal(text.split(anchor).length, 2);
  return text.replace(anchor, wikiStaticLocations + anchor);
}

export function validateWikiNginxDelta(before, after) {
  assert.equal(after, deriveWikiNginx(before));
  assert.equal(after.replace(wikiStaticLocations, ''), before);
  assert.equal((wikiStaticLocations.match(/\blocation\b/g) ?? []).length, 2);
  assert.doesNotMatch(wikiStaticLocations, /proxy_|rewrite|srforgid|srfuserid|Authorization|\/api\//);
  return { addedLocations: ['= /plmwiki', '^~ /plmwiki/'], APIChanges: false, identityHeadersAdded: false };
}

function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  visit(node, ancestors);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) for (const child of value) walk(child, visit, [...ancestors, node]);
      else walk(value, visit, [...ancestors, node]);
    }
  }
}

export function inspectCachedWikiAuthentication(text) {
  const tree = acorn.parse(text, { ecmaVersion: 2022, sourceType: 'script' });
  const methods = [];
  walk(tree, (node, ancestors) => {
    if (node.type !== 'MethodDefinition' || node.key?.name !== 'anonymousLogin') return;
    const source = text.slice(node.start, node.end);
    const parent = ancestors.at(-1);
    assert.equal(parent.type, 'ClassBody');
    const login = parent.body.find(item => item.type === 'MethodDefinition' && item.key?.name === 'login');
    assert.ok(login);
    let usesNormalLogin = false;
    walk(login, child => {
      if (child.type === 'Literal' && child.value === '/v7/login') usesNormalLogin = true;
    });
    assert.ok(source.includes('anonymousUser') && source.includes('anonymousPwd') && source.includes('this.login('));
    assert.equal(usesNormalLogin, true);
    methods.push({ bytes: Buffer.byteLength(source), sha256: hash(source),
      credentialKeys: ['anonymousUser', 'anonymousPwd'], delegatesToNormalV7Login: true });
  });
  assert.equal(methods.length, 1, 'The observed cached anonymous bootstrap must be traceable');
  return { observedCachedBytes: true, credentialFreeAnonymousBootstrap: false, methods };
}

export function inspectWikiGuestContract({ entity, appEntity, serviceAPI, sharedView, subtreeView,
  displayForm, sharedAction, sharedInfo, authSource, cloudAPISource, APILevelSource }) {
  assert.ok(authSource.includes('this.login(anonymousUser, anonymousPwd)'));
  assert.ok(cloudAPISource.includes('serviceUrl = serviceUrl + "/**"'));
  assert.ok(cloudAPISource.includes('getIgnoreAuthPatterns()'));
  assert.ok(cloudAPISource.includes('createAnonymousUserContext()'));
  assert.ok(APILevelSource.includes('ANONYMOUSUSER = 4'));
  assert.equal(sharedView.accUserMode, 3);
  assert.equal(subtreeView.accUserMode, 3);
  assert.equal(appEntity.getPSSysServiceAPI.path, 'PSSYSSERVICEAPIS/ServiceAPI.json');
  const actions = appEntity.getAllPSAppDEActions.map(item => item.codeName.toLowerCase());
  assert.ok(['create', 'update', 'get_draft', 'remove'].every(name => actions.includes(name)));
  const dto = entity.getAllPSDEMethodDTOs.find(item => item.name === 'article_page_dto');
  const fields = dto.getPSDEMethodDTOFields.map(item => item.name);
  assert.ok(['content', 'publish_content', 'access_password'].every(name => fields.includes(name)));
  assert.equal(displayForm.getGetPSControlAction.actionName, 'Get');
  assert.equal(sharedAction.getPSDEActionReturn.getPSDEMethodDTO.id, 'article_page_dto');
  assert.equal(sharedAction.dataAccessAction, 'UPDATE');
  const outputs = sharedInfo.getPSDELogicNodes.flatMap(node => node.getPSDELogicNodeParams ?? []);
  assert.ok(outputs.some(item => item.dstFieldName === 'ACCESS_PASSWORD'
    && item.getDstPSDELogicParam?.id === 'result'));
  return {
    status: 'GUEST_ACTIVATION_BLOCKED_CURRENT_CONTRACT',
    observedSourceNotRuntimeAuthorizationAcceptance: true,
    frontend: { sharedViewAccessMode: 3, subtreeViewAccessMode: 3,
      anonymousLoginUsesConfiguredCredentials: true },
    native: { anonymousAPILevel: 4, level4RegistersWholeServiceWildcard: true,
      preciseIgnoreAuthPatternsSupported: true, serverCreatesAnonymousUserContext: true },
    currentModel: { serviceCode: serviceAPI.codeName, explicitAPILevel: serviceAPI.apiLevel ?? null,
      explicitIgnoreAuthPatterns: serviceAPI.ignoreAuthPatterns ?? [],
      commonAPIHasWritesAndDraftAction: true, sharedFormLoadsDefaultGet: true,
      defaultDTOIncludesDraftContent: true, internalSharedLogicCopiesPassword: true },
    activeGuestConfiguration: {
      enableAnonymous: false, anonymousUser: '', anonymousPwd: '',
      APILevelOverride: null, ignoreAuthPatterns: [], newAccounts: [], roleGrants: [],
    },
    unresolved: [
      'Current cached frontend has no credential-free anonymous bootstrap',
      'Do not make the common API anonymous or expose internal shared action',
      'Prove server-side password, expiry, revoke and subset enforcement before a visitor grant',
      'Prove anonymous responses exclude draft content and access_password independently of UI display',
      'Review exact namespace routing and metadata/bootstrap requirements without identity headers',
    ],
  };
}

export function validateDisabledWikiGuestConfiguration(value) {
  assert.deepEqual(value, {
    enableAnonymous: false, anonymousUser: '', anonymousPwd: '',
    APILevelOverride: null, ignoreAuthPatterns: [], newAccounts: [], roleGrants: [],
  }, 'No currently verified guest activation or API opening is available');
}

function regularRead(filename) {
  assert.equal(fs.realpathSync(filename), path.resolve(filename), 'Input symlinks are not allowed');
  const before = fs.lstatSync(filename);
  const pinnedParser = filename === path.join(workspace, parserPath);
  assert.ok(before.isFile() && (before.nlink === 1 || pinnedParser) && before.size < 64 * 1024 * 1024,
    `Unexpected input file metadata: ${path.relative(workspace, filename)}`);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(descriptor);
    for (const after of [fs.fstatSync(descriptor), fs.lstatSync(filename)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function privateWrite(output, relative, bytes) {
  validateWikiAssetPath(relative);
  const filename = path.join(output, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, bytes, { mode: 0o600, flag: 'wx' });
  return { path: relative, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
}

function assertAbsent(filename) {
  try { fs.lstatSync(filename); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('The reviewed wiki target must still be absent');
}

function docker(args, input) {
  const result = spawnSync('docker', args, { input, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, 'Read-only existing-container inspection failed');
  return Buffer.from(result.stdout ?? '');
}

function runtimeWitness() {
  const raw = docker(['inspect', containerId]);
  const rows = JSON.parse(raw);
  assert.equal(rows.length, 1);
  const value = rows[0];
  assert.equal(value.Id, containerId);
  assert.equal(value.Image, imageId);
  assert.equal(value.Name, '/plmweb');
  assert.equal(value.State.Status, 'running');
  assert.equal(value.HostConfig.Tmpfs['/dist'], 'uid=101,gid=101,mode=0755');
  const bind = value.Mounts.find(item => item.Destination === '/opt/aibiz/local-dist');
  assert.equal(bind.Source, path.join(workspace, 'plm-web/dist'));
  assert.equal(bind.Type, 'bind');
  assert.equal(bind.RW, false);
  assert.ok(!value.Mounts.some(item => runtimeNginx === item.Destination
    || runtimeNginx.startsWith(`${item.Destination}/`)));
  const nginx = docker(['exec', containerId, 'cat', runtimeNginx]);
  assert.equal(hash(nginx), nginxSha256);
  const start = docker(['exec', containerId, 'cat', '/start.sh']);
  const configuration = docker(['exec', containerId, 'cat', '/environment.config']);
  const metadata = docker(['exec', containerId, 'stat', '-c', '%d:%i:%u:%g:%a:%h:%s', runtimeNginx]).toString().trim();
  assert.match(metadata, /^\d+:\d+:\d+:\d+:[0-7]+:1:\d+$/);
  const absent = docker(['exec', containerId, 'sh', '-c',
    'set -eu\ntest ! -e /dist/plmwiki && test ! -L /dist/plmwiki\nprintf "ABSENT\\n"\n']);
  assert.equal(absent.toString(), 'ABSENT\n');
  assertAbsent(hostTarget);
  return {
    raw, nginx, start, configuration,
    binding: {
      container: value.Id, image: value.Image, name: value.Name,
      configurationSha256: hash(json(canonical({ config: value.Config, host: value.HostConfig,
        mounts: value.Mounts.toSorted((left, right) => left.Destination.localeCompare(right.Destination)) }))),
      startedAt: value.State.StartedAt, restartCount: value.RestartCount,
      nginxSha256: hash(nginx), nginxMetadata: metadata, startSha256: hash(start),
      environmentConfigSha256: hash(configuration), hostWikiAbsent: true, runtimeWikiAbsent: true,
    },
  };
}

const authorityPaths = {
  entity: 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json',
  appEntity: 'plm/model/PSSYSAPPS/plmwiki/PSAPPDATAENTITIES/article_page.json',
  serviceAPI: 'plm/model/PSSYSSERVICEAPIS/ServiceAPI.json',
  sharedView: 'plm/model/PSSYSAPPS/plmwiki/PSAPPDEVIEWS/article_page_wiki_shared_view.json',
  subtreeView: 'plm/model/PSSYSAPPS/plmwiki/PSAPPDEVIEWS/article_page_shared_with_sub_view.json',
  displayForm: 'plm/model/PSSYSAPPS/plmwiki/PSAPPDATAENTITIES/article_page/PSFORMS/wiki_show_edit_view_form.json',
  sharedAction: 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDEACTIONS/shared.json',
  sharedInfo: 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/get_shared_info.json',
  authSource: 'ibiz-app-hub/packages/runtime/src/service/service/auth/v7-auth.service.ts',
  cloudAPISource: 'ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/service/SysServiceAPIRuntime.java',
  APILevelSource: 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/service/SysServiceAPILevels.java',
};

export function prepareExistingPlmWikiEntry({ output }) {
  output = path.resolve(output);
  assert.equal(fs.realpathSync(path.dirname(output)), fs.realpathSync(artifacts));
  assert.match(path.basename(output), /^plm-wiki-entry-candidate-[a-z0-9-]+$/);
  assertAbsent(output);
  fs.mkdirSync(output, { mode: 0o700 });
  const report = { contract: 'existing-plm-wiki-entry-candidate-v1', status: 'FAILED',
    startedAt: new Date().toISOString(), sourceBindings: [], containerCreate: false, imagePull: false,
    sharedApply: false, nginxReloaded: false, serviceRestarted: false, accountsCreated: false,
    loginExecuted: false, APIConfigurationChanged: false, businessAcceptance: false };
  let failure;
  try {
    assert.equal(hash(regularRead(path.join(workspace, parserPath))), parserSha256);
    const manifestBytes = regularRead(path.join(workspace, inventoryPath));
    assert.equal(hash(manifestBytes), inventorySha256);
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.contract, 'existing-stopped-plmwiki-static-copy-v1');
    assert.equal(manifest.status, 'PRIVATE-COPY-NOT-SERVED');
    assert.equal(manifest.files.length, 8787);
    assert.equal(manifest.files.reduce((sum, item) => sum + item.bytes, 0), 318317488);
    assert.equal(new Set(manifest.files.map(item => item.path)).size, 8787);
    privateWrite(output, 'observed-inventory.private.json', manifestBytes);
    report.originalAssets = { path: staticRoot, inventorySha256, files: 8787, bytes: 318317488,
      historicalContainer: manifest.containerId, historicalImage: manifest.imageId };
    const sources = [fileURLToPath(import.meta.url), path.join(workspace, 'scripts/tests/prepare-existing-plm-wiki-entry.test.mjs'),
      path.join(workspace, sourceNginx), path.join(workspace, 'plm-web/start.sh'), path.join(workspace, parserPath),
      ...Object.values(authorityPaths).map(relative => path.join(workspace, relative))];
    for (const filename of [...new Set(sources)]) {
      const relative = path.relative(workspace, filename);
      const bytes = regularRead(filename);
      const snapshot = privateWrite(output, `source/${relative}`, bytes);
      report.sourceBindings.push({ path: relative, sha256: snapshot.sha256, snapshot: snapshot.path });
    }
    const before = runtimeWitness();
    privateWrite(output, 'runtime-before.private.json', before.raw);
    privateWrite(output, 'runtime-nginx-before.private.conf', before.nginx);
    privateWrite(output, 'runtime-start.private.sh', before.start);
    privateWrite(output, 'runtime-environment-config.private.txt', before.configuration);
    report.runtimeBefore = before.binding;
    const nginxBefore = regularRead(path.join(workspace, sourceNginx));
    assert.equal(hash(nginxBefore), nginxSha256);
    assert.equal(hash(before.start), hash(regularRead(path.join(workspace, 'plm-web/start.sh'))));
    const nginxAfter = deriveWikiNginx(nginxBefore.toString());
    report.nginxDelta = validateWikiNginxDelta(nginxBefore.toString(), nginxAfter);
    privateWrite(output, 'nginx-source-before.private.conf', nginxBefore);
    const sourceCandidate = privateWrite(output, 'nginx-source-after.private.conf', nginxAfter);
    const runtimeCandidate = privateWrite(output, 'nginx-runtime-after.private.conf', nginxAfter);
    const sourceAssets = path.join(workspace, staticRoot, 'dist');
    const environment = sanitizeWikiEnvironment(regularRead(path.join(sourceAssets, environmentPath)).toString());
    report.environment = { namespace: environment.after.appId, baseUrl: environment.after.baseUrl,
      APIBaseUrl: environment.after.BaseUrl, enableAnonymous: false, credentialsCleared: true,
      changedKeys: ['anonymousUser', 'anonymousPwd'], unrelatedValuesPreserved: true };
    const authority = Object.fromEntries(Object.entries(authorityPaths).map(([key, relative]) => {
      const bytes = regularRead(path.join(workspace, relative));
      return [key, relative.endsWith('.json') ? JSON.parse(bytes) : bytes.toString()];
    }));
    report.guestContract = inspectWikiGuestContract(authority);
    report.cachedAuthentication = inspectCachedWikiAuthentication(
      regularRead(path.join(sourceAssets, runtimeBundle)).toString());
    validateDisabledWikiGuestConfiguration(report.guestContract.activeGuestConfiguration);
    privateWrite(output, 'guest-configuration.private.json', json(report.guestContract));
    const candidateFiles = [];
    for (const item of manifest.files) {
      validateWikiAssetPath(item.path);
      const bytes = regularRead(path.join(sourceAssets, item.path));
      assert.equal(bytes.length, item.bytes);
      assert.equal(hash(bytes), item.sha256, 'An observed local asset changed');
      if (item.path !== environmentPath && environment.before.anonymousUser) {
        assert.equal(bytes.includes(Buffer.from(environment.before.anonymousUser)), false,
          'An old embedded anonymous username exists outside the reviewed environment file');
      }
      const next = item.path === environmentPath ? Buffer.from(environment.output) : bytes;
      const saved = privateWrite(output, `site/${item.path}`, next);
      candidateFiles.push({ path: item.path, bytes: saved.bytes, sha256: saved.sha256,
        changed: saved.sha256 !== item.sha256 });
    }
    assert.deepEqual(candidateFiles.filter(item => item.changed).map(item => item.path), [environmentPath]);
    report.candidateInventory = privateWrite(output, 'candidate-inventory.private.json', json(candidateFiles));
    const nativeFiles = [
      { source: '/usr/sbin/nginx', target: 'native/nginx', executable: true },
      { source: '/lib/ld-musl-aarch64.so.1', target: 'native/lib/ld-musl-aarch64.so.1', executable: true },
      { source: '/usr/lib/libpcre2-8.so.0', target: 'native/lib/libpcre2-8.so.0' },
      { source: '/usr/lib/libssl.so.3', target: 'native/lib/libssl.so.3' },
      { source: '/usr/lib/libcrypto.so.3', target: 'native/lib/libcrypto.so.3' },
      { source: '/usr/lib/libz.so.1', target: 'native/lib/libz.so.1' },
    ];
    for (const item of nativeFiles) {
      const bytes = docker(['exec', containerId, 'cat', item.source]);
      const saved = privateWrite(output, item.target, bytes);
      item.sha256 = saved.sha256;
      if (item.executable) fs.chmodSync(path.join(output, item.target), 0o700);
    }
    privateWrite(output, 'native/lib/libc.musl-aarch64.so.1',
      regularRead(path.join(output, 'native/lib/ld-musl-aarch64.so.1')));
    const tempDirectives = ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => {
      const directory = path.join(output, 'native', `${name}_temp`);
      fs.mkdirSync(directory, { mode: 0o700 });
      return `    ${name}_temp_path ${directory};\n`;
    }).join('');
    const nativeConfiguration = `pid /dev/null;\nerror_log stderr;\nevents {}\nhttp {\n`
      + `    access_log off;\n${tempDirectives}    server {\n        listen 8080;\n${wikiStaticLocations}    }\n}\n`;
    const nativeInput = privateWrite(output, 'native-nginx-parse.private.conf', nativeConfiguration);
    const executable = path.join(output, 'native/lib/ld-musl-aarch64.so.1');
    const args = ['--library-path', path.join(output, 'native/lib'), path.join(output, 'native/nginx'),
      '-t', '-p', path.join(output, 'native'), '-c', path.join(output, nativeInput.path), '-e', 'stderr'];
    const syntax = spawnSync(executable, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
    const stdout = privateWrite(output, 'native-nginx-parse.stdout.private.log', syntax.stdout ?? '');
    const stderr = privateWrite(output, 'native-nginx-parse.stderr.private.log', syntax.stderr ?? '');
    report.nginxNativeParse = { command: { executable, args }, configuration: nativeInput,
      copiedRuntimeInputs: nativeFiles, scope: 'two-new-static-locations-only',
      completeCandidateConfigurationValidationPendingApply: true,
      status: syntax.status, signal: syntax.signal, stdout, stderr, reload: false, configurationWritten: false };
    assert.equal(syntax.error, undefined, syntax.error?.message);
    assert.equal(syntax.signal, null);
    assert.equal(syntax.status, 0, 'Native nginx rejected the candidate configuration');
    for (const item of nativeFiles) {
      assert.equal(hash(docker(['exec', containerId, 'cat', item.source])), item.sha256);
      assert.equal(hash(regularRead(path.join(output, item.target))), item.sha256);
    }
    for (const item of manifest.files) {
      assert.equal(hash(regularRead(path.join(sourceAssets, item.path))), item.sha256);
    }
    for (const item of candidateFiles) assert.equal(hash(regularRead(path.join(output, 'site', item.path))), item.sha256);
    for (const item of report.sourceBindings) {
      assert.equal(hash(regularRead(path.join(workspace, item.path))), item.sha256);
      assert.equal(hash(regularRead(path.join(output, item.snapshot))), item.sha256);
    }
    assert.equal(hash(regularRead(path.join(workspace, inventoryPath))), inventorySha256);
    const after = runtimeWitness();
    privateWrite(output, 'runtime-after.private.json', after.raw);
    assert.deepEqual(after.binding, before.binding);
    report.runtimeAfter = after.binding;
    const epoch = randomUUID();
    report.plan = {
      contract: 'existing-plm-wiki-entry-plan-v1', status: 'PREPARED-NOT-APPLIED', epoch,
      candidateSite: path.join(output, 'site'), candidateInventorySha256: report.candidateInventory.sha256,
      files: candidateFiles.length, hostTarget, mountedSource: '/opt/aibiz/local-dist/plmwiki', runtimeTarget,
      hostStaging: path.join(workspace, `plm-web/dist/.plmwiki-${epoch}.pending`),
      runtimeStaging: `/dist/.plmwiki-${epoch}.pending`,
      nginxSource: { path: sourceNginx, beforeSha256: nginxSha256, after: sourceCandidate },
      nginxRuntime: { path: runtimeNginx, beforeSha256: nginxSha256,
        beforeMetadata: before.binding.nginxMetadata, after: runtimeCandidate },
      filePermissions: '0644', directoryPermissions: '0755', runtime: before.binding,
      startupCopy: { source: 'plm-web/start.sh', sha256: before.binding.startSha256,
        appliesTopLevelEnvironmentOverridesOnly: true, nestedWikiEnvironmentPreserved: true },
      requiredWriterLock: '.artifacts/.plm-notification-style-recovery.lock',
      futureApply: ['revalidate exact source/runtime/absence and private candidate inventory under the shared writer lock',
        'stage and verify only the host and tmpfs wiki subtrees; publish each by owned-path rename',
        'stage both exact nginx files; validate the complete candidate and preserve recorded permissions',
        'publish the two reviewed configs and reload nginx once; verify real entry and static hashes',
        'keep guest disabled and API configuration unchanged'],
      restore: { sourceNginx: 'nginx-source-before.private.conf', runtimeNginx: 'runtime-nginx-before.private.conf',
        hostWikiPreviouslyAbsent: true, runtimeWikiPreviouslyAbsent: true,
        subtreeRemovalRequiresExactOwnedInventory: true, removeUnrelatedPaths: false,
        reloadPreviousNginxOnce: true, containerRestart: false },
      guestActivationReady: false, guestConfiguration: report.guestContract.activeGuestConfiguration,
      containerCreate: false, imagePull: false, containerRestart: false, APIConfigurationChange: false,
      credentialPublication: false, accountCreation: false, businessAcceptance: false,
      trustedExclusiveWriterWindowRequired: true, atomicCompareAndSwapClaimed: false,
    };
    const prepared = privateWrite(output, 'prepared.private.json', json(report.plan));
    report.planSha256 = prepared.sha256;
    report.sourceInputsStable = true;
    report.status = 'PREPARED-STATIC-ENTRY-GUEST-DISABLED';
  } catch (error) {
    failure = error;
    report.failure = { name: error.name, message: error.message };
  } finally {
    report.finishedAt = new Date().toISOString();
    privateWrite(output, 'report.private.json', json(report));
  }
  if (failure) throw failure;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
    const result = prepareExistingPlmWikiEntry({ output: values.output });
    console.log(json({ status: result.status, files: result.originalAssets.files,
      planSha256: result.planSha256, guestActivationReady: false, sharedApply: false }));
  } catch (error) {
    console.error(json({ status: 'FAILED_WIKI_ENTRY_PREPARATION', message: error.message }));
    process.exitCode = 1;
  }
}
