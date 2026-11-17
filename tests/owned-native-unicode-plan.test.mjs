import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  buildOwnedNativeUnicodePlan, quoteMysql57Identifier, quoteMysql57Literal,
  writeOwnedNativeUnicodePlan,
} from '../owned-native-unicode-plan.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tool = fileURLToPath(new URL('../owned-native-unicode-plan.mjs', import.meta.url));
const runId = '123456abcdef';
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

function counted(metadata) {
  metadata.counts = Object.fromEntries([
    'schemas', 'tables', 'columns', 'indexes', 'characterSets', 'collations',
    'foreignKeys', 'triggers', 'views', 'routines',
  ].map(name => [name, metadata[name].length]));
  return metadata;
}

function fixture() {
  const { manifest } = createFixture({
    runId, passwordStorageMode: 'sm3', modelVersion: 819, secret: () => 'a'.repeat(36),
  });
  const manifestSha256 = hash(serialize(manifest));
  const database = manifest.schemas.modelA;
  const table = "Item`s'";
  const column = (name, type, values = {}) => ({
    database, table, column: name, type, columnType: type, ordinal: 1, key: '',
    nullable: 'YES', default: null, extra: '', charset: null, collation: null,
    characterLength: null, octetLength: null, comment: '', generationExpression: '', ...values,
  });
  const metadata = counted({
    contract: 'owned-native-unicode-inventory-v1',
    runId, manifestSha256, observedAt: '2026-11-15T00:00:00.000Z',
    coverage: {
      schemas: 'manifest-exact', tables: 'all-base-tables', columns: 'all-columns',
      indexes: 'all-index-parts', dependencies: 'all-touching-selected-schemas',
      collations: 'server-catalog',
    },
    server: {
      vendor: 'mysql', version: '5.7.41', innodbPageSize: 16384,
      innodbLargePrefix: true, innodbFileFormat: 'Barracuda', innodbStrictMode: true,
      lowerCaseTableNames: 0, sqlModes: ['STRICT_TRANS_TABLES', 'NO_ENGINE_SUBSTITUTION'],
      characterSetClient: 'utf8mb4', characterSetConnection: 'utf8mb4', characterSetResults: 'utf8mb4',
    },
    schemas: Object.values(manifest.schemas).map(schema => ({
      schema, charset: 'utf8', collation: 'utf8_general_ci',
    })),
    tables: [{
      database, table, kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic',
      collation: 'utf8_general_ci', createOptions: '', comment: "表注释 ' \\ \n",
    }],
    columns: [
      column('ID', 'int', { columnType: 'int(11)', key: 'PRI', nullable: 'NO' }),
      column("名`称'", 'varchar', {
        columnType: 'varchar(100)', ordinal: 2, key: 'MUL', nullable: 'NO',
        default: "中文😀 e\u0301 ' \\ \n", charset: 'utf8', collation: 'utf8_general_ci',
        characterLength: 100, octetLength: 300, comment: "注释 😀 ' \\ \n",
      }),
      column('NOTE', 'text', {
        ordinal: 3, charset: 'utf8', collation: 'utf8_unicode_ci',
        characterLength: 65535, octetLength: 65535,
      }),
      column('MB4', 'varchar', {
        columnType: 'varchar(32)', ordinal: 4, charset: 'utf8mb4', collation: 'utf8mb4_bin',
        characterLength: 32, octetLength: 128, default: "' \\ \n",
      }),
      column('BYTES', 'varbinary', {
        columnType: 'varbinary(16)', ordinal: 5, characterLength: 16, octetLength: 16,
      }),
    ],
    indexes: [
      { database, table, name: 'PRIMARY', column: 'ID', position: 1, nonUnique: 0, prefix: null, type: 'BTREE', collation: 'A' },
      { database, table, name: 'idx`name', column: "名`称'", position: 1, nonUnique: 1, prefix: null, type: 'BTREE', collation: 'A' },
    ],
    characterSets: [{ name: 'utf8', maxlen: 3 }, { name: 'utf8mb4', maxlen: 4 }],
    collations: ['general_ci', 'unicode_ci', 'bin'].flatMap(suffix => [
      { name: `utf8_${suffix}`, charset: 'utf8' },
      { name: `utf8mb4_${suffix}`, charset: 'utf8mb4' },
    ]),
    foreignKeys: [], triggers: [], views: [], routines: [],
  });
  return { runId, manifest, manifestSha256, metadata };
}

function build(changes = () => {}) {
  const input = fixture();
  changes(input.metadata, input);
  counted(input.metadata);
  return buildOwnedNativeUnicodePlan(input);
}

