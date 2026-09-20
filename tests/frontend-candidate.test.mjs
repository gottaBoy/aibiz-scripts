import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { workspace } from "../localization-baseline.mjs";
import {
  isAllowedProxyRequest,
  createCandidateServer,
} from "../../modelingweb/app/scripts/serve-source-candidate.mjs";
import {
  relativeAsset,
  verifyCandidateImportMap,
} from "../../modelingweb/app/scripts/assemble-source-candidate.mjs";

test("candidate proxy permits explicit queries and login but never business writes", () => {
  assert.equal(isAllowedProxyRequest("GET", "/api/projects/one"), true);
  assert.equal(
    isAllowedProxyRequest("POST", "/api/projects/fetch_default"),
    true,
  );
  assert.equal(isAllowedProxyRequest("POST", "/api/example/v7/login"), true);
  assert.equal(isAllowedProxyRequest("POST", "/api/projects"), false);
  assert.equal(
    isAllowedProxyRequest("POST", "/api/projects/one/update"),
    false,
  );
  assert.equal(
    isAllowedProxyRequest("DELETE", "/api/projects/fetch_default"),
    false,
  );
  assert.equal(isAllowedProxyRequest("PUT", "/api/projects/one"), false);
  assert.equal(
    relativeAsset("/run/dist", "/run/dist/source-runtime/core/index.system.js"),
    "../../source-runtime/core/index.system.js",
  );
});

test("candidate import map requires local existing resources and rejects missing/remote dependencies", async (t) => {
  const parent =
    process.env.CANDIDATE_TEST_ROOT || join(workspace, ".artifacts");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "candidate-map-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "extras/json"), { recursive: true });
  await mkdir(join(root, "source-runtime/core"), { recursive: true });
  await writeFile(
    join(root, "source-runtime/core/index.system.js"),
    "System.register([], function(){return {execute(){}};});",
  );
  const map = join(root, "extras/json/system-import.json");
  await writeFile(
    map,
    JSON.stringify({
      imports: { core: "../../source-runtime/core/index.system.js" },
    }),
  );
  const assets = await verifyCandidateImportMap(root);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].group, "imports");
  await writeFile(
    map,
    JSON.stringify({ imports: { core: "https://remote.invalid/core.js" } }),
  );
  await assert.rejects(verifyCandidateImportMap(root), /Nonlocal/);
  await writeFile(
    map,
    JSON.stringify({ imports: { core: "../../missing.js" } }),
  );
  await assert.rejects(verifyCandidateImportMap(root));
});

test("isolated server serves candidate bytes, proxies queries, blocks mutation and does not use SPA fallback for missing JS", async (t) => {
  const parent =
    process.env.CANDIDATE_TEST_ROOT || join(workspace, ".artifacts");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "candidate-server-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, "dist");
  await mkdir(dist);
  await writeFile(join(dist, "index.html"), "<div>candidate</div>");
  await writeFile(join(dist, "asset.js"), "window.candidate=true;");
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url });
    res.setHeader("content-type", "application/json");
    res.end('{"queried":true}');
  });
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const server = await createCandidateServer({
    dist,
    upstream: `http://127.0.0.1:${upstream.address().port}`,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base + "/modeldesign/")).text(), /candidate/);
  assert.equal((await fetch(base + "/modeldesign/missing.js")).status, 404);
  assert.equal(
    (await fetch(base + "/modeldesign/%2e%2e%2f%2e%2e%2fpackage.json")).status,
    403,
  );
  assert.match(
    await (
      await fetch(base + "/modeldesign/view", {
        headers: { accept: "text/html" },
      })
    ).text(),
    /candidate/,
  );
  assert.equal(
    (await fetch(base + "/api/projects", { method: "POST" })).status,
    403,
  );
  assert.equal(seen.length, 0);
  assert.deepEqual(
    await (
      await fetch(base + "/api/projects/fetch_default", { method: "POST" })
    ).json(),
    { queried: true },
  );
  assert.equal(seen.length, 1);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(
      base + "/api/projects",
      { headers: { host: "unrelated.invalid" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal(seen.length, 1);
  assert.equal(
    (
      await fetch(base + "/api/projects", {
        headers: { origin: "https://unrelated.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(seen.length, 1);
});
