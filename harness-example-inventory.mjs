#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLES = ['quickstart', 'quickstart_b', 'quickstart_c'];
const ACCEPTANCE = {
  status: 'not_run',
  reason:
    'Static inventory only; no build, application, browser or API acceptance was run.',
};
const ENV_FIELDS = new Set([
  'appId',
  'AppTitle',
  'AppLabel',
  'baseUrl',
  'BaseUrl',
  'pluginBaseUrl',
  'assetsUrl',
  'remoteModelUrl',
  'downloadFileUrl',
  'uploadFileUrl',
  'mqttUrl',
  'enableMqtt',
  'enableAnonymous',
  'isLocalModel',
  'dev',
  'hub',
  'runContainer',
  'environmentTag',
  'marketAddress',
  'casLoginUrl',
  'favicon',
]);
const ENDPOINT_ROLES = {
  BaseUrl: 'api-prefix',
  baseUrl: 'api-namespace',
  pluginBaseUrl: 'plugin-registry',
  assetsUrl: 'assets',
  remoteModelUrl: 'model-service',
  downloadFileUrl: 'file-download',
  uploadFileUrl: 'file-upload',
  mqttUrl: 'mqtt',
  marketAddress: 'marketplace',
  casLoginUrl: 'login',
};
const slash = (value) => value.split(sep).join('/');
const pointer = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');

function loadTypeScript(root) {
  for (const base of [
    join(root, 'ibiz-app-hub'),
    root,
    join(SCRIPT_ROOT, 'ibiz-app-hub'),
    join(SCRIPT_ROOT, 'modelingweb/app'),
  ]) {
    const require = createRequire(join(base, 'package.json'));
    try {
      const file = require.resolve('typescript');
      return { ts: require(file), require: createRequire(file) };
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error(
    'No local TypeScript parser found. Install workspace dependencies first; regex fallback is disabled.',
  );
}

function diskEntry(root, file) {
  const result = { path: slash(relative(root, file)), exists: false };
  try {
    const stat = statSync(file);
    return {
      ...result,
      exists: true,
      kind: stat.isDirectory() ? 'directory' : 'file',
    };
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return result;
  }
}

function reader(root, ts) {
  const inputs = [];
  const issues = [];
  const source = (file, node, sf) => {
    const location = { file: slash(relative(root, file)) };
    if (node && sf) {
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      Object.assign(location, {
        line: pos.line + 1,
        column: pos.character + 1,
      });
    }
    return location;
  };
  const issue = (code, at, message) =>
    issues.push({ code, source: at, message });
  function read(file, format) {
    const entry = { ...diskEntry(root, file), format };
    inputs.push(entry);
    if (!entry.exists) {
      entry.status = 'missing';
      return null;
    }
    if (entry.kind !== 'file') {
      entry.status = 'invalid';
      issue('not-a-file', source(file), 'Expected a regular input file.');
      return null;
    }
    const text = readFileSync(file, 'utf8');
    entry.sha256 = createHash('sha256').update(text).digest('hex');
    entry.status = 'read';
    return { text, entry, source: source(file) };
  }
  function json(file) {
    const input = read(file, 'json');
    if (!input) return null;
    try {
      input.value = JSON.parse(input.text);
      if (
        !input.value ||
        typeof input.value !== 'object' ||
        Array.isArray(input.value)
      ) {
        throw new Error('Expected a JSON object.');
      }
      input.entry.status = 'parsed';
      return input;
    } catch (error) {
      input.entry.status = 'invalid';
      issue('invalid-json', input.source, error.message);
      return null;
    }
  }
  function code(file) {
    const input = read(file, 'typescript');
    if (!input) return null;
    const sf = ts.createSourceFile(
      file,
      input.text,
      ts.ScriptTarget.Latest,
      true,
    );
    if (sf.parseDiagnostics.length) {
      input.entry.status = 'invalid';
      for (const diagnostic of sf.parseDiagnostics) {
        const pos = sf.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        issue(
          'invalid-typescript',
          { ...input.source, line: pos.line + 1, column: pos.character + 1 },
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      }
      return null;
    }
    input.entry.status = 'parsed';
    return syntax(ts, sf, (node) => source(file, node, sf), issue);
  }
  return { inputs, issues, source, issue, read, json, code };
}

// Only unwrap syntax and literal const bindings. Never import or execute scanned code.
function syntax(ts, sf, at, issue) {
  const bindings = new Map();
  for (const statement of sf.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.flags & ts.NodeFlags.Const
    ) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name))
          bindings.set(decl.name.text, decl.initializer);
      }
    }
  }
  function unwrap(node, seen = new Set()) {
    if (!node) return null;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return unwrap(node.expression, seen);
    if (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !seen.has(node.text)
    ) {
      return unwrap(bindings.get(node.text), new Set([...seen, node.text]));
    }
    return node;
  }
  function literal(node) {
    node = unwrap(node);
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    return undefined;
  }
  function name(node) {
    if (!node) return null;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
    if (ts.isComputedPropertyName(node))
      return literal(node.expression) ?? null;
    return null;
  }
  function member(node) {
    if (!node) return '';
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node))
      return `${member(node.expression)}.${node.name.text}`;
    if (
      ts.isElementAccessExpression(node) &&
      typeof literal(node.argumentExpression) === 'string'
    ) {
      return `${member(node.expression)}.${literal(node.argumentExpression)}`;
    }
    return '';
  }
  function object(node, seen = new Set()) {
    node = unwrap(node);
    const fields = new Map();
    if (!node || !ts.isObjectLiteralExpression(node) || seen.has(node)) {
      if (node)
        issue(
          'unresolved-object',
          at(node),
          'Object is not a static literal or contains a cycle.',
        );
      return { fields, complete: false };
    }
    let complete = true;
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = object(prop.expression, new Set([...seen, node]));
        for (const [key, value] of spread.fields) fields.set(key, value);
        complete &&= spread.complete;
      } else {
        const key = name(prop.name);
        if (key === null) {
          complete = false;
          issue(
            'unresolved-property',
            at(prop),
            'Computed property cannot be determined statically.',
          );
        } else {
          fields.set(String(key), {
            node: prop,
            value: ts.isPropertyAssignment(prop)
              ? prop.initializer
              : ts.isShorthandPropertyAssignment(prop)
                ? prop.name
                : prop,
          });
        }
      }
    }
    return { fields, complete };
  }
  function fact(node) {
    const value = literal(node);
    return {
      value: value === undefined ? null : value,
      resolution: value === undefined ? 'dynamic' : 'literal',
      ...(value === undefined
        ? { expression: node?.getText(sf) ?? '<missing>' }
        : {}),
      source: at(node),
    };
  }
  const fieldFact = (prop) => fact(prop?.value);
  function walk(node, callback) {
    callback(node);
    ts.forEachChild(node, (child) => walk(child, callback));
  }
  return { ts, sf, at, unwrap, literal, member, object, fact, fieldFact, walk };
}

