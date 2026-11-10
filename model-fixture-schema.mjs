import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = data => createHash('sha256').update(data).digest('hex');
const safeName = name => {
  assert.match(name, /^[A-Za-z][A-Za-z0-9_]*$/);
  return name;
};
const id = name => `\`${safeName(name)}\``;

export function mergeModelSchema(sources) {
  assert.deepEqual(sources.map(source => source.link), ['DEFAULT', 'DB2', 'DB3']);
  const tables = new Map();
  for (const { model } of sources) {
    assert.ok(Array.isArray(model.getAllPSSysDBTables));
    for (const table of model.getAllPSSysDBTables) {
      const name = safeName(table.name).toLowerCase();
      if (!tables.has(name)) tables.set(name, new Map());
      const columns = tables.get(name);
      for (const column of table.getAllPSSysDBColumns ?? []) {
        safeName(column.name);
        assert.ok([5, 6, 7, 9, 21, 25].includes(column.stdDataType), 'Unreviewed model column type');
        assert.ok(!column.dataType && !column.autoIncrement, 'Unreviewed model column override');
        const key = column.name.toUpperCase();
        const previous = columns.get(key);
        if (previous) {
          for (const property of ['stdDataType', 'pKey', 'nullable']) {
            assert.equal(previous[property] ?? false, column[property] ?? false,
              `Conflicting model projection: ${name}.${key}.${property}`);
          }
          previous.length = Math.max(previous.length ?? 0, column.length ?? 0);
          previous.precision = Math.max(previous.precision ?? 0, column.precision ?? 0);
        } else columns.set(key, structuredClone({ ...column, name: key }));
      }
    }
  }
  return tables;
}

function modelType(column) {
  switch (column.stdDataType) {
    case 5: return 'datetime';
    case 6: {
      const length = column.length || 12, scale = column.precision || 0;
      assert.ok(Number.isInteger(length) && length <= 65 && length > 0);
      assert.ok(Number.isInteger(scale) && scale >= 0 && scale <= 30 && scale <= length);
      return `decimal(${length},${scale})`;
    }
    case 7: return 'double';
    case 9: return 'int';
    case 21: return 'mediumtext';
    case 25: {
      const length = column.length || 200;
      assert.ok(Number.isInteger(length) && length > 0 && length <= 4 * 1024 * 1024);
      return length > 16383 ? 'mediumtext' : `varchar(${length})`;
    }
    default: assert.fail('Unreviewed model column type');
  }
}

function columnDDL(column, type) {
  return `${id(column.name)} ${type} ${column.pKey || !column.nullable ? 'NOT NULL' : 'NULL'}`;
}

// Accept the repository's mysqldump CREATE TABLE format only; never parse dump DML.
export function dumpTableDefinitions(dump) {
  const definitions = new Map();
  const pattern = /^CREATE TABLE `([A-Za-z][A-Za-z0-9_]*)` \(\r?\n([\s\S]*?)^\) ENGINE=InnoDB[^;\r\n]*;/gm;
  for (const match of dump.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    assert.ok(!definitions.has(name), 'Duplicate dump table');
    const columns = new Set([...match[2].matchAll(/^  `([A-Za-z][A-Za-z0-9_]*)` /gm)]
      .map(column => column[1].toUpperCase()));
    assert.ok(columns.size > 0);
    definitions.set(name, { ddl: match[0], columns });
  }
  assert.ok(definitions.size > 0, 'No supported dump CREATE TABLE definitions');
  return definitions;
}

export function createModelSchemaPlan(dump, sources) {
  const merged = mergeModelSchema(sources);
  const existing = dumpTableDefinitions(dump);
  const tables = [];
  for (const [name, columns] of [...merged].sort(([a], [b]) => a.localeCompare(b))) {
    const original = existing.get(name);
    const additions = [...columns.values()].filter(column => !original?.columns.has(column.name));
    const types = new Map(additions.map(column => [column.name, modelType(column)]));
    const adaptations = [];
    // Empty fixture tables may need off-page strings to stay below MySQL's row limit.
    // Do not narrow string capacity or alter existing dump columns.
    if (!original) {
      const rowBytes = () => additions.reduce((total, column) => {
        const varchar = /^varchar\((\d+)\)$/.exec(types.get(column.name));
        return total + (varchar ? Number(varchar[1]) * 4 + 2 : 20);
      }, 0);
      for (const column of [...additions].filter(column => !column.pKey && column.stdDataType === 25)
        .sort((a, b) => (b.length || 200) - (a.length || 200))) {
        if (rowBytes() < 60000) break;
        adaptations.push({ column: column.name, before: types.get(column.name), after: 'mediumtext',
          reason: 'new model table exceeds the utf8mb4 in-row capacity budget' });
        types.set(column.name, 'mediumtext');
      }
      assert.ok(rowBytes() < 60000, 'Unreviewed model row-size requirement');
    }
    let ddl;
    if (original) {
      const end = original.ddl.indexOf('\n) ENGINE=');
      ddl = original.ddl.slice(0, end)
        + (additions.length ? `,\n${additions.map(column => `  ${columnDDL(column, types.get(column.name))}`).join(',\n')}` : '')
        + original.ddl.slice(end);
    } else {
      assert.ok(additions.length > 0, `Model table lacks both dump and columns: ${name}`);
      const keys = additions.filter(column => column.pKey).map(column => id(column.name));
      assert.ok(keys.length > 0, `Model table has no declared primary key: ${name}`);
      ddl = `CREATE TABLE ${id(name)} (\n${additions.map(column => `  ${columnDDL(column, types.get(column.name))}`).join(',\n')},\n  PRIMARY KEY (${keys.join(',')})\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
    }
    const fields = [...new Set([...(original?.columns ?? []), ...columns.keys()])].sort();
    tables.push({ name, ddl, columns: fields, source: original ? 'dump-with-model-additions' : 'model',
      addedColumns: additions.map(column => ({ name: column.name, type: types.get(column.name) })),
      adaptations, sha256: hash(ddl) });
  }
  return { tables, sourceModels: sources.map(source => ({
    link: source.link, sha256: source.sha256, path: source.path,
  })), dumpSha256: hash(dump), fingerprint: hash(JSON.stringify(tables.map(({ name, sha256 }) => ({ name, sha256 })))) };
}
