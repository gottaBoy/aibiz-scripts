import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import {
  checkTypes,
  sourceTypeConfig,
} from "../../modelingweb/app/scripts/audit-source-types.mjs";
import { workspace } from "../localization-baseline.mjs";
import { sourceCompilerOptions } from "../../modelingweb/app/scripts/build-source-runtime.mjs";

const require = createRequire(join(workspace, "modelingweb/app/package.json"));
const ts = require("typescript");

test("source type config resolves framework sources, not installed declarations or shims", () => {
  const config = sourceTypeConfig(["runtime", "vue3-components"], {
    root: "/fixture",
  });
  assert.deepEqual(config.compilerOptions.paths["@ibiz-template/runtime"], [
    "/fixture/modelingweb/packages-latest/@ibiz-template/runtime/src/index.ts",
  ]);
  assert.deepEqual(config.compilerOptions.paths["@ibiz/model-core"], [
    "/fixture/modelingweb/packages-latest/@ibiz/model-core/src/index.ts",
  ]);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(
    config.compilerOptions.useDefineForClassFields,
    sourceCompilerOptions.useDefineForClassFields,
  );
  assert.equal(config.vueCompilerOptions.strictTemplates, true);
  assert.ok(config.include.some((path) => path.endsWith("src/**/*.vue")));
  assert.doesNotMatch(
    JSON.stringify(config),
    /dev-source-shims|\/out\/|\/dist\//,
  );
  assert.throws(() => sourceTypeConfig(["../dist"]), /Unsupported/);
});

test("source type checking and Vite emission preserve inherited field values with the same options", async () => {
  const { transformWithEsbuild } = await import(
    pathToFileURL(
      join(workspace, "modelingweb/app/node_modules/vite/dist/node/index.js"),
    )
  );
  const source =
    "class Base { value = 7; } export class Derived extends Base { value!: number; }";
  const { code } = await transformWithEsbuild(source, "/fixture/fields.ts", {
    format: "cjs",
    target: "es2020",
    tsconfigRaw: { compilerOptions: sourceCompilerOptions },
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports });
  assert.equal(new module.exports.Derived().value, 7);
  const typed = ts.transpileModule(source, {
    compilerOptions: {
      ...sourceCompilerOptions,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  });
  const typedModule = { exports: {} };
  vm.runInNewContext(typed.outputText, {
    module: typedModule,
    exports: typedModule.exports,
  });
  assert.equal(new typedModule.exports.Derived().value, 7);
});

test("source checker reports real assignment, missing export and missing package diagnostics", async (t) => {
  const run = await mkdtemp(join(tmpdir(), "source-types-"));
  t.after(() => rm(run, { recursive: true, force: true }));
  const library = join(run, "library.ts");
  const entry = join(run, "entry.ts");
  await writeFile(library, "export const present = 1;");
  await writeFile(
    entry,
    [
      'import { absent } from "./library";',
      'import { md5 } from "missing-dependency-for-test";',
      'const count: number = "invalid";',
      "export { absent, md5, count };",
    ].join("\n"),
  );
  const { diagnostics } = checkTypes([entry, library], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  });
  for (const code of [2305, 2307, 2322]) {
    assert.ok(
      diagnostics.some((item) => item.code === code),
      `Missing TS${code}`,
    );
  }
  assert.ok(diagnostics.every((item) => item.line > 0 && item.column > 0));
  assert.ok(diagnostics.every((item) => item.category === "Error"));
});

test("model-core exports are type-only and model-helper retains its service path implementation", async () => {
  const root = join(workspace, "modelingweb/packages-latest");
  const code = await readFile(
    join(root, "@ibiz/model-core/src/exports.ts"),
    "utf8",
  );
  const source = ts.createSourceFile(
    "exports.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  assert.equal(source.statements.length, 747);
  assert.ok(
    source.statements.every(
      (node) => ts.isExportDeclaration(node) && node.isTypeOnly,
    ),
  );
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, isolatedModules: true },
  }).outputText;
  assert.doesNotMatch(compiled, /IAppMenuModel|IViewLogic/);
  const helper = await readFile(
    join(root, "@ibiz-template/model-helper/src/utils/index.ts"),
    "utf8",
  );
  const helperJs = ts.transpileModule(helper, {
    compilerOptions: { module: ts.ModuleKind.ESNext, isolatedModules: true },
  }).outputText;
  assert.doesNotMatch(helperJs, /ServicePathDeep|ServicePathItem/);
  assert.match(helperJs, /export \{ ServicePathUtil \}/);
});

test("global model dictionary works alone and merges with the runtime model API declaration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "model-type-merge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const model = join(
    workspace,
    "modelingweb/packages-latest/@ibiz/model-core/src/index.ts",
  );
  const usage = join(root, "usage.ts");
  const legacy = join(root, "runtime-api.d.ts");
  await writeFile(
    usage,
    [
      "interface OriginalModel extends Object { [key: string]: any; }",
      'const model: IModel = { id: "item", count: 1 };',
      "const original: OriginalModel = model;",
      "const restored: IModel = original;",
      'model["nested"] = { value: 1 };',
      'const dynamicValue: number = model["count"];',
      "export { restored, dynamicValue };",
    ].join("\n"),
  );
  await writeFile(
    legacy,
    [
      "export {};",
      "declare global { interface IModel extends Object { [key: string]: any; } }",
    ].join("\n"),
  );
  for (const files of [
    [model, usage],
    [model, usage, legacy],
  ]) {
    const result = checkTypes(files, {
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      types: [],
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    });
    assert.deepEqual(result.diagnostics, []);
  }
});