function collection(entries, source, basis, complete = true) {
  return {
    count: complete ? entries.length : null,
    observedCount: entries.length,
    complete,
    basis,
    source,
    entries,
  };
}

function resolveModule(root, importer, specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
  const base = resolve(dirname(importer), specifier.split(/[?#]/, 1)[0]);
  const paths = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.vue`,
    join(base, 'index.ts'),
  ];
  return diskEntry(
    root,
    paths.find((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    }) ?? base,
  );
}

function viewInventory(root, file, ast, kind, r) {
  const basis =
    kind === 'pages'
      ? 'Unique string case labels in getAppViewComponent; not the number of files or imports.'
      : 'Unique string IDs registered by ibiz.hub.config.view.set; type imports are excluded.';
  const entries = new Map();
  let complete = Boolean(ast);
  if (ast) {
    const { ts, sf, walk, literal, at, member, unwrap } = ast;
    const imports = new Map();
    for (const node of sf.statements) {
      if (ts.isImportDeclaration(node) && node.importClause?.name) {
        imports.set(node.importClause.name.text, literal(node.moduleSpecifier));
      }
    }
    const add = (id, node, modules) => {
      if (typeof id !== 'string') {
        complete = false;
        r.issue('dynamic-view-id', at(node), 'View ID is not a static string.');
        return;
      }
      if (!entries.has(id)) entries.set(id, { id, registrations: [] });
      entries.get(id).registrations.push({
        source: at(node),
        modules: modules.map((specifier) => ({
          specifier,
          local: resolveModule(root, file, specifier),
        })),
      });
    };
    if (kind === 'pages') {
      const functions = sf.statements.filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          node.name?.text === 'getAppViewComponent',
      );
      for (const func of functions) {
        let switches = 0;
        function visit(node) {
          if (node !== func && ts.isFunctionLike(node)) return;
          if (ts.isSwitchStatement(node)) {
            switches += 1;
            for (const clause of node.caseBlock.clauses) {
              if (!ts.isCaseClause(clause)) continue;
              const modules = [];
              walk(clause, (child) => {
                if (
                  ts.isCallExpression(child) &&
                  child.expression.kind === ts.SyntaxKind.ImportKeyword
                ) {
                  const specifier = literal(child.arguments[0]);
                  if (typeof specifier === 'string') modules.push(specifier);
                  else {
                    complete = false;
                    r.issue(
                      'dynamic-view-import',
                      at(child),
                      'View import is not a static string.',
                    );
                  }
                }
              });
              add(literal(clause.expression), clause, modules);
            }
            return;
          }
          ts.forEachChild(node, visit);
        }
        visit(func);
        if (!switches) {
          complete = false;
          r.issue(
            'unsupported-page-registry',
            at(func),
            'No page switch found; view count is unknown.',
          );
        }
      }
      if (
        !functions.length &&
        sf.statements.some(
          (node) =>
            !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node),
        )
      ) {
        complete = false;
        r.issue(
          'unsupported-page-registry',
          at(sf),
          'Expected a getAppViewComponent declaration.',
        );
      }
    } else {
      walk(sf, (node) => {
        if (
          !ts.isCallExpression(node) ||
          member(node.expression) !== 'ibiz.hub.config.view.set'
        )
          return;
        const model = unwrap(node.arguments[1]);
        const specifier =
          model && ts.isIdentifier(model) ? imports.get(model.text) : null;
        add(literal(node.arguments[0]), node, specifier ? [specifier] : []);
      });
      if (
        !entries.size &&
        sf.statements.some((node) => ts.isExportAssignment(node))
      ) {
        complete = false;
        r.issue(
          'unsupported-view-registry',
          at(sf),
          'Exported object is not a view.set registry.',
        );
      }
    }
  }
  return collection([...entries.values()], r.source(file), basis, complete);
}

function locationOf(value) {
  if (typeof value !== 'string') return 'unknown';
  if (!value) return 'empty';
  if (/^(?:https?|wss?):\/\//i.test(value) || value.startsWith('//')) {
    try {
      const url = new URL(value.startsWith('//') ? `http:${value}` : value);
      const host = url.hostname.toLowerCase();
      return host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '[::1]' ||
        /^127\./.test(host)
        ? 'loopback'
        : 'remote';
    } catch {
      return 'unknown';
    }
  }
  if (value.startsWith('/')) return 'same-origin';
  if (value.startsWith('.')) return 'relative';
  return 'namespace';
}

function addEndpoint(endpoints, role, fact, details = {}) {
  endpoints.push({
    role,
    ...fact,
    location:
      fact.resolution === 'literal' ? locationOf(fact.value) : 'unknown',
    ...details,
  });
}

function environmentInventory(file, ast, endpoints, r) {
  const configurations = [];
  if (ast) {
    const { ts, sf, walk, member, object, fieldFact, literal, at } = ast;
    walk(sf, (node) => {
      let value;
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        member(node.left) === 'window.Environment'
      )
        value = node.right;
      if (ts.isExportAssignment(node) && !node.isExportEquals)
        value = node.expression;
      if (!value) return;
      const parsed = object(value);
      const fields = {};
      for (const [key, prop] of parsed.fields) {
        if (ENV_FIELDS.has(key)) fields[key] = fieldFact(prop);
        if (ENDPOINT_ROLES[key]) {
          addEndpoint(endpoints, ENDPOINT_ROLES[key], fieldFact(prop), {
            ...(key === 'mqttUrl'
              ? {
                  enabled:
                    fields.enableMqtt?.value ??
                    literal(parsed.fields.get('enableMqtt')?.value) ??
                    null,
                }
              : {}),
          });
        }
        if (key === 'customParams' && typeof literal(prop.value) === 'string') {
          try {
            const params = JSON.parse(literal(prop.value));
            function urls(obj, path = '') {
              if (!obj || typeof obj !== 'object') return;
              for (const [param, child] of Object.entries(obj)) {
                const jsonPointer = `${path}/${pointer(param)}`;
                if (
                  typeof child === 'string' &&
                  ['remote', 'loopback'].includes(locationOf(child))
                ) {
                  addEndpoint(endpoints, 'custom-service', {
                    value: child,
                    resolution: 'literal',
                    source: {
                      ...at(prop.node),
                      jsonPointer,
                      embeddedJson: 'customParams',
                    },
                  });
                } else urls(child, jsonPointer);
              }
            }
            urls(params);
          } catch {
            r.issue(
              'invalid-custom-params',
              at(prop.node),
              'customParams is not valid JSON.',
            );
          }
        }
      }
      configurations.push({
        source: at(node),
        complete: parsed.complete,
        fields,
      });
    });
  }
  return { source: r.source(file), configurations };
}

function viteInventory(ast, endpoints, r) {
  const result = { settings: {}, proxies: [], aliases: [] };
  if (!ast) return result;
  const { ts, sf, object, unwrap, member, fieldFact, at } = ast;
  const exported = sf.statements.find(
    (node) => ts.isExportAssignment(node) && !node.isExportEquals,
  );
  let node = unwrap(exported?.expression);
  if (
    node &&
    ts.isCallExpression(node) &&
    member(node.expression) === 'defineConfig'
  ) {
    node = unwrap(node.arguments[0]);
  }
  if (node && ts.isArrowFunction(node)) {
    node = ts.isBlock(node.body)
      ? unwrap(
          node.body.statements.find((item) => ts.isReturnStatement(item))
            ?.expression,
        )
      : unwrap(node.body);
  }
  if (!node) return result;
  const config = object(node);
  result.complete = config.complete;
  const readFields = (fields, prefix, keys) => {
    for (const key of keys) {
      if (fields.has(key))
        result.settings[`${prefix}${key}`] = fieldFact(fields.get(key));
    }
  };
  readFields(config.fields, '', ['base', 'publicDir']);
  if (config.fields.has('server')) {
    const server = object(config.fields.get('server').value);
    readFields(server.fields, 'server.', [
      'host',
      'port',
      'strictPort',
      'https',
    ]);
    if (server.fields.has('proxy')) {
      const proxies = object(server.fields.get('proxy').value);
      for (const [route, prop] of proxies.fields) {
        const value = unwrap(prop.value);
        const options =
          value && ts.isObjectLiteralExpression(value)
            ? object(value).fields
            : null;
        const target = fieldFact(options?.get('target') ?? prop);
        result.proxies.push({ route, target, source: at(prop.node) });
        addEndpoint(endpoints, 'vite-proxy', target, { route });
      }
    }
  }
  if (config.fields.has('resolve')) {
    const resolveFields = object(config.fields.get('resolve').value).fields;
    if (resolveFields.has('alias')) {
      const aliases = object(resolveFields.get('alias').value);
      for (const [name, prop] of aliases.fields)
        result.aliases.push({ name, ...fieldFact(prop) });
    }
  }
  return result;
}

function mainInventory(file, ast, endpoints, root, r) {
  const entries = [];
  const calls = [];
  const localImports = [];
  let complete = Boolean(ast);
  if (ast) {
    const { ts, sf, walk, member, unwrap, object, fieldFact, literal, at } =
      ast;
    walk(sf, (node) => {
      if (
        ts.isImportDeclaration(node) &&
        typeof literal(node.moduleSpecifier) === 'string'
      ) {
        const specifier = literal(node.moduleSpecifier);
        if (specifier.startsWith('.'))
          localImports.push({
            specifier,
            source: at(node),
            local: resolveModule(root, file, specifier),
          });
      }
      if (!ts.isCallExpression(node)) return;
      const name = member(node.expression);
      if (name === 'runApp') calls.push({ callee: name, source: at(node) });
      if (name !== 'registerMicroApps' && !name.endsWith('.registerMicroApps'))
        return;
      const apps = unwrap(node.arguments[0]);
      if (!apps || !ts.isArrayLiteralExpression(apps)) {
        complete = false;
        r.issue(
          'dynamic-micro-apps',
          at(node),
          'Micro-app list is not a static array.',
        );
        return;
      }
      for (const app of apps.elements) {
        const parsed = object(app);
        complete &&= parsed.complete;
        const fields = {};
        for (const key of ['name', 'entry', 'baseUrl', 'pluginBaseUrl']) {
          if (parsed.fields.has(key))
            fields[key] = fieldFact(parsed.fields.get(key));
        }
        entries.push({ fields, source: at(app), complete: parsed.complete });
        if (fields.entry)
          addEndpoint(endpoints, 'micro-app', fields.entry, {
            app: fields.name?.value,
          });
        if (fields.pluginBaseUrl)
          addEndpoint(endpoints, 'micro-app-plugins', fields.pluginBaseUrl, {
            app: fields.name?.value,
            relativeTo: fields.entry ?? null,
          });
      }
    });
  }
  return {
    calls,
    localImports,
    microApps: collection(
      entries,
      r.source(file),
      'Objects passed to registerMicroApps; comments are excluded.',
      complete,
    ),
  };
}

function environmentBindings(file, r) {
  const input = r.read(file, 'environment-key-map');
  if (!input) return [];
  const bindings = [];
  input.text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;
    const colon = trimmed.indexOf(':');
    if (colon < 1) {
      r.issue(
        'invalid-environment-binding',
        { ...input.source, line: index + 1 },
        'Expected an environment key:variable mapping.',
      );
      return;
    }
    bindings.push({
      key: trimmed.slice(0, colon).trim(),
      variable: trimmed.slice(colon + 1).trim(),
      source: { ...input.source, line: index + 1 },
    });
  });
  input.entry.status = 'parsed';
  return bindings;
}

function resourceInventory(root, directory, r, endpoints, environment) {
  const publicRoot = join(directory, 'public');
  const directories = [
    'public',
    'public/assets',
    'public/extras',
    'public/plugins',
    'public/model',
  ].map((path) => diskEntry(root, join(directory, path)));
  const importFile = join(publicRoot, 'extras/json/system-import.json');
  const map = r.json(importFile);
  const references = [];
  if (map) {
    for (const group of ['imports', 'styles']) {
      for (const [name, value] of Object.entries(map.value[group] ?? {})) {
        const source = {
          ...map.source,
          jsonPointer: `/${group}/${pointer(name)}`,
        };
        if (typeof value !== 'string') {
          r.issue(
            'invalid-resource-reference',
            source,
            'Expected a string resource URL.',
          );
          continue;
        }
        const location = locationOf(value);
        if (['remote', 'loopback'].includes(location)) {
          addEndpoint(endpoints, 'system-resource', {
            value,
            resolution: 'literal',
            source,
          });
        } else {
          const pathname = value.split(/[?#]/, 1)[0];
          references.push({
            name,
            group,
            value,
            source,
            local: diskEntry(
              root,
              value.startsWith('/')
                ? resolve(publicRoot, `.${pathname}`)
                : resolve(dirname(importFile), pathname),
            ),
          });
        }
      }
    }
  }
  const configuredPaths = [];
  for (const config of environment.configurations) {
    for (const key of ['pluginBaseUrl', 'assetsUrl', 'favicon']) {
      const fact = config.fields[key];
      if (
        !fact ||
        !['relative', 'same-origin'].includes(locationOf(fact.value))
      )
        continue;
      configuredPaths.push({
        key,
        ...fact,
        local: diskEntry(
          root,
          resolve(publicRoot, `./${fact.value.split(/[?#]/, 1)[0]}`),
        ),
        basis:
          'Resolved relative to the example public root, not a micro-app host.',
      });
    }
  }
  return {
    directories,
    configuredPaths,
    systemResources: collection(
      references,
      r.source(importFile),
      'Local imports/styles declared in the SystemJS import map. Only public files are checked; build/dev generated assets are not inferred.',
      Boolean(map),
    ),
  };
}

function workspaceInventory(root, parser) {
  const hub = join(root, 'ibiz-app-hub');
  const r = reader(root, parser.ts);
  const file = join(hub, 'pnpm-workspace.yaml');
  const input = r.read(file, 'yaml');
  const packages = new Map();
  let complete = Boolean(input);
  if (input) {
    try {
      const yaml = parser.require('yaml');
      const glob = parser.require('fast-glob');
      const document = yaml.parseDocument(input.text);
      if (document.errors.length) throw document.errors[0];
      const patterns = document.toJS()?.packages;
      if (
        !Array.isArray(patterns) ||
        patterns.some((value) => typeof value !== 'string')
      ) {
        throw new Error('Expected packages to be an array of workspace globs.');
      }
      input.entry.status = 'parsed';
      for (const path of glob
        .sync(patterns, {
          cwd: hub,
          onlyDirectories: true,
          followSymbolicLinks: false,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
        .sort()) {
        const manifestFile = join(hub, path, 'package.json');
        if (!existsSync(manifestFile)) continue;
        const manifest = r.json(manifestFile);
        if (!manifest || typeof manifest.value?.name !== 'string') {
          complete = false;
          continue;
        }
        const name = manifest.value.name;
        if (!packages.has(name)) packages.set(name, []);
        const sourceRoots = [
          'src',
          ...['style', 'styles'].filter(
            (dir) =>
              Array.isArray(manifest.value.files) &&
              manifest.value.files.includes(dir),
          ),
        ];
        const sourceFile = glob
          .sync(
            sourceRoots.map(
              (dir) => `${dir}/**/*.{ts,tsx,js,jsx,mjs,cjs,vue,css,scss}`,
            ),
            {
              cwd: join(hub, path),
              onlyFiles: true,
              followSymbolicLinks: false,
              ignore: ['**/node_modules/**', '**/*.d.ts'],
            },
          )
          .sort()[0];
        packages.get(name).push({
          name,
          manifest: manifest.source,
          workspacePatternSource: input.source,
          sourceDirectories: sourceRoots.map((dir) =>
            diskEntry(root, join(hub, path, dir)),
          ),
          sourceEvidence: sourceFile
            ? diskEntry(root, join(hub, path, sourceFile))
            : null,
          sourceSearchBasis:
            'Implementation files in src, plus style/styles directories explicitly listed in package.json files; .d.ts files are excluded.',
          watchScript: manifest.value.scripts?.watch ?? null,
        });
      }
    } catch (error) {
      complete = false;
      input.entry.status = 'invalid';
      r.issue('workspace-scan-unavailable', input.source, error.message);
    }
  }
  return {
    packages,
    complete,
    inputs: r.inputs,
    issues: r.issues,
    source: r.source(file),
  };
}

function workspaceDependencies(root, pkg, workspace) {
  const entries = [];
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, version] of Object.entries(pkg?.value?.[section] ?? {})) {
      if (typeof version !== 'string' || !version.startsWith('workspace:'))
        continue;
      const suffix = version.slice('workspace:'.length);
      const aliasAt = suffix.lastIndexOf('@');
      const packageName = aliasAt > 0 ? suffix.slice(0, aliasAt) : name;
      let candidates = workspace.packages.get(packageName) ?? [];
      if (suffix.startsWith('.')) {
        const target = slash(
          relative(
            root,
            resolve(root, dirname(pkg.source.file), suffix, 'package.json'),
          ),
        );
        candidates = [...workspace.packages.values()]
          .flat()
          .filter((candidate) => candidate.manifest.file === target);
      }
      entries.push({
        name,
        version,
        section,
        source: { ...pkg.source, jsonPointer: `/${section}/${pointer(name)}` },
        candidates,
        hasLocalSource: candidates.some(
          (candidate) => candidate.sourceEvidence?.exists,
        )
          ? true
          : workspace.complete
            ? false
            : null,
      });
    }
  }
  return {
    ...collection(
      entries,
      pkg?.source ?? null,
      'Direct workspace: declarations across dependency sections.',
      Boolean(pkg),
    ),
    hasDeclarations: pkg ? entries.length > 0 : null,
    hasLocalSource: entries.some((entry) => entry.hasLocalSource)
      ? true
      : pkg && workspace.complete
        ? false
        : null,
    resolutionComplete: workspace.complete,
    limitation:
      'Source presence and watch scripts do not establish installed linking, successful builds or source-debug acceptance.',
  };
}

