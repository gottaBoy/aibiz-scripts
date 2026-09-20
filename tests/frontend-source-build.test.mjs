import assert from "node:assert/strict";
import test from "node:test";
import { join, relative, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import {
  isolatedOutput,
  selectPackages,
  sourceCompilerOptions,
} from "../../modelingweb/app/scripts/build-source-runtime.mjs";
import {
  inspectSystemBundle,
  verifySourceRuntime,
} from "../../modelingweb/app/scripts/verify-source-runtime.mjs";
import {
  fingerprint,
  treeFingerprint,
  workspace,
} from "../localization-baseline.mjs";
import { verifySourceDependencies } from "../../modelingweb/source-build-deps/verify.mjs";

test("source build selection is explicit and cannot select arbitrary paths", () => {
  assert.equal(selectPackages().length, 7);
  assert.deepEqual(selectPackages("vue3-util,vue3-components"), [
    "vue3-util",
    "vue3-components",
  ]);
  for (const value of ["../dist", "vue3-util,vue3-util", "vue3-util,"]) {
    assert.throws(() => selectPackages(value), /Unsupported/);
  }
  assert.throws(
    () =>
      isolatedOutput(resolve(workspace, "modelingweb/app/dist"), "vue3-util"),
    /inside/,
  );
  assert.throws(
    () =>
      isolatedOutput(
        resolve(workspace, ".artifacts/frontend-source/test"),
        "../dist",
      ),
    /inside/,
  );
});

test("SystemJS inspection checks real calls rather than text in comments or error messages", () => {
  const parsed = inspectSystemBundle(`
    // ibiz.engine.register('VIEW_FAKE')
    System.register(['vue', './chunk.js'], function () {
      return { execute() {
        const text = "VIEW_FAKE";
        ibiz.engine.register('VIEW_DEREDIRECTVIEW', c => new Engine(c));
        ibiz.engine.register('VIEW_DEMOBREDIRECTVIEW', c => new Engine(c));
      }};
    });
  `);
  assert.deepEqual(parsed.imports, ["./chunk.js", "vue"]);
  assert.deepEqual(parsed.registrations, [
    "VIEW_DEMOBREDIRECTVIEW",
    "VIEW_DEREDIRECTVIEW",
  ]);
  assert.throws(() => inspectSystemBundle("System.register(["), /Invalid/);
});

test("actual source registry installs both redirect lifecycles without replacing their provider", async () => {
  const req = createRequire(resolve(workspace, "modelingweb/app/package.json"));
  const ts = req("typescript");
  const registered = new Map();
  class ViewEngineBase {
    constructor(controller) {
      this.controller = controller;
    }
  }
  const source = await readFile(
    resolve(
      workspace,
      "modelingweb/packages-latest/@ibiz-template/vue3-components/src/view-engine/index.ts",
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    ibiz: {
      engine: { register: (key, factory) => registered.set(key, factory) },
    },
    require: () =>
      new Proxy(
        { ViewEngineBase },
        { get: (target, key) => target[key] || class {} },
      ),
  });
  exports.IBizViewEngine.install({});
  const controller = {};
  for (const key of ["VIEW_DEREDIRECTVIEW", "VIEW_DEMOBREDIRECTVIEW"]) {
    const engine = registered.get(key)(controller);
    assert.ok(engine instanceof ViewEngineBase);
    assert.equal(engine.controller, controller);
  }
});

test("type-only API exports disappear from JavaScript without fabricated values", async () => {
  const req = createRequire(resolve(workspace, "modelingweb/app/package.json"));
  const ts = req("typescript");
  const source = await readFile(
    resolve(
      workspace,
      "modelingweb/packages-latest/@ibiz-template/core/src/interface/api/global-param/index.ts",
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  assert.doesNotMatch(compiled, /IApiContext|IApiParams|IApiData|IApiObject/);
});

test("artifact verifier rejects changed source, changed JS, failed builds and empty receipts", async (t) => {
  const parent = join(workspace, ".artifacts/frontend-source");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "integrity-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceSet = join(root, "sources");
  const source = join(sourceSet, "vue3-util/src");
  const output = join(root, "packages/vue3-util");
  const theme = join(sourceSet, "theme/style");
  await mkdir(source, { recursive: true });
  await mkdir(output, { recursive: true });
  await mkdir(theme, { recursive: true });
  const sourceCode = "export const fixture = 1;";
  await writeFile(join(source, "index.ts"), sourceCode);
  await writeFile(
    join(sourceSet, "vue3-util/package.json"),
    '{"name":"@ibiz-template/vue3-util","version":"fixture"}',
  );
  await writeFile(
    join(output, "index.system.js"),
    "System.register([], function () { return {execute() {}}; });",
  );
  await writeFile(
    join(output, "index.system.js.map"),
    JSON.stringify({
      version: 3,
      sources: [relative(output, join(source, "index.ts"))],
      sourcesContent: [sourceCode],
    }),
  );
  const report = {
    schemaVersion: 1,
    lane: "source-candidate",
    deployable: false,
    productionModified: false,
    status: "built-not-deployed",
    sourceSet: relative(workspace, sourceSet),
    sourceDependencies: await verifySourceDependencies(),
    compilerOptions: sourceCompilerOptions,
    lockfile: await fingerprint(
      join(workspace, "modelingweb/app/pnpm-lock.yaml"),
    ),
    hubLockfile: await fingerprint(
      join(workspace, "ibiz-app-hub/pnpm-lock.yaml"),
    ),
    importMap: await fingerprint(
      join(workspace, "modelingweb/app/public/extras/json/system-import.json"),
    ),
    builder: await fingerprint(
      join(workspace, "modelingweb/app/scripts/build-source-runtime.mjs"),
    ),
    packages: [
      {
        name: "@ibiz-template/vue3-util",
        status: "built",
        source: await treeFingerprint(source),
        theme: await treeFingerprint(theme),
        sourceManifest: await fingerprint(
          join(sourceSet, "vue3-util/package.json"),
        ),
        output: {
          path: relative(workspace, output),
          ...(await treeFingerprint(output)),
        },
        chunks: [{ sourceModuleCount: 1 }],
        dependencies: [],
      },
    ],
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report));
  const original = await verifySourceRuntime(root, { quiet: true });
  assert.equal(original.sourceArtifactsVerified, true);
  assert.equal(original.deployable, false);
  assert.equal(original.browserVerified, false);
  await writeFile(join(source, "index.ts"), "export const fixture = 2;");
  assert.match(
    (await verifySourceRuntime(root, { quiet: true })).failures.join("\n"),
    /source changed/,
  );
  await writeFile(join(source, "index.ts"), sourceCode);
  await writeFile(
    join(output, "index.system.js"),
    "System.register([], function () { return {execute() {throw 1;}}; });",
  );
  assert.match(
    (await verifySourceRuntime(root, { quiet: true })).failures.join("\n"),
    /output bytes changed/,
  );
  report.status = "failed";
  await writeFile(join(root, "report.json"), JSON.stringify(report));
  assert.match(
    (await verifySourceRuntime(root, { quiet: true })).failures.join("\n"),
    /Build report contains failures/,
  );
  report.packages = [];
  await writeFile(join(root, "report.json"), JSON.stringify(report));
  await assert.rejects(
    verifySourceRuntime(root, { quiet: true }),
    /source-candidate/,
  );
});
