#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assertLanguageDeploymentCandidateApproval, createLanguageDeploymentIo,
  mutateLanguageDeployment, prepareLanguageDeployment,
} from './deploy-existing-plm-language-runtime.mjs';
import { acquireNotificationDeploymentLock } from './deploy-existing-plm-notification-style.mjs';
import { lifecycleCommitBinding } from './prepare-plm-control-lifecycle-runtime.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = /^[a-f0-9]{64}$/;
const safe = relative => {
  assert.ok(relative && !path.isAbsolute(relative) && !/[\0\\\r\n]/.test(relative));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
};
function privateRead(filename) {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(descriptor);
    assert.ok(info.isFile() && info.uid === process.geteuid() && (info.mode & 0o077) === 0);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}
function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function journalAt(output) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^plm-lifecycle-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  syncDirectory(artifacts);
  let sequence = 0;
  const bytes = (relative, value) => {
    safe(relative);
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    for (let directory = path.dirname(filename); directory.startsWith(output); directory = path.dirname(directory)) {
      syncDirectory(directory);
      if (directory === output) break;
    }
  };
  return { bytes, fixed: (name, value) => bytes(name, json(value)),
    event(stage, value) {
      bytes(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`,
        json({ stage, ...value, at: new Date().toISOString() }));
    } };
}

export function loadControlLifecycleDeploymentCandidate(directory, manifestSha256) {
  assert.ok(path.isAbsolute(directory));
  assert.equal(fs.realpathSync(path.dirname(directory)), artifacts);
  assert.equal(fs.realpathSync(directory), directory);
  assert.match(path.basename(directory), /^plm-control-lifecycle-candidate-[a-z0-9-]+$/);
  assert.match(manifestSha256 ?? '', hash);
  const manifestPath = path.join(directory, 'control-lifecycle-candidate.private.json');
  const manifestBytes = privateRead(manifestPath);
  assert.equal(digest(manifestBytes), manifestSha256);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.contract, 'plm-control-lifecycle-runtime-candidate-v1');
  const payload = new Map(manifest.files.map(file => {
    safe(file.path);
    const bytes = privateRead(path.join(directory, 'overlay', file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(digest(bytes), file.sha256);
    return [file.path, bytes];
  }));
  assert.equal(payload.size, 3);
  const originalIndex = privateRead(path.join(directory, 'rollback/index.html'));
  safe(manifest.activeOriginalEntries.importMap);
  const originalMap = privateRead(path.join(directory, 'rollback', manifest.activeOriginalEntries.importMap));
  const approval = { contract: manifest.contract, manifestSha256 };
  const sealed = { directory, manifest, manifestSha256, files: manifest.files, payload, originalIndex, originalMap };
  assertLanguageDeploymentCandidateApproval(sealed, approval);
  const verifySources = () => {
    assert.equal(digest(privateRead(manifestPath)), manifestSha256);
    for (const file of manifest.files) {
      assert.equal(digest(privateRead(path.join(directory, 'overlay', file.path))), file.sha256);
    }
    for (const [relative, expected] of [['producer-report.private.json', manifest.producerReportSha256],
      ['producer-verification.private.json', manifest.producerVerificationSha256],
      ['producer-plan.private.json', manifest.producerPlanSha256],
      ['commit-binding.private.json', manifest.commitBinding.sha256]]) {
      assert.equal(digest(privateRead(path.join(directory, relative))), expected);
    }
    const producerPlan = JSON.parse(privateRead(path.join(directory, 'producer-plan.private.json')));
    const binding = JSON.parse(privateRead(path.join(directory, 'commit-binding.private.json')));
    assert.deepEqual(lifecycleCommitBinding(producerPlan.sources, manifest.commitBinding.commit), binding);
    for (const source of manifest.sourceFiles) {
      safe(source.path);
      assert.equal(digest(privateRead(path.join(directory, source.path))), source.sha256);
    }
    for (const tool of manifest.tools) {
      safe(tool.path); safe(tool.sourcePath);
      assert.ok(tool.sourcePath.startsWith('scripts/'));
      assert.equal(digest(privateRead(path.join(directory, tool.path))), tool.sha256);
      assert.equal(digest(fs.readFileSync(path.join(workspace, tool.sourcePath))), tool.sha256);
    }
    assert.equal(digest(privateRead(path.join(directory, 'rollback/index.html'))), manifest.originalIndexSha256);
    assert.equal(digest(privateRead(path.join(directory, 'rollback', manifest.activeOriginalEntries.importMap))), manifest.originalMapSha256);
  };
  verifySources();
  return { ...sealed, verifySources, controlLifecycleApproval: approval };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    candidate: { type: 'string' }, 'candidate-sha256': { type: 'string' },
    output: { type: 'string' }, plan: { type: 'string' }, epoch: { type: 'string' },
    'plan-sha256': { type: 'string' }, 'apply-report': { type: 'string' },
    'apply-report-sha256': { type: 'string' }, 'trusted-exclusive-writer-window': { type: 'boolean' },
  }, strict: true });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  assert.ok(values.output && path.isAbsolute(values.output));
  let plan, appliedReport;
  if (values.prepare) {
    assert.ok(values.candidate && path.isAbsolute(values.candidate));
    assert.match(values['candidate-sha256'] ?? '', hash);
    for (const name of ['plan', 'plan-sha256', 'epoch', 'apply-report', 'apply-report-sha256',
      'trusted-exclusive-writer-window']) assert.equal(values[name], undefined);
  } else {
    assert.equal(values['trusted-exclusive-writer-window'], true);
    assert.ok(values.plan && path.isAbsolute(values.plan));
    assert.equal(path.basename(values.plan), 'prepared.private.json');
    assert.equal(fs.realpathSync(path.dirname(path.dirname(values.plan))), artifacts);
    assert.equal(values.candidate, undefined);
    assert.equal(values['candidate-sha256'], undefined);
    const bytes = privateRead(values.plan);
    assert.match(values['plan-sha256'] ?? '', hash);
    assert.equal(digest(bytes), values['plan-sha256']);
    plan = JSON.parse(bytes);
    assert.equal(plan.controlLifecycleApproval?.contract, 'plm-control-lifecycle-runtime-candidate-v1');
    assert.equal(plan.controlLifecycleApproval.manifestSha256, plan.manifestSha256);
    if (values.rollback) {
      assert.ok(values['apply-report'] && path.isAbsolute(values['apply-report']));
      const bytes = privateRead(values['apply-report']);
      assert.match(values['apply-report-sha256'] ?? '', hash);
      assert.equal(digest(bytes), values['apply-report-sha256']);
      appliedReport = JSON.parse(bytes);
    } else {
      assert.equal(values['apply-report'], undefined);
      assert.equal(values['apply-report-sha256'], undefined);
    }
  }
  const lock = acquireNotificationDeploymentLock();
  try {
    const sealed = loadControlLifecycleDeploymentCandidate(plan?.candidate ?? values.candidate,
      plan?.manifestSha256 ?? values['candidate-sha256']);
    if (plan) {
      const directory = path.dirname(values.plan);
      assert.deepEqual(JSON.parse(privateRead(path.join(directory, 'preserved.private.json'))), plan.preserved);
      for (const file of sealed.files) {
        assert.equal(digest(privateRead(path.join(directory, 'payload', file.path))), file.sha256);
      }
      for (const scope of ['host', 'container']) {
        assert.equal(digest(privateRead(path.join(directory, 'backup', scope, 'index.html'))), sealed.manifest.originalIndexSha256);
      }
      for (const source of plan.sourceSeal) {
        safe(source.path);
        assert.equal(digest(privateRead(path.join(directory, 'sources', source.path))), source.sha256);
      }
    }
    const io = createLanguageDeploymentIo(sealed);
    const journal = journalAt(values.output);
    const result = values.prepare ? await prepareLanguageDeployment({ sealed, io, journal, lock })
      : await mutateLanguageDeployment({ sealed, plan, io, journal, lock, expectedEpoch: values.epoch,
        expectedPlanSha256: values['plan-sha256'], controlLifecycleApproval: sealed.controlLifecycleApproval,
        trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'], rollback: values.rollback === true,
        appliedReport, expectedApplySha256: values['apply-report-sha256'] });
    console.log(JSON.stringify({ status: result.status, epoch: result.epoch, files: sealed.files.length,
      planSha256: plan ? values['plan-sha256'] : digest(privateRead(path.join(values.output, 'prepared.private.json'))),
      reportSha256: plan ? digest(privateRead(path.join(values.output, 'report.private.json'))) : undefined,
      emptyCreatedDirectoriesRetained: true, functionalAcceptance: false }));
    return result;
  } finally { lock.release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