export function generateInventory({ root = SCRIPT_ROOT } = {}) {
  root = resolve(root);
  const parser = loadTypeScript(root);
  const workspace = workspaceInventory(root, parser);
  const examples = EXAMPLES.map((name) => {
    const directory = join(root, 'ibiz-app-hub/examples', name);
    const r = reader(root, parser.ts);
    const pkg = r.json(join(directory, 'package.json'));
    const pagesFile = join(directory, 'src/publish/pages/index.ts');
    const viewsFile = join(directory, 'src/publish/model/view-config/index.ts');
    const pages = viewInventory(root, pagesFile, r.code(pagesFile), 'pages', r);
    const viewConfig = viewInventory(
      root,
      viewsFile,
      r.code(viewsFile),
      'config',
      r,
    );
    const endpoints = [];
    const environmentFile = join(
      directory,
      'public/environments/environment.js',
    );
    const environment = environmentInventory(
      environmentFile,
      r.code(environmentFile),
      endpoints,
      r,
    );
    const mainFile = join(directory, 'src/main.ts');
    const main = mainInventory(mainFile, r.code(mainFile), endpoints, root, r);
    const vite = viteInventory(
      r.code(join(directory, 'vite.config.ts')),
      endpoints,
      r,
    );
    const bindings = environmentBindings(
      join(directory, 'environment.config'),
      r,
    );
    const localResources = resourceInventory(
      root,
      directory,
      r,
      endpoints,
      environment,
    );
    const scripts = Object.entries(pkg?.value?.scripts ?? {}).map(
      ([key, command]) => ({
        name: key,
        command,
        source: { ...pkg.source, jsonPointer: `/scripts/${pointer(key)}` },
      }),
    );
    return {
      name,
      directory: diskEntry(root, directory),
      acceptance: { ...ACCEPTANCE },
      package: pkg
        ? {
            name: pkg.value.name ?? null,
            version: pkg.value.version ?? null,
            source: pkg.source,
          }
        : null,
      entry: {
        html: diskEntry(root, join(directory, 'index.html')),
        main: diskEntry(root, mainFile),
        scripts,
        bootstrapCalls: main.calls,
        vite,
      },
      views: { pages, viewConfig },
      environment: { ...environment, bindings },
      localResources: { ...localResources, mainImports: main.localImports },
      dependencies: {
        endpoints,
        microApps: main.microApps,
        workspace: workspaceDependencies(root, pkg, workspace),
      },
      inputs: r.inputs,
      issues: r.issues,
    };
  });
  return {
    schemaVersion: 1,
    root,
    acceptance: { ...ACCEPTANCE },
    parser: { name: 'typescript', version: parser.ts.version },
    scope: {
      examples: EXAMPLES.map((name) => `ibiz-app-hub/examples/${name}`),
      method:
        'Targeted AST/JSON/config parsing and filesystem existence checks; no repository-wide text matching.',
      limitations: [
        'Counts are static declarations, not runnable or passing examples.',
        'Unknown counts are null; observedCount is a lower bound backed by entries and source locations.',
        'Only the listed inputs are scanned. Dynamic expressions, imported config and runtime overrides are not executed.',
        'Conventional index.html/src/main.ts entries and public resource paths are existence observations, not browser verification.',
        'Endpoints are configured values, not reachability checks; relative micro-app resources belong to that micro-app entry.',
      ],
    },
    workspace: {
      source: workspace.source,
      complete: workspace.complete,
      inputs: workspace.inputs,
      issues: workspace.issues,
    },
    examples,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(
      'Usage: node scripts/harness-example-inventory.mjs [--root WORKSPACE] [--output FILE|-]\n' +
        'Read-only static inventory. Defaults to JSON on stdout. Existing output files are never overwritten.',
    );
    return;
  }
  const inventory = generateInventory({ root: values.root });
  const json = `${JSON.stringify(inventory, null, 2)}\n`;
  if (!values.output || values.output === '-') process.stdout.write(json);
  else {
    const output = resolve(values.output);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, json, { flag: 'wx' });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`Example inventory failed: ${error.message}`);
    process.exitCode = 1;
  }
}
