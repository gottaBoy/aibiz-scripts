#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const oldCharsets = new Set(['utf8', 'utf8mb3']);
const textTypes = new Map([
  ['tinytext', 255], ['text', 65535], ['mediumtext', 16777215], ['longtext', 4294967295],
]);
const integerBytes = new Map([
  ['tinyint', 1], ['smallint', 2], ['mediumint', 3], ['int', 4], ['bigint', 8],
]);
const arrays = [
  'schemas', 'tables', 'columns', 'indexes', 'characterSets', 'collations',
  'foreignKeys', 'triggers', 'views', 'routines',
];
const coverageContract = {
  schemas: 'manifest-exact',
  tables: 'all-base-tables',
  columns: 'all-columns',
  indexes: 'all-index-parts',
  dependencies: 'all-touching-selected-schemas',
  collations: 'server-catalog',
};
const own = (value, key) => Object.hasOwn(value ?? {}, key);
const key = (...parts) => JSON.stringify(parts);
const sorted = values => [...values].sort();
const validText = value => typeof value === 'string'
  && Buffer.from(value, 'utf8').toString('utf8') === value;

export function quoteMysql57Identifier(value, kind = 'column') {
  assert.ok(['schema', 'table', 'column', 'index'].includes(kind), 'Unknown identifier kind');
  assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 64,
    'Identifier must have 1..64 BMP characters');
  assert.ok(!/[\u0000-\u001f\u007f\uD800-\uDFFF\u{10000}-\u{10FFFF}]/u.test(value),
    'Control, surrogate or supplementary identifier is not supported');
  assert.ok(!value.endsWith(' '), 'Trailing-space identifier is not supported');
  if (kind === 'schema' || kind === 'table') {
    assert.ok(!/[./\\]/u.test(value), 'Database/table file-name separators are not supported');
  }
  return `\`${value.replaceAll('`', '``')}\``;
}

export function quoteMysql57Literal(value, sqlModes) {
  assert.ok(validText(value), 'Literal must be lossless UTF-8 text');
  assert.ok(Array.isArray(sqlModes) && sqlModes.every(mode => typeof mode === 'string'));
  assert.ok(!sqlModes.includes('NO_BACKSLASH_ESCAPES'),
    'NO_BACKSLASH_ESCAPES requires a separately reviewed literal renderer');
  const escapes = new Map([
    ['\0', '\\0'], ['\b', '\\b'], ['\n', '\\n'], ['\r', '\\r'], ['\t', '\\t'],
    ['\u001a', '\\Z'], ['\\', '\\\\'], ["'", "\\'"],
  ]);
  return `'${[...value].map(character => escapes.get(character) ?? character).join('')}'`;
}

function groupRows(rows, makeKey) {
  const result = new Map();
  for (const row of rows) {
    const group = makeKey(row);
    if (!result.has(group)) result.set(group, []);
    result.get(group).push(row);
  }
  return result;
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function complete(row, fields) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && fields.every(field => own(row, field));
}

