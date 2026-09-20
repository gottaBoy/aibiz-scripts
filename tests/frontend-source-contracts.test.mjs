import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { createRequire } from "node:module";
import { workspace } from "../localization-baseline.mjs";
import {
  checkVersionRange,
  compareNamedImports,
  containedFile,
  distributionManifest,
  inspectGlobalModuleContract,
  inspectModuleContract,
  mappedAssetPath,
} from "../../modelingweb/app/scripts/audit-source-contracts.mjs";

test("dynamic imports are tracked through await, then chains, guards and loader escapes", () => {
  const result = inspectModuleContract(`
    System.register(["dep"], function(exp, ctx) {
      return {
        setters: [null],
        execute() {
          async function a() {
            const t = await ctx.import("plugin-a");
            return t.chat || t.default.chat;
          }
          async function b() {
            const { Foo, bar: baz, opt = 1 } = await ctx.import("plugin-b");
            return [Foo, baz, opt];
          }
          ctx.import("plugin-c").catch(function(e) { return e; }).then(function(m) {
            const install = m.default;
            return m.default ? m.default : m;
          });
          const loader = () => ctx.import("./chunk-d.js");
          async function g() {
            const w = await ctx.import("plugin-g");
            return w.default || w;
          }
          async function e() {
            const n = await ctx.import("plugin-e");
            return (n && n.createFlatChat) ? n.createFlatChat() : n.default.createFlatChat();
          }
          async function f() {
            return (await ctx.import("plugin-f"))[name];
          }
          function unrelated(ctx) { ctx.import("not-tracked"); }
        }
      };
    });
  `);
  assert.deepEqual(result.unknown, []);
  const byName = Object.fromEntries(
    result.dynamicImports.map((entry) => [entry.specifier, entry]),
  );
  assert.deepEqual(Object.keys(byName).sort(), [
    "./chunk-d.js",
    "plugin-a",
    "plugin-b",
    "plugin-c",
    "plugin-e",
    "plugin-f",
    "plugin-g",
  ]);
  assert.deepEqual(byName["plugin-a"], {
    specifier: "plugin-a",
    names: [],
    probed: ["chat", "default"],
    optional: [],
    namespace: false,
    reasons: [],
  });
  assert.deepEqual(byName["plugin-b"], {
    specifier: "plugin-b",
    names: ["Foo", "bar"],
    probed: [],
    optional: ["opt"],
    namespace: false,
    reasons: [],
  });
  assert.equal(byName["plugin-c"].namespace, true);
  assert.deepEqual(byName["plugin-c"].names, ["default"]);
  assert.deepEqual(byName["plugin-c"].reasons, [
    "Module namespace used as a conditional branch value",
  ]);
  assert.deepEqual(byName["plugin-g"], {
    specifier: "plugin-g",
    names: [],
    probed: ["default"],
    optional: [],
    namespace: true,
    reasons: ["Module namespace used as a fallback value"],
  });
  assert.deepEqual(byName["./chunk-d.js"].reasons, [
    "Import promise is returned to an opaque consumer (loader callback)",
  ]);
  assert.deepEqual(byName["plugin-e"], {
    specifier: "plugin-e",
    names: [],
    probed: ["createFlatChat", "default"],
    optional: [],
    namespace: false,
    reasons: [],
  });
  assert.deepEqual(byName["plugin-f"].reasons, [
    "Computed member access on the module namespace",
  ]);
  assert.deepEqual(
    compareNamedImports(byName["plugin-a"], { exports: ["chat"], unknown: [] }),
    { missing: [], unresolvedNames: [], unverified: false, probedAbsent: ["default"] },
  );
  assert.deepEqual(
    compareNamedImports(byName["plugin-a"], { exports: ["other"], unknown: [] }),
    {
      missing: ["chat", "default"],
      unresolvedNames: [],
      unverified: false,
      probedAbsent: ["chat", "default"],
    },
  );
  assert.deepEqual(
    compareNamedImports(byName["plugin-b"], { exports: ["Foo"], unknown: [] }),
    { missing: ["bar"], unresolvedNames: [], unverified: false, optionalAbsent: ["opt"] },
  );
});

