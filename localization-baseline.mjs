#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const services = [
  "modelingservice",
  "modelingweb",
  "plmservice",
  "ibiz-ebsx-allinone",
  "ibizlab-uaa-api",
  "ibiz-ebsx-gateway",
  "task",
];
const ignored = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  ".artifacts",
]);

export async function fingerprint(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function treeFingerprint(root, { exclude = ignored } = {}) {
  const files = [];
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (exclude.has(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isSymbolicLink())
        throw new Error(`Refusing source symlink: ${path}`);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile())
        files.push({
          path: relative(root, path),
          ...(await fingerprint(path)),
        });
    }
  }
  await walk(root);
  return {
    files,
    sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}

// Never persist environment variables, command arguments, labels or credentials.
export function containerSummary(container) {
  return {
    name: container.Name,
    id: container.Id,
    imageId: container.Image,
    image: container.Config?.Image,
    state: {
      status: container.State?.Status,
      running: container.State?.Running,
      startedAt: container.State?.StartedAt,
      oomKilled: container.State?.OOMKilled,
      health: container.State?.Health?.Status ?? null,
    },
    mounts: (container.Mounts || []).map(
      ({ Type, Source, Destination, RW }) => ({
        type: Type,
        source: Source,
        destination: Destination,
        writable: RW,
      }),
    ),
  };
}

function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const reason = /permission denied|operation not permitted/i.test(
      result.stderr || "",
    )
      ? "permission-denied"
      : result.error?.code || "command-failed";
    throw new Error(
      `docker ${args[0]} failed (exit=${result.status}, code=${reason})`,
    );
  }
  return result.stdout;
}