function caseOne(metadata) {
  metadata.server.lowerCaseTableNames = 1;
  for (const row of [...metadata.tables, ...metadata.columns, ...metadata.indexes]) {
    row.table = row.table.toLowerCase();
  }
}

function hasCode(plan, code) {
  return plan.issues.some(issue => issue.code === code && issue.severity === 'block');
}

function expectBlocked(changes, code) {
  const plan = build(changes);
  assert.equal(plan.status, 'BLOCKED');
  assert.deepEqual(plan.migrationStatements, []);
  assert.equal(plan.executionAllowed, false);
  assert.ok(hasCode(plan, code), `Expected ${code}: ${JSON.stringify(plan.issues)}`);
  return plan;
}

function diskFixture(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'owned-unicode-plan-'));
  const input = fixture();
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const manifestPath = join(base, 'manifest.json');
  const metadataPath = join(base, 'inventory.private.json');
  writeFileSync(manifestPath, serialize(input.manifest), { mode: 0o600 });
  writeFileSync(metadataPath, serialize(input.metadata), { mode: 0o600 });
  t.after(() => rmSync(workspace, { force: true, recursive: true }));
  return {
    ...input, workspace, base, manifestPath, metadataPath,
    metadataSha256: hash(serialize(input.metadata)), output: join(base, 'unicode-plan-unit'),
  };
}

test('pure plan binds exact owned schemas and never claims execution or acceptance', () => {
  const input = fixture();
  const before = structuredClone(input);
  const plan = buildOwnedNativeUnicodePlan(input);
  assert.deepEqual(input, before);
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  assert.deepEqual(plan.schemaScope, Object.values(input.manifest.schemas).sort());
  assert.equal(plan.counts.changedColumns, 2);
  assert.equal(plan.counts.changedTables, 1);
  assert.equal(plan.migrationStatements.length, 5);
  for (const flag of [
    'executionAllowed', 'migrationExecuted', 'backupVerified', 'cloneRestoreVerified',
    'dataPreservationVerified', 'idempotenceVerified', 'apiUnicodeVerified',
    'nativeAcceptance', 'fullAcceptance',
  ]) assert.equal(plan[flag], false, flag);
  assert.equal(plan.planOnly, true);
  assert.ok(plan.issues.some(issue => issue.code === 'ROW-SIZE-CLONE-CHECK'
    && issue.severity === 'review'));
});

test('column clauses preserve exact type, nullability, literal defaults and comments', () => {
  const plan = build();
  const table = plan.tables[0];
  const name = table.columns.find(column => column.column === "名`称'");
  assert.equal(name.before.columnType, 'varchar(100)');
  assert.equal(name.target.collation, 'utf8mb4_general_ci');
  assert.equal(name.modifyClause,
    "MODIFY COLUMN `名``称'` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
    + " NOT NULL DEFAULT '中文😀 e\u0301 \\' \\\\ \\n' COMMENT '注释 😀 \\' \\\\ \\n'");
  const note = table.columns.find(column => column.column === 'NOTE');
  assert.equal(note.target.collation, 'utf8mb4_unicode_ci');
  assert.match(note.modifyClause, /^MODIFY COLUMN `NOTE` text CHARACTER SET utf8mb4/);
  assert.doesNotMatch(note.modifyClause, /mediumtext|DEFAULT/i);
  assert.ok(table.proposedStatement.includes(".`Item``s'` "));
  assert.ok(plan.migrationStatements.every(statement => !/CONVERT TO|SET GLOBAL|DROP |TRUNCATE /i.test(statement)));
});

test('existing mb4 collation, binary bytes and numeric/generated metadata are not rewritten', () => {
  const plan = build();
  for (const name of ['ID', 'MB4', 'BYTES']) {
    const column = plan.tables[0].columns.find(row => row.column === name);
    assert.equal(column.changed, false);
    assert.equal(column.modifyClause, null);
  }
  const mb4 = plan.tables[0].columns.find(row => row.column === 'MB4');
  assert.equal(mb4.before.collation, 'utf8mb4_bin');
  assert.equal(mb4.target.collation, 'utf8mb4_bin');
});

test('no-change plan remains an unexecuted metadata observation, not idempotence proof', () => {
  const plan = build(metadata => {
    for (const schema of metadata.schemas) {
      schema.charset = 'utf8mb4';
      schema.collation = 'utf8mb4_general_ci';
    }
    metadata.tables[0].collation = 'utf8mb4_general_ci';
    for (const column of metadata.columns.filter(row => row.charset === 'utf8')) {
      column.charset = 'utf8mb4';
      column.collation = column.collation.replace('utf8_', 'utf8mb4_');
      if (column.type === 'varchar') column.octetLength = column.characterLength * 4;
    }
  });
  assert.equal(plan.status, 'NO-UTF8-CHANGES-PLANNED');
  assert.equal(plan.counts.changedColumns, 0);
  assert.deepEqual(plan.migrationStatements, []);
  assert.equal(plan.idempotenceVerified, false);
});

