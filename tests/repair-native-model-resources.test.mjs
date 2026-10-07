import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  AUDITED_INVENTORY, repairJsonBytes, repairNativeModelResources, RESOURCE_INPUT,
  verifyNativeModelResourceReceipt, WORKSPACE,
} from '../repair-native-model-resources.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const openedPath = path => typeof path === 'number' ? fs.readlinkSync(`/proc/self/fd/${path}`) : path;

function fingerprintDirectory(root, path) {
  const entries = [];
  function visit(directory, prefix = '') {
    const info = fs.lstatSync(directory);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), `Not a regular directory: ${directory}`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const child = fs.lstatSync(target);
      assert.ok(!child.isSymbolicLink(), `Symlink fingerprint entry rejected: ${name}`);
      if (child.isDirectory()) visit(target, name);
      else {
        assert.ok(child.isFile(), `Non-regular fingerprint entry rejected: ${name}`);
        const data = fs.readFileSync(target);
        entries.push({ path: name, bytes: data.length, sha256: hash(data) });
      }
    }
  }
  visit(join(root, path));
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    fingerprintKind: 'relative-file-set',
    fingerprint: hash(JSON.stringify(entries)),
    entries,
  };
}

function fixture(t, files = { 'valid.json': '{"value":1}\n', 'broken.json': '{"value":"a\nb"}\n' }) {
  const root = join(WORKSPACE, '.artifacts/native-resource-repair');
  fs.mkdirSync(root, { recursive: true });
  const workspace = fs.mkdtempSync(join(root, 'test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const input = join(workspace, 'input');
  fs.mkdirSync(input);
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(dirname(join(input, name)), { recursive: true });
    fs.writeFileSync(join(input, name), bytes, { flag: 'wx' });
  }
  const output = join(workspace, '.artifacts/native-resource-repair/candidate');
  return {
    workspace,
    input,
    output,
    expected: { files: 2, changedFiles: 1, unchangedFiles: 1, escapedLf: 1 },
  };
}

test('quoted LF repair respects escaped quotes and even/odd backslash sequences', () => {
  const value = {
    text: 'quote: "inside"; slash: \\; doubled: \\\\; LF:\nnext',
    tail: 'a backslash: \\',
    literal: '\\n',
  };
  const canonical = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const input = Buffer.from(canonical.toString().replace('LF:\\nnext', 'LF:\nnext'));
  assert.throws(() => JSON.parse(input), SyntaxError);
  const result = repairJsonBytes(input);
  assert.deepEqual(result.data, canonical);
  assert.deepEqual(JSON.parse(result.data), value);
  assert.equal(result.inputParseable, false);
  assert.equal(result.escapedLf, 1);
  assert.deepEqual(result.lfUtf16Offsets, [input.toString().indexOf('LF:\n') + 3]);
});

test('valid JSON retains legitimate outside LF, existing escapes, UTF-8 and all bytes', () => {
  const input = Buffer.from(`${JSON.stringify({
    literal: '\\n', newline: '\n', quote: '"', unicode: '\u4e2d',
  }, null, 2)}\n`);
  const result = repairJsonBytes(input);
  assert.equal(result.inputParseable, true);
  assert.equal(result.escapedLf, 0);
  assert.deepEqual(result.lfUtf16Offsets, []);
  assert.deepEqual(result.data, input);
  for (const text of ['null\n', '42\n', '"scalar"\n', '[\n1,\n2\n]\n']) {
    assert.deepEqual(repairJsonBytes(Buffer.from(text)).data, Buffer.from(text));
  }
});

test('multiple raw LF edits are byte-minimal and record original UTF-16 offsets', () => {
  const input = Buffer.from('{\n"value":"\u4e2d\na\nb",\n"other":"c\\nd"\n}\n');
  const result = repairJsonBytes(input);
  assert.equal(result.escapedLf, 2);
  assert.deepEqual(result.lfUtf16Offsets, [input.toString().indexOf('\u4e2d\n') + 1,
    input.toString().indexOf('a\n') + 1]);
  assert.equal(result.data.length, input.length + 2);
  assert.deepEqual(JSON.parse(result.data), { value: '\u4e2d\na\nb', other: 'c\nd' });
  assert.equal(result.data.toString(), '{\n"value":"\u4e2d\\na\\nb",\n"other":"c\\nd"\n}\n');
});

const malformed = [
  ['truncated string', '{"value":"a\nb'],
  ['truncated object', '{"value":"a\nb"'],
  ['trailing comma after a repairable string', '{"value":"a\nb",}'],
  ['raw tab alongside LF', '{"value":"a\nb\tc"}'],
  ['raw CR alongside LF', '{"value":"a\nb\rc"}'],
  ['raw NUL alongside LF', '{"value":"a\nb\u0000c"}'],
  ['unknown escape alongside LF', '{"value":"a\nb\\q"}'],
  ['backslash followed by raw LF', '{"value":"a\\\nb"}'],
  ['outside LF splitting a number', '{"value":1\n2}'],
  ['comment', '{"value":"a\nb"/* comment */}'],
  ['single-quoted property', "{'value':'a\nb'}"],
  ['trailing content', '{"value":"a\nb"}false'],
  ['empty input', ''],
  ['UTF-8 BOM', '\ufeff{"value":1}'],
  ['invalid UTF-8', Buffer.from([0x22, 0xc3, 0x28, 0x22])],
];
for (const [name, input] of malformed) {
  test(`${name} fails closed before creating a copy or receipt`, t => {
    const options = fixture(t, { 'valid.json': '{"value":1}', 'broken.json': input });
    assert.throws(() => repairJsonBytes(Buffer.from(input)), /invalid JSON|invalid UTF-8/);
    const before = fingerprintDirectory(options.workspace, 'input');
    assert.throws(() => repairNativeModelResources(options), /invalid JSON|invalid UTF-8/);
    assert.equal(fs.existsSync(options.output), false);
    assert.equal(fs.existsSync(dirname(options.output)), false);
    assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
  });
}

test('receipt binds every original/repaired file, parse result and full tree without source edits', t => {
  const options = fixture(t, {
    'valid.json': '{\n"value":"escaped \\\\n"\n}\n',
    'nested/broken.json': '{"value":"a\nb"}\n',
  });
  const before = fingerprintDirectory(options.workspace, 'input');
  const receipt = repairNativeModelResources(options);
  const persisted = JSON.parse(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'));
  assert.deepEqual(persisted, receipt);
  assert.equal(receipt.status, 'prepared-not-accepted');
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.runtimeModelSourceRecovered, false);
  assert.equal(receipt.repair.validator, 'JSON.parse');
  assert.equal(receipt.input.fingerprint, before.fingerprint);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
  assert.deepEqual(receipt.summary, {
    files: 2, changedFiles: 1, unchangedFiles: 1, escapedLf: 1,
    inputParseableFiles: 1, inputInvalidFiles: 1, outputParseableFiles: 2,
  });
  const resources = join(options.output, 'resources');
  const output = fingerprintDirectory(options.output, 'resources');
  assert.equal(receipt.output.fingerprint, output.fingerprint);
  assert.equal(receipt.input.bytes + 1, receipt.output.bytes);
  assert.equal(receipt.output.bytes, output.bytes);
  assert.equal(receipt.input.parseableFiles, 1);
  assert.equal(receipt.input.invalidFiles, 1);
  assert.equal(receipt.output.parseableFiles, 2);
  for (const file of receipt.files) {
    const original = fs.readFileSync(join(options.input, file.path));
    const repaired = fs.readFileSync(join(resources, file.path));
    assert.equal(file.originalSha256, hash(original));
    assert.equal(file.repairedSha256, hash(repaired));
    assert.equal(file.originalBytes, original.length);
    assert.equal(file.repairedBytes, repaired.length);
    assert.equal(file.outputParseable, true);
    assert.doesNotThrow(() => JSON.parse(repaired));
    if (file.changed) {
      assert.equal(file.inputParseable, false);
      assert.throws(() => JSON.parse(original), SyntaxError);
      assert.equal(file.escapedLf, file.lfUtf16Offsets.length);
    } else {
      assert.equal(file.inputParseable, true);
      assert.doesNotThrow(() => JSON.parse(original));
      assert.deepEqual(repaired, original);
    }
  }
  assert.equal(fs.existsSync(join(options.output, '.receipt.tmp')), false);
});

test('default destinations are unique and prior candidate bytes are never overwritten', t => {
  const options = fixture(t);
  delete options.output;
  const first = repairNativeModelResources(options);
  const firstPath = join(options.workspace, dirname(first.output.path), 'receipt.json');
  const before = fs.readFileSync(firstPath);
  const second = repairNativeModelResources(options);
  assert.notEqual(first.output.path, second.output.path);
  assert.deepEqual(fs.readFileSync(firstPath), before);
  assert.match(first.output.path, /^\.artifacts\/native-resource-repair\/repair-[^/]+\/resources$/);
});

for (const kind of ['directory', 'file', 'symlink', 'dangling symlink']) {
  test(`existing destination ${kind} is rejected without overwrite`, t => {
    const options = fixture(t);
    fs.mkdirSync(dirname(options.output), { recursive: true });
    if (kind === 'directory') {
      fs.mkdirSync(options.output);
      fs.writeFileSync(join(options.output, 'sentinel'), 'keep');
    } else if (kind === 'file') fs.writeFileSync(options.output, 'keep');
    else fs.symlinkSync(kind === 'symlink' ? options.input : join(options.workspace, 'absent'),
      options.output);
    assert.throws(() => repairNativeModelResources(options), /must not be overwritten/);
    if (kind === 'directory') assert.equal(fs.readFileSync(join(options.output, 'sentinel'), 'utf8'), 'keep');
    else if (kind === 'file') assert.equal(fs.readFileSync(options.output, 'utf8'), 'keep');
    else assert.equal(fs.lstatSync(options.output).isSymbolicLink(), true);
  });
}

test('output outside artifacts, the artifact root itself and nested destinations are rejected', t => {
  const options = fixture(t);
  for (const output of [
    join(options.workspace, 'outside'),
    join(options.workspace, '..', 'escape'),
    dirname(options.output),
    join(options.output, 'nested'),
    options.input,
  ]) {
    assert.throws(() => repairNativeModelResources({ ...options, output }), /Output must be a direct child/);
  }
  assert.equal(fs.existsSync(dirname(options.output)), false);
});

for (const component of ['.artifacts', '.artifacts/native-resource-repair']) {
  test(`symlink output ancestor ${component} is rejected without following it`, t => {
    const options = fixture(t);
    const target = join(options.workspace, 'target');
    fs.mkdirSync(target);
    const link = join(options.workspace, component);
    fs.mkdirSync(dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    assert.throws(() => repairNativeModelResources(options), /Symlink directory rejected/);
    assert.deepEqual(fs.readdirSync(target), []);
  });
}

for (const kind of ['root', 'file', 'directory', 'ancestor']) {
  test(`symlink input ${kind} is rejected without a receipt`, t => {
    const options = fixture(t);
    let input = options.input;
    if (kind === 'root') {
      input = join(options.workspace, 'linked-input');
      fs.symlinkSync(options.input, input);
    } else if (kind === 'file') {
      fs.symlinkSync(join(options.input, 'valid.json'), join(options.input, 'linked.json'));
    } else if (kind === 'directory') {
      const target = join(options.workspace, 'target');
      fs.mkdirSync(target);
      fs.symlinkSync(target, join(options.input, 'linked'));
    } else {
      const target = join(options.workspace, 'parent');
      fs.symlinkSync(options.workspace, target);
      input = join(target, 'input');
    }
    assert.throws(() => repairNativeModelResources({ ...options, input }), /Symlink/);
    assert.equal(fs.existsSync(options.output), false);
  });
}

test('input outside the workspace and overlapping artifact input are rejected', t => {
  const options = fixture(t);
  assert.throws(() => repairNativeModelResources({
    ...options, input: join(options.workspace, '..', 'outside'),
  }), /Input must be a child/);
  for (const input of [dirname(options.output), join(dirname(options.output), 'input'), options.workspace]) {
    assert.throws(() => repairNativeModelResources({ ...options, input }),
      /Input.*child|must not overlap/);
  }
});

for (const inputPath of ['.artifacts', '.artifacts/native-resource-repair']) {
  test(`input encompassing output root ${inputPath} is rejected before any filesystem write`, t => {
    const options = fixture(t);
    const input = join(options.workspace, inputPath);
    fs.mkdirSync(dirname(input), { recursive: true });
    fs.renameSync(options.input, input);
    const before = fingerprintDirectory(options.workspace, inputPath);
    const mutations = [];
    for (const method of [
      'mkdirSync', 'writeFileSync', 'linkSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'renameSync',
    ]) {
      t.mock.method(fs, method, (...args) => {
        mutations.push({ method, path: args[0] });
        throw new Error('Unexpected preflight write');
      });
    }
    const open = fs.openSync;
    t.mock.method(fs, 'openSync', (path, flags, ...args) => {
      if (flags & (fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY |
        fs.constants.O_RDWR)) {
        mutations.push({ method: 'openSync', path });
        throw new Error('Unexpected preflight write');
      }
      return open(path, flags, ...args);
    });
    try {
      assert.throws(() => repairNativeModelResources({ ...options, input }), /must not overlap/);
      assert.deepEqual(mutations, []);
    } finally { t.mock.reset(); }
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(fingerprintDirectory(options.workspace, inputPath), before);
  });
}

test('unvalidated non-JSON files and empty resource trees fail closed', t => {
  const options = fixture(t, { 'unvalidated.txt': 'not json' });
  assert.throws(() => repairNativeModelResources(options), /Non-JSON resource rejected/);
  fs.unlinkSync(join(options.input, 'unvalidated.txt'));
  assert.throws(() => repairNativeModelResources(options), /contains no JSON files/);
  assert.equal(fs.existsSync(options.output), false);
});

test('all inventory counters and the optional input fingerprint fail closed on drift', t => {
  const options = fixture(t);
  for (const key of ['files', 'changedFiles', 'unchangedFiles', 'escapedLf']) {
    assert.throws(() => repairNativeModelResources({
      ...options, expected: { ...options.expected, [key]: options.expected[key] + 1 },
    }), new RegExp(`Inventory mismatch: ${key}`));
    assert.equal(fs.existsSync(options.output), false);
  }
  assert.throws(() => repairNativeModelResources({
    ...options, expected: { ...options.expected, inputFingerprint: '0'.repeat(64) },
  }), /Input fingerprint mismatch/);
  assert.throws(() => repairNativeModelResources({ ...options, expected: {} }), /must declare files/);
  assert.throws(() => repairNativeModelResources({ ...options, expected: AUDITED_INVENTORY }),
    /Inventory mismatch: files/);
});

test('receipt open failure retains the partial candidate without a receipt or source changes', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const open = fs.openSync;
  let injected = false;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (!injected && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) {
      injected = true;
      throw new Error('Injected receipt publication failure');
    }
    return open(path, flags, ...args);
  });
  assert.throws(() => repairNativeModelResources(options), /Injected receipt publication failure/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), /ENOENT/);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
});