function catalogWord(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

function characterShape(column) {
  const sized = /^(char|varchar)\(([1-9]\d*)\)$/.exec(column.columnType);
  if (sized && sized[1] === column.type && integer(Number(sized[2]), 1)) {
    const length = Number(sized[2]);
    if (length <= (column.type === 'char' ? 255 : 65535)
        && length === column.characterLength) return { kind: column.type, length };
  }
  if (textTypes.has(column.type) && column.columnType === column.type) {
    return { kind: 'text', capacityBytes: textTypes.get(column.type) };
  }
  return null;
}

function fixedBytes(column) {
  const numeric = /^(tinyint|smallint|mediumint|int|bigint)(?:\([1-9]\d*\))?(?: unsigned)?(?: zerofill)?$/
    .exec(column.columnType);
  if (numeric?.[1] === column.type) return integerBytes.get(column.type);
  const binary = /^(binary|varbinary)\(([1-9]\d*)\)$/.exec(column.columnType);
  if (binary?.[1] === column.type && integer(Number(binary[2]), 1)) return Number(binary[2]);
  return null;
}

function indexLimit(table, server) {
  if (!integer(server.innodbPageSize, 4096)) return null;
  const pageLimit = server.innodbPageSize < 16384
    ? 3072 * server.innodbPageSize / 16384 : 3072;
  if (['Compact', 'Redundant'].includes(table.rowFormat) || server.innodbLargePrefix === false) {
    return Math.min(767, pageLimit);
  }
  return table.rowFormat === 'Dynamic' && server.innodbLargePrefix === true
    && server.innodbFileFormat === 'Barracuda' ? pageLimit : null;
}

function identifierCaseAudit(metadata, server, add) {
  const audit = {
    observedLowerCaseTableNames: server.lowerCaseTableNames ?? null,
    mode: server.lowerCaseTableNames === 1 ? 'exact-canonical-lowercase-ascii'
      : server.lowerCaseTableNames === 0 ? 'exact-case-sensitive-profile' : 'unsupported',
    schemasChecked: metadata.schemas.length, tablesChecked: metadata.tables.length,
    collisionCount: 0, noncanonicalCount: 0, unsupportedNameCount: 0,
    namesRewritten: false,
  };
  if (server.lowerCaseTableNames !== 1) return audit;
  const canonical = (name, scope) => {
    if (typeof name !== 'string' || !/^[\x20-\x7e]+$/.test(name)) {
      audit.unsupportedNameCount++;
      add('CASE1-IDENTIFIER-UNREVIEWED',
        'Case=1 support is limited to exact canonical ASCII database/table identifiers; Unicode case folding is not guessed',
        scope);
      return null;
    }
    const normalized = name.toLowerCase();
    if (name !== normalized) {
      audit.noncanonicalCount++;
      add('CASE1-NONCANONICAL-IDENTIFIER',
        'Observed case=1 database/table names must already be lowercase; input names are never silently rewritten',
        scope);
    }
    return normalized;
  };
  const unique = (rows, tableNames) => {
    const seen = new Set();
    for (const row of rows) {
      const scope = tableNames ? { database: row.database, table: row.table } : { database: row.schema };
      const database = canonical(tableNames ? row.database : row.schema, scope);
      const table = tableNames ? canonical(row.table, scope) : '';
      if (database === null || table === null) continue;
      const normalizedKey = key(database, table);
      if (seen.has(normalizedKey)) {
        audit.collisionCount++;
        add('CASE1-IDENTIFIER-COLLISION',
          'Normalized database/table identities collide; no case-insensitive target adoption is allowed', scope);
      }
      seen.add(normalizedKey);
    }
  };
  unique(metadata.schemas, false);
  unique(metadata.tables, true);
  return audit;
}

function declaredRowBudget(columns, charsets) {
  const contributions = [];
  const offPageColumns = [];
  const unpricedColumns = [];
  let sourceCharacterBytes = 0;
  let targetCharacterBytes = 0;
  let sourceLengthPrefixBytes = 0;
  let targetLengthPrefixBytes = 0;
  let knownOtherBytes = 0;
  for (const column of columns) {
    const shape = characterShape(column);
    if (shape && shape.kind !== 'text') {
      const sourceMaxBytes = shape.length * (charsets.get(column.charset) ?? 0);
      const targetMaxBytes = shape.length
        * (oldCharsets.has(column.charset) ? 4 : (charsets.get(column.charset) ?? 0));
      const sourcePrefix = column.type === 'varchar' ? (sourceMaxBytes > 255 ? 2 : 1) : 0;
      const targetPrefix = column.type === 'varchar' ? (targetMaxBytes > 255 ? 2 : 1) : 0;
      sourceCharacterBytes += sourceMaxBytes;
      targetCharacterBytes += targetMaxBytes;
      sourceLengthPrefixBytes += sourcePrefix;
      targetLengthPrefixBytes += targetPrefix;
      contributions.push({
        column: column.column, type: column.type, maxCharacters: shape.length,
        sourceMaxBytes, targetMaxBytes, sourceLengthPrefixBytes: sourcePrefix,
        targetLengthPrefixBytes: targetPrefix,
      });
    } else if (shape?.kind === 'text' || ['tinyblob', 'blob', 'mediumblob', 'longblob'].includes(column.type)) {
      offPageColumns.push({
        column: column.column, type: column.type, declaredCapacityBytesNotAdded: column.octetLength,
        minimumLogicalContributionBytes: 9,
      });
    } else {
      const bytes = fixedBytes(column);
      if (bytes === null) unpricedColumns.push({ column: column.column, type: column.type });
      else {
        knownOtherBytes += bytes;
        if (column.type === 'varbinary') {
          const prefix = bytes > 255 ? 2 : 1;
          sourceLengthPrefixBytes += prefix;
          targetLengthPrefixBytes += prefix;
        }
      }
    }
  }
  const textBlobMinimum = offPageColumns.length * 9;
  return {
    logicalRowLimitBytes: 65535,
    sourceCharacterPayloadMaxBytes: sourceCharacterBytes,
    targetCharacterPayloadMaxBytes: targetCharacterBytes,
    sourceLengthPrefixBytes, targetLengthPrefixBytes,
    textBlobMinimumLogicalBytes: textBlobMinimum, knownOtherBytes,
    sourceKnownLogicalLowerBoundBytes: sourceCharacterBytes + sourceLengthPrefixBytes + textBlobMinimum + knownOtherBytes,
    targetKnownLogicalLowerBoundBytes: targetCharacterBytes + targetLengthPrefixBytes + textBlobMinimum + knownOtherBytes,
    contributions, offPageColumns, unpricedColumns,
    boundary: 'Known declaration-size lower bound only. TEXT/BLOB full capacities are excluded; 9-byte minimum contribution is not an exact engine row size. Unknown types, null/record overhead and off-page placement still need clone DDL.',
  };
}

function rowRedesignProposal(scope, columns, indexes, budget) {
  const columnsToReview = columns.filter(column => column.type === 'varchar' && characterShape(column))
    .map(column => {
      const shape = characterShape(column);
      const targetMaxBytes = shape.length * 4;
      const defaultKnown = own(column, 'default') && (column.default === null || validText(column.default));
      const supportedCharset = oldCharsets.has(column.charset) || column.charset === 'utf8mb4';
      const reduction = targetMaxBytes + (targetMaxBytes > 255 ? 2 : 1) - 9;
      const indexConstraints = indexes.flatMap(index => index.before
        .filter(part => part.column === column.column)
        .map(part => ({
          name: index.name, type: part.type, nonUnique: part.nonUnique,
          position: part.position, prefix: part.prefix,
          consequence: part.prefix === null
            ? 'Full VARCHAR index cannot be kept as an unprefixed TEXT index; separate exact index/uniqueness design required'
            : 'Existing character prefix must be retained and reviewed; never shortened implicitly',
        })));
      const blockers = [
        'Authoritative source/model/dump/dialect mapping is unresolved by information_schema alone',
        'Logical maximum character length must be preserved across every native write surface; MySQL 5.7 CHECK is not enforcement',
        'Backup/clone, complete metadata/data/index comparison, idempotence and real API acceptance are not executed',
      ];
      if (column.default !== null) blockers.push('Literal VARCHAR default is not automatically legal for TEXT in MySQL 5.7');
      if (!defaultKnown) blockers.push('Missing/invalid default metadata is not an authorization to change default semantics');
      if (!supportedCharset) blockers.push('Source character set needs an independent conversion policy');
      if (indexConstraints.length) blockers.push('Index contract requires a separate reviewed design');
      if (column.extra !== '' || column.generationExpression !== '') blockers.push('Generated/special column requires separate semantic review');
      return {
        sourceLocator: { ...scope, column: column.column },
        authoritativeSourceResolved: false,
        original: {
          columnType: column.columnType, nullable: column.nullable,
          maxCharacters: shape.length, characterSet: column.charset, collation: column.collation,
          defaultKind: !defaultKnown ? 'missing-or-invalid-metadata'
            : column.default === null ? 'metadata-null-not-an-invented-empty-string' : 'literal',
          defaultSha256: validText(column.default) ? hash(column.default) : null,
        },
        proposal: {
          minimumCapacityType: targetMaxBytes <= 65535 ? 'text' : 'mediumtext',
          targetMaxBytes, preserveNullable: column.nullable, preserveMaxCharacters: shape.length,
          preserveExplicitExistingMb4Collation: column.charset === 'utf8mb4' ? column.collation : null,
          knownLogicalBytesReductionIfReplacedWithText: reduction,
          storageTypeDecision: 'Minimum byte capacity is not a selected type; authoritative source may already require MEDIUMTEXT or a split-table design',
          ddlGenerated: false, automaticallySelected: false,
        },
        indexConstraints,
        candidateForSourceReview: defaultKnown && supportedCharset && column.default === null && !indexConstraints.length
          && reduction > 0
          && column.extra === '' && column.generationExpression === '',
        blockers,
      };
    });
  return {
    status: 'SOURCE-SCHEMA-REDESIGN-REQUIRED-NOT-EXECUTED',
    automaticallyExecutable: false,
    minimumKnownBytesToRemoveBeforeOtherOverhead:
      budget.targetKnownLogicalLowerBoundBytes - budget.logicalRowLimitBytes,
    allColumnsRemainUnchanged: true,
    alternatives: ['Reviewed VARCHAR-to-TEXT/MEDIUMTEXT storage mapping with original logical length enforcement',
      'Reviewed vertical table split with native mapper/association/transaction compatibility'],
    columnsToReview,
    requiredSourceGates: [
      'Bind authoritative database model and original dump/dialect definitions for every selected physical column',
      'Preserve nullability, default semantics, original maximum characters and all index/uniqueness contracts',
      'Resolve model/dump type mismatches before selecting TEXT versus MEDIUMTEXT; never truncate or relax validation',
      'Stage source changes privately, back up and restore a clone, then execute and compare complete data/schema/grants',
      'Verify all API write surfaces, failures, Unicode roundtrips and idempotence before any shared change',
    ],
  };
}

export function buildOwnedNativeUnicodePlan({ runId, manifest, manifestSha256, metadata }) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/, 'Explicit owned runId required');
  validateMatrixFixture(manifest);
  assert.equal(manifest.runId, runId, 'Manifest belongs to another run');
  assert.match(manifestSha256 ?? '', /^[a-f0-9]{64}$/, 'Manifest SHA-256 required');
  assert.ok(metadata && typeof metadata === 'object' && !Array.isArray(metadata));
  assert.equal(metadata.runId, runId, 'Inventory belongs to another run');
  assert.equal(metadata.manifestSha256, manifestSha256, 'Inventory/manifest binding differs');
  const allowedSchemas = sorted(Object.values(manifest.schemas));
  const issues = [];
  const add = (code, message, scope = {}, severity = 'block') =>
    issues.push({ code, severity, ...scope, message });
  const plan = {
    contract: 'owned-native-unicode-plan-v1',
    runId,
    status: 'BLOCKED',
    planOnly: true,
    executionAllowed: false,
    migrationExecuted: false,
    backupVerified: false,
    cloneRestoreVerified: false,
    dataPreservationVerified: false,
    idempotenceVerified: false,
    apiUnicodeVerified: false,
    nativeAcceptance: false,
    fullAcceptance: false,
    inputs: { manifestSha256, parsedInventorySha256: hash(JSON.stringify(metadata)) },
    schemaScope: allowedSchemas,
    schemas: [],
    tables: [],
    issues,
    migrationStatements: [],
    requiredNextSteps: [
      'Read-only fresh owned inventory with exact container/image/network/schema identity and no other clients',
      'Full owned backup, isolated clone restore and metadata/data/grant equality',
      'Review all blocked metadata/index/generated/dependency cases; never truncate indexes implicitly',
      'Execute only the reviewed plan on the restored owned clone, with DDL intent/result journaling',
      'Compare complete metadata, data, grants, defaults, comments, indexes and existing mb4 collations',
      'Run a second fresh inventory/plan and prove idempotence, not merely no planned statements',
      'Real authenticated native API Unicode create/read/update/fresh-session/delete and negative-role effects',
      'Cleanup exact owned API records and clone resources; shared migration needs separate approval',
    ],
    boundary: 'Private metadata audit/proposal only. No Docker, SQL, service restart, data conversion, backup or API request is performed.',
  };
  if (metadata.contract !== 'owned-native-unicode-inventory-v1') {
    add('INVENTORY-CONTRACT', 'Exact structured information_schema inventory contract required');
  }
  for (const name of arrays) {
    if (!Array.isArray(metadata[name])) {
      add('METADATA-INCOMPLETE', `Missing structured ${name} array`);
    }
  }
  if (arrays.some(name => !Array.isArray(metadata[name]))) return finish(plan);
  let missingIdentity = false;
  for (const [name, fields] of [
    ['schemas', ['schema']], ['tables', ['database', 'table']],
    ['columns', ['database', 'table', 'column']], ['indexes', ['database', 'table', 'name']],
    ['characterSets', ['name']], ['collations', ['name']],
    ['foreignKeys', ['database', 'referencedDatabase']],
    ['triggers', ['database']], ['views', ['database']], ['routines', ['database']],
  ]) {
    if (metadata[name].some(row => !complete(row, fields)
        || fields.some(field => typeof row[field] !== 'string' || !row[field]))) {
      add('METADATA-INCOMPLETE', `Missing structured ${name} identity`);
      missingIdentity = true;
    }
  }
  if (missingIdentity) return finish(plan);
  for (const [field, expected] of Object.entries(coverageContract)) {
    if (metadata.coverage?.[field] !== expected) {
      add('METADATA-COVERAGE', `Inventory must explicitly cover ${field}: ${expected}`);
    }
  }
  for (const name of arrays) {
    if (!integer(metadata.counts?.[name]) || metadata.counts[name] !== metadata[name].length) {
      add('METADATA-COUNT', `Independent ${name} count is missing or differs from rows`);
    }
  }
  if (!validText(metadata.observedAt) || !Number.isFinite(Date.parse(metadata.observedAt))) {
    add('METADATA-TIME', 'Inventory observation time is required');
  }
  assert.deepEqual(sorted(metadata.schemas.map(row => row.schema)), allowedSchemas,
    'Inventory schemas must be exactly the manifest-owned schemas');
  for (const name of ['tables', 'columns', 'indexes', 'foreignKeys', 'triggers', 'views', 'routines']) {
    for (const row of metadata[name]) {
      assert.ok(allowedSchemas.includes(row.database), `${name}: non-owned schema rejected`);
      if (name === 'foreignKeys') {
        assert.ok(allowedSchemas.includes(row.referencedDatabase),
          'Foreign schema dependency requires a separate reviewed plan');
      }
    }
  }
  for (const [name, fields] of [
    ['foreignKeys', ['name', 'table', 'column', 'referencedDatabase', 'referencedTable', 'referencedColumn']],
    ['triggers', ['name', 'table']],
    ['views', ['name']],
    ['routines', ['name']],
  ]) {
    for (const row of metadata[name]) {
      if (!complete(row, fields) || fields.some(field => typeof row[field] !== 'string' || !row[field])) {
        add('DEPENDENCY-METADATA', `Complete ${name} identity/dependency metadata is required`,
          { database: row.database });
      }
    }
  }
  const server = metadata.server ?? {};
  if (server.vendor !== 'mysql' || server.version !== '5.7.41') {
    add('SERVER-PROFILE', 'This first plan profile supports observed Oracle MySQL 5.7.41 only');
  }
  if (![4096, 8192, 16384, 32768, 65536].includes(server.innodbPageSize)
      || typeof server.innodbLargePrefix !== 'boolean'
      || !['Antelope', 'Barracuda'].includes(server.innodbFileFormat)
      || server.innodbStrictMode !== true || ![0, 1].includes(server.lowerCaseTableNames)) {
    add('INNODB-PROFILE', 'Explicit page size, large-prefix, file format, strict mode and a reviewed case=0/1 profile required');
  }
  plan.identifierCasePolicy = identifierCaseAudit(metadata, server, add);
  if (!Array.isArray(server.sqlModes) || server.sqlModes.some(mode => typeof mode !== 'string')
      || server.sqlModes.includes('NO_BACKSLASH_ESCAPES')
      || !server.sqlModes.some(mode => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode))) {
    add('SQL-MODE', 'Strict SQL mode with standard backslash escaping is required; modes are never changed by this tool');
  }
  const supportedLiteralMode = Array.isArray(server.sqlModes)
    && server.sqlModes.every(mode => typeof mode === 'string')
    && !server.sqlModes.includes('NO_BACKSLASH_ESCAPES');
  for (const setting of ['characterSetClient', 'characterSetConnection', 'characterSetResults']) {
    if (server[setting] !== 'utf8mb4') add('CONNECTION-CHARSET', `${setting} must be observed as utf8mb4`);
  }
  const charsets = new Map();
  for (const row of metadata.characterSets) {
    if (!catalogWord(row.name) || !integer(row.maxlen, 1) || charsets.has(row.name)) {
      add('CHARSET-CATALOG', 'Incomplete or duplicate character-set catalog row');
    } else charsets.set(row.name, row.maxlen);
  }
  const collations = new Map();
  for (const row of metadata.collations) {
    if (!catalogWord(row.name) || !catalogWord(row.charset)
        || !charsets.has(row.charset) || collations.has(row.name)) {
      add('COLLATION-CATALOG', 'Incomplete, incompatible or duplicate collation catalog row');
    } else collations.set(row.name, row.charset);
  }
  if (charsets.get('utf8mb4') !== 4) add('CHARSET-CATALOG', 'Observed utf8mb4 MAXLEN=4 is required');
  for (const old of oldCharsets) {
    if (charsets.has(old) && charsets.get(old) !== 3) {
      add('CHARSET-CATALOG', 'Observed old UTF-8 MAXLEN must remain 3');
    }
  }
  const targetCollation = (charset, collation, scope) => {
    if (!catalogWord(charset) || !catalogWord(collation) || collations.get(collation) !== charset) {
      add('COLLATION-METADATA', 'Observed charset/collation pairing is absent from the server catalog', scope);
      return null;
    }
    if (charset === 'utf8mb4') return collation;
    if (!oldCharsets.has(charset) || !collation.startsWith(`${charset}_`)) {
      add('OTHER-CHARSET', 'Non-UTF8 character set requires a separate conversion policy', scope);
      return null;
    }
    const target = `utf8mb4${collation.slice(charset.length)}`;
    if (collations.get(target) !== 'utf8mb4') {
      add('UNSUPPORTED-COLLATION', 'No matching utf8mb4 collation exists; no default substitution is allowed', scope);
      return null;
    }
    return target;
  };
  for (const schema of metadata.schemas) {
    const scope = { database: schema.schema };
    const to = targetCollation(schema.charset, schema.collation, scope);
    plan.schemas.push({
      ...scope, before: structuredClone(schema),
      target: to ? { charset: 'utf8mb4', collation: to } : null,
      changed: oldCharsets.has(schema.charset),
    });
  }
  const tables = new Map();
  for (const table of metadata.tables) {
    const id = key(table.database, table.table);
    assert.ok(!tables.has(id), 'Duplicate table metadata');
    quoteMysql57Identifier(table.table, 'table');
    tables.set(id, table);
  }
  const columnsByTable = groupRows(metadata.columns, row => key(row.database, row.table));
  const indexesByTable = groupRows(metadata.indexes, row => key(row.database, row.table));
  for (const [id, rows] of [...columnsByTable, ...indexesByTable]) {
    assert.ok(tables.has(id), 'Column/index metadata references an unlisted table');
    assert.ok(rows.length);
  }
  const requiredColumnFields = [
    'database', 'table', 'column', 'type', 'columnType', 'ordinal', 'key', 'nullable',
    'default', 'extra', 'charset', 'collation', 'characterLength', 'octetLength',
    'comment', 'generationExpression',
  ];
  for (const table of metadata.tables) {
    const scope = { database: table.database, table: table.table };
    const id = key(table.database, table.table);
    const columns = [...(columnsByTable.get(id) ?? [])].sort((a, b) => a.ordinal - b.ordinal);
    const affected = columns.some(column => oldCharsets.has(column.charset))
      || oldCharsets.has(collations.get(table.collation));
    const audit = {
      ...scope, affected, before: structuredClone(table),
      columns: [], indexes: [], rowRisk: null, proposedStatement: null,
    };
    plan.tables.push(audit);
    if (!complete(table, ['kind', 'engine', 'rowFormat', 'collation', 'createOptions', 'comment'])
        || table.kind !== 'BASE TABLE' || !validText(table.comment)
        || typeof table.createOptions !== 'string') {
      add('TABLE-METADATA', 'Complete base-table engine/row format/collation/options/comment metadata required', scope);
    }
    if (!columns.length) add('METADATA-INCOMPLETE', 'Every listed base table requires all columns', scope);
    const tableCharset = collations.get(table.collation);
    const defaultCollation = targetCollation(tableCharset, table.collation, scope);
    if (affected && (table.engine !== 'InnoDB'
        || !['Dynamic', 'Compact', 'Redundant'].includes(table.rowFormat)
        || table.createOptions !== '')) {
      add('TABLE-PROFILE', 'Engine, compressed/unknown row format or special table options require separate review', scope);
    }
    const names = new Set();
    const columnMap = new Map();
    for (const [position, column] of columns.entries()) {
      quoteMysql57Identifier(column.column);
      assert.ok(!names.has(column.column), 'Duplicate column metadata');
      names.add(column.column);
      columnMap.set(column.column, column);
      const columnScope = { ...scope, column: column.column };
      const entry = {
        column: column.column, before: structuredClone(column),
        changed: oldCharsets.has(column.charset), target: null, modifyClause: null,
      };
      audit.columns.push(entry);
      if (!complete(column, requiredColumnFields)
          || column.ordinal !== position + 1
          || !['YES', 'NO'].includes(column.nullable)
          || !['', 'PRI', 'UNI', 'MUL'].includes(column.key)
          || !validText(column.comment) || !validText(column.extra)
          || !validText(column.generationExpression)
          || !(column.default === null || validText(column.default))
          || !catalogWord(column.type) || typeof column.columnType !== 'string') {
        add('COLUMN-METADATA', 'Column metadata must be complete, ordinal and lossless; absent default is not NULL', columnScope);
        continue;
      }
      if (affected && (column.generationExpression !== '' || /GENERATED/i.test(column.extra))) {
        add('GENERATED-DEPENDENCY', 'Generated columns/expressions require dependency and serialization review', columnScope);
      }
      if (column.charset === null && column.collation === null) continue;
      const to = targetCollation(column.charset, column.collation, columnScope);
      entry.target = to ? { charset: 'utf8mb4', collation: to } : null;
      if (!entry.changed) continue;
      const shape = characterShape(column);
      if (!shape || column.extra !== ''
          || !integer(column.characterLength, 1) || !integer(column.octetLength, 1)) {
        add('COLUMN-PROFILE', 'Only plain CHAR/VARCHAR/TEXT columns with complete lengths are supported', columnScope);
        continue;
      }
      if (shape.kind !== 'text' && column.octetLength !== shape.length * charsets.get(column.charset)) {
        add('COLUMN-LENGTH', 'Character/octet lengths disagree with the observed source charset', columnScope);
      }
      if (shape.kind === 'text' && (column.default !== null || column.octetLength !== shape.capacityBytes)) {
        add('TEXT-PROFILE', 'TEXT byte capacity or default is unsupported; type widening is not allowed', columnScope);
      }
      if (to && supportedLiteralMode) {
        const defaultClause = column.default === null
          ? (column.nullable === 'YES' && shape.kind !== 'text' ? ' DEFAULT NULL' : '')
          : ` DEFAULT ${quoteMysql57Literal(column.default, server.sqlModes)}`;
        entry.modifyClause = `MODIFY COLUMN ${quoteMysql57Identifier(column.column)} ${column.columnType}`
          + ` CHARACTER SET utf8mb4 COLLATE ${to}`
          + (column.nullable === 'YES' ? ' NULL' : ' NOT NULL')
          + defaultClause + ` COMMENT ${quoteMysql57Literal(column.comment, server.sqlModes)}`;
      }
    }
    const limit = indexLimit(table, server);
    if (affected && limit === null) add('INDEX-LIMIT-UNKNOWN', 'Exact index limit cannot be derived from the declared server/table profile', scope);
    const indexGroups = groupRows(indexesByTable.get(id) ?? [], row => row.name);
    const primaryColumns = columns.filter(column => column.key === 'PRI').map(column => column.column);
    const primaryParts = indexGroups.get('PRIMARY') ?? [];
    if (JSON.stringify(sorted(primaryColumns)) !== JSON.stringify(sorted(primaryParts.map(part => part.column)))
        || columns.some(column => column.key !== ''
          && !(indexesByTable.get(id) ?? []).some(part => part.column === column.column))) {
      add('INDEX-COLUMN-COVERAGE', 'Column key markers and captured index parts disagree', scope);
    }
    for (const [name, unsorted] of indexGroups) {
      quoteMysql57Identifier(name, 'index');
      const parts = [...unsorted].sort((a, b) => a.position - b.position);
      const indexAudit = {
        name, before: structuredClone(parts), parts: [],
        sourceKeyBytes: 0, targetKeyBytes: 0, limitBytes: limit, prefixOrUniquenessChanged: false,
      };
      audit.indexes.push(indexAudit);
      const indexScope = { ...scope, index: name };
      let known = true;
      for (const [position, part] of parts.entries()) {
        if (!complete(part, ['column', 'position', 'nonUnique', 'prefix', 'type', 'collation'])
            || part.position !== position + 1 || ![0, 1].includes(part.nonUnique)
            || part.nonUnique !== parts[0].nonUnique
            || (name === 'PRIMARY' && (part.nonUnique !== 0 || part.prefix !== null))
            || part.type !== 'BTREE' || part.collation !== 'A'
            || !(part.prefix === null || integer(part.prefix, 1))
            || !columnMap.has(part.column)) {
          add('INDEX-PROFILE', 'Missing, non-BTREE, functional, inconsistent or unknown index metadata', indexScope);
          known = false;
          continue;
        }
        const column = columnMap.get(part.column);
        const shape = characterShape(column);
        let before;
        let after;
        let units;
        if (column.charset !== null && shape) {
          const length = part.prefix ?? (shape.kind === 'text' ? null : shape.length);
          if (!integer(length, 1) || length > column.characterLength) {
            add('INDEX-PREFIX', 'TEXT needs an explicit prefix; prefix cannot exceed character capacity', indexScope);
            known = false;
            continue;
          }
          units = 'characters';
          before = length * charsets.get(column.charset);
          after = length * (oldCharsets.has(column.charset) ? 4 : charsets.get(column.charset));
        } else {
          const bytes = fixedBytes(column);
          if (bytes === null || (part.prefix !== null && !['binary', 'varbinary'].includes(column.type))
              || (part.prefix !== null && part.prefix > bytes)) {
            add('INDEX-STORAGE-UNKNOWN', 'Index storage for this type/prefix requires a separate exact-byte review', indexScope);
            known = false;
            continue;
          }
          units = ['binary', 'varbinary'].includes(column.type) ? 'bytes' : 'not-prefixable';
          before = part.prefix ?? bytes;
          after = before;
        }
        if (!integer(before) || !integer(after)) {
          add('INDEX-STORAGE-UNKNOWN', 'Character-set byte widths are missing', indexScope);
          known = false;
          continue;
        }
        indexAudit.parts.push({
          column: part.column, prefix: part.prefix, prefixUnits: units,
          sourceMaxBytes: before, targetMaxBytes: after,
        });
        indexAudit.sourceKeyBytes += before;
        indexAudit.targetKeyBytes += after;
      }
      if (!known) {
        indexAudit.sourceKeyBytes = null;
        indexAudit.targetKeyBytes = null;
      }
      if (affected && parts.length > 1
          && (['Compact', 'Redundant'].includes(table.rowFormat) || server.innodbLargePrefix === false)) {
        indexAudit.limitBytes = null;
        add('LEGACY-COMPOSITE-LIMIT-UNREVIEWED',
          'Legacy composite-key semantics need exact-server clone review; the per-part 767 limit is not treated as a proven total-key limit',
          indexScope);
      }
      if (affected && known && (parts.length > 16
          || (indexAudit.limitBytes !== null && indexAudit.targetKeyBytes > indexAudit.limitBytes))) {
        add('INDEX-OVERFLOW', 'Target key exceeds the observed row-format/page-size key budget; no truncation is proposed', indexScope);
      }
      if (affected && known && parts[0]?.nonUnique === 0
          && indexAudit.targetKeyBytes !== indexAudit.sourceKeyBytes) {
        add('UNIQUE-COLLATION-CLONE-CHECK', 'Unique keys keep exact parts/prefixes; clone DDL must verify equality/collision behavior', indexScope, 'review');
      }
    }
    const changedColumns = audit.columns.filter(column => column.changed);
    const rowBudget = declaredRowBudget(columns, charsets);
    audit.rowRisk = {
      rowFormat: table.rowFormat, pageSize: server.innodbPageSize ?? null,
      fixedCharacterPayloadMaxBytes: rowBudget.targetCharacterPayloadMaxBytes,
      declaredBudget: rowBudget,
      exactInlineRowBytes: null,
      status: affected ? 'CLONE-DDL-REQUIRED' : 'UNCHANGED-NOT-REVALIDATED',
      boundary: 'Character payload only, not a complete row-size or off-page-storage proof. The planner never changes row format or column type.',
    };
    if (affected) {
      add('ROW-SIZE-CLONE-CHECK', 'Page-local row size, off-page placement and rebuild feasibility require strict-mode clone DDL', scope, 'review');
      if (rowBudget.targetKnownLogicalLowerBoundBytes > rowBudget.logicalRowLimitBytes) {
        add('ROW-PAYLOAD-OVERFLOW',
          'Known declared column/prefix/TEXT-minimum bytes exceed the logical row budget; TEXT capacities/off-page data were not added',
          scope);
        audit.rowRisk.redesign = rowRedesignProposal(scope, columns, audit.indexes, rowBudget);
      }
    }
    for (const foreignKey of metadata.foreignKeys) {
      if (affected && ((foreignKey.database === table.database && foreignKey.table === table.table)
          || (foreignKey.referencedDatabase === table.database && foreignKey.referencedTable === table.table))) {
        add('FOREIGN-KEY-DEPENDENCY', 'Character-set changes on constrained tables require a separate paired-table plan', scope);
      }
    }
    for (const trigger of metadata.triggers) {
      if (affected && trigger.database === table.database && trigger.table === table.table) {
        add('TRIGGER-DEPENDENCY', 'Trigger side effects need a separate dependency review', scope);
      }
    }
    const blockedHere = issues.some(issue => issue.severity === 'block'
      && (!issue.database || (issue.database === table.database && (!issue.table || issue.table === table.table))));
    if (affected && !blockedHere && defaultCollation && changedColumns.every(column => column.modifyClause)) {
      const clauses = [];
      if (oldCharsets.has(tableCharset)) {
        clauses.push(`DEFAULT CHARACTER SET utf8mb4 COLLATE ${defaultCollation}`);
      }
      clauses.push(...changedColumns.map(column => column.modifyClause));
      audit.proposedStatement = `ALTER TABLE ${quoteMysql57Identifier(table.database, 'schema')}`
        + `.${quoteMysql57Identifier(table.table, 'table')} ${clauses.join(', ')};`;
    }
  }
  const changedSchemas = new Set(plan.schemas.filter(schema => schema.changed).map(schema => schema.database));
  for (const dependency of [...metadata.views, ...metadata.routines]) {
    if (changedSchemas.has(dependency.database)
        || plan.tables.some(table => table.affected && table.database === dependency.database)) {
      add('SCHEMA-DEPENDENCY', 'Views/routines in an affected schema require an explicit dependency/charset review',
        { database: dependency.database });
    }
  }
  return finish(plan);
}