test('missing matching collation never falls back to a global default', () => {
  expectBlocked(metadata => {
    metadata.collations = metadata.collations.filter(row => row.name !== 'utf8mb4_unicode_ci');
  }, 'UNSUPPORTED-COLLATION');
});

test('schema and table defaults map independently without flattening collation families', () => {
  const plan = build(metadata => {
    metadata.schemas[0].collation = 'utf8_unicode_ci';
    metadata.tables[0].collation = 'utf8_bin';
  });
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  assert.ok(plan.migrationStatements.some(statement => statement.endsWith('COLLATE utf8mb4_unicode_ci;')));
  assert.ok(plan.tables[0].proposedStatement.includes('DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,'));
  assert.equal(plan.tables[0].columns[1].target.collation, 'utf8mb4_general_ci');
  const mb4Table = build(metadata => { metadata.tables[0].collation = 'utf8mb4_bin'; });
  assert.equal(mb4Table.status, 'PLANNED-NOT-EXECUTED');
  assert.ok(!mb4Table.tables[0].proposedStatement.includes('DEFAULT CHARACTER SET'));
});

test('utf8mb3 alias maps by its suffix only when explicitly observed in both catalogs', () => {
  const plan = build(metadata => {
    metadata.characterSets.push({ name: 'utf8mb3', maxlen: 3 });
    metadata.collations.push({ name: 'utf8mb3_general_ci', charset: 'utf8mb3' });
    metadata.columns[1].charset = 'utf8mb3';
    metadata.columns[1].collation = 'utf8mb3_general_ci';
  });
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  assert.equal(plan.tables[0].columns[1].target.collation, 'utf8mb4_general_ci');
});

test('other character sets require a separate policy, even when their catalog is complete', () => {
  expectBlocked(metadata => {
    metadata.characterSets.push({ name: 'latin1', maxlen: 1 });
    metadata.collations.push({ name: 'latin1_swedish_ci', charset: 'latin1' });
    metadata.columns[1].charset = 'latin1';
    metadata.columns[1].collation = 'latin1_swedish_ci';
    metadata.columns[1].octetLength = 100;
  }, 'OTHER-CHARSET');
});

test('missing schema, foreign schema and wrong run/manifest bindings are rejected', () => {
  for (const change of [
    input => { input.runId = 'abcdef123456'; },
    input => { input.metadata.runId = 'abcdef123456'; },
    input => { input.metadata.manifestSha256 = '0'.repeat(64); },
    input => { input.manifest.schemas.modelA = 'shared'; },
    input => { input.metadata.schemas.pop(); },
    input => { input.metadata.columns[0].database = 'shared'; },
    input => { input.metadata.tables[0].database = 'shared'; },
    input => { input.metadata.indexes[0].database = 'shared'; },
  ]) {
    const input = fixture();
    change(input);
    assert.throws(() => buildOwnedNativeUnicodePlan(input));
  }
});

test('missing arrays, coverage or independent counts block instead of assuming empty', () => {
  const input = fixture();
  delete input.metadata.indexes;
  const plan = buildOwnedNativeUnicodePlan(input);
  assert.equal(plan.status, 'BLOCKED');
  assert.ok(hasCode(plan, 'METADATA-INCOMPLETE'));
  expectBlocked(metadata => { delete metadata.coverage.dependencies; }, 'METADATA-COVERAGE');
  const mismatch = fixture();
  mismatch.metadata.counts.columns--;
  assert.ok(hasCode(buildOwnedNativeUnicodePlan(mismatch), 'METADATA-COUNT'));
});

test('missing default differs from explicit NULL and incomplete columns block', () => {
  expectBlocked(metadata => { delete metadata.columns[1].default; }, 'COLUMN-METADATA');
  expectBlocked(metadata => { delete metadata.columns[1].comment; }, 'COLUMN-METADATA');
  expectBlocked(metadata => { metadata.columns[1].ordinal = 99; }, 'COLUMN-METADATA');
  expectBlocked(metadata => { metadata.columns[1].octetLength = 299; }, 'COLUMN-LENGTH');
  expectBlocked(metadata => { delete metadata.columns[1].column; }, 'METADATA-INCOMPLETE');
  expectBlocked(metadata => { delete metadata.tables[0].table; }, 'METADATA-INCOMPLETE');
});