test("global (UMD) providers are executed like the SystemJS 6.14.2 global extra", () => {
  const umd = (body) => `
    (function (global, factory) {
      typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
      typeof define === 'function' && define.amd ? define(['exports'], factory) :
      (global = typeof globalThis !== 'undefined' ? globalThis : global || self, ${body});
    })(this, function (exports) { exports.init = function () {}; exports.registerMap = 1; Object.defineProperty(exports, '__esModule', { value: true }); });
  `;
  const named = inspectGlobalModuleContract(umd("factory(global.echartsFixture = {})"));
  assert.equal(named.mode, "global-vm");
  assert.equal(named.globalName, "echartsFixture");
  assert.deepEqual(named.exports, ["default", "init", "registerMap"]);
  assert.deepEqual(named.unknown, []);
  const plugin = inspectGlobalModuleContract(
    `!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t():"function"==typeof define&&define.amd?define(t):(e="undefined"!=typeof globalThis?globalThis:e||self).dayjs_plugin_fixture=t()}(this,function(){return function(){}});`,
  );
  assert.deepEqual(plugin.exports, ["default"]);
  assert.equal(plugin.globalName, "dayjs_plugin_fixture");
  assert.deepEqual(
    compareNamedImports({ names: ["default"], namespace: false }, plugin),
    { missing: [], unresolvedNames: [], unverified: false },
  );
  assert.deepEqual(
    compareNamedImports({ names: ["init", "missing"], namespace: false }, named),
    { missing: ["missing"], unresolvedNames: [], unverified: false },
  );
  const thrown = inspectGlobalModuleContract("document.createElement('canvas');");
  assert.match(thrown.unknown[0], /threw inside the vm sandbox/);
  const silent = inspectGlobalModuleContract("(function(){ var local = 1; })();");
  assert.match(silent.unknown[0], /No new global property/);
  // A classic-script top-level var is a global property, exactly as in a browser.
  assert.equal(inspectGlobalModuleContract("var lib = { a: 1 };").globalName, "lib");
  assert.match(
    inspectGlobalModuleContract("while (true) {}", { timeout: 50 }).unknown[0],
    /threw inside the vm sandbox/,
  );
});

test("version ranges report strict semver and pnpm prerelease semantics separately", () => {
  assert.deepEqual(checkVersionRange("^0.7.0", "0.7.41-alpha.119"), {
    matches: false,
    matchesWithPrereleases: true,
  });
  assert.deepEqual(checkVersionRange("^0.6.0", "0.7.41-alpha.119"), {
    matches: false,
    matchesWithPrereleases: false,
  });
  assert.deepEqual(checkVersionRange("^0.7.41-alpha.119", "0.7.41-alpha.127"), {
    matches: true,
    matchesWithPrereleases: true,
  });
  assert.deepEqual(checkVersionRange("0.7.39", "0.7.41-alpha.127"), {
    matches: false,
    matchesWithPrereleases: false,
  });
  assert.deepEqual(checkVersionRange("^1.10.26", null), {
    matches: null,
    matchesWithPrereleases: null,
  });
  assert.deepEqual(checkVersionRange("not a range", "1.0.0"), {
    matches: null,
    matchesWithPrereleases: null,
  });
});

test("source framework manifests do not drift from local package versions", async () => {
  const packageNames = [
    "core",
    "model-helper",
    "runtime",
    "vue3-util",
    "vue3-components",
    "devtool",
    "theme",
    "web-theme",
  ];
  const manifests = new Map();
  for (const name of packageNames) {
    const manifest = JSON.parse(
      await readFile(
        join(
          workspace,
          "modelingweb/packages-latest/@ibiz-template",
          name,
          "package.json",
        ),
        "utf8",
      ),
    );
    manifests.set(manifest.name, manifest);
  }

  for (const manifest of manifests.values()) {
    for (const section of [
      "dependencies",
      "peerDependencies",
      "devDependencies",
    ]) {
      for (const [dependency, required] of Object.entries(
        manifest[section] || {},
      )) {
        const dependencyManifest = manifests.get(dependency);
        if (!dependencyManifest) continue;
        const result = checkVersionRange(
          required,
          dependencyManifest.version,
        );
        assert.notEqual(
          result.matches,
          false,
          `${manifest.name} ${section} requires ${dependency}@${required}, but local source is ${dependencyManifest.version}`,
        );
      }
    }
  }
});

test("distribution manifests are found above served assets but never outside the root", async (t) => {
  const run = await mkdtemp(join(tmpdir(), "source-contracts-dist-"));
  t.after(() => rm(run, { force: true, recursive: true }));
  const root = join(run, "dist");
  await mkdir(join(root, "plugins/p/1.0.0/dist"), { recursive: true });
  await writeFile(join(run, "package.json"), JSON.stringify({ name: "outside" }));
  await writeFile(join(root, "plugins/p/1.0.0/dist/index.js"), "1");
  await writeFile(
    join(root, "plugins/p/1.0.0/package.json"),
    JSON.stringify({ name: "p", version: "1.0.0", peerDependencies: { x: "^1" } }),
  );
  const found = await distributionManifest(
    root,
    join(root, "plugins/p/1.0.0/dist/index.js"),
  );
  assert.equal(found.manifest.version, "1.0.0");
  assert.match(found.path, /plugins\/p\/1\.0\.0\/package\.json$/);
  await mkdir(join(root, "extras/js/lib"), { recursive: true });
  await writeFile(join(root, "extras/js/lib/index.js"), "1");
  assert.equal(
    await distributionManifest(root, join(root, "extras/js/lib/index.js")),
    null,
  );
});

