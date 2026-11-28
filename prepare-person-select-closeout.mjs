#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspaceDefault = path.resolve(import.meta.dirname, '..');
export const personSelectRef = '@ibiz-template-plm/person-select@0.0.3-alpha.434';
const packagePath = 'plugin-src/@ibiz-template-plm/person-select';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const excluded = new Set(['node_modules', '.git', '.artifacts', 'dist', 'es', 'lib', 'out']);
const rootFiles = ['package.json', 'pnpm-lock.yaml', 'tools/build-plugins.mjs',
  'tools/plugin-recovery/runtime-plugins.txt'];
const evidenceFiles = [
  'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.json',
  'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json',
  'plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/idea/PSFORMS/main.json',
  'plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS/idea_main_view.json',
  'plm-web/src/publish/model/app/app.ts',
  'plm-web/src/publish/model/views/idea-main-view.ts',
  'plm-web/start.sh',
  'plm/deploy/compose/docker-compose-dev.yml',
];

export function personSelectOutput(workspace, output) {
  assert.equal(typeof output, 'string');
  workspace = path.resolve(workspace);
  output = path.resolve(workspace, output);
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^person-select-closeout-[a-z0-9][a-z0-9-]{0,69}$/);
  assert.equal(fs.existsSync(output), false, 'A new private closeout directory is required');
  for (let current = path.dirname(output); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Output ancestry must be real directories');
    if (current === path.dirname(current)) break;
  }
  return output;
}

function read(directories, filename) {
  return readPinnedFile(directories, directories.open(path.dirname(filename)), path.basename(filename)).data;
}

function put(directories, root, relative, bytes) {
  assert.ok(relative && !path.isAbsolute(relative)
    && relative.split('/').every(part => part && part !== '.' && part !== '..'));
  const filename = path.join(root, relative);
  const parent = directories.open(path.dirname(filename), { create: true });
  directories.write(parent, path.basename(filename), bytes);
}

export function personSelectTree(root, { ignore = excluded, maxBytes = 512 * 1024 * 1024 } = {}) {
  const entries = [];
  let totalBytes = 0;
  const directories = new PinnedDirectories();
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory.access, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignore.has(entry.name) || entry.name.endsWith('.tsbuildinfo')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.ok(!entry.isSymbolicLink(), 'Only explicit dependency links may be followed');
      if (entry.isDirectory()) walk(directories.open(path.join(directory.path, entry.name)), relative);
      else {
        assert.ok(entry.isFile());
        const bytes = readPinnedFile(directories, directory, entry.name).data;
        totalBytes += bytes.length;
        assert.ok(totalBytes <= maxBytes && entries.length < 100000, 'Tree exceeds the bounded inventory');
        entries.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
      }
    }
    directories.verify(directory);
  };
  try { walk(directories.open(root)); }
  finally { directories.close(); }
  return { files: entries.length, bytes: totalBytes, fingerprint: sha(json(entries)), entries };
}

function fileBinding(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    assert.ok(before.isFile() && before.size <= 256 * 1024 * 1024);
    let length = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      hash.update(buffer.subarray(0, count));
      length += count;
    }
    const after = fs.fstatSync(fd), current = fs.lstatSync(filename);
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      assert.equal(after[key], before[key]);
      assert.equal(current[key], after[key]);
    }
    assert.equal(length, before.size);
    return { path: filename, bytes: length, sha256: hash.digest('hex') };
  } finally { fs.closeSync(fd); }
}

function git(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const result = spawnSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Read-only Git input observation failed');
  return result.stdout;
}

function copyTree(directories, source, destination, inventory) {
  for (const entry of inventory.entries) {
    const bytes = read(directories, path.join(source, entry.path));
    assert.equal(sha(bytes), entry.sha256, 'Source changed before snapshot');
    put(directories, destination, entry.path, bytes);
  }
}

function packageRoot(resolver, name) {
  const found = resolver.resolve.paths(name)?.map(root => path.join(root, name))
    .find(root => fs.existsSync(path.join(root, 'package.json')));
  assert.ok(found, `Cached dependency unavailable: ${name}`);
  return fs.realpathSync(found);
}