test('copied byte drift is rejected and retained without publishing a receipt', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const write = fs.writeFileSync;
  let changed = false;
  t.mock.method(fs, 'writeFileSync', (path, data, flags) => {
    if (!changed && openedPath(path).startsWith(join(options.output, 'resources'))) {
      changed = true;
      return write(path, '{"unexpected":"copy drift"}', flags);
    }
    return write(path, data, flags);
  });
  assert.throws(() => repairNativeModelResources(options), /Copied resource tree differs/);
  assert.equal(changed, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), /ENOENT/);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
});

test('input changes during copying are rejected without publishing a receipt', t => {
  const options = fixture(t);
  const write = fs.writeFileSync;
  let changed = false;
  t.mock.method(fs, 'writeFileSync', (path, data, flags) => {
    const target = openedPath(path);
    write(path, data, flags);
    if (!changed && target.startsWith(join(options.output, 'resources'))) {
      changed = true;
      write(join(options.input, 'valid.json'), '{"changed":"during copy"}');
    }
  });
  assert.throws(() => repairNativeModelResources(options), /Original resource tree changed/);
  assert.equal(changed, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), /ENOENT/);
  assert.equal(fs.readFileSync(join(options.input, 'valid.json'), 'utf8'), '{"changed":"during copy"}');
});

