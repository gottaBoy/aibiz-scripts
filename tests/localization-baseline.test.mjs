import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
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