function dependencyInventory(root) {
  const packages = new Map(), missingOptional = [];
  const visit = directory => {
    directory = fs.realpathSync(directory);
    if (packages.has(directory)) return;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    const inventory = personSelectTree(directory, { ignore: new Set(['node_modules', '.git', '.artifacts']) });
    packages.set(directory, { path: directory, name: manifest.name, version: manifest.version, inventory });
    assert.ok(packages.size <= 2000, 'Dependency package graph exceeds reviewed budget');
    const resolver = createRequire(path.join(directory, 'package.json'));
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies,
      ...manifest.peerDependencies }).sort()) {
      let dependency;
      try { dependency = packageRoot(resolver, name); }
      catch (error) {
        if (manifest.optionalDependencies?.[name] || manifest.peerDependenciesMeta?.[name]?.optional) {
          missingOptional.push({ package: manifest.name, dependency: name });
        } else throw error;
      }
      if (dependency) visit(dependency);
    }
  };
  const resolver = createRequire(path.join(root, 'package.json'));
  for (const name of ['vite', 'typescript', '@qx-chitanda/vite-plugin-lib-legacy',
    '@vitejs/plugin-vue-jsx', 'vite-plugin-libcss']) visit(packageRoot(resolver, name));
  const entries = [...packages.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { packages: entries, missingOptional, packageCount: entries.length,
    files: entries.reduce((n, row) => n + row.inventory.files, 0),
    bytes: entries.reduce((n, row) => n + row.inventory.bytes, 0), fingerprint: sha(json(entries)) };
}