test('interrupted receipt write retains partial bytes which the verifier rejects', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const write = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    if (!injected && openedPath(path) === join(options.output, 'receipt.json')) {
      injected = true;
      write(path, '{"truncated":', ...args);
      throw new Error('Injected receipt finalization failure');
    }
    return write(path, data, ...args);
  });
  assert.throws(() => repairNativeModelResources(options), /Injected receipt finalization failure/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'), '{"truncated":');
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), SyntaxError);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
});

for (const phase of ['receipt open', 'receipt write', 'receipt read-back']) {
  test(`input drift during ${phase} is rejected and the unverified candidate is retained`, t => {
    const options = fixture(t);
    const write = fs.writeFileSync;
    const open = fs.openSync;
    const read = fs.readFileSync;
    let changed = false;
    const changeInput = () => {
      changed = true;
      write(join(options.input, 'valid.json'), '{"changed":"during publication"}');
    };
    if (phase === 'receipt write') {
      t.mock.method(fs, 'writeFileSync', (path, data, flags) => {
        const target = openedPath(path);
        write(path, data, flags);
        if (!changed && target === join(options.output, 'receipt.json')) changeInput();
      });
    } else if (phase === 'receipt open') {
      t.mock.method(fs, 'openSync', (path, flags, ...args) => {
        const result = open(path, flags, ...args);
        if (!changed && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) changeInput();
        return result;
      });
    } else {
      t.mock.method(fs, 'readFileSync', (path, ...args) => {
        const target = openedPath(path);
        const result = read(path, ...args);
        if (!changed && target === join(options.output, 'receipt.json')) changeInput();
        return result;
      });
    }
    assert.throws(() => repairNativeModelResources(options), /Original resource tree changed/);
    assert.equal(changed, true);
    assert.equal(fs.existsSync(options.output), true);
    assert.throws(() => verifyNativeModelResourceReceipt({
      ...options, receipt: join(options.output, 'receipt.json'),
    }), /Receipt per-file evidence differs/);
    assert.equal(fs.readFileSync(join(options.input, 'valid.json'), 'utf8'),
      '{"changed":"during publication"}');
  });
}

