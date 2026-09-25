import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../build-modeling-arm64.sh', import.meta.url),
  'utf8',
);

test('Modeling arm64 build supports forced custom image builds and verifies architecture', () => {
  assert.match(source, /AIBIZ_MODELING_IMAGE:-aibiz\/modelingservice-arm64:local/);
  assert.match(source, /--force\) FORCE=true/);
  assert.doesNotMatch(source, /Using external modeling image/);
  assert.match(source, /if \[ "\$FORCE" != true \] && docker image inspect/);
  assert.match(source, /docker build --platform linux\/arm64 -t "\$MODELING_IMAGE"/);
  assert.match(source, /docker image inspect "\$MODELING_IMAGE" --format '{{\.Architecture}} {{\.Os}}'/);
  assert.match(source, /"\$architecture" != "arm64 linux"/);
});