export async function verifyCapturedCopies(directory) {
  const allowed = resolve(workspace, ".artifacts/localization-baseline");
  directory = await realpath(resolve(directory));
  if (!directory.startsWith(`${await realpath(allowed)}/`))
    throw new Error("Capture must be inside localization-baseline");
  const baseline = JSON.parse(
    await readFile(join(directory, "baseline.json"), "utf8"),
  );
  const verification = {
    verifiedAt: new Date().toISOString(),
    runtimeVerified: false,
    copies: [],
  };
  for (const [name, hostPath] of [
    [
      "modelingservice-provider.jar",
      "ibiz-service-hub/ibiz-service-runner/ibizservicerunner-provider.jar",
    ],
    [
      "plmservice-provider.jar",
      "runtime/harness/ibizservicerunner-provider.jar",
    ],
  ]) {
    if (!(await lstat(join(directory, name))).isFile())
      throw new Error("Capture is not a regular file");
    const expected = baseline.files.find((file) => file.path === hostPath);
    const actual = await fingerprint(join(directory, name));
    verification.copies.push({
      path: name,
      ...actual,
      expectedHostPath: hostPath,
      matchesRecordedHostArtifact: expected?.sha256 === actual.sha256,
    });
  }
  const webRoot = join(directory, "modelingweb-dist");
  for (const path of [
    "index.html",
    "extras/json/system-import.json",
    "environments/environment.js",
  ]) {
    await lstat(join(webRoot, path));
  }
  verification.copies.push({
    path: "modelingweb-dist",
    ...(await treeFingerprint(webRoot, { exclude: new Set() })),
  });
  const target = join(directory, "capture-verification.json");
  await writeFile(target, `${JSON.stringify(verification, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return { target, verification };
}

export async function captureBaseline({ root = workspace, live = false } = {}) {
  const outputRoot = join(root, ".artifacts/localization-baseline");
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(
    join(outputRoot, `${new Date().toISOString().replaceAll(":", "-")}-`),
  );
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    scope: "existing-capabilities",
    originalPlugins: "deferred-not-complete",
    runtimeVerified: false,
    sourceBuildVerified: false,
    files: [],
    sourceTrees: [],
    containers: [],
    backups: [],
    errors: [],
  };
  const files = [
    "scripts/localization-baseline.mjs",
    "modelingweb/app/package.json",
    "modelingweb/app/pnpm-lock.yaml",
    "modelingweb/app/vite.config.ts",
    "modelingweb/app/vite-plugins/ibiz-vite-plugin.ts",
    "modelingweb/app/public/extras/json/system-import.json",
    "modelingweb/start.sh",
    "modelingweb/nginx-local.conf",
    "modelingservice/start-docker.sh",
    "modelingservice/build-source.sh",
    "modelingservice/.runtime/ibiz-plugin-stubs.jar",
    "ibiz-service-hub/ibiz-service-runner/ibizservicerunner-provider.jar",
    "runtime/harness/ibizservicerunner-provider.jar",
    "plm/model/PSSYSTEM.json",
    "plm/model/PSSYSDBSCHEMES/DEFAULT.json",
    "plm/deploy/compose/docker-compose-dev.yml",
    "plm/deploy/compose/docker-compose-modeling-local.yml",
    "docker-compose-platform.yml",
    "docker-compose-harness.yml",
    "PLUGIN-LOCALIZATION-AUDIT.md",
    "MODELING-EXTENSION-UPSTREAM-GAPS.md",
  ];
  for (const path of files) {
    try {
      report.files.push({ path, ...(await fingerprint(join(root, path))) });
    } catch (error) {
      report.errors.push({ path, code: error.code || error.message });
    }
  }
  for (const path of [
    "modelingweb/app/src",
    "modelingservice/stubs/src",
    "plm/model",
  ]) {
    try {
      report.sourceTrees.push({
        path,
        ...(await treeFingerprint(join(root, path))),
      });
    } catch (error) {
      report.errors.push({ path, code: error.code || error.message });
    }
  }
  for (const repository of [
    "ibiz-app-hub",
    "ibiz-service-hub",
    "plm",
    "plm-web",
  ]) {
    const result = spawnSync(
      "git",
      ["-C", join(root, repository), "rev-parse", "HEAD"],
      { encoding: "utf8" },
    );
    const status = spawnSync(
      "git",
      ["-C", join(root, repository), "status", "--porcelain"],
      { encoding: "utf8" },
    );
    (report.repositories ||= []).push({
      path: repository,
      commit: result.status === 0 ? result.stdout.trim() : null,
      worktreeStatus:
        status.status === 0
          ? status.stdout.trim().split("\n").filter(Boolean)
          : null,
    });
  }
  if (live) {
    for (const service of services) {
      try {
        report.containers.push(
          containerSummary(JSON.parse(docker(["inspect", service]))[0]),
        );
      } catch (error) {
        report.errors.push({ service, code: error.message });
      }
    }
    // Copy deployed bytes, not the host's possibly newer build. No service is stopped.
    for (const [service, source, name] of [
      [
        "modelingservice",
        "/ibizservicerunner-provider.jar",
        "modelingservice-provider.jar",
      ],
      [
        "plmservice",
        "/ibizservicerunner-provider.jar",
        "plmservice-provider.jar",
      ],
      ["modelingweb", "/dist", "modelingweb-dist"],
    ]) {
      try {
        const target = join(output, name);
        docker(["cp", `${service}:${source}`, target]);
        const data = (await lstat(target)).isDirectory()
          ? await treeFingerprint(target, { exclude: new Set() })
          : await fingerprint(target);
        report.backups.push({ service, source, path: name, ...data });
      } catch (error) {
        report.errors.push({ service, source, code: error.message });
      }
    }
    for (const before of report.containers) {
      try {
        const after = containerSummary(
          JSON.parse(docker(["inspect", before.name]))[0],
        );
        if (
          before.id !== after.id ||
          before.state.startedAt !== after.state.startedAt
        ) {
          report.errors.push({
            service: before.name,
            code: "container-changed-during-capture",
          });
        }
      } catch (error) {
        report.errors.push({ service: before.name, code: error.message });
      }
    }
  }
  report.backupScope =
    "Application artifacts only; not a transactional database/volume backup or proof of loaded JVM classes.";
  await writeFile(
    join(output, "baseline.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        output,
        files: report.files.length,
        backups: report.backups.length,
        errors: report.errors,
      },
      null,
      2,
    ),
  );
  return { output, report };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean" },
      "verify-capture": { type: "string" },
    },
  });
  if (values["verify-capture"]) {
    if (values.live)
      throw new Error("--live and --verify-capture are mutually exclusive");
    const { target, verification } = await verifyCapturedCopies(
      values["verify-capture"],
    );
    console.log(
      JSON.stringify(
        {
          target,
          copies: verification.copies.map(({ files, ...entry }) => entry),
        },
        null,
        2,
      ),
    );
    if (
      verification.copies.some(
        (copy) => copy.matchesRecordedHostArtifact === false,
      )
    )
      process.exitCode = 1;
  } else {
    const { report } = await captureBaseline({ live: values.live });
    if (report.errors.length) process.exitCode = 1;
  }
}