export function verifyPersonSelectHostModel(app, view, pluginRefs) {
  assert.equal(pluginRefs.length, 73);
  assert.equal(new Set(pluginRefs).size, 73);
  assert.equal(pluginRefs.filter(ref => ref === personSelectRef).length, 1);
  const plugins = app.getAllPSAppPFPluginRefs.filter(row => row.rTObjectRepo === personSelectRef);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].pluginCode, 'PERSON_SELECT');
  assert.equal(plugins[0].rTObjectName, 'IBizPersonelSelect');
  const styles = app.getAllPSAppEditorStyleRefs.filter(row => row.codeName === 'PERSONEL_SELECT_PRODUCT');
  assert.ok(styles.some(row => row.containerType === 'FORMITEM' && row.pluginCode === 'PERSON_SELECT'));
  const editors = [], hiddenValueFields = [];
  const walk = (value, pointer = '') => {
    if (!value || typeof value !== 'object') return;
    if (value.editorStyle === 'PERSONEL_SELECT_PRODUCT' && value.name === 'assignee_name') {
      editors.push({ pointer, params: value.editorParams, type: value.editorType,
        valueItemName: value.valueItemName, singleSelect: value.singleSelect,
        forceSelection: value.forceSelection, acMode: value.getPSAppDEACMode?.id });
    }
    if (value.name === 'assignee_id' && value.detailType === 'FORMITEM') {
      hiddenValueFields.push({ pointer, hidden: value.hidden,
        editorType: value.getPSEditor?.editorType, codeName: value.getPSAppDEField?.codeName });
    }
    for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${key}`);
  };
  walk(view);
  assert.equal(editors.length, 1);
  const selected = editors[0];
  assert.equal(selected.type, 'PICKEREX_TRIGGER');
  assert.equal(selected.params.URL, 'products/${context.product}/product_members/fetch_default');
  assert.equal(selected.params.USERMETHOD, 'post');
  assert.deepEqual(JSON.parse(selected.params.USERMAP), { id: 'user_id', name: 'name' });
  assert.equal(selected.params.DEPTURL, '/users/fetch_default');
  assert.equal(selected.params.DEPTMETHOD, 'get');
  assert.equal(selected.valueItemName, 'ASSIGNEE_ID');
  assert.equal(selected.singleSelect, true);
  assert.equal(selected.forceSelection, true);
  assert.equal(selected.acMode, 'member_select');
  assert.equal(hiddenValueFields.length, 1);
  assert.equal(hiddenValueFields[0].hidden, true);
  assert.equal(hiddenValueFields[0].editorType, 'HIDDEN');
  assert.equal(hiddenValueFields[0].codeName, 'assignee_id');
  return { plugin: plugins[0], style: styles.find(row => row.containerType === 'FORMITEM'),
    view: 'idea_main_view', field: 'assignee_name', persistedValueField: 'assignee_id',
    hiddenValueField: hiddenValueFields[0], ...selected };
}

export function personSelectDelta(candidate, baselines) {
  assert.ok(candidate.entries.length > 0 && baselines.length === 2);
  const allowed = relative => typeof relative === 'string' && !/[\\\0:?#]/.test(relative)
    && relative.split('/').every(part => part && part !== '.' && part !== '..')
    && (relative === 'index.es.js' || relative === 'index.legacy.js'
    || relative === 'polyfills.legacy.js' || relative === 'style.css' || relative === 'assets/style.css'
    || /^assets\/images\/(?:[A-Za-z0-9._/-]+)$/.test(relative));
  for (const row of candidate.entries) assert.ok(allowed(row.path), `Unexpected runtime output: ${row.path}`);
  return baselines.map(baseline => {
    const original = new Map(baseline.inventory.entries.map(row => [row.path, row]));
    const delta = candidate.entries.filter(row => original.get(row.path)?.sha256 !== row.sha256
      || original.get(row.path)?.bytes !== row.bytes).map(row => ({
      path: `plugins/${personSelectRef}/dist/${row.path}`, candidatePath: row.path,
      before: original.get(row.path) ?? null, after: row,
    }));
    return { target: baseline.target, root: baseline.path, delta,
      preserved: baseline.inventory.entries.filter(row => !delta.some(item => item.candidatePath === row.path)),
      removed: [], metadataRewritten: false };
  });
}

export function personSelectNativePlan(bindings) {
  return { contract: 'person-select-minimal-native-acceptance-plan-v1', executed: false,
    nativeAcceptance: false, fullB02Acceptance: false, fullL02Acceptance: false,
    view: bindings.view, field: bindings.field, persistedValueField: bindings.persistedValueField,
    route: '/#/-/index/product=<owned-product>/idea=<owned-idea>/idea_main_view/-',
    exactRouteMustComeFromNormalNativeNavigation: true,
    editorUserRequest: bindings.params.URL, editorDepartmentRequest: bindings.params.DEPTURL,
    cells: ['zh-CN/desktop', 'en-US/desktop', 'zh-CN/mobile-touch', 'en-US/mobile-touch'],
    roles: ['ordinary-member-write', 'readonly-member-denial', 'nonmember-or-crossorg-denial'],
    steps: [
      'Normal UI login; bind actual appdata identity, native product membership and candidate served plugin hashes',
      'Create one owned idea in the retained own product through normal allowed business operation',
      'Open its real main view, activate assignee_name editor, inspect real member request/page/query and nonempty rows',
      'Choose a different actual member and save through native UI; GET and fresh UI login read back the exact assignee_id/name',
      'Search Unicode and a genuine empty query result; preserve IDs and user text after refresh and language change',
      'In a separate fault-only case abort the observed exact editor request once, do not fulfill fabricated rows; Retry must issue the same query/page and recover from the real service',
      'Readonly and nonmember/crossorg sessions must refuse direct assignee writes; authorized readback and scoped version/recent/message snapshots remain unchanged',
      'Restore any original owned selection then remove the owned idea and exact owned notifications; verify three datasets, keyed absence and unrelated data preservation',
    ],
    rawErrors: 'Capture console/page/unhandled/network/business responses; classify only the exact injected request failure as expected',
    forbidden: ['controller injection', 'forced click', 'fabricated service response as persistence proof',
      'aliasing user IDs', 'public/dist equality as runtime proof'],
  };
}

export function inspectPersonSelectRuntime(ts, source, filename = 'index.legacy.js') {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'Generated SystemJS must parse without syntax errors');
  const dependencies = [], exports = new Set();
  let registrations = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(parsed) === 'System' && node.expression.name.text === 'register') {
      registrations++;
      const array = node.arguments.find(item => ts.isArrayLiteralExpression(item));
      const unwrap = item => ts.isParenthesizedExpression(item) ? unwrap(item.expression) : item;
      const factory = node.arguments.map(unwrap).find(item =>
        ts.isFunctionExpression(item) || ts.isArrowFunction(item));
      assert.ok(array && factory && factory.parameters.length > 0);
      const exportFunction = factory.parameters[0].name.getText(parsed);
      array.elements.forEach(item => { assert.ok(ts.isStringLiteral(item)); dependencies.push(item.text); });
      const exported = child => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)
          && child.expression.text === exportFunction) {
          if (ts.isStringLiteral(child.arguments[0])) exports.add(child.arguments[0].text);
          else if (ts.isObjectLiteralExpression(child.arguments[0])) {
            for (const property of child.arguments[0].properties) {
              assert.ok(property.name);
              exports.add(property.name.text);
            }
          }
        }
        ts.forEachChild(child, exported);
      };
      ts.forEachChild(factory.body, exported);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(registrations, 1, 'The single plugin must have one real SystemJS registration');
  assert.deepEqual([...exports].sort(), ['IBizPersonelSelect', 'default']);
  assert.ok(dependencies.length > 0 && dependencies.every(name => !name.startsWith('.')
    && !name.includes('.artifacts') && !/^(?:https?:|\/)/.test(name)),
  'This plugin must keep its declared bare external dependency surface');
  return { registrations, dependencies, exports: [...exports].sort() };
}

async function buildPass({ directories, output, pass, pluginInventory, roots, guard, journal }) {
  const passRoot = path.join(output, pass);
  const work = path.join(passRoot, 'plm-web');
  directories.open(work, { create: true, exclusive: true });
  copyTree(directories, path.join(output, 'inputs/plm-web', packagePath),
    path.join(work, packagePath), pluginInventory);
  for (const entry of roots) put(directories, work, entry.path,
    read(directories, path.join(output, 'inputs/plm-web', entry.path)));
  fs.symlinkSync(path.join(workspaceDefault, 'plm-web/node_modules'), path.join(work, 'node_modules'));
  fs.symlinkSync(path.join(work, 'node_modules'), path.join(work, packagePath, 'node_modules'));
  for (const name of ['home', 'tmp', 'cache']) directories.open(path.join(passRoot, name), { create: true });
  const program = `import fs from 'node:fs';const status=fs.readFileSync('/proc/self/status','utf8');` +
    `if(!/^NoNewPrivs:\\s+1$/m.test(status)||!/^Seccomp:\\s+2$/m.test(status))throw Error('offline guard absent');` +
    `fs.writeFileSync(process.argv[4],JSON.stringify({pid:process.pid,noNewPrivs:true,seccompMode2:true}),{flag:'wx',mode:384});` +
    `const {buildOne,parsePackageRef}=await import(process.argv[2]);await buildOne(parsePackageRef(process.argv[3]));`;
  put(directories, passRoot, 'build-entry.private.mjs', Buffer.from(program));
  const args = [process.execPath, path.join(passRoot, 'build-entry.private.mjs'),
    pathToFileURL(path.join(work, 'tools/build-plugins.mjs')).href, personSelectRef,
    path.join(passRoot, 'isolation.private.json')];
  const log = fs.openSync(path.join(passRoot, 'build.private.log'), 'wx', 0o600);
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    HOME: path.join(passRoot, 'home'), TMPDIR: path.join(passRoot, 'tmp'),
    XDG_CACHE_HOME: path.join(passRoot, 'cache'), npm_config_offline: 'true',
    npm_config_cache: path.join(passRoot, 'cache/npm'), NODE_ENV: 'production' };
  const startedAt = new Date().toISOString();
  let child, outcome, timer, progress;
  try {
    outcome = await new Promise((resolve, reject) => {
      child = spawn(guard.path, args, { cwd: work, env, stdio: ['ignore', log, log], detached: true });
      journal({ stage: 'build-start', pass, pid: child.pid });
      progress = setInterval(() => journal({ stage: 'build-running', pass, pid: child.pid }), 25000);
      timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') reject(error); }
      }, 120000);
      child.once('error', reject);
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
  } finally { clearInterval(progress); clearTimeout(timer); fs.closeSync(log); }
  journal({ stage: 'build-finish', pass, pid: child.pid, ...outcome });
  assert.ok(outcome.exitCode === 0 && !outcome.signal, `Private ${pass} source build failed; retain its log`);
  const generated = path.join(work, 'public/plugins', personSelectRef, 'dist');
  return { pass, startedAt, finishedAt: new Date().toISOString(), pid: child.pid, ...outcome,
    isolation: JSON.parse(read(directories, path.join(passRoot, 'isolation.private.json'))),
    generated, inventory: personSelectTree(generated, { ignore: new Set() }),
    buildLogSha256: fileBinding(path.join(passRoot, 'build.private.log')).sha256 };
}

export async function preparePersonSelectCloseout({ output, workspace = workspaceDefault } = {}) {
  workspace = path.resolve(workspace);
  assert.equal(workspace, workspaceDefault, 'This source-build preparer has one reviewed workspace');
  output = personSelectOutput(workspace, output);
  const directories = new PinnedDirectories();
  const report = { contract: 'person-select-source-build-closeout-v1', status: 'PREPARING',
    startedAt: new Date().toISOString(), pluginRef: personSelectRef,
    fullB02Acceptance: false, fullL02Acceptance: false, nativeBrowserExecuted: false,
    dockerOperations: false, networkRequests: false, sharedPublication: false };
  let destination;
  try {
    destination = directories.open(output, { create: true, exclusive: true });
    let sequence = 0;
    const journal = event => {
      directories.write(destination, `phase-${String(++sequence).padStart(3, '0')}.private.json`,
        json({ ...event, at: new Date().toISOString() }));
      console.log(JSON.stringify(event));
    };
    const web = path.join(workspace, 'plm-web');
    const revision = git(web, ['rev-parse', 'HEAD']).toString().trim();
    const plugin = path.join(web, packagePath);
    const pluginInventory = personSelectTree(plugin);
    copyTree(directories, plugin, path.join(output, 'inputs/plm-web', packagePath), pluginInventory);
    const roots = [];
    for (const relative of rootFiles) {
      const committed = git(web, ['show', `${revision}:${relative}`]);
      put(directories, path.join(output, 'inputs/plm-web'), relative, committed);
      roots.push({ path: relative, sha256: sha(committed), bytes: committed.length,
        fromExactCommit: revision, workingCopySha256: fileBinding(path.join(web, relative)).sha256 });
    }
    const packageJson = JSON.parse(read(directories, path.join(plugin, 'package.json')));
    assert.equal(`${packageJson.name}@${packageJson.version}`, personSelectRef);
    assert.equal(packageJson.system, 'dist/index.legacy.js');
    assert.deepEqual(packageJson.styles, ['dist/style.css']);
    const runtimeRefs = read(directories, path.join(output, 'inputs/plm-web/tools/plugin-recovery/runtime-plugins.txt'))
      .toString().trim().split(/\r?\n/);
    const bindings = verifyPersonSelectHostModel(
      JSON.parse(read(directories, path.join(workspace, evidenceFiles[0]))),
      JSON.parse(read(directories, path.join(workspace, evidenceFiles[3]))), runtimeRefs);
    const evidenceBindings = evidenceFiles.map(relative => ({ relative,
      ...fileBinding(path.join(workspace, relative)) }));
    for (const binding of evidenceBindings) put(directories, path.join(output, 'evidence-inputs'), binding.relative,
      read(directories, binding.path));
    const baselines = ['public', 'dist'].map(target => ({ target,
      path: path.join(web, target === 'public' ? 'public/plugins' : 'dist/plugins', personSelectRef, 'dist') }));
    baselines.forEach(row => { row.inventory = personSelectTree(row.path, { ignore: new Set() });
      copyTree(directories, row.path, path.join(output, 'rollback', row.target), row.inventory); });
    const tools = [fileBinding(process.execPath), fileBinding(fileURLToPath(import.meta.url))];
    put(directories, output, 'executed-preparer.private.mjs',
      read(directories, fileURLToPath(import.meta.url)));
    const guardRecord = JSON.parse(read(directories,
      path.join(workspace, 'scripts/records/aibiz-offline-implementation-20261122.json')));
    const guard = { ...guardRecord.networkIsolation.wrapperBinary,
      path: path.join(workspace, guardRecord.networkIsolation.wrapperBinary.path) };
    assert.equal(fileBinding(guard.path).sha256, guard.sha256);
    journal({ stage: 'dependency-inventory-start' });
    const dependencies = dependencyInventory(web);
    journal({ stage: 'dependency-inventory-finish', packages: dependencies.packageCount,
      files: dependencies.files, bytes: dependencies.bytes });
    const planBytes = json({
      contract: report.contract, revision, source: { path: packagePath, inventory: pluginInventory },
      roots, tools, guard, dependencies, baselines, evidenceBindings, bindings,
      buildToolMode: 'exact-HEAD-buildOne-in-private-worktree',
    });
    directories.write(destination, 'plan.private.json', planBytes);
    report.planSha256 = sha(planBytes);
    report.first = await buildPass({ directories, output, pass: 'first', pluginInventory, roots, guard, journal });
    report.second = await buildPass({ directories, output, pass: 'second', pluginInventory, roots, guard, journal });
    assert.deepEqual(report.first.inventory, report.second.inventory, 'All generated runtime bytes must match both builds');
    const generated = report.first.inventory;
    for (const relative of ['index.es.js', 'index.legacy.js', 'polyfills.legacy.js', 'style.css', 'assets/style.css']) {
      assert.ok(generated.entries.some(row => row.path === relative && row.bytes > 0), 'Declared fresh runtime output missing');
    }
    const resolver = createRequire(path.join(web, 'package.json'));
    const ts = resolver('typescript');
    const generatedSystem = inspectPersonSelectRuntime(ts,
      read(directories, path.join(report.first.generated, 'index.legacy.js')).toString());
    const baselineSystems = baselines.map(row => ({ target: row.target,
      ...inspectPersonSelectRuntime(ts, read(directories, path.join(row.path, 'index.legacy.js')).toString()) }));
    for (const baseline of baselineSystems) {
      assert.deepEqual([...generatedSystem.dependencies].sort(), [...baseline.dependencies].sort(),
        'A narrow plugin candidate cannot silently change runtime external dependencies');
    }
    report.runtimeContract = { generated: generatedSystem, baselines: baselineSystems,
      dependencySurfaceEquivalent: true, exportSurfaceEquivalent: true,
      runtimeExternalFilesOrBrowserLoadedVerified: false };
    const delta = personSelectDelta(generated, baselines);
    const byPath = new Map(delta.flatMap(row => row.delta.map(item => [item.candidatePath, item.after])));
    assert.ok(byPath.size > 0, 'The selected source must produce a concrete runtime delta');
    for (const entry of byPath.values()) put(directories, path.join(output, 'payload/plugins', personSelectRef, 'dist'),
      entry.path, read(directories, path.join(report.first.generated, entry.path)));
    const nativePlan = personSelectNativePlan(bindings);
    directories.write(destination, 'native-browser-plan.private.json', json(nativePlan));
    report.delta = delta;
    report.sourceInputsUnchanged = JSON.stringify(personSelectTree(plugin)) === JSON.stringify(pluginInventory);
    report.baselinesUnchanged = baselines.every(row =>
      JSON.stringify(personSelectTree(row.path, { ignore: new Set() })) === JSON.stringify(row.inventory));
    report.evidenceInputsUnchanged = evidenceBindings.every(row => fileBinding(row.path).sha256 === row.sha256);
    report.toolsUnchanged = tools.every(row => fileBinding(row.path).sha256 === row.sha256);
    report.dependenciesUnchanged = JSON.stringify(dependencyInventory(web)) === JSON.stringify(dependencies);
    assert.ok(report.sourceInputsUnchanged && report.baselinesUnchanged && report.evidenceInputsUnchanged
      && report.toolsUnchanged && report.dependenciesUnchanged, 'A measured source/build/baseline input changed');
    report.payload = personSelectTree(path.join(output, 'payload'), { ignore: new Set() });
    report.generatedFingerprint = generated.fingerprint;
    report.nativePlanSha256 = sha(json(nativePlan));
    report.status = 'PREPARED-REPRODUCIBLE-SINGLE-PLUGIN-DELTA-NOT-PUBLISHED';
    report.remaining = ['current container/served-byte binding and exact publication recovery',
      'real native four-cell persistence/readback/refusal/cleanup',
      'recursive dependency/toolchain source closure', 'full 73-plugin behavior matrix'];
  } catch (error) {
    report.status = 'FAILED';
    report.failure = { type: error.name, message: error.message };
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (destination) directories.write(destination, 'report.private.json', json(report));
    directories.close();
  }
  console.log(JSON.stringify({ status: report.status, generatedFiles: report.first.inventory.files,
    payloadFiles: report.payload.files, reportSha256: sha(json(report)), nativeBrowserExecuted: false,
    sharedPublication: false }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
  await preparePersonSelectCloseout({ output: values.output });
}
