import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { waitForRuntimeModelScrollEnd } from './runtime-model-test-support.mjs';

const states = [
  ['missing content', null, false],
  ['hidden content', { clientWidth: 0, scrollWidth: 810, scrollLeft: 810 }, false],
  ['unmeasured content', { clientWidth: 390, scrollWidth: 0, scrollLeft: -390 }, false],
  ['mobile animation midpoint', { clientWidth: 390, scrollWidth: 810, scrollLeft: 300 }, false],
  ['mobile endpoint', { clientWidth: 390, scrollWidth: 810, scrollLeft: 420 }, true],
  ['mobile nested endpoint', { clientWidth: 390, scrollWidth: 1620, scrollLeft: 1230 }, true],
  ['desktop without overflow', { clientWidth: 1440, scrollWidth: 1440, scrollLeft: 0 }, true],
  ['fractional endpoint', { clientWidth: 390, scrollWidth: 810, scrollLeft: 419.5 }, true],
  ['not at fractional endpoint', { clientWidth: 390, scrollWidth: 810, scrollLeft: 418 }, false],
];

for (const [name, content, expected] of states) {
  test(`browser scroll settlement requires ${name}`, async () => {
    let calls = 0;
    await waitForRuntimeModelScrollEnd({
      async waitForFunction(predicate) {
        calls++;
        const actual = runInNewContext(`(${predicate.toString()})()`, {
          document: {
            querySelector(selector) {
              assert.equal(selector, '#runtime .ibiz-model-runtime-content');
              return content;
            },
          },
        });
        assert.equal(actual, expected);
      },
    });
    assert.equal(calls, 1);
  });
}

test('scroll settlement propagates a browser timeout without accepting an intermediate position', async () => {
  const timeout = new Error('Timed out waiting for the actual horizontal endpoint');
  await assert.rejects(waitForRuntimeModelScrollEnd({
    async waitForFunction() { throw timeout; },
  }), error => error === timeout);
});

test('differential snapshots retain scroll positions and run settlement on both implementation sides', () => {
  const browser = fs.readFileSync(
    new URL('./runtime-model-reconstruction.browser.mjs', import.meta.url), 'utf8',
  );
  assert.match(browser, /scrollLeft: Math\.round\(content\.scrollLeft\)/);
  assert.match(browser, /for \(const side of \['original', 'recovered'\]\)/);
  assert.match(browser, /assert\.deepEqual\(recovered\[key\], original\[key\]/);
  assert.equal(browser.match(/await waitForRuntimeModelScrollEnd\(page\)/g)?.length, 4);
});

test('parent reload waits for the actual empty render before delivering replacement children', () => {
  const browser = fs.readFileSync(
    new URL('./runtime-model-reconstruction.browser.mjs', import.meta.url), 'utf8',
  );
  assert.match(browser, /params\.srfparentkey === 'parent-second'/);
  assert.match(browser, /await new Promise\(done => pendingRootChildren\.set\(key, done\)\)/);
  assert.match(browser, /document\.querySelectorAll\('#runtime ibiz-model-runtime-list'\)\.length === 0/);
  assert.match(browser, /finally \{\s*fixture\.releaseRootChildren\(key\)/);
  assert.match(browser, /window\.fixture\.mounted\.some\(event =>\s*event\.stage === 'parent-watcher'/);
  assert.match(browser, /'attributeCoercion', 'parentReloadBoundary'/);
});

test('initial event stage is assigned before mounting either implementation', () => {
  const browser = fs.readFileSync(
    new URL('./runtime-model-reconstruction.browser.mjs', import.meta.url), 'utf8',
  );
  const fixtureIndex = browser.indexOf("window.fixture={ready:false,stage:'initial',mounted:[]");
  const appendIndex = browser.indexOf("document.getElementById('fixture').append(runtime)");
  assert.ok(fixtureIndex > 0 && fixtureIndex < appendIndex);
  assert.doesNotMatch(browser, /stage:'bootstrap'/);
  assert.doesNotMatch(browser, /window\.fixture\.stage = 'initial'/);
});

test('fixed-revision scroll endpoint is required on mount, not on a reused cached column', () => {
  const browser = fs.readFileSync(
    new URL('./runtime-model-next.browser.mjs', import.meta.url), 'utf8',
  );
  assert.match(browser, /await waitForRows\(page, \[30, 2\]\);\s*await waitForRuntimeModelScrollEnd\(page\)/);
  assert.match(browser, /result\.selection = \{ switched: true, cacheRevisited: true, activeRows: 1 \};\s*await screenshot/);
  assert.equal(browser.match(/await waitForRuntimeModelScrollEnd\(page\)/g)?.length, 3);
});
