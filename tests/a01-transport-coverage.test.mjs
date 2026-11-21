import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  A01_TRANSPORT_SOURCE_PATHS, classifyA01TransportCoverage, readA01TransportSources,
  reviewA01TransportSources,
} from '../a01-transport-coverage.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { createNativeMatrix } from '../prepare-run-owned-native-nonadmin-matrix.mjs';
import { a01InvalidRootRequest, createA01RootPlan } from '../owned-a01-root-http.mjs';

const sources = readA01TransportSources();
const fixture = scenario => createFixture({ runId: 'abcdef012345', scenario, modelVersion: 816,
  uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36) }).manifest;

for (const scenario of ['same-center', 'two-center']) {
  test(`${scenario}: classify all real 84 cases without replacing expected outcomes or claiming execution`, () => {
    const manifest = fixture(scenario);
    const before = structuredClone(manifest);
    const matrix = createNativeMatrix(manifest);
    const report = classifyA01TransportCoverage(manifest, sources);
    assert.deepEqual(report.rows.map(row => row.canonicalCase), matrix.invalidRootCases);
    assert.deepEqual(report.counts, {
      originalLogicalCases: 84, existingNativeParentHttp: 36,
      publishedParentlessHttpCandidates: 12, nativeJavaTypedBoundaryRequired: 36,
      stillBlockedInExistingHttpRunner: 48, matrixCaseExecutionsProven: 0,
      default: { supportedHttp: 36, blocked: 48, parentlessAbsentSelected: false },
      selected: { includeParentlessAbsent: false, supportedHttp: 36, blocked: 48,
        parentlessAbsentSelected: false },
    });
    assert.deepEqual(manifest, before);
    assert.equal(new Set(report.rows.map(row => row.canonicalCase.id)).size, 84);
    for (const row of report.rows) {
      assert.equal(row.executionClaimed, false);
      assert.deepEqual(row.canonicalCase.expected, {
        authorization: 'deny-or-bounded-input-rejection', physicalMutation: 'neither-schema',
      });
      assert.equal(row.canonicalCase.executionStatus, 'not-run');
      assert.equal(row.canonicalCase.bothDatabaseProjectionsRequired, true);
    }
    for (const key of ['nativeAcceptance', 'permissionAcceptance', 'fullA01Acceptance', 'typedRootHTTPAcceptance']) {
      assert.equal(report[key], false);
    }
    assert.throws(() => { report.counts.matrixCaseExecutionsProven = 84; });
    assert.throws(() => { report.rows[0].canonicalCase.expected.authorization = 'allow'; });
  });
}

test('current HTTP requests remain exactly the existing 36 encoded parent String requests', () => {
  const manifest = fixture('two-center');
  const report = classifyA01TransportCoverage(manifest, sources);
  const plan = createA01RootPlan(manifest);
  for (const row of report.rows) {
    const existing = plan.invalidRootCases.find(item => item.id === row.canonicalCase.id);
    assert.deepEqual(row.currentRequest, a01InvalidRootRequest(manifest, existing));
    if (!row.currentRunnerSupportsDispatch) continue;
    assert.equal(typeof row.canonicalCase.appContext.PSDEVSLNSYS, 'string');
    assert.equal(decodeURIComponent(row.currentRequest.path.split('/psdevslnsys/')[1].split('/')[0]),
      row.canonicalCase.appContext.PSDEVSLNSYS);
  }
});

test('opt-in parentless mode selects 12 absent cases while preserving 36 typed blockers and zero execution claims', () => {
  const manifest = fixture('two-center');
  const options = { includeParentlessAbsent: true };
  const report = classifyA01TransportCoverage(manifest, sources, options);
  assert.deepEqual(report.counts, {
    originalLogicalCases: 84, existingNativeParentHttp: 36,
    publishedParentlessHttpCandidates: 12, nativeJavaTypedBoundaryRequired: 36,
    stillBlockedInExistingHttpRunner: 36, matrixCaseExecutionsProven: 0,
    default: { supportedHttp: 36, blocked: 48, parentlessAbsentSelected: false },
    selected: { includeParentlessAbsent: true, supportedHttp: 48, blocked: 36,
      parentlessAbsentSelected: true },
  });
  assert.equal(report.rows.filter(row => row.currentRunnerSupportsDispatch).length, 48);
  assert.equal(report.rows.filter(row => row.canonicalCase.rootKind === 'absent'
    && row.currentRunnerSupportsDispatch).length, 12);
  assert.equal(report.rows.filter(row => row.canonicalCase.rootKind !== 'absent'
    && !row.currentRunnerSupportsDispatch).length, 36);
  assert.equal(report.rows.every(row => row.executionClaimed === false), true);
  assert.equal(report.fullA01Acceptance, false);
  const plan = createA01RootPlan(manifest, options);
  for (const row of report.rows) {
    assert.deepEqual(row.currentRequest, a01InvalidRootRequest(manifest,
      plan.invalidRootCases.find(item => item.id === row.canonicalCase.id), options));
    if (row.canonicalCase.rootKind !== 'absent') continue;
    assert.equal(row.faithfulParentString, false);
    assert.equal(row.httpCandidate.selectedByOption, true);
    assert.equal(row.httpCandidate.approvedForDispatch, false);
    assert.equal(row.javaEntry.setup.present, false);
  }
});

