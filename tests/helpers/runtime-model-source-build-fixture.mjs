import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const packagePath = 'modelingweb/local-plugins/runtime-model';
export const realPackage = join(workspace, packagePath);
const originalRoot = join(workspace,
  'plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/node_modules/.pnpm/' +
  '@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/' +
  '@ibiz-template-plugin/runtime-model');
const tags = ['ibiz-model-runtime', 'ibiz-model-runtime-list', 'loading-mask', 'loading-panel'];
const members = {
  'ibiz-model-runtime': {
    url: [8], headers: [8], parentKey: [1, 'parent-key'],
    configBaseUrl: [1, 'config-base-url'], breadcrumbHoverIndex: [32],
  },
  'loading-mask': { visible: [32], show: [64], hide: [64] },
  'ibiz-model-runtime-list': {
    controller: [16], items: [16], index: [2], parent: [8], list: [32],
  },
  'loading-panel': {
    defaultShow: [4, 'default-show'], visible: [32], message: [32], show: [64], hide: [64],
  },
};

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function write(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, value);
}

export function json(path, value) { write(path, `${JSON.stringify(value, null, 2)}\n`); }
export function mutate(path, change) {
  const value = JSON.parse(fs.readFileSync(path));
  change(value);
  json(path, value);
}

// Controlled receipt fixtures only; no tool execution or native evidence.
export function fixture(t, { revision = 'baseline' } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'runtime-model-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const selectedPath = revision === 'fixed' ? `${packagePath}-next` : packagePath;
  const selectedPackage = join(workspace, selectedPath);
  const packageRoot = join(root, selectedPath);
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const name of ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'stencil.config.ts']) {
    fs.cpSync(join(selectedPackage, name), join(packageRoot, name), {
      recursive: true,
      filter: path => !path.endsWith('/components.d.ts'),
    });
  }
  const lock = JSON.parse(fs.readFileSync(join(selectedPackage, 'package-lock.json')));
  for (const path of Object.keys(lock.packages).filter(Boolean)) {
    const destination = join(packageRoot, path);
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(join(realPackage, path, 'package.json'), join(destination, 'package.json'));
    if (path === 'node_modules/typescript') {
      fs.rmSync(destination, { recursive: true });
      fs.symlinkSync(fs.realpathSync(join(realPackage, path)), destination, 'dir');
    }
    if (path === 'node_modules/@stencil/core') {
      write(join(destination, 'bin/stencil'), '// fixture tool; spawn is mocked\n');
      write(join(destination, 'compiler/stencil.js'), '// fixture compiler implementation\n');
    }
    if (path === 'node_modules/ramda') write(join(destination, 'src/index.js'), 'export {};\n');
    if (path === 'node_modules/@stencil/store') write(join(destination, 'dist/index.js'), 'export {};\n');
  }
  const output = join(root, '.artifacts/runtime-model-source-build/fixture');
  fs.cpSync(originalRoot, join(root, relative(workspace, originalRoot)), { recursive: true });
  return { workspace: root, packageRoot, output, options: { workspace: root, output, revision } };
}

function outputs(root) {
  const manifest = JSON.parse(fs.readFileSync(join(root, 'package.json')));
  const bundles = [['ibiz-model-runtime_4', tags.map(tag => [0, tag,
    manifest.version === '0.2.2-local.2' && tag === 'ibiz-model-runtime-list'
      ? { ...members[tag], activeData: [32] } : members[tag]])]];
  write(join(root, 'dist/esm/loader.js'),
    `import { bootstrapLazy } from './runtime.js';\n` +
    `export const defineCustomElements = () => bootstrapLazy(${JSON.stringify(bundles)});\n`);
  write(join(root, 'dist/esm/runtime.js'), 'export function bootstrapLazy() {}\n');
  write(join(root, 'loader/index.js'), "export * from '../dist/esm/polyfills/index.js';\n" +
    "export * from '../dist/esm/loader.js';\n");
  write(join(root, 'dist/esm/polyfills/index.js'), 'export function applyPolyfills() {}\n');
  write(join(root, 'loader/index.d.ts'), 'export declare function defineCustomElements(): void;\n');
  json(join(root, 'loader/package.json'), { module: './index.js', typings: './index.d.ts' });
  write(join(root, 'dist/esm/ibiz-model-runtime_4.entry.js'), 'export const built = true;\n');
  write(join(root, 'dist/types/components.d.ts'), 'export interface Components {}\n');
  for (const tag of tags) {
    write(join(root, `dist/types/components/${tag}/${tag}.d.ts`), 'export class Component {}\n');
    write(join(root, `dist/collection/components/${tag}/${tag}.css`), `${tag} { display: block; }\n`);
  }
}

export function fakeBuild(t, change = () => {}) {
  const calls = [];
  const mock = t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
    calls.push({ executable, args, options });
    const build = args.includes('build');
    if (build) outputs(options.cwd);
    const result = { status: 0, signal: null, stdout: 'fixture command output\n', stderr: '' };
    change({ executable, args, options, build, result, calls });
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  return calls;
}

export function updateReport(result, change) {
  mutate(result.reportPath, change);
  write(join(dirname(result.reportPath), 'report.sha256'),
    `${hash(fs.readFileSync(result.reportPath))}\n`);
}
