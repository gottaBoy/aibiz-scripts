import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePromotionBuild } from '../promote-standalone-uaa-source.mjs';

const selectedHash = 'e3e4b175db046a221621625b38515213a28156b613813fe1e19bd4c5d320af64';
function selectedFixture() {
  const inventory = { fingerprint: 'a'.repeat(64), entries: [{ path: 'Example.java' }] };
  return {
    contract: 'standalone-uaa-recovered-source-compilation-experiment-v1',
    status: 'recovered-source-built-focused-fixture-tested-not-native-accepted',
    errors: [], nativeAcceptance: false, sourceClosureVerified: false,
    javaCompilationVerified: true, compilerBuildInDockerVerified: true,
    focusedSourceContractVerified: true,
    packages: ['uaa-core', 'uaa-user', 'uaa-api'].map(module => ({ module })),
    sourceInputs: { before: structuredClone(inventory), after: structuredClone(inventory) },
    toolInputs: { before: structuredClone(inventory), after: structuredClone(inventory) },
  };
}

test('selected historical receipt can authorize source copying, not native acceptance', () => {
  const fixture = selectedFixture();
  validatePromotionBuild(fixture, selectedHash);
  assert.equal(fixture.nativeAcceptance, false);
  assert.equal(fixture.sourceClosureVerified, false);
});

test('promotion rejects another receipt hash even when its declared fields match', () => {
  assert.throws(() => validatePromotionBuild(selectedFixture(), 'b'.repeat(64)));
});

for (const [name, change] of [
  ['failed build', value => value.status = 'failed'],
  ['build errors', value => value.errors.push('failure')],
  ['missing compilation', value => value.javaCompilationVerified = false],
  ['missing Docker compilation', value => value.compilerBuildInDockerVerified = false],
  ['missing focused regression', value => value.focusedSourceContractVerified = false],
  ['native claim', value => value.nativeAcceptance = true],
  ['full closure claim', value => value.sourceClosureVerified = true],
  ['wrong source contract', value => value.contract = 'legacy-cloud-uaa'],
  ['missing business module', value => value.packages.pop()],
  ['source drift', value => value.sourceInputs.after.fingerprint = 'c'.repeat(64)],
  ['tool drift', value => value.toolInputs.after.fingerprint = 'c'.repeat(64)],
]) {
  test(`promotion rejects ${name}`, () => {
    const fixture = selectedFixture();
    change(fixture);
    assert.throws(() => validatePromotionBuild(fixture, selectedHash));
  });
}