test('resource byte drift during receipt publication is rejected and preserved as failed evidence', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const write = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    const target = openedPath(path);
    write(path, data, ...args);
    if (!injected && target === join(options.output, 'receipt.json')) {
      injected = true;
      write(join(options.output, 'resources/valid.json'), '{"changed":"after copy check"}');
    }
  });
  assert.throws(() => repairNativeModelResources(options),
    /Copied resource tree changed during receipt publication/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), /Current repaired resources differ/);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
});

test('receipt byte drift after its exclusive write is rejected and retained', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const write = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    const target = openedPath(path);
    write(path, data, ...args);
    if (!injected && target === join(options.output, 'receipt.json')) {
      injected = true;
      write(target, '{"changed":"receipt drift"}');
    }
  });
  assert.throws(() => repairNativeModelResources(options), /Published receipt bytes changed/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'), '{"changed":"receipt drift"}');
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), /Unsupported repair receipt schema/);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
});

for (const component of ['candidate', 'resources', 'nested resources', 'artifact root']) {
  test(`replacement of ${component} between validation and file open cannot redirect writes`, t => {
    const options = fixture(t, {
      'valid.json': '{"value":1}\n', 'nested/broken.json': '{"value":"a\nb"}\n',
    });
    const before = fingerprintDirectory(options.workspace, 'input');
    const external = join(options.workspace, 'external');
    fs.mkdirSync(external);
    fs.writeFileSync(join(external, 'sentinel'), 'keep');
    const open = fs.openSync;
    const moved = join(options.workspace, 'moved-owned-directory');
    const replaced = {
      candidate: options.output,
      resources: join(options.output, 'resources'),
      'nested resources': join(options.output, 'resources/nested'),
      'artifact root': dirname(options.output),
    }[component];
    let changed = false;
    t.mock.method(fs, 'openSync', (path, flags, mode) => {
      if (!changed && (flags & fs.constants.O_CREAT) &&
        (component !== 'nested resources' || path.endsWith('/broken.json'))) {
        changed = true;
        fs.renameSync(replaced, moved);
        fs.symlinkSync(external, replaced);
      }
      return open(path, flags, mode);
    });
    assert.throws(() => repairNativeModelResources(options), /Directory changed/);
    assert.equal(changed, true);
    assert.deepEqual(fs.readdirSync(external), ['sentinel']);
    assert.equal(fs.readFileSync(join(external, 'sentinel'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
    assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
  });
}

test('regular-directory substitution is detected without cleaning the substitute tree', t => {
  const options = fixture(t);
  const external = join(options.workspace, 'moved-candidate');
  const open = fs.openSync;
  let changed = false;
  t.mock.method(fs, 'openSync', (path, flags, mode) => {
    if (!changed && (flags & fs.constants.O_CREAT)) {
      changed = true;
      fs.renameSync(options.output, external);
      fs.mkdirSync(options.output);
      fs.writeFileSync(join(options.output, 'sentinel'), 'keep');
    }
    return open(path, flags, mode);
  });
  assert.throws(() => repairNativeModelResources(options), /Directory changed/);
  assert.equal(changed, true);
  assert.deepEqual(fs.readdirSync(options.output), ['sentinel']);
  assert.equal(fs.readFileSync(join(options.output, 'sentinel'), 'utf8'), 'keep');
  assert.ok(fs.readdirSync(external).length > 0, 'Owned failed writes are retained in the original directory');
});

for (const phase of ['receipt open', 'receipt write']) {
  test(`candidate replacement during ${phase} cannot write or unlink external files`, t => {
    const options = fixture(t);
    const external = join(options.workspace, 'external');
    const moved = join(options.workspace, 'moved-candidate');
    fs.mkdirSync(external);
    for (const name of ['.receipt.tmp', 'receipt.json', 'sentinel']) {
      fs.writeFileSync(join(external, name), `keep ${name}`);
    }
    const replace = () => {
      fs.renameSync(options.output, moved);
      fs.symlinkSync(external, options.output);
    };
    if (phase === 'receipt open') {
      const open = fs.openSync;
      t.mock.method(fs, 'openSync', (path, flags, mode) => {
        if ((flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) replace();
        return open(path, flags, mode);
      });
    } else {
      const write = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
        const target = openedPath(path);
        const result = write(path, data, ...args);
        if (target === join(options.output, 'receipt.json')) replace();
        return result;
      });
    }
    assert.throws(() => repairNativeModelResources(options), /Directory changed/);
    for (const name of ['.receipt.tmp', 'receipt.json', 'sentinel']) {
      assert.equal(fs.readFileSync(join(external, name), 'utf8'), `keep ${name}`);
    }
    assert.deepEqual(fs.readdirSync(moved).sort(), ['receipt.json', 'resources']);
  });
}

test('receipt name inserted before exclusive publication is not overwritten or deleted', t => {
  const options = fixture(t);
  const open = fs.openSync;
  const independent = join(options.workspace, 'independent-receipt');
  fs.writeFileSync(independent, 'keep independently inserted receipt');
  let injected = false;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (!injected && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) {
      injected = true;
      fs.renameSync(independent, path);
    }
    return open(path, flags, ...args);
  });
  assert.throws(() => repairNativeModelResources(options), /EEXIST/);
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'),
    'keep independently inserted receipt');
  assert.deepEqual(fs.readdirSync(options.output).sort(), ['receipt.json', 'resources']);
  assert.throws(() => verifyNativeModelResourceReceipt({
    ...options, receipt: join(options.output, 'receipt.json'),
  }), SyntaxError);
});