function finish(plan) {
  const blocked = plan.issues.some(issue => issue.severity === 'block');
  plan.counts = {
    schemas: plan.schemas.length,
    tables: plan.tables.length,
    changedDefaults: plan.schemas.filter(schema => schema.changed).length,
    changedTables: plan.tables.filter(table => table.affected).length,
    changedColumns: plan.tables.flatMap(table => table.columns).filter(column => column.changed).length,
    indexes: plan.tables.reduce((sum, table) => sum + table.indexes.length, 0),
    blockers: plan.issues.filter(issue => issue.severity === 'block').length,
    reviews: plan.issues.filter(issue => issue.severity === 'review').length,
  };
  if (!blocked) {
    plan.migrationStatements = [
      ...plan.schemas.filter(schema => schema.changed).map(schema =>
        `ALTER DATABASE ${quoteMysql57Identifier(schema.database, 'schema')}`
        + ` CHARACTER SET utf8mb4 COLLATE ${schema.target.collation};`),
      ...plan.tables.map(table => table.proposedStatement).filter(Boolean),
    ];
    plan.status = plan.migrationStatements.length ? 'PLANNED-NOT-EXECUTED' : 'NO-UTF8-CHANGES-PLANNED';
  }
  return plan;
}

function privatePath(base, input) {
  const path = resolve(input);
  const suffix = relative(base, path);
  assert.ok(suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep),
    'Every input/output must be inside this run private artifact directory');
  return path;
}