test('parentless option is strict and cannot alter the canonical case denominator', () => {
  assert.throws(() => classifyA01TransportCoverage(fixture('two-center'), sources, {
    includeParentlessAbsent: 'true',
  }), /boolean/);
  assert.throws(() => classifyA01TransportCoverage(fixture('two-center'), sources, {
    includeParentlessAbsent: 1,
  }), /boolean/);
  for (const options of [null, [], true, 'true']) {
    assert.throws(() => classifyA01TransportCoverage(fixture('two-center'), sources, options), /object/);
  }
  assert.throws(() => classifyA01TransportCoverage(fixture('two-center'), sources, {
    includeParentlessAbsent: true, force: true,
  }), /Unknown/);
});

test('absence alone has a declared parentless candidate, never a new approved or executed request', () => {
  const report = classifyA01TransportCoverage(fixture('two-center'), sources);
  const candidates = report.rows.filter(row => row.httpCandidate);
  assert.equal(candidates.length, 12);
  for (const row of candidates) {
    assert.equal(row.canonicalCase.rootKind, 'absent');
    assert.equal(Object.hasOwn(row.canonicalCase.appContext, 'PSDEVSLNSYS'), false);
    assert.equal(row.httpCandidate.approvedForDispatch, false);
    assert.equal(row.currentRunnerSupportsDispatch, false);
    assert.equal(row.currentRequest, null);
    assert.doesNotMatch(row.httpCandidate.path, /psdevslnsys/);
    assert.ok(row.httpCandidate.requiredGates.some(gate => gate.includes('immediately before native access checking')));
    assert.equal(row.httpCandidate.method, row.canonicalCase.accessAction === 'READ' ? 'POST' : 'PUT');
  }
});

test('null, empty String and exact numeric zero keep distinct Java setups and original six actors/actions', () => {
  const report = classifyA01TransportCoverage(fixture('same-center'), sources);
  for (const kind of ['null', 'empty', 'number-zero']) {
    const rows = report.rows.filter(row => row.canonicalCase.rootKind === kind);
    assert.equal(rows.length, 12);
    assert.equal(new Set(rows.map(row => row.canonicalCase.principal.loginname)).size, 6);
    assert.deepEqual([...new Set(rows.map(row => row.canonicalCase.accessAction))], ['READ', 'UPDATE']);
    for (const row of rows) {
      assert.equal(row.lane, 'native-java-typed-boundary');
      assert.equal(row.javaEntry.setup.present, true);
      assert.equal(row.javaEntry.executedByClassifier, false);
      assert.equal(row.javaEntry.actorReplayRequired, true);
      assert.equal(row.javaEntry.fullPhysicalBeforeAfterRequired, true);
      assert.equal(row.httpCandidate, undefined);
      assert.equal(Object.hasOwn(row.canonicalCase.appContext, 'PSDEVSLNSYS'), true);
    }
  }
  assert.match(report.rows.find(row => row.canonicalCase.rootKind === 'null').javaEntry.setup.javaSetup, /, null\)/);
  assert.match(report.rows.find(row => row.canonicalCase.rootKind === 'empty').javaEntry.setup.javaSetup, /, ""\)/);
  assert.match(report.rows.find(row => row.canonicalCase.rootKind === 'number-zero').javaEntry.setup.javaSetup,
    /Integer\.valueOf\(0\)/);
});