test('input file substitution during read is rejected without leaking descriptors or writing output', t => {
  const options = fixture(t);
  const descriptors = fs.readdirSync('/proc/self/fd').length;
  const read = fs.readFileSync;
  let changed = false;
  t.mock.method(fs, 'readFileSync', (path, flags) => {
    const target = openedPath(path);
    const result = read(path, flags);
    if (!changed && target === join(options.input, 'valid.json')) {
      changed = true;
      fs.renameSync(target, join(options.input, 'moved.json'));
      fs.writeFileSync(target, '{"changed":"read substitution"}', { flag: 'wx' });
    }
    return result;
  });
  assert.throws(() => repairNativeModelResources(options), /Resource (?:path )?changed while reading/);
  assert.equal(changed, true);
  assert.equal(fs.existsSync(options.output), false);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
});

test('successful and failed repairs close all pinned directory and file descriptors', t => {
  const options = fixture(t);
  const descriptors = fs.readdirSync('/proc/self/fd').length;
  repairNativeModelResources(options);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
  const failed = { ...options, output: join(dirname(options.output), 'failed-candidate') };
  const open = fs.openSync;
  let injected = false;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (!injected && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) {
      injected = true;
      throw new Error('Injected publication failure');
    }
    return open(path, flags, ...args);
  });
  assert.throws(() => repairNativeModelResources(failed), /Injected publication failure/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(failed.output), true);
  assert.equal(fs.existsSync(join(failed.output, 'receipt.json')), false);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
});

test('the default real repair pins the audited original tree and exact defect inventory', () => {
  assert.deepEqual(AUDITED_INVENTORY, {
    files: 1414, changedFiles: 17, unchangedFiles: 1397, escapedLf: 46,
    inputFingerprint: '138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797',
  });
});