test('unreviewed server, SQL mode and connection charset do not produce migration SQL', () => {
  expectBlocked(metadata => { metadata.server.version = '8.0.36'; }, 'SERVER-PROFILE');
  expectBlocked(metadata => { metadata.server.vendor = 'mariadb'; }, 'SERVER-PROFILE');
  expectBlocked(metadata => { delete metadata.server.innodbPageSize; }, 'INNODB-PROFILE');
  expectBlocked(metadata => { metadata.server.sqlModes.push('NO_BACKSLASH_ESCAPES'); }, 'SQL-MODE');
  expectBlocked(metadata => { metadata.server.sqlModes = []; }, 'SQL-MODE');
  expectBlocked(metadata => { metadata.server.sqlModes = [123]; }, 'SQL-MODE');
  expectBlocked(metadata => { metadata.server.characterSetConnection = 'utf8'; }, 'CONNECTION-CHARSET');
  expectBlocked(metadata => { metadata.server.lowerCaseTableNames = 2; }, 'INNODB-PROFILE');
});

test('explicit case=1 profile requires exact canonical ASCII schema/table names without rewriting', () => {
  const plan = build(caseOne);
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  assert.deepEqual(plan.identifierCasePolicy, {
    observedLowerCaseTableNames: 1, mode: 'exact-canonical-lowercase-ascii',
    schemasChecked: 4, tablesChecked: 1,
    collisionCount: 0, noncanonicalCount: 0, unsupportedNameCount: 0, namesRewritten: false,
  });
  assert.equal(plan.tables[0].table, "item`s'");
  assert.equal(plan.tables[0].columns[1].column, "名`称'");
  assert.equal(plan.migrationExecuted, false);
});

test('case=1 does not silently fold mixed-case names or normalize Unicode table identities', () => {
  expectBlocked(metadata => { metadata.server.lowerCaseTableNames = 1; }, 'CASE1-NONCANONICAL-IDENTIFIER');
  expectBlocked(metadata => {
    caseOne(metadata);
    for (const row of [...metadata.tables, ...metadata.columns, ...metadata.indexes]) row.table = '表';
  }, 'CASE1-IDENTIFIER-UNREVIEWED');
});

test('case=1 normalized collisions block while equal table names in different owned schemas remain distinct', () => {
  const collision = expectBlocked(metadata => {
    caseOne(metadata);
    for (const name of ['tables', 'columns', 'indexes']) {
      metadata[name].push(...structuredClone(metadata[name]).map(row =>
        ({ ...row, table: row.table.toUpperCase() })));
    }
  }, 'CASE1-IDENTIFIER-COLLISION');
  assert.equal(collision.identifierCasePolicy.collisionCount, 1);
  assert.equal(collision.identifierCasePolicy.namesRewritten, false);
  const valid = build((metadata, input) => {
    caseOne(metadata);
    for (const name of ['tables', 'columns', 'indexes']) {
      metadata[name].push(...structuredClone(metadata[name]).map(row =>
        ({ ...row, database: input.manifest.schemas.modelB })));
    }
  });
  assert.equal(valid.status, 'PLANNED-NOT-EXECUTED');
  assert.equal(valid.identifierCasePolicy.collisionCount, 0);
  const input = fixture();
  caseOne(input.metadata);
  input.metadata.schemas.push({ ...input.metadata.schemas[0] });
  counted(input.metadata);
  assert.throws(() => buildOwnedNativeUnicodePlan(input), /exactly the manifest-owned schemas/);
});

test('DDL-looking column type and unreviewed enum/set/extra metadata are blocked', () => {
  for (const type of ["varchar(100); DROP DATABASE shared", "enum('a','b')", "set('a','b')"]) {
    expectBlocked(metadata => {
      metadata.columns[1].columnType = type;
      metadata.columns[1].type = type.startsWith('enum') ? 'enum' : type.startsWith('set') ? 'set' : 'varchar';
    }, 'COLUMN-PROFILE');
  }
  expectBlocked(metadata => { metadata.columns[1].extra = 'STORAGE DISK'; }, 'COLUMN-PROFILE');
});

test('generated columns are preserved verbatim and block affected-table DDL', () => {
  const plan = expectBlocked(metadata => {
    metadata.columns[3].generationExpression = 'lower(`名``称\\\'`)';
    metadata.columns[3].extra = 'VIRTUAL GENERATED';
  }, 'GENERATED-DEPENDENCY');
  assert.equal(plan.tables[0].columns[3].before.extra, 'VIRTUAL GENERATED');
  assert.equal(plan.tables[0].columns[3].modifyClause, null);
});

test('TEXT capacity/defaults are not widened or normalized silently', () => {
  expectBlocked(metadata => { metadata.columns[2].default = 'content'; }, 'TEXT-PROFILE');
  expectBlocked(metadata => { metadata.columns[2].octetLength = 16777215; }, 'TEXT-PROFILE');
});