test("SystemJS contract parser respects export parameter scope and named setter accesses", () => {
  const result = inspectModuleContract(`
    System.register("fixture", ["dep"], (function(exp) {
      let value;
      return {
        setters: [dep => { value = dep.present; const other = dep["default"]; }],
        execute() {
          exp("public", value);
          exp({ another: 1 });
          function unrelated(exp) { exp("fake", 1); }
        }
      };
    }));
  `);
  assert.deepEqual(result.exports, ["another", "public"]);
  assert.deepEqual(result.imports, [
    { specifier: "dep", names: ["default", "present"], namespace: false },
  ]);
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(
    compareNamedImports(result.imports[0], {
      exports: ["default"],
      unknown: [],
    }),
    { missing: ["present"], unresolvedNames: [], unverified: false },
  );
});

test("dynamic export objects and namespace imports cannot receive a verified named contract", () => {
  const result = inspectModuleContract(`
    System.register(["dep"], function(exp) {
      let namespace;
      return {
        setters: [dep => { namespace = dep; }],
        execute() { exp(namespace); }
      };
    });
  `);
  assert.deepEqual(result.unknown, ["Dynamic export object"]);
  assert.equal(result.imports[0].namespace, true);
  assert.equal(compareNamedImports(result.imports[0], result).unverified, true);
  assert.deepEqual(
    compareNamedImports(
      { names: ["init"], namespace: false },
      {
        exports: [],
        unknown: ["UMD module"],
      },
    ),
    { missing: [], unresolvedNames: ["init"], unverified: true },
  );
  assert.ok(inspectModuleContract("export const ignored = 1;").unknown.length);
  assert.ok(inspectModuleContract("System.register();").unknown.length);
  assert.throws(() => inspectModuleContract("System.register(["), /Invalid/);
});

test("deployment URL resolution uses URL semantics for cache queries and absolute paths", () => {
  const root = "/fixture/dist";
  const map = "/fixture/dist/extras/json/system-import.json";
  assert.equal(
    mappedAssetPath(root, map, "../js/vue.js?time=123#module"),
    "/fixture/dist/extras/js/vue.js",
  );
  assert.equal(
    mappedAssetPath(root, map, "/assets/vue.js"),
    "/fixture/dist/assets/vue.js",
  );
  assert.equal(mappedAssetPath(root, map, "https://cdn.example/vue.js"), null);
  assert.equal(mappedAssetPath(root, map, "//cdn.example/vue.js"), null);
  assert.equal(mappedAssetPath(root, map, undefined), null);
});

test("contract paths reject escapes including symlinks", async (t) => {
  const run = await mkdtemp(join(tmpdir(), "source-contracts-"));
  t.after(() => rm(run, { force: true, recursive: true }));
  const root = join(run, "allowed");
  await mkdir(root);
  await writeFile(join(root, "asset.js"), "1");
  await writeFile(join(run, "outside.js"), "2");
  await symlink(join(run, "outside.js"), join(root, "escape.js"));
  assert.match(await containedFile(root, join(root, "asset.js")), /asset\.js$/);
  await assert.rejects(containedFile(root, join(root, "escape.js")), /escapes/);
  await assert.rejects(
    containedFile(root, join(root, "../outside.js")),
    /escapes/,
  );
});

test("source plugin path normalization works with the actual default-only SystemJS path provider", async () => {
  const require = createRequire(
    join(workspace, "modelingweb/app/package.json"),
  );
  const ts = require("typescript");
  function execute(code, dependencies = {}) {
    const exports = {};
    vm.runInNewContext(code, {
      URL,
      System: {
        register(names, declare) {
          const module = declare((name, value) => {
            if (typeof name === "string") exports[name] = value;
            else Object.assign(exports, name);
          }, {});
          names.forEach((name, index) =>
            module.setters[index](dependencies[name] || {}),
          );
          module.execute();
        },
      },
    });
    return exports;
  }
  const provider = execute(
    await readFile(
      join(
        workspace,
        "modelingweb/app/public/extras/js/path-browserify/1.0.1/index.system.min.js",
      ),
      "utf8",
    ),
  );
  assert.equal(provider.join, undefined);
  assert.equal(typeof provider.default.join, "function");
  const source = await readFile(
    join(
      workspace,
      "modelingweb/packages-latest/@ibiz-template/vue3-util/src/plugin/plugin-factory/plugin-factory.ts",
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.System,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const { PluginFactory } = execute(compiled, { "path-browserify": provider });
  const normalize = (base, path) =>
    PluginFactory.prototype.normalizedPath.call(
      { urlReg: /^https?:\/\// },
      base,
      path,
    );
  assert.equal(
    normalize("/plugins/a", "../b/package.json"),
    "/plugins/b/package.json",
  );
  assert.equal(
    normalize("https://example.test/plugins/a", "../b/package.json"),
    "https://example.test/plugins/b/package.json",
  );
});