test('the complete audited real tree yields 1414 parseable resources with exact per-file receipts', t => {
  const before = fingerprintDirectory(WORKSPACE, RESOURCE_INPUT);
  const receipt = repairNativeModelResources();
  const candidate = join(WORKSPACE, dirname(receipt.output.path));
  t.after(() => fs.rmSync(candidate, { recursive: true, force: true }));
  assert.equal(receipt.status, 'prepared-not-accepted');
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.runtimeModelSourceRecovered, false);
  assert.equal(receipt.input.fingerprint, AUDITED_INVENTORY.inputFingerprint);
  assert.equal(receipt.output.fingerprint,
    '45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211');
  assert.equal(receipt.summary.outputParseableFiles, 1414);
  assert.equal(receipt.summary.changedFiles, 17);
  assert.equal(receipt.summary.unchangedFiles, 1397);
  assert.equal(receipt.summary.escapedLf, 46);
  assert.equal(receipt.output.bytes - receipt.input.bytes, 46);
  for (const record of receipt.files) {
    const original = fs.readFileSync(join(WORKSPACE, RESOURCE_INPUT, record.path));
    const copied = fs.readFileSync(join(WORKSPACE, receipt.output.path, record.path));
    assert.equal(hash(original), record.originalSha256);
    assert.equal(hash(copied), record.repairedSha256);
    assert.deepEqual(copied, repairJsonBytes(original, record.path).data);
    assert.doesNotThrow(() => JSON.parse(copied));
    if (!record.changed) assert.deepEqual(copied, original);
  }
  assert.deepEqual(fingerprintDirectory(WORKSPACE, RESOURCE_INPUT), before);
  assert.equal(fingerprintDirectory(WORKSPACE, receipt.output.path).fingerprint,
    receipt.output.fingerprint);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(candidate, 'receipt.json'), 'utf8')), receipt);
  const verified = verifyNativeModelResourceReceipt({ receipt: join(candidate, 'receipt.json') });
  assert.equal(verified.status, 'verified-resource-candidate-not-accepted');
  assert.equal(verified.resourceIntegrityVerified, true);
  assert.equal(verified.acceptedForProduction, false);
  assert.equal(verified.runtimeModelSourceRecovered, false);
  assert.equal(verified.outputFingerprint, receipt.output.fingerprint);
});

test('receipt consumer validates current inputs and copies without changing either tree or receipt', t => {
  const options = fixture(t);
  const generated = repairNativeModelResources(options);
  const receipt = join(options.output, 'receipt.json');
  const before = fingerprintDirectory(options.workspace, 'input');
  const candidateBefore = fingerprintDirectory(options.workspace, '.artifacts/native-resource-repair/candidate');
  const result = verifyNativeModelResourceReceipt({ ...options, receipt });
  assert.equal(result.resourceIntegrityVerified, true);
  assert.equal(result.inputFingerprint, generated.input.fingerprint);
  assert.equal(result.outputFingerprint, generated.output.fingerprint);
  assert.deepEqual(result.summary, generated.summary);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
  assert.deepEqual(fingerprintDirectory(options.workspace, '.artifacts/native-resource-repair/candidate'),
    candidateBefore);
});

const corruptedReceipts = [
  ['schema version', value => { value.schemaVersion = 2; }, /Unsupported repair receipt schema/],
  ['contract', value => { value.contract = 'native-source-complete'; }, /Invalid repair receipt contract/],
  ['status', value => { value.status = 'accepted'; }, /Resource repair is not native acceptance/],
  ['production acceptance', value => { value.acceptedForProduction = true; }, /cannot assert production acceptance/],
  ['source recovery', value => { value.runtimeModelSourceRecovered = true; }, /cannot assert loader source recovery/],
  ['method', value => { value.repair.method = 'reformat-json'; }, /Unsupported repair method/],
  ['expected inventory', value => { value.expectedInventory.escapedLf++; }, /inventory differs from the audit/],
  ['summary', value => { value.summary.changedFiles++; }, /Receipt summary differs/],
  ['missing file record', value => { value.files.pop(); }, /Receipt per-file evidence differs/],
  ['duplicate file record', value => { value.files.push(value.files[0]); }, /Receipt per-file evidence differs/],
  ['repaired file hash', value => { value.files[0].repairedSha256 = '0'.repeat(64); }, /Receipt per-file evidence differs/],
  ['LF offsets', value => { value.files.find(file => file.changed).lfUtf16Offsets = [0]; }, /Receipt per-file evidence differs/],
  ['input evidence', value => { value.input.fingerprint = '0'.repeat(64); }, /Receipt input evidence differs/],
  ['output evidence', value => { value.output.fingerprint = '0'.repeat(64); }, /Receipt output evidence differs/],
  ['output path escape', value => { value.output.path = '../outside'; }, /Receipt output evidence differs/],
];
for (const [name, corrupt, error] of corruptedReceipts) {
  test(`receipt consumer rejects altered ${name} and does not rewrite the candidate`, t => {
    const options = fixture(t);
    const generated = repairNativeModelResources(options);
    corrupt(generated);
    const receipt = join(options.output, 'receipt.json');
    fs.writeFileSync(receipt, JSON.stringify(generated));
    const before = fingerprintDirectory(options.workspace, '.artifacts/native-resource-repair/candidate');
    assert.throws(() => verifyNativeModelResourceReceipt({ ...options, receipt }), error);
    assert.deepEqual(fingerprintDirectory(options.workspace, '.artifacts/native-resource-repair/candidate'),
      before);
  });
}

