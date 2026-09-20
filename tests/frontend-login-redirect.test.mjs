import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import { workspace } from "../localization-baseline.mjs";

const require = createRequire(join(workspace, "modelingweb/app/package.json"));
const ts = require("typescript");
const sourcePath = join(
  workspace,
  "modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app/util/unauthorized-handler/unauthorized-handler.ts",
);

async function handler(hash) {
  const actions = [];
  const location = {
    hash,
    _href: `http://127.0.0.1:32704/modeldesign/${hash}`,
    get href() {
      return this._href;
    },
    set href(value) {
      actions.push(["navigate", value]);
      this._href = value;
    },
    reload() {
      actions.push(["reload", this.href]);
    },
  };
  const document = { body: { style: { display: "" } } };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(await readFile(sourcePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      exports,
      document,
      window: { location },
      require: (name) =>
        name === "qs"
          ? require("qs")
          : {
              UrlHelper: { routeBase: "http://127.0.0.1:32704/modeldesign/#" },
            },
    },
  );
  return {
    instance: new exports.UnauthorizedHandler(),
    actions,
    document,
    location,
  };
}

test("unauthorized hash navigation reloads after selecting login so the hidden page is recreated", async () => {
  const state = await handler("#/-/project/-?id=one");
  await state.instance.normalLogin();
  assert.equal(state.document.body.style.display, "none");
  assert.deepEqual(state.actions, [
    [
      "navigate",
      "http://127.0.0.1:32704/modeldesign/#/login?ru=%2F-%2Fproject%2F-%3Fid%3Done",
    ],
    [
      "reload",
      "http://127.0.0.1:32704/modeldesign/#/login?ru=%2F-%2Fproject%2F-%3Fid%3Done",
    ],
  ]);
});

test("login route does not loop or hide the visible login screen", async () => {
  const state = await handler("#/login?ru=%2F");
  await state.instance.normalLogin();
  assert.deepEqual(state.actions, []);
  assert.equal(state.document.body.style.display, "");
});
