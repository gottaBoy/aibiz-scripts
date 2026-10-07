import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BASELINE_FILES,
  containerSummary,
  fingerprint,
  treeFingerprint,
} from "../localization-baseline.mjs";

test("container evidence excludes secrets, arguments and labels", () => {
  const summary = containerSummary({
    Name: "/modelingservice",
    Id: "id",
    Config: {
      Image: "local",
      Env: ["PASSWORD=secret"],
      Cmd: ["--token=secret"],
      Labels: { password: "secret" },
    },
    State: { Running: true },
    Mounts: [{ Type: "bind", Source: "/src", Destination: "/app", RW: false }],
  });
  assert.equal(JSON.stringify(summary).includes("secret"), false);
  assert.equal(summary.state.running, true);
  assert.equal(summary.mounts[0].destination, "/app");
});

test("source snapshot changes on edited bytes and ignores build caches", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "localization-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.ts"), "export const value = 1;");
  const first = await treeFingerprint(root);
  assert.equal(first.files.length, 1);
  assert.deepEqual(await treeFingerprint(root), first);
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules", "ignored"), "cached");
  assert.deepEqual(await treeFingerprint(root), first);
  assert.equal(
    (await treeFingerprint(root, { exclude: new Set() })).files.length,
    2,
  );
  await writeFile(join(root, "index.ts"), "export const value = 2;");
  assert.notEqual((await treeFingerprint(root)).sha256, first.sha256);
  assert.match(
    (await fingerprint(join(root, "index.ts"))).sha256,
    /^[a-f0-9]{64}$/,
  );
  await symlink(join(root, "index.ts"), join(root, "link.ts"));
  await assert.rejects(treeFingerprint(root), /symlink/);
});

test("baseline distinguishes required current inputs from optional historical evidence", () => {
  const required = BASELINE_FILES.filter((entry) => entry.required).map(
    (entry) => entry.path,
  );
  const optional = BASELINE_FILES.filter((entry) => !entry.required);
  assert.ok(required.includes("plm/deploy/compose/docker-compose-dev.yml"));
  assert.ok(
    required.includes(
      "ibiz-service-hub/ibiz-service-runner/ibizservicerunner-provider.jar",
    ),
  );
  assert.ok(required.includes("plm/backend/plm-provider.jar"));
  assert.deepEqual(
    optional.map((entry) => entry.path),
    [
      "runtime/harness/ibizservicerunner-provider.jar",
      "docker-compose-platform.yml",
      "docker-compose-harness.yml",
      "PLUGIN-LOCALIZATION-AUDIT.md",
      "MODELING-EXTENSION-UPSTREAM-GAPS.md",
    ],
  );
  assert.ok(optional.every((entry) => entry.reason));
});

test("localization baseline CLI help exits cleanly", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../localization-baseline.mjs", import.meta.url)),
      "--help",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Usage: node scripts\/localization-baseline\.mjs/,
  );
  assert.match(result.stdout, /--verify-capture DIR/);
});