for (const tree of ['input', 'copy']) {
  test(`receipt consumer rejects stale ${tree} bytes without changing evidence`, t => {
    const options = fixture(t);
    repairNativeModelResources(options);
    const root = tree === 'input' ? options.input : join(options.output, 'resources');
    fs.writeFileSync(join(root, 'valid.json'), '{"changed":"stale valid JSON"}');
    const receipt = join(options.output, 'receipt.json');
    const before = fs.readFileSync(receipt);
    assert.throws(() => verifyNativeModelResourceReceipt({ ...options, receipt }),
      tree === 'input' ? /Receipt per-file evidence differs/ : /Current repaired resources differ/);
    assert.deepEqual(fs.readFileSync(receipt), before);
    assert.equal(fs.readFileSync(join(root, 'valid.json'), 'utf8'), '{"changed":"stale valid JSON"}');
  });
}

for (const entry of ['receipt.json', 'resources']) {
  test(`receipt consumer rejects symlinked ${entry} without following it`, t => {
    const options = fixture(t);
    repairNativeModelResources(options);
    const path = join(options.output, entry);
    const external = join(options.workspace, 'external');
    fs.renameSync(path, external);
    fs.symlinkSync(external, path);
    assert.throws(() => verifyNativeModelResourceReceipt({
      ...options, receipt: join(options.output, 'receipt.json'),
    }), /Symlink/);
    assert.equal(fs.lstatSync(path).isSymbolicLink(), true);
  });
}

test('receipt consumer rejects partial candidates, path escapes and missing receipts', t => {
  const options = fixture(t);
  repairNativeModelResources(options);
  const receipt = join(options.output, 'receipt.json');
  for (const path of [join(options.workspace, 'receipt.json'), join(options.output, 'wrong.json'),
    join(options.output, 'nested/receipt.json')]) {
    assert.throws(() => verifyNativeModelResourceReceipt({ ...options, receipt: path }),
      /Receipt must belong|Expected a candidate/);
  }
  assert.throws(() => verifyNativeModelResourceReceipt(options), /receipt path is required/);
  fs.writeFileSync(join(options.output, '.receipt.tmp'), 'partial');
  assert.throws(() => verifyNativeModelResourceReceipt({ ...options, receipt }),
    /Unexpected candidate files/);
});

test('receipt replacement during validation is rejected and all read descriptors are closed', t => {
  const options = fixture(t);
  repairNativeModelResources(options);
  const receipt = join(options.output, 'receipt.json');
  const before = fs.readFileSync(receipt);
  const descriptors = fs.readdirSync('/proc/self/fd').length;
  const read = fs.readFileSync;
  let changed = false;
  t.mock.method(fs, 'readFileSync', (path, flags) => {
    const target = openedPath(path);
    const result = read(path, flags);
    if (!changed && target === join(options.input, 'valid.json')) {
      changed = true;
      fs.renameSync(receipt, join(options.workspace, 'replaced-receipt.json'));
      fs.writeFileSync(receipt, before, { flag: 'wx' });
    }
    return result;
  });
  assert.throws(() => verifyNativeModelResourceReceipt({ ...options, receipt }),
    /Resource identity changed: receipt.json/);
  assert.equal(changed, true);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
  assert.deepEqual(fs.readFileSync(receipt), before);
});

for (const operation of ['prepare', 'verify']) {
  for (const change of ['bytes', 'additional resource', 'removed resource', 'candidate entry']) {
    test(`${operation} rejects output ${change} introduced during the final original-input read`, t => {
      const options = fixture(t);
      if (operation === 'verify') repairNativeModelResources(options);
      const before = fingerprintDirectory(options.workspace, 'input');
      const descriptors = fs.readdirSync('/proc/self/fd').length;
      const resource = join(options.output, 'resources/valid.json');
      const receipt = join(options.output, 'receipt.json');
      const read = fs.readFileSync;
      let outputRead = false;
      let injected = false;
      t.mock.method(fs, 'readFileSync', (path, ...args) => {
        const target = openedPath(path);
        const result = read(path, ...args);
        if (target === resource) outputRead = true;
        if (!injected && outputRead && fs.existsSync(receipt) &&
          target === join(options.input, 'valid.json')) {
          injected = true;
          if (change === 'bytes') fs.writeFileSync(resource, '{"changed":"late output"}');
          else if (change === 'additional resource') {
            fs.writeFileSync(join(options.output, 'resources/late.json'), '{}', { flag: 'wx' });
          } else if (change === 'removed resource') fs.unlinkSync(resource);
          else fs.writeFileSync(join(options.output, 'late.json'), '{}', { flag: 'wx' });
        }
        return result;
      });
      assert.throws(() => operation === 'prepare' ? repairNativeModelResources(options)
        : verifyNativeModelResourceReceipt({ ...options, receipt }),
      /Copied resource tree|Current repaired resources|Repaired resources changed|Unexpected candidate files|ENOENT/);
      assert.equal(injected, true, 'The final input read must actually exercise the output mutation');
      assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
      assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
    });
  }
}