test('index budget uses full utf8mb4 bytes and preserves prefix/uniqueness', () => {
  const plan = build(metadata => {
    metadata.indexes[1].prefix = 40;
    metadata.indexes[1].nonUnique = 0;
    metadata.columns[1].key = 'UNI';
  });
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  const index = plan.tables[0].indexes.find(row => row.name === 'idx`name');
  assert.equal(index.sourceKeyBytes, 120);
  assert.equal(index.targetKeyBytes, 160);
  assert.equal(index.limitBytes, 3072);
  assert.deepEqual(index.parts, [{
    column: "名`称'", prefix: 40, prefixUnits: 'characters',
    sourceMaxBytes: 120, targetMaxBytes: 160,
  }]);
  assert.equal(index.prefixOrUniquenessChanged, false);
  assert.ok(plan.issues.some(issue => issue.code === 'UNIQUE-COLLATION-CLONE-CHECK'));
});

test('composite Dynamic key totals sum character, integer and binary bytes', () => {
  const plan = build(metadata => {
    metadata.indexes.push(
      { ...metadata.indexes[1], column: 'ID', position: 2, prefix: null },
      { ...metadata.indexes[1], column: 'BYTES', position: 3, prefix: 8 },
    );
  });
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  const index = plan.tables[0].indexes.find(row => row.name === 'idx`name');
  assert.equal(index.sourceKeyBytes, 312);
  assert.equal(index.targetKeyBytes, 412);
});

test('16KB Dynamic, 8KB and 4KB page budgets are respectively 3072/1536/768', () => {
  for (const [pageSize, limit] of [[16384, 3072], [8192, 1536], [4096, 768]]) {
    const plan = build(metadata => { metadata.server.innodbPageSize = pageSize; });
    assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
    assert.equal(plan.tables[0].indexes[1].limitBytes, limit);
  }
});

test('overflowing character/composite indexes are blocked and never truncated', () => {
  const plan = expectBlocked(metadata => {
    metadata.columns[1].columnType = 'varchar(800)';
    metadata.columns[1].characterLength = 800;
    metadata.columns[1].octetLength = 2400;
  }, 'INDEX-OVERFLOW');
  const index = plan.tables[0].indexes[1];
  assert.equal(index.before[0].prefix, null);
  assert.equal(index.targetKeyBytes, 3200);
  assert.equal(index.prefixOrUniquenessChanged, false);
});

test('legacy single-part key uses 767 and ambiguous legacy composite key remains blocked', () => {
  const small = build(metadata => { metadata.tables[0].rowFormat = 'Compact'; });
  assert.equal(small.status, 'PLANNED-NOT-EXECUTED');
  assert.equal(small.tables[0].indexes[1].limitBytes, 767);
  expectBlocked(metadata => {
    metadata.tables[0].rowFormat = 'Compact';
    metadata.columns[1].columnType = 'varchar(200)';
    metadata.columns[1].characterLength = 200;
    metadata.columns[1].octetLength = 600;
  }, 'INDEX-OVERFLOW');
  const composite = expectBlocked(metadata => {
    metadata.tables[0].rowFormat = 'Compact';
    metadata.indexes.push({ ...metadata.indexes[1], column: 'ID', position: 2 });
  }, 'LEGACY-COMPOSITE-LIMIT-UNREVIEWED');
  assert.equal(composite.tables[0].indexes[1].limitBytes, null);
});

test('unknown indexes, absent parts, TEXT without prefix and unsupported storage are blocked', () => {
  expectBlocked(metadata => { metadata.indexes[1].type = 'FULLTEXT'; }, 'INDEX-PROFILE');
  expectBlocked(metadata => { delete metadata.indexes[1].prefix; }, 'INDEX-PROFILE');
  expectBlocked(metadata => { metadata.indexes[1].position = 2; }, 'INDEX-PROFILE');
  expectBlocked(metadata => { metadata.indexes.pop(); }, 'INDEX-COLUMN-COVERAGE');
  expectBlocked(metadata => { metadata.indexes[1].column = 'NOTE'; }, 'INDEX-PREFIX');
  expectBlocked(metadata => {
    metadata.columns[0].type = 'decimal';
    metadata.columns[0].columnType = 'decimal(10,2)';
  }, 'INDEX-STORAGE-UNKNOWN');
});

