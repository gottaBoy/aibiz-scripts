import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSourceOverlayResolver,
  findProvenanceCandidates,
  indexRunOutputs,
  readSourceRuns,
  sha256,
  shortPackageName,
} from "../../modelingweb/app/scripts/source-overlay-provenance.mjs";
import { workspace } from "../localization-baseline.mjs";

const js = "System.register([], function () { return { execute() {} }; });";
const css = "body { color: red; }";
const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

// Mirrors the shape emitted by build-source-runtime.mjs: a report whose
// packages record the sha256 of every emitted output file.
async function fixtureRun(root, { name, verify = true, packageName = "vue3-util" } = {}) {
  const run = join(root, name);
  const output = join(run, "packages", packageName);
  await write(join(output, "index.system.js"), js);
  await write(join(output, "style.css"), css);
  const report = {
    schemaVersion: 1,
    lane: "source-candidate",
    deployable: false,
    productionModified: false,
    status: verify ? "built-not-deployed" : "failed",
    packages: [
      {
        name: `@ibiz-template/${packageName}`,
        sourceVersion: "0.7.41-alpha.127",
        status: verify ? "built" : "failed",
        output: {
          path: `.artifacts/frontend-source/${name}/packages/${packageName}`,
          files: [
            { path: "index.system.js", bytes: js.length, sha256: sha256(Buffer.from(js)) },
            { path: "style.css", bytes: css.length, sha256: sha256(Buffer.from(css)) },
          ],
        },
      },
    ],
  };
  await writeFile(join(run, "report.json"), JSON.stringify(report));
  return { run, report, output };
}

test("recorded build outputs are indexed by sha256 and scoped to their package", () => {
  const report = {
    packages: [
      {
        name: "@ibiz-template/vue3-util",
        status: "built",
        sourceVersion: "0.7.41-alpha.127",
        output: {
          path: ".artifacts/frontend-source/run/packages/vue3-util",
          files: [{ path: "index.system.js", bytes: 4, sha256: "aaaa" }],
        },
      },
      { name: "@ibiz-template/broken", status: "failed", output: { files: [{ path: "x.js", sha256: "bbbb" }] } },
    ],
  };
  const index = indexRunOutputs(report, "run");
  assert.deepEqual([...index.get("aaaa")].map(r => r.path), ["index.system.js"]);
  assert.equal(index.has("bbbb"), false, "failed package outputs must not be indexed");
  assert.deepEqual(findProvenanceCandidates([{ index }], { sha: "aaaa", packageName: "vue3-util" }).length, 1);
  assert.deepEqual(
    findProvenanceCandidates([{ index }], { sha: "aaaa", packageName: "vue3-components" }),
    [],
    "a matching sha in another package must not be borrowed as provenance",
  );
  assert.equal(shortPackageName("@ibiz-template/vue3-util"), "vue3-util");
  assert.equal(shortPackageName("vue3-util"), "vue3-util");
});