// Same-UID 0700 replacement before the first stat is outside the single-writer boundary.
for (const phase of ['after mkdir', 'before directory open']) {
  for (const replacement of ['symlink', 'regular directory']) {
    const label = phase === 'after mkdir' && replacement === 'regular directory'
      ? 'regular directory (0755)' : replacement;
    test(`${label} substitution ${phase} cannot be accepted or removed as an owned directory`, t => {
      const options = fixture(t);
      const before = fingerprintDirectory(options.workspace, 'input');
      const external = join(options.workspace, 'external');
      fs.mkdirSync(external);
      fs.writeFileSync(join(external, 'sentinel'), 'keep');
      const moved = join(options.workspace, 'moved-owned-candidate');
      const descriptors = fs.readdirSync('/proc/self/fd').length;
      const mkdir = fs.mkdirSync;
      const open = fs.openSync;
      let injected = false;
      let substitute;
      const replace = () => {
        injected = true;
        fs.renameSync(options.output, moved);
        if (replacement === 'symlink') fs.symlinkSync(external, options.output);
        else {
          mkdir(options.output, { mode: 0o755 });
          fs.chmodSync(options.output, 0o755);
          substitute = fs.lstatSync(options.output);
        }
      };
      if (phase === 'after mkdir') {
        t.mock.method(fs, 'mkdirSync', (path, ...args) => {
          const result = mkdir(path, ...args);
          if (!injected && path.endsWith('/candidate')) replace();
          return result;
        });
      } else {
        t.mock.method(fs, 'openSync', (path, flags, ...args) => {
          if (!injected && (flags & fs.constants.O_DIRECTORY) && path.endsWith('/candidate')) replace();
          return open(path, flags, ...args);
        });
      }
      const error = phase === 'after mkdir' && replacement === 'regular directory'
        ? /Created directory permissions changed/ : /Directory changed|Symlink|ELOOP|ENOTDIR/;
      assert.throws(() => repairNativeModelResources(options), error);
      assert.equal(injected, true);
      assert.deepEqual(fs.readdirSync(external), ['sentinel']);
      assert.equal(fs.readFileSync(join(external, 'sentinel'), 'utf8'), 'keep');
      if (replacement === 'regular directory') {
        const current = fs.lstatSync(options.output);
        assert.equal(current.dev, substitute.dev);
        assert.equal(current.ino, substitute.ino);
        assert.deepEqual(fs.readdirSync(options.output), []);
      } else assert.equal(fs.lstatSync(options.output).isSymbolicLink(), true);
      assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
      assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
    });
  }
}

test('receipt publication is exclusive and cannot unlink a substituted temporary receipt', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const open = fs.openSync;
  const link = fs.linkSync;
  const unlink = fs.unlinkSync;
  const writes = [];
  const links = [];
  const unlinks = [];
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if ((flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) writes.push(flags);
    return open(path, flags, ...args);
  });
  t.mock.method(fs, 'linkSync', (...args) => {
    links.push(args);
    return link(...args);
  });
  t.mock.method(fs, 'unlinkSync', path => {
    unlinks.push(path);
    if (path.endsWith('/.receipt.tmp')) {
      fs.renameSync(path, join(options.workspace, 'owned-receipt-backup'));
      fs.writeFileSync(path, 'keep independent temporary receipt', { flag: 'wx' });
    }
    return unlink(path);
  });
  repairNativeModelResources(options);
  assert.deepEqual(links, [], 'Publication must not hard-link a mutable temporary pathname');
  assert.deepEqual(unlinks, [], 'Publication must not delete a mutable temporary pathname');
  assert.equal(writes.length, 1);
  for (const flag of [fs.constants.O_CREAT, fs.constants.O_EXCL, fs.constants.O_NOFOLLOW]) {
    assert.ok(writes[0] & flag, `Receipt open must include flag ${flag}`);
  }
  assert.equal(fs.existsSync(join(options.output, '.receipt.tmp')), false);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
});

test('ambiguous failure cannot unlink or rmdir a pathname substituted after a cleanup identity check', t => {
  const options = fixture(t);
  const before = fingerprintDirectory(options.workspace, 'input');
  const descriptors = fs.readdirSync('/proc/self/fd').length;
  const open = fs.openSync;
  const unlink = fs.unlinkSync;
  const rmdir = fs.rmdirSync;
  const deletions = [];
  let injected = false;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (!injected && (flags & fs.constants.O_CREAT) &&
      /\/(?:receipt\.json|\.receipt\.tmp)$/.test(path)) {
      injected = true;
      throw new Error('Injected ambiguous publication failure');
    }
    return open(path, flags, ...args);
  });
  t.mock.method(fs, 'unlinkSync', path => {
    deletions.push(path);
    fs.renameSync(path, join(options.workspace, 'cleanup-owned-backup'));
    fs.writeFileSync(path, 'keep independent cleanup substitute', { flag: 'wx' });
    return unlink(path);
  });
  t.mock.method(fs, 'rmdirSync', path => {
    deletions.push(path);
    return rmdir(path);
  });
  assert.throws(() => repairNativeModelResources(options), /Injected ambiguous publication failure/);
  assert.equal(injected, true);
  assert.deepEqual(deletions, [], 'Identity checks cannot authorize later pathname deletion');
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.deepEqual(fingerprintDirectory(options.workspace, 'input'), before);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
});