test('row format, table options, oversized payload and dependencies require review', () => {
  expectBlocked(metadata => { metadata.tables[0].rowFormat = 'Compressed'; }, 'TABLE-PROFILE');
  expectBlocked(metadata => { metadata.tables[0].engine = 'MyISAM'; }, 'TABLE-PROFILE');
  expectBlocked(metadata => { metadata.tables[0].createOptions = 'partitioned'; }, 'TABLE-PROFILE');
  expectBlocked(metadata => {
    metadata.columns[1].columnType = 'varchar(20000)';
    metadata.columns[1].characterLength = 20000;
    metadata.columns[1].octetLength = 60000;
  }, 'ROW-PAYLOAD-OVERFLOW');
  expectBlocked(metadata => {
    const { database, table } = metadata.tables[0];
    metadata.foreignKeys.push({
      database, table, name: 'fk_name', column: "名`称'",
      referencedDatabase: database, referencedTable: table, referencedColumn: "名`称'",
    });
  }, 'FOREIGN-KEY-DEPENDENCY');
  expectBlocked(metadata => {
    metadata.triggers.push({ ...metadata.tables[0], name: 'trigger' });
  }, 'TRIGGER-DEPENDENCY');
  expectBlocked(metadata => {
    metadata.views.push({ database: metadata.tables[0].database, name: 'view' });
  }, 'SCHEMA-DEPENDENCY');
  expectBlocked(metadata => {
    metadata.routines.push({ database: metadata.tables[0].database, name: 'procedure' });
  }, 'SCHEMA-DEPENDENCY');
});

test('TEXT/BLOB capacities are excluded from the declared row lower bound, not mistaken for inline payload', () => {
  const plan = build(metadata => {
    for (let index = 0; index < 100; index++) {
      metadata.columns.push({
        ...metadata.columns[2], column: `LONG_${index}`, type: 'mediumtext', columnType: 'mediumtext',
        ordinal: 6 + index, characterLength: 16777215, octetLength: 16777215,
      });
    }
  });
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  const budget = plan.tables[0].rowRisk.declaredBudget;
  assert.equal(budget.targetCharacterPayloadMaxBytes, 528);
  assert.equal(budget.textBlobMinimumLogicalBytes, 909);
  assert.equal(budget.targetKnownLogicalLowerBoundBytes, 1461);
  assert.equal(budget.offPageColumns.length, 101);
  assert.ok(!plan.issues.some(issue => issue.code === 'ROW-PAYLOAD-OVERFLOW'));
  assert.equal(plan.tables[0].rowRisk.exactInlineRowBytes, null);
});

test('known VARCHAR prefixes and minimum TEXT contribution can prove overflow before payload alone', () => {
  const plan = expectBlocked(metadata => {
    const column = metadata.columns[1];
    Object.assign(column, {
      columnType: 'varchar(16350)', characterLength: 16350, octetLength: 49050,
      default: null, key: '',
    });
    metadata.indexes.pop();
  }, 'ROW-PAYLOAD-OVERFLOW');
  const budget = plan.tables[0].rowRisk.declaredBudget;
  assert.equal(budget.targetCharacterPayloadMaxBytes, 65528);
  assert.equal(budget.targetKnownLogicalLowerBoundBytes, 65561);
  assert.ok(budget.targetCharacterPayloadMaxBytes < budget.logicalRowLimitBytes);
});

test('oversized rows propose source/length/default/index review without altering types or selecting DDL', () => {
  const plan = expectBlocked(metadata => {
    metadata.columns[1].columnType = 'varchar(20000)';
    metadata.columns[1].characterLength = 20000;
    metadata.columns[1].octetLength = 60000;
  }, 'ROW-PAYLOAD-OVERFLOW');
  const audit = plan.tables[0];
  const redesign = audit.rowRisk.redesign;
  assert.equal(redesign.status, 'SOURCE-SCHEMA-REDESIGN-REQUIRED-NOT-EXECUTED');
  assert.equal(redesign.automaticallyExecutable, false);
  assert.equal(redesign.allColumnsRemainUnchanged, true);
  const column = redesign.columnsToReview.find(row => row.sourceLocator.column === "名`称'");
  assert.equal(column.original.columnType, 'varchar(20000)');
  assert.equal(column.original.defaultKind, 'literal');
  assert.equal(column.proposal.minimumCapacityType, 'mediumtext');
  assert.equal(column.proposal.preserveMaxCharacters, 20000);
  assert.equal(column.proposal.automaticallySelected, false);
  assert.equal(column.proposal.ddlGenerated, false);
  assert.equal(column.candidateForSourceReview, false);
  assert.equal(column.authoritativeSourceResolved, false);
  assert.equal(column.indexConstraints.length, 1);
  assert.equal(column.indexConstraints[0].prefix, null);
  assert.match(column.blockers.join('\n'), /CHECK is not enforcement/);
  assert.equal(audit.columns[1].before.columnType, 'varchar(20000)');
  assert.ok(audit.columns[1].modifyClause.includes('varchar(20000)'));
  assert.deepEqual(plan.migrationStatements, []);
});