test('mapper source covers all four blocked shapes for both actions without claiming six-actor runtime cases', () => {
  const report = classifyA01TransportCoverage(fixture('two-center'), sources);
  for (const row of report.rows.filter(row => !row.currentRunnerSupportsDispatch)) {
    const evidence = row.javaSourceAssociation;
    assert.equal(evidence.mapper.explicitShapePresent, true);
    assert.deepEqual(evidence.mapper.actions, ['READ', 'UPDATE']);
    assert.deepEqual(evidence.mapper.entryForms, ['record', 'search']);
    assert.equal(evidence.mapper.actorMatrixCovered, false);
    assert.equal(evidence.mapper.executedByClassifier, false);
    assert.deepEqual(evidence.managerFactory.actions, ['READ']);
    assert.equal(evidence.currentRootLookup.explicitShapePresent,
      ['null', 'empty'].includes(row.canonicalCase.rootKind));
  }
  assert.equal(report.sourceEvidence.explicitNullMapperSourceEvidence, true);
  assert.equal(report.sourceEvidence.explicitNullMapperMethod,
    'explicitlyNullModelRootMapsTo403ForRecordAndSearchReadAndUpdate');
  assert.match(report.sourceEvidence.explicitNullMapperBoundary, /not six-actor native matrix execution/);
  assert.equal(report.sourceEvidence.matrixActorReplayProven, false);
});

test('explicit null association requires present-null before and after the actual mapper helper', () => {
  const report = classifyA01TransportCoverage(fixture('two-center'), sources);
  const rows = report.rows.filter(row => row.canonicalCase.rootKind === 'null');
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.equal(row.javaSourceAssociation.mapper.method,
      report.sourceEvidence.explicitNullMapperMethod);
    assert.match(row.javaSourceAssociation.mapper.boundary, /source test/);
    assert.equal(row.executionClaimed, false);
    assert.equal(row.javaSourceAssociation.mapper.executedByClassifier, false);
    assert.equal(row.javaSourceAssociation.mapper.actorMatrixCovered, false);
  }
  for (const [before, after] of [
    ['void explicitlyNullModelRootMapsTo403ForRecordAndSearchReadAndUpdate()', 'void removedNullTest()'],
    ['app.set("PSDEVSLNSYS", null);', 'app.reset("PSDEVSLNSYS");'],
    ['assertTrue(app.contains("PSDEVSLNSYS"));', 'assertTrue(true);'],
    ['assertEquals(inputBefore, input.any());', 'assertTrue(true);'],
    ['assertEquals(searchBefore, search.any());', 'assertTrue(true);'],
  ]) {
    assert.throws(() => reviewA01TransportSources({
      ...sources, mapperTest: sources.mapperTest.replaceAll(before, after),
    }));
  }
});

test('source association binds current native transport/model/test bytes, not old receipts or a surrogate endpoint', () => {
  const review = reviewA01TransportSources(sources);
  assert.equal(review.files.length, Object.keys(A01_TRANSPORT_SOURCE_PATHS).length);
  for (const file of review.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(file.anchors.every(anchor => Number.isSafeInteger(anchor.line) && anchor.line > 0));
  }
  for (const [key, before, after] of [
    ['handler', '@PathVariable(name = "pkey") String pkey', '@RequestBody Object root'],
    ['adapter', 'MethodHandlerBase.getFetchMethod()', 'inventedFetch()'],
    ['entity', 'paramMap.put(strName, objValue);', 'paramMap.remove(strName);'],
    ['mapperTest', 'if (root != null) app.set("PSDEVSLNSYS", root);', 'app.set("PSDEVSLNSYS", root);'],
  ]) {
    assert.throws(() => reviewA01TransportSources({ ...sources, [key]: sources[key].replaceAll(before, after) }));
  }
  const api = JSON.parse(sources.modelApi);
  api.getPSDEServiceAPIs.find(row => row.name === 'PSMODULE').aPIMode = 0;
  assert.throws(() => reviewA01TransportSources({ ...sources, modelApi: JSON.stringify(api) }));
});

test('classifier has no deployment execution, Java execution, private receipt or denominator rewrite path', () => {
  const source = readFileSync(new URL('../a01-transport-coverage.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /spawnSync|execFile|child_process|writeFile|\.artifacts\/|credentials\.private/);
  assert.doesNotMatch(source, /^\s*(?:await\s+)?(?:globalThis\.)?fetch\s*\(/m);
  assert.match(source, /createNativeMatrix\(manifest\)\.invalidRootCases/);
  assert.match(source, /matrixCaseExecutionsProven: 0/);
});
