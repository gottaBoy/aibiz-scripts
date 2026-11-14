import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { candidateBuildEnvironment } from '../../modelingweb/app/scripts/assemble-source-candidate.mjs';

const require = createRequire(fileURLToPath(new URL('../../modelingweb/app/package.json', import.meta.url)));
const { build } = require('vite');

async function compile(define) {
  const id = fileURLToPath(new URL('./candidate-production-probe.js', import.meta.url));
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'silent', mode: 'production', define,
    plugins: [{
      name: 'candidate-production-test-input',
      resolveId: source => source === id ? id : undefined,
      load: source => source === id
        ? 'export const environment = process.env.NODE_ENV; export const browserHasProcess = typeof process !== "undefined";'
        : undefined,
    }],
    build: {
      write: false, minify: false,
      lib: { entry: id, formats: ['system'], fileName: () => 'probe.js' },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(row => row.output);
  const chunks = outputs.filter(row => row.type === 'chunk');
  assert.equal(chunks.length, 1);
  return chunks[0].code;
}

function execute(code) {
  const exports = {};
  vm.runInNewContext(code, {
    System: {
      register(dependencies, declaration) {
        assert.deepEqual(Array.from(dependencies), []);
        declaration((name, value) => {
          if (typeof name === 'object') Object.assign(exports, name);
          else exports[name] = value;
        }).execute();
      },
    },
  });
  return exports;
}

test('real Vite library output runs without a browser process shim only with the bound production define', async () => {
  const unconfigured = await compile({});
  assert.throws(() => execute(unconfigured), /process is not defined/);
  assert.deepEqual(candidateBuildEnvironment, {
    mode: 'production', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const configured = await compile({ ...candidateBuildEnvironment.define });
  assert.deepEqual(execute(configured), { environment: 'production', browserHasProcess: false });
});