test('plain unindexed NULL-default columns are review candidates, not automatically converted', () => {
  const plan = expectBlocked(metadata => {
    Object.assign(metadata.columns[1], {
      columnType: 'varchar(16350)', characterLength: 16350, octetLength: 49050,
      default: null, key: '',
    });
    metadata.indexes.pop();
  }, 'ROW-PAYLOAD-OVERFLOW');
  const column = plan.tables[0].rowRisk.redesign.columnsToReview
    .find(row => row.sourceLocator.column === "名`称'");
  assert.equal(column.candidateForSourceReview, true);
  assert.equal(column.proposal.minimumCapacityType, 'text');
  assert.equal(column.proposal.preserveNullable, 'NO');
  assert.equal(column.proposal.preserveMaxCharacters, 16350);
  assert.equal(column.proposal.automaticallySelected, false);
  assert.equal(column.original.defaultKind, 'metadata-null-not-an-invented-empty-string');
});

test('incomplete dependency metadata and foreign dependency schemas cannot be ignored', () => {
  expectBlocked(metadata => {
    metadata.triggers.push({ database: metadata.tables[0].database, name: 'trigger' });
  }, 'DEPENDENCY-METADATA');
  const input = fixture();
  input.metadata.foreignKeys.push({
    database: input.manifest.schemas.modelA, referencedDatabase: 'shared',
  });
  counted(input.metadata);
  assert.throws(() => buildOwnedNativeUnicodePlan(input), /Foreign schema dependency/);
});

test('identifier quoting preserves legal BMP punctuation and rejects ambiguous names', () => {
  assert.equal(quoteMysql57Identifier("中文 ` ' ; --"), "`中文 `` ' ; --`");
  assert.equal(quoteMysql57Identifier('column\\name'), '`column\\name`');
  for (const value of ['', 'a'.repeat(65), 'bad\0name', 'bad\nname', 'emoji😀', '\uD800', 'tail ']) {
    assert.throws(() => quoteMysql57Identifier(value));
  }
  for (const value of ['a.b', 'a/b', 'a\\b']) {
    assert.throws(() => quoteMysql57Identifier(value, 'table'));
  }
});

test('literal quoting retains supplementary/combining characters, quote, slash, newline and NUL', () => {
  assert.equal(quoteMysql57Literal("😀e\u0301'\\\n\r\t\0\u001a", []),
    "'😀e\u0301\\'\\\\\\n\\r\\t\\0\\Z'");
  assert.throws(() => quoteMysql57Literal('content', ['NO_BACKSLASH_ESCAPES']));
  assert.throws(() => quoteMysql57Literal('\uD800', []));
});

test('private writer emits only a plan and a redacted summary without executing external commands', t => {
  const input = diskFixture(t);
  const summary = writeOwnedNativeUnicodePlan(input);
  const privatePlan = JSON.parse(readFileSync(join(input.output, 'plan.private.json'), 'utf8'));
  assert.equal(summary.status, 'PLANNED-NOT-EXECUTED');
  assert.equal(summary.executionAllowed, false);
  assert.equal(summary.sha256, hash(serialize(privatePlan)));
  assert.equal(privatePlan.inputs.inventoryFileSha256, input.metadataSha256);
  assert.equal(privatePlan.inputs.plannerFileSha256, hash(readFileSync(tool)));
  assert.ok(!JSON.stringify(summary).includes(input.manifest.schemas.modelA));
  assert.ok(!JSON.stringify(summary).includes('MODIFY COLUMN'));
  assert.throws(() => writeOwnedNativeUnicodePlan(input), /Existing destination/);
});

test('inventory-supplied success claims cannot promote backup, restore, idempotence or API acceptance', () => {
  const flags = [
    'executionAllowed', 'migrationExecuted', 'backupVerified', 'cloneRestoreVerified',
    'dataPreservationVerified', 'idempotenceVerified', 'apiUnicodeVerified',
    'nativeAcceptance', 'fullAcceptance',
  ];
  for (const blocked of [false, true]) {
    const input = fixture();
    for (const flag of flags) input.metadata[flag] = true;
    input.metadata.status = 'MIGRATED-AND-ACCEPTED';
    if (blocked) input.metadata.server.version = '8.0.36';
    const before = structuredClone(input);
    const plan = buildOwnedNativeUnicodePlan(input);
    assert.deepEqual(input, before);
    assert.equal(plan.status, blocked ? 'BLOCKED' : 'PLANNED-NOT-EXECUTED');
    for (const flag of flags) assert.equal(plan[flag], false, flag);
    assert.match(plan.boundary, /metadata audit\/proposal only/i);
    assert.ok(plan.requiredNextSteps.some(step => /backup|clone/i.test(step)));
    assert.ok(plan.requiredNextSteps.some(step => /idempotence/i.test(step)));
    assert.ok(plan.requiredNextSteps.some(step => /API.*Unicode|Unicode.*API/i.test(step)));
  }
});

