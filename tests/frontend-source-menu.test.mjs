import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { workspace } from "../localization-baseline.mjs";
import { sourceCompilerOptions } from "../../modelingweb/app/scripts/build-source-runtime.mjs";

test("source mobile custom menus preserve visibility, recursion, ordering and explicit maps", async () => {
  const require = createRequire(
    join(workspace, "modelingweb/app/package.json"),
  );
  const ts = require("typescript");
  const code = await readFile(
    join(
      workspace,
      "modelingweb/packages-latest/@ibiz-template/runtime/src/controller/control/app-menu/app-menu.controller.ts",
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(code, {
    compilerOptions: {
      ...sourceCompilerOptions,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) =>
      name === "../../common" ? { ControlController: class {} } : {},
  });
  const controller = Object.create(exports.AppMenuController.prototype);
  controller.saveConfigs = [
    { id: "parent", order: 2 },
    { id: "child-a", order: 2 },
    { id: "child-b", order: 1 },
    { id: "hidden", hidden: true },
    { id: "first", order: 1 },
  ];
  const items = [
    {
      id: "parent",
      appMenuItems: [{ id: "child-a" }, { id: "child-b" }, { id: "hidden" }],
    },
    { id: "hidden" },
    { id: "first" },
    { id: "unconfigured" },
  ];
  const before = JSON.stringify(items);
  const visible = controller.calcMobCustomVisibleItems(items);
  assert.deepEqual(
    Array.from(visible, (item) => item.id),
    ["parent", "first"],
  );
  assert.deepEqual(
    Array.from(visible[0].appMenuItems, (item) => item.id),
    ["child-a", "child-b"],
  );
  const sorted = controller.calcMobCustomSorteItems(visible);
  assert.deepEqual(
    Array.from(sorted, (item) => item.id),
    ["first", "parent"],
  );
  assert.deepEqual(
    Array.from(sorted[1].appMenuItems, (item) => item.id),
    ["child-b", "child-a"],
  );
  assert.equal(JSON.stringify(items), before);
  const explicit = { unconfigured: { id: "unconfigured" } };
  assert.deepEqual(
    Array.from(
      controller.calcMobCustomVisibleItems(items, explicit),
      (item) => item.id,
    ),
    ["unconfigured"],
  );
  assert.deepEqual(Object.keys(explicit), ["unconfigured"]);
  controller.saveConfigs = [];
  assert.equal(controller.calcMobCustomVisibleItems(items).length, 0);
});