export function writeOwnedNativeUnicodePlan({
  runId, manifestPath, manifestSha256, metadataPath, metadataSha256, output, workspace = workspaceRoot,
}) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(manifestSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(metadataSha256 ?? '', /^[a-f0-9]{64}$/);
  const base = join(resolve(workspace), '.artifacts', 'native-nonadmin-fixtures', runId);
  const manifestFile = privatePath(base, resolve(workspace, manifestPath));
  const inventoryFile = privatePath(base, resolve(workspace, metadataPath));
  const outputPath = privatePath(base, resolve(workspace, output));
  assert.equal(manifestFile, join(base, 'manifest.json'), 'Only the exact run manifest is accepted');
  const directories = new PinnedDirectories();
  try {
    const read = (path, expected) => {
      const source = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
      assert.equal(source.identity.uid, process.geteuid(), 'Private artifact must be owned by the current user');
      assert.equal(source.identity.mode & 0o077, 0, 'Raw metadata/manifest must remain private');
      assert.equal(hash(source.data), expected, 'Private input SHA-256 differs');
      return JSON.parse(source.data);
    };
    const manifest = read(manifestFile, manifestSha256);
    const metadata = read(inventoryFile, metadataSha256);
    const plan = buildOwnedNativeUnicodePlan({ runId, manifest, manifestSha256, metadata });
    plan.inputs.inventoryFileSha256 = metadataSha256;
    const plannerFile = fileURLToPath(import.meta.url);
    plan.inputs.plannerFileSha256 = hash(readPinnedFile(directories,
      directories.open(dirname(plannerFile)), basename(plannerFile)).data);
    const destination = directories.open(outputPath, { create: true, exclusive: true });
    directories.write(destination, 'plan.private.json', json(plan));
    return {
      status: plan.status, planOnly: true, executionAllowed: false,
      counts: plan.counts, sha256: hash(json(plan)),
      boundary: 'Private metadata plan only; no migration, backup, restore or API acceptance.',
    };
  } finally {
    directories.close();
  }
}

export function main(args = process.argv.slice(2), { workspace = workspaceRoot } = {}) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: false,
    options: {
      plan: { type: 'boolean' }, 'run-id': { type: 'string' },
      manifest: { type: 'string' }, 'manifest-sha256': { type: 'string' },
      metadata: { type: 'string' }, 'metadata-sha256': { type: 'string' },
      output: { type: 'string' },
    },
  });
  assert.equal(values.plan, true, 'Explicit --plan required; no execute mode exists');
  assert.deepEqual(positionals, []);
  const result = writeOwnedNativeUnicodePlan({
    runId: values['run-id'], manifestPath: values.manifest,
    manifestSha256: values['manifest-sha256'], metadataPath: values.metadata,
    metadataSha256: values['metadata-sha256'], output: values.output, workspace,
  });
  process.stdout.write(json(result));
  if (result.status === 'BLOCKED') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch {
    process.stderr.write('Owned Unicode plan rejected; private inputs were not executed or published.\n');
    process.exitCode = 1;
  }
}