test('one unsafe table blocks the complete DDL list without discarding safe-table observations', () => {
  const plan = expectBlocked(metadata => {
    const unsafe = 'unsafe_table';
    metadata.tables.push({ ...metadata.tables[0], table: unsafe });
    metadata.columns.push(...structuredClone(metadata.columns).map(column => ({
      ...column, table: unsafe,
      ...(column.column === "名`称'" ? {
        columnType: 'varchar(800)', characterLength: 800, octetLength: 2400,
      } : {}),
    })));
    metadata.indexes.push(...structuredClone(metadata.indexes).map(index => ({
      ...index, table: unsafe,
    })));
  }, 'INDEX-OVERFLOW');
  assert.equal(plan.status, 'BLOCKED');
  assert.deepEqual(plan.migrationStatements, []);
  assert.equal(plan.executionAllowed, false);
  const safe = plan.tables.find(table => table.table === "Item`s'");
  const unsafe = plan.tables.find(table => table.table === 'unsafe_table');
  assert.ok(safe.proposedStatement, 'A private local proposal is not execution authorization');
  assert.equal(unsafe.proposedStatement, null);
  assert.equal(unsafe.indexes[1].targetKeyBytes, 3200);
  assert.equal(unsafe.indexes[1].before[0].prefix, null);
  assert.equal(unsafe.indexes[1].prefixOrUniquenessChanged, false);
  assert.equal(unsafe.columns[1].before.columnType, 'varchar(800)');
  assert.ok(unsafe.columns[1].modifyClause.includes('varchar(800)'));
});

test('private writer rejects unpinned, non-private, cross-run, escaping and symlink inputs', t => {
  const input = diskFixture(t);
  assert.throws(() => writeOwnedNativeUnicodePlan({ ...input, metadataSha256: '0'.repeat(64) }),
    /SHA-256 differs/);
  assert.throws(() => writeOwnedNativeUnicodePlan({ ...input, output: join(input.workspace, 'escape') }),
    /inside this run/);
  assert.throws(() => writeOwnedNativeUnicodePlan({ ...input, runId: 'abcdef123456' }),
    /inside this run/);
  chmodSync(input.metadataPath, 0o644);
  assert.throws(() => writeOwnedNativeUnicodePlan(input), /must remain private/);
  chmodSync(input.metadataPath, 0o600);
  const link = join(input.base, 'inventory-link.private.json');
  symlinkSync(input.metadataPath, link);
  assert.throws(() => writeOwnedNativeUnicodePlan({ ...input, metadataPath: link }),
    /Symlink resource/);
});

test('CLI has no execute mode, produces only a private plan and uses exit 2 for blocked plans', t => {
  const input = diskFixture(t);
  const args = [
    tool, '--plan', `--run-id=${runId}`, `--manifest=${input.manifestPath}`,
    `--manifest-sha256=${input.manifestSha256}`, `--metadata=${input.metadataPath}`,
    `--metadata-sha256=${input.metadataSha256}`, `--output=${input.output}`,
  ];
  const rejected = spawnSync(process.execPath, [tool, '--execute'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(rejected.status, 1);
  assert.ok(!rejected.stderr.includes(input.manifest.schemas.modelA));
  const script = `import { main } from ${JSON.stringify(pathToFileURL(tool).href)};`
    + `main(process.argv.slice(1), { workspace: ${JSON.stringify(input.workspace)} });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, '--', ...args.slice(1)], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'PLANNED-NOT-EXECUTED');
  assert.ok(!result.stdout.includes(input.manifest.schemas.modelA));
  input.metadata.server.version = '8.0.36';
  writeFileSync(input.metadataPath, serialize(input.metadata), { mode: 0o600 });
  const blockedArgs = args.slice(1).map(argument => {
    if (argument.startsWith('--metadata-sha256=')) return `--metadata-sha256=${hash(serialize(input.metadata))}`;
    if (argument.startsWith('--output=')) return `--output=${join(input.base, 'unicode-plan-blocked')}`;
    return argument;
  });
  const blocked = spawnSync(process.execPath, ['--input-type=module', '-e', script, '--', ...blockedArgs], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, 'BLOCKED');
  const source = readFileSync(tool, 'utf8');
  assert.doesNotMatch(source, /(?:spawnSync|execFile|execSync|\.query\(|\.execute\()/);
});
