import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import {
  dependencyRoot,
  verifyArchiveIntegrity,
  verifySourceDependencies,
} from "../../modelingweb/source-build-deps/verify.mjs";

test("pinned original archive and installed package are verified byte for byte", async () => {
  const receipt = await verifySourceDependencies();
  assert.equal(receipt.packages[0].name, "js-md5");
  assert.equal(receipt.packages[0].version, "0.8.3");
  assert.equal(receipt.packages[0].installed.files.length, 7);
  const archive = await readFile(
    join(dependencyRoot, "archives/js-md5-0.8.3.tgz"),
  );
  const tampered = Buffer.from(archive);
  tampered[0] ^= 1;
  assert.throws(
    () => verifyArchiveIntegrity(tampered, receipt.packages[0].integrity),
    /integrity mismatch/,
  );
});

test("dependency verification rejects an edited installed implementation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [
    "archives",
    "references",
    "node_modules",
    "registry-lock.json",
    "package-lock.json",
  ])
    await cp(join(dependencyRoot, name), join(root, name), { recursive: true });
  await verifySourceDependencies(root);
  await writeFile(
    join(root, "node_modules/js-md5/src/md5.js"),
    "module.exports = () => 0;",
  );
  await assert.rejects(
    verifySourceDependencies(root),
    /differ from original archive/,
  );
});

test("locked dependency installs offline into a clean directory with an empty cache", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-deps-clean-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [
    "archives",
    "references",
    "package.json",
    "registry-lock.json",
    "package-lock.json",
  ])
    await cp(join(dependencyRoot, name), join(root, name), { recursive: true });
  const installed = spawnSync(
    "npm",
    [
      "ci",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(root, "empty-cache"),
    ],
    { cwd: root, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(
    installed.status,
    0,
    installed.stderr || installed.error?.message,
  );
  assert.equal(
    (await verifySourceDependencies(root)).packages[0].version,
    "0.8.3",
  );
});

test("original Node and browser MD5 APIs handle strings, binary, incremental output and HMAC", async () => {
  const require = createRequire(join(dependencyRoot, "package.json"));
  const nodeMd5 = require("js-md5");
  const browserModule = { exports: {} };
  vm.runInNewContext(
    await readFile(
      join(dependencyRoot, "node_modules/js-md5/src/md5.js"),
      "utf8",
    ),
    {
      module: browserModule,
      exports: browserModule.exports,
      ArrayBuffer,
      Uint8Array,
      Uint32Array,
    },
  );
  for (const md5 of [nodeMd5, browserModule.exports]) {
    for (const input of [
      "",
      "abc",
      "\u4e2d\u6587\ud83d\ude00",
      "x".repeat(4097),
    ]) {
      const expected = createHash("md5").update(input).digest("hex");
      assert.equal(md5(input), expected);
      assert.equal(
        md5.create().update(input.slice(0, 1)).update(input.slice(1)).hex(),
        expected,
      );
      assert.equal(
        md5.base64(input),
        createHash("md5").update(input).digest("base64"),
      );
    }
    const bytes = new Uint8Array([0, 127, 128, 255]);
    assert.equal(md5(bytes), createHash("md5").update(bytes).digest("hex"));
    assert.equal(md5(bytes.buffer), md5(bytes));
    assert.deepEqual(
      Array.from(md5.array(bytes)),
      Array.from(createHash("md5").update(bytes).digest()),
    );
    const expectedHmac = createHmac("md5", "key")
      .update("message")
      .digest("hex");
    assert.equal(md5.hmac("key", "message"), expectedHmac);
    assert.equal(
      md5.hmac.create("key").update("mes").update("sage").hex(),
      expectedHmac,
    );
    assert.throws(() => md5(null), /invalid type/);
  }
});
