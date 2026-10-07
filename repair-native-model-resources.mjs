#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, TextDecoder } from 'node:util';
import {
  directoryPath, fingerprint, optionalStat, PinnedDirectories, readPinnedFile, readTree,
} from './native-candidate-files.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const WORKSPACE = resolve(dirname(scriptPath), '..');
export const RESOURCE_INPUT =
  'plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/' +
  'dist/assets/json/runtime-model';
export const AUDITED_INVENTORY = Object.freeze({
  files: 1414,
  changedFiles: 17,
  unchangedFiles: 1397,
  escapedLf: 46,
  inputFingerprint: '138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function childOf(parent, path) {
  const child = relative(parent, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function repairJsonBytes(input, label = '<input>') {
  let text;
  try { text = decoder.decode(input); }
  catch (error) { throw new Error(`${label}: invalid UTF-8`, { cause: error }); }
  let originalError;
  try {
    JSON.parse(text);
    return { data: Buffer.from(input), inputParseable: true, escapedLf: 0, lfUtf16Offsets: [] };
  } catch (error) {
    originalError = error;
  }

  const offsets = [];
  let quoted = false;
  let escaped = false;
  // Lexing locates the only permitted edit; JSON.parse validates both byte streams.
  for (let offset = 0; offset < text.length; offset++) {
    const character = text[offset];
    if (quoted && escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (quoted && character === '\n') offsets.push(offset);
  }
  if (!offsets.length) {
    throw new Error(`${label}: invalid JSON without repairable quoted raw LF`, { cause: originalError });
  }
  const chunks = [];
  let start = 0;
  for (const offset of offsets) {
    chunks.push(text.slice(start, offset), '\\n');
    start = offset + 1;
  }
  chunks.push(text.slice(start));
  const repaired = chunks.join('');
  try { JSON.parse(repaired); }
  catch (error) {
    throw new Error(`${label}: invalid JSON after quoted raw LF repair`, { cause: error });
  }
  return {
    data: Buffer.from(repaired, 'utf8'),
    inputParseable: false,
    escapedLf: offsets.length,
    lfUtf16Offsets: offsets,
  };
}

function checkInventory(expected, summary, inputFingerprint) {
  for (const key of ['files', 'changedFiles', 'unchangedFiles', 'escapedLf']) {
    assert.ok(Number.isSafeInteger(expected?.[key]) && expected[key] >= 0,
      `Expected inventory must declare ${key}`);
    assert.equal(summary[key], expected[key], `Inventory mismatch: ${key}`);
  }
  if (expected.inputFingerprint !== undefined) {
    assert.match(expected.inputFingerprint, /^[a-f0-9]{64}$/, 'Invalid expected input fingerprint');
    assert.equal(inputFingerprint, expected.inputFingerprint, 'Input fingerprint mismatch');
  }
}

function prepareResources(original) {
  const prepared = original.contents.map(file => {
    const repaired = repairJsonBytes(file.data, file.path);
    return { ...file, repaired };
  });
  const records = prepared.map(({ path, bytes, sha256, repaired }) => ({
    path,
    originalBytes: bytes,
    originalSha256: sha256,
    repairedBytes: repaired.data.length,
    repairedSha256: hash(repaired.data),
    inputParseable: repaired.inputParseable,
    outputParseable: true,
    changed: sha256 !== hash(repaired.data),
    escapedLf: repaired.escapedLf,
    lfUtf16Offsets: repaired.lfUtf16Offsets,
  }));
  const summary = {
    files: original.files,
    changedFiles: records.filter(file => file.changed).length,
    unchangedFiles: records.filter(file => !file.changed).length,
    escapedLf: records.reduce((sum, file) => sum + file.escapedLf, 0),
    inputParseableFiles: records.filter(file => file.inputParseable).length,
    inputInvalidFiles: records.filter(file => !file.inputParseable).length,
    outputParseableFiles: records.length,
  };
  const outputEntries = records.map(file => ({
    path: file.path, bytes: file.repairedBytes, sha256: file.repairedSha256,
  }));
  return { prepared, records, summary, outputEntries };
}

export function verifyNativeModelResourceReceipt({
  workspace = WORKSPACE,
  input = RESOURCE_INPUT,
  receipt: receiptPath,
  expected = AUDITED_INVENTORY,
} = {}) {
  assert.ok(typeof receiptPath === 'string' && receiptPath, 'A repair receipt path is required');
  workspace = resolve(workspace);
  const source = resolve(workspace, input);
  const allowedRoot = join(workspace, '.artifacts/native-resource-repair');
  const path = resolve(workspace, receiptPath);
  const destination = dirname(path);
  assert.equal(dirname(destination), allowedRoot, 'Receipt must belong to a direct repair candidate');
  assert.equal(relative(destination, path), 'receipt.json', 'Expected a candidate receipt.json');
  assert.match(relative(allowedRoot, destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Invalid candidate directory name');
  assert.ok(childOf(workspace, source), 'Input must be a child of the workspace');
  assert.ok(!childOf(allowedRoot, source) && source !== allowedRoot &&
    !childOf(source, allowedRoot), 'Input and output artifact trees must not overlap');
  const directories = new PinnedDirectories();
  try {
    const candidate = directories.open(destination);
    const persisted = readPinnedFile(directories, candidate, 'receipt.json');
    const receipt = JSON.parse(decoder.decode(persisted.data));
    assert.equal(receipt.schemaVersion, 1, 'Unsupported repair receipt schema');
    assert.equal(receipt.contract, 'native-model-resource-repair-candidate', 'Invalid repair receipt contract');
    assert.equal(receipt.status, 'prepared-not-accepted', 'Resource repair is not native acceptance');
    assert.equal(receipt.acceptedForProduction, false, 'Resource receipt cannot assert production acceptance');
    assert.equal(receipt.runtimeModelSourceRecovered, false, 'Resource receipt cannot assert loader source recovery');
    assert.deepEqual(receipt.repair, {
      method: 'escape-quoted-raw-lf-only', validator: 'JSON.parse', offsetKind: 'UTF-16-code-unit',
    }, 'Unsupported repair method');
    assert.deepEqual(receipt.expectedInventory, expected, 'Receipt expected inventory differs from the audit');
    assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['receipt.json', 'resources'],
      'Unexpected candidate files');
    const original = readTree(source);
    const { records, summary, outputEntries } = prepareResources(original);
    checkInventory(expected, summary, original.fingerprint);
    assert.deepEqual(receipt.files, records, 'Receipt per-file evidence differs from the original resources');
    assert.deepEqual(receipt.summary, summary, 'Receipt summary differs from the original resources');
    assert.deepEqual(receipt.input, {
      path: slash(relative(workspace, source)), ...fingerprint(original.entries),
      parseableFiles: summary.inputParseableFiles, invalidFiles: summary.inputInvalidFiles,
    }, 'Receipt input evidence differs from the audited resources');
    const resources = join(destination, 'resources');
    assert.deepEqual(receipt.output, {
      path: slash(relative(workspace, resources)), ...fingerprint(outputEntries),
      parseableFiles: summary.outputParseableFiles,
    }, 'Receipt output evidence differs from the expected repair');
    const copied = readTree(resources);
    assert.deepEqual(copied.entries, outputEntries, 'Current repaired resources differ from the receipt');
    for (const file of copied.contents) {
      assert.equal(repairJsonBytes(file.data, file.path).inputParseable, true,
        `Repaired JSON must parse without another repair: ${file.path}`);
    }
    assert.deepEqual(readTree(source).entries, original.entries,
      'Original resources changed during receipt verification');
    assert.deepEqual(readTree(resources).entries, outputEntries,
      'Repaired resources changed during receipt verification');
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', persisted.identity).data,
      persisted.data, 'Receipt changed during verification');
    assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['receipt.json', 'resources'],
      'Unexpected candidate files');
    directories.verify(candidate);
    return {
      status: 'verified-resource-candidate-not-accepted',
      resourceIntegrityVerified: true,
      acceptedForProduction: false,
      runtimeModelSourceRecovered: false,
      receipt: slash(relative(workspace, path)),
      resources: slash(relative(workspace, resources)),
      inputFingerprint: original.fingerprint,
      outputFingerprint: copied.fingerprint,
      summary,
    };
  } finally {
    directories.close();
  }
}

export function repairNativeModelResources({
  workspace = WORKSPACE,
  input = RESOURCE_INPUT,
  output,
  expected = AUDITED_INVENTORY,
} = {}) {
  workspace = resolve(workspace);
  directoryPath(workspace);
  const allowedRoot = join(workspace, '.artifacts/native-resource-repair');
  const source = resolve(workspace, input);
  const destination = resolve(workspace, output || join(allowedRoot,
    `repair-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
  assert.ok(childOf(workspace, source), 'Input must be a child of the workspace');
  assert.ok(!childOf(allowedRoot, source) && source !== allowedRoot &&
    !childOf(source, allowedRoot), 'Input and output artifact trees must not overlap');
  assert.equal(dirname(destination), allowedRoot,
    'Output must be a direct child of .artifacts/native-resource-repair');
  assert.match(relative(allowedRoot, destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Invalid output directory name');
  directoryPath(allowedRoot, { allowMissing: true });
  assert.ok(!optionalStat(destination), 'Existing destination must not be overwritten');

  const original = readTree(source);
  const { prepared, records, summary, outputEntries } = prepareResources(original);
  checkInventory(expected, summary, original.fingerprint);
  const repairedTree = fingerprint(outputEntries);
  const receipt = {
    schemaVersion: 1,
    contract: 'native-model-resource-repair-candidate',
    status: 'prepared-not-accepted',
    acceptedForProduction: false,
    runtimeModelSourceRecovered: false,
    generatedAt: new Date().toISOString(),
    repair: { method: 'escape-quoted-raw-lf-only', validator: 'JSON.parse', offsetKind: 'UTF-16-code-unit' },
    expectedInventory: { ...expected },
    input: {
      path: slash(relative(workspace, source)),
      ...fingerprint(original.entries),
      parseableFiles: summary.inputParseableFiles,
      invalidFiles: summary.inputInvalidFiles,
    },
    output: {
      path: slash(relative(workspace, join(destination, 'resources'))),
      ...repairedTree,
      parseableFiles: summary.outputParseableFiles,
    },
    summary,
    files: records,
  };

  const directories = new PinnedDirectories();
  try {
    directories.open(allowedRoot, { create: true });
    const candidate = directories.open(destination, { create: true, exclusive: true });
    const resources = join(destination, 'resources');
    directories.open(resources, { create: true, exclusive: true });
    for (const file of prepared) {
      const target = join(resources, file.path);
      const parent = directories.open(dirname(target), { create: true });
      directories.write(parent, relative(dirname(target), target), file.repaired.data);
    }
    const copied = readTree(resources);
    assert.deepEqual(copied.entries, outputEntries, 'Copied resource tree differs from prepared bytes');
    for (const file of copied.contents) {
      assert.equal(repairJsonBytes(file.data, file.path).inputParseable, true,
        `Copied JSON must parse without another repair: ${file.path}`);
    }
    // Receipt existence is not acceptance; every consumer must verify its bytes
    // and both resource trees. Failures retain the candidate without unlinking.
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    assert.deepEqual(readTree(source).entries, original.entries,
      'Original resource tree changed during repair');
    directories.verify(candidate);
    const identity = directories.write(candidate, 'receipt.json', receiptBytes);
    directories.verify(candidate);
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', identity).data,
      receiptBytes, 'Published receipt bytes changed');
    assert.deepEqual(readTree(source).entries, original.entries,
      'Original resource tree changed during receipt publication');
    assert.deepEqual(readTree(resources).entries, outputEntries,
      'Copied resource tree changed during receipt publication');
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', identity).data,
      receiptBytes, 'Published receipt bytes changed');
    assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['receipt.json', 'resources'],
      'Unexpected candidate files');
    directories.verify(candidate);
    return receipt;
  } finally {
    directories.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const { values } = parseArgs({
      options: {
        input: { type: 'string', default: RESOURCE_INPUT },
        output: { type: 'string' },
        'verify-receipt': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
    if (values.help) {
      console.log('Usage: node scripts/repair-native-model-resources.mjs [--input PATH] [--output PATH]');
      console.log('Verify: node scripts/repair-native-model-resources.mjs --verify-receipt PATH [--input PATH]');
      console.log('Outputs a new .artifacts/native-resource-repair/<unique>/resources and receipt.json.');
      console.log('Pins the audited 1414 files / 17 changed / 46 quoted LF / 1397 unchanged inventory.');
      console.log('Requires trusted artifact parents with no concurrent writer; failures retain partial candidates.');
      console.log('Receipt existence is not success: verify before consuming and retry into a fresh destination.');
      console.log('Resource candidate only; no mapping acceptance or runtime-model source recovery.');
    } else if (values['verify-receipt']) {
      assert.ok(!values.output, '--output cannot be combined with --verify-receipt');
      console.log(JSON.stringify(verifyNativeModelResourceReceipt({
        input: values.input, receipt: values['verify-receipt'],
      }), null, 2));
    } else {
      const receipt = repairNativeModelResources({ input: values.input, output: values.output });
      console.log(JSON.stringify({
        status: receipt.status,
        receipt: join(dirname(receipt.output.path), 'receipt.json'),
        summary: receipt.summary,
        inputFingerprint: receipt.input.fingerprint,
        outputFingerprint: receipt.output.fingerprint,
      }, null, 2));
    }
  } catch (error) {
    console.error(`Native resource repair failed: ${error.message}`);
    process.exitCode = 1;
  }
}
