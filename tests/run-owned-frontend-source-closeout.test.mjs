import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareFrontendOutputs, frontendSourcePackages, ownedFrontendOutput, sourceTree,
} from '../run-owned-frontend-source-closeout.mjs';
import { frontendOutputsMatchReceipt, inspectBoundSystemModule } from '../verify-owned-frontend-source-closeout.mjs';

test('complete framework build selects seven canonical source packages and a new direct private output', () => {
  assert.equal(Object.keys(frontendSourcePackages).length, 7);
  assert.equal(frontendSourcePackages.runtime, 'packages/runtime');
  assert.equal(frontendSourcePackages['vue3-components'], 'components/ibiz-next-vue3');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-closeout-policy-'));
  try {
    fs.mkdirSync(path.join(root, '.artifacts'));
    assert.equal(ownedFrontendOutput('.artifacts/d01-frontend-source-unit', root),
      path.join(root, '.artifacts/d01-frontend-source-unit'));
    for (const output of ['plm-web/dist', '.artifacts/subdir/d01-frontend-source-unit',
      '.artifacts/../dist', '.artifacts/not-owned']) {
      assert.throws(() => ownedFrontendOutput(output, root));
    }
    fs.mkdirSync(path.join(root, '.artifacts/d01-frontend-source-unit'));
    assert.throws(() => ownedFrontendOutput('.artifacts/d01-frontend-source-unit', root));
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('source snapshots distinguish current source bytes and reject symbolic inputs instead of copying live caches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-closeout-inputs-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/index.ts'), 'export const value = 1;\n');
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/cached.js'), 'stale');
    const before = sourceTree(root);
    assert.equal(before.files, 1);
    fs.writeFileSync(path.join(root, 'src/index.ts'), 'export const value = 2;\n');
    assert.notEqual(sourceTree(root).fingerprint, before.fingerprint);
    fs.symlinkSync(path.join(root, 'src/index.ts'), path.join(root, 'src/link.ts'));
    assert.throws(() => sourceTree(root), /symlink/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('reproducibility requires the same complete output file set and actual bytes', () => {
  const first = { fingerprint: 'first', entries: [{ path: 'core/index.js', bytes: 2, sha256: 'a' }] };
  assert.equal(compareFrontendOutputs(first, { ...first }).bytewise, true);
  assert.equal(compareFrontendOutputs(first, { fingerprint: 'other',
    entries: [{ path: 'core/index.js', bytes: 2, sha256: 'b' }] }).bytewise, false);
  assert.deepEqual(compareFrontendOutputs(first, { fingerprint: 'empty', entries: [] }).differences,
    ['core/index.js']);
});

test('matching two current trees cannot hide a file or directory removed or changed in both after the build', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-recorded-delivery-'));
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  const inventory = directory => sourceTree(directory, { ignore: new Set() });
  try {
    for (const directory of [first, second]) {
      fs.mkdirSync(path.join(directory, 'lib'), { recursive: true });
      fs.mkdirSync(path.join(directory, 'dist'));
      fs.writeFileSync(path.join(directory, 'lib/index.js'), 'recorded declaration companion');
      fs.writeFileSync(path.join(directory, 'dist/index.js'), 'recorded distribution');
    }
    const recorded = compareFrontendOutputs(inventory(first), inventory(second));
    assert.equal(frontendOutputsMatchReceipt(recorded, recorded), true);
    for (const directory of [first, second]) fs.rmSync(path.join(directory, 'lib'), { recursive: true });
    const missing = compareFrontendOutputs(inventory(first), inventory(second));
    assert.equal(missing.bytewise, true);
    assert.equal(frontendOutputsMatchReceipt(missing, recorded), false);
    for (const directory of [first, second]) {
      fs.mkdirSync(path.join(directory, 'lib'));
      fs.writeFileSync(path.join(directory, 'lib/index.js'), 'recorded declaration companion');
      fs.writeFileSync(path.join(directory, 'dist/index.js'), 'same later change in both');
    }
    const changed = compareFrontendOutputs(inventory(first), inventory(second));
    assert.equal(changed.bytewise, true);
    assert.equal(frontendOutputsMatchReceipt(changed, recorded), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('a copied SystemJS entry must match its recorded bytes and contain a real literal module registration', () => {
  const require = createRequire(path.resolve(import.meta.dirname, '../../ibiz-app-hub/package.json'));
  const ts = require('typescript');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const bytes = Buffer.from('System.register(["real-runtime", "./chunk.js"], function () { return {}; });');
  assert.deepEqual(inspectBoundSystemModule(ts, 'index.system.js', bytes, hash(bytes)).dependencies,
    ['real-runtime', './chunk.js']);
  assert.throws(() => inspectBoundSystemModule(ts, 'index.system.js', Buffer.from('changed'), hash(bytes)),
    /differ from the producer binding/);
  for (const text of ['', 'console.log("no registration");']) {
    const empty = Buffer.from(text);
    assert.throws(() => inspectBoundSystemModule(ts, 'index.system.js', empty, hash(empty)),
      /must contain System.register/);
  }
  const dynamic = Buffer.from('System.register([dynamicName], function () { return {}; });');
  assert.throws(() => inspectBoundSystemModule(ts, 'index.system.js', dynamic, hash(dynamic)));
});