test("overlay bytes are accepted only when the recording run still verifies", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlay-provenance-"));
  try {
    const good = await fixtureRun(root, { name: "good-run" });
    const bad = await fixtureRun(root, { name: "bad-run", verify: false });
    const { runs } = await readSourceRuns(root);
    assert.equal(runs.length, 2);

    const resolver = createSourceOverlayResolver({
      root,
      verifyRun: path =>
        Promise.resolve({ sourceArtifactsVerified: path === good.run }),
    });
    const resolved = await resolver.resolvePackageOverlay("vue3-util", [
      { path: "index.system.js", bytes: Buffer.from(js) },
    ]);
    assert.equal(resolved.allowed.length, 1);
    assert.equal(resolved.allowed[0].run, "good-run");
    assert.equal(resolved.allowed[0].runPath, good.run);
    assert.equal(resolved.unprovenanced.length, 0);

    const provenance = await resolver.provenanceFor("vue3-util", Buffer.from(css));
    assert.equal(provenance?.run, "good-run");
    assert.deepEqual(resolver.verifiedRuns(), [good.run]);
    assert.ok(!resolver.verifiedRuns().includes(bad.run), "a failed run must never be listed as verified");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unverifiable overlay bytes stay unprovenanced instead of passing silently", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlay-provenance-"));
  try {
    await fixtureRun(root, { name: "only-run" });
    const resolver = createSourceOverlayResolver({
      root,
      verifyRun: () => Promise.resolve({ sourceArtifactsVerified: false }),
    });
    const resolved = await resolver.resolvePackageOverlay("vue3-util", [
      { path: "index.system.js", bytes: Buffer.from(js) },
    ]);
    assert.deepEqual(resolved.allowed, []);
    assert.equal(resolved.unprovenanced.length, 1);
    assert.equal(resolved.unprovenanced[0].candidates, 1);

    const rogue = await resolver.resolvePackageOverlay("vue3-util", [
      { path: "rogue.js", bytes: Buffer.from("not from any build") },
    ]);
    assert.deepEqual(rogue.allowed, []);
    assert.equal(rogue.unprovenanced[0].candidates, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a run whose report cannot be parsed is skipped rather than trusted", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlay-provenance-"));
  try {
    await mkdir(join(root, "broken-run"), { recursive: true });
    await writeFile(join(root, "broken-run", "report.json"), "{ not json");
    await writeFile(join(root, "broken-run", "index.system.js"), js);
    const { runs } = await readSourceRuns(root);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].report, null);
    assert.ok(runs[0].error);
    assert.equal(runs[0].index.size, 0);

    let verifyCalls = 0;
    const resolver = createSourceOverlayResolver({
      root,
      verifyRun: () => {
        verifyCalls += 1;
        return Promise.resolve({ sourceArtifactsVerified: true });
      },
    });
    const resolved = await resolver.resolvePackageOverlay("vue3-util", [
      { path: "index.system.js", bytes: Buffer.from(js) },
    ]);
    assert.deepEqual(resolved.allowed, []);
    assert.equal(verifyCalls, 0, "an unparseable report must not reach run verification");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing artifact root yields no runs instead of throwing", async () => {
  const { runs, root } = await readSourceRuns(join(tmpdir(), "no-such-overlay-root"));
  assert.deepEqual(runs, []);
  assert.equal(root, join(tmpdir(), "no-such-overlay-root"));
  const resolver = createSourceOverlayResolver({ root });
  const resolved = await resolver.resolvePackageOverlay("vue3-util", [
    { path: "index.system.js", bytes: Buffer.from(js) },
  ]);
  assert.deepEqual(resolved.allowed, []);
  assert.equal(resolved.unprovenanced.length, 1);
});

test("sha256 helper matches the byte hash used by the build report", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlay-provenance-"));
  try {
    const { output } = await fixtureRun(root, { name: "hash-run" });
    const bytes = await readFile(join(output, "index.system.js"));
    assert.equal(
      sha256(bytes),
      createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Drift guard: the provenance module only has teeth while release-harness
// still consults it for both the extra-file classification and the assets the
// dist import map actually serves.
test("release-harness wires overlay provenance into both dist gates", async () => {
  const harnessPath = join(
    workspace,
    "modelingweb/app/scripts/release-harness.mjs",
  );
  const harness = await readFile(harnessPath, "utf8");

  assert.match(
    harness,
    /from '\.\/source-overlay-provenance\.mjs'/,
    "release-harness must import the provenance module",
  );
  assert.match(harness, /createSourceOverlayResolver\(\)/);
  assert.match(
    harness,
    /resolver: getSourceOverlayResolver\(\)/,
    "component asset trees must pass an overlay resolver",
  );
  assert.match(
    harness,
    /resolvePackageOverlay\(\s*overlay\.packageName/,
    "extra files must be classified through resolvePackageOverlay",
  );
  assert.match(
    harness,
    /await verifyServedSourceAssets\(importMapPath, importMap\)/,
    "the dist import map must be checked for served-asset provenance",
  );
  assert.match(
    harness,
    /await resolver\.provenanceFor\(shortName, bytes\)/,
    "served assets must be resolved byte-wise, not by file name",
  );
  assert.match(
    harness,
    /no served source-buildable package asset was checked/,
    "the served-asset gate must fail closed when it resolves nothing",
  );

  // The resolver must not be reachable from the non-dist release preflight.
  assert.match(
    harness,
    /let sourceOverlayResolver = null;[\s\S]*?function getSourceOverlayResolver\(\)[\s\S]*?if \(!sourceOverlayResolver\)/,
    "resolver construction must stay lazy",
  );
  const preflightSection = harness.split("if (shouldCheckDist) {")[0];
  assert.equal(
    preflightSection.includes("await verifyServedSourceAssets(importMapPath, importMap)"),
    false,
    "served-asset verification belongs to the dist lane only",
  );
});
