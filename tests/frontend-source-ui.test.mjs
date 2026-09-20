import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import vm from "node:vm";
import { workspace } from "../localization-baseline.mjs";
import {
  checkTypes,
  sourceTypeConfig,
} from "../../modelingweb/app/scripts/audit-source-types.mjs";
import { sourceCompilerOptions } from "../../modelingweb/app/scripts/build-source-runtime.mjs";

const require = createRequire(join(workspace, "modelingweb/app/package.json"));
const ts = require("typescript");

test("source dependency resolution retains the interactjs package's own ambient action types", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ui-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, "entry.ts");
  await writeFile(
    entry,
    [
      'import interact from "interactjs";',
      'interact("#target").draggable({ enabled: true }).resizable({ edges: { left: true } });',
    ].join("\n"),
  );
  const options = ts.convertCompilerOptionsFromJson(
    sourceTypeConfig(["devtool"]).compilerOptions,
    workspace,
  ).options;
  assert.deepEqual(checkTypes([entry], options).diagnostics, []);
});

test("semantic hooks retain omitted parameters, primitive arguments and controller event context", async () => {
  const source = await readFile(
    join(
      workspace,
      "modelingweb/packages-latest/@ibiz-template/vue3-util/src/use/use-semantic-node/use-semantic-node.ts",
    ),
    "utf8",
  );
  const received = [];
  let attrs = {};
  const scripts = {
    classes: {
      root: (controller, ...args) => {
        received.push({ controller, args });
        return "custom";
      },
    },
    styles: { root: "color: red; width: 10px;" },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        ...sourceCompilerOptions,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      exports,
      require: (name) =>
        name === "vue"
          ? { ...require("vue"), useAttrs: () => attrs }
          : {
              PredefinedAttributes: {
                CLASSNAMES: "classNames",
                STYLES: "styles",
              },
              ScriptFactory: {
                execSingleLine: (key, context) => {
                  received.push(context);
                  return scripts[key];
                },
              },
            },
    },
  );
  const controller = {
    model: {
      controlType: "DASHBOARD",
      controlAttributes: [
        { attrName: "classNames", attrValue: "classes" },
        { attrName: "styles", attrValue: "styles" },
      ],
    },
    getEventArgs: () => ({ marker: "events" }),
  };
  const hook = exports.useSemanticNode(controller);
  assert.equal(hook.semanticClass("root", undefined, "create"), "custom");
  const call = received.find((item) => item.controller);
  assert.equal(call.controller, controller);
  assert.deepEqual(Array.from(call.args), [undefined, "create"]);
  assert.ok(received.some((item) => item.marker === "events"));
  assert.equal(hook.semanticClass("missing"), undefined);
  assert.equal(hook.semanticStyle("missing"), undefined);
  assert.equal(hook.semanticStyle("root").color, "red");
  attrs = { classNames: { root: "attr-override" } };
  assert.equal(
    exports.useSemanticNode(controller).semanticClass("root"),
    "attr-override",
  );
});

test("Vue style normalization preserves the rendered meaning of nullable and nested bindings", async () => {
  const { h, normalizeStyle } = require("vue");
  const { renderToString } = createRequire(require.resolve("vue/package.json"))(
    "@vue/server-renderer",
  );
  for (const styles of [
    undefined,
    null,
    { color: "red" },
    ["color: red", undefined, [{ width: "10px" }, null]],
    ["background-image: url(https://example.test/a:b.png); color: blue", {}],
  ]) {
    assert.equal(
      await renderToString(h("div", { style: normalizeStyle(styles) })),
      await renderToString(h("div", { style: styles })),
    );
  }
});

test("screenshot color clearing restores the selected tool's configured default color", async () => {
  const source = await readFile(
    join(
      workspace,
      "modelingweb/packages-latest/@ibiz-template/vue3-components/src/util/screen-shot-util/screen-shot/components/screen-shot-toolbar/screen-shot-toolbar.tsx",
    ),
    "utf8",
  );
  const exports = {};
  const events = [];
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        ...sourceCompilerOptions,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (name === "vue") return require("vue");
        if (name === "@ibiz-template/vue3-util")
          return { useNamespace: () => ({}) };
        if (name === "../../constant")
          return {
            getDefaultToolbarItems: () => [
              { type: "rectangle", color: "#123456", size: 2 },
              { type: "line", color: "#654321", size: 1 },
            ],
          };
        return {};
      },
    },
  );
  const state = exports.ScreenShotToolbar.setup(
    {},
    { emit: (...args) => events.push(args) },
  );
  assert.equal(state.colorPickerAttrs.teleported, false);
  state.handleItemClick(state.items[0]);
  state.handleColorChange("#abcdef");
  assert.equal(state.activeItem.value.color, "#abcdef");
  state.activeItem.value.color = null;
  state.handleColorChange(null);
  assert.equal(state.activeItem.value.color, "#123456");
  assert.equal(events.at(-1)[2].color, "#123456");
  state.handleItemClick(state.items[1]);
  state.handleColorChange(null);
  assert.equal(state.activeItem.value.color, "#654321");
});

test("candidate dependency types are distinct from installed dependency types", () => {
  const candidate = sourceTypeConfig(["vue3-components"]);
  const installed = sourceTypeConfig(["vue3-components"], {
    dependencyProfile: "installed",
  });
  assert.match(
    candidate.compilerOptions.paths["@ibiz-template-plugin/ai-chat"][0],
    /packages-latest/,
  );
  assert.match(
    installed.compilerOptions.paths["@ibiz-template-plugin/ai-chat"][1],
    /app\/node_modules/,
  );
  assert.equal(candidate.compilerOptions.paths["*"], undefined);
  assert.throws(
    () => sourceTypeConfig(["core"], { dependencyProfile: "anything" }),
    /Invalid/,
  );
});
