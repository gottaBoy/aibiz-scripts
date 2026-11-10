import assert from 'node:assert/strict';

const sqlId = value => {
  assert.match(value, /^[A-Za-z][A-Za-z0-9_]*$/);
  return `\`${value}\``;
};

export function uaaSchemaTableSQL(model, schema) {
  sqlId(schema);
  assert.ok(Array.isArray(model.entities));
  const tables = model.entities.filter(entity => entity.table_name);
  assert.equal(tables.length, 18, 'Expected all eighteen physical UAA model tables');
  assert.equal(new Set(tables.map(row => row.table_name.toLowerCase())).size, tables.length);
  return tables.map(entity => {
    const fields = entity.fields.filter(field => field.physical_field === 1);
    assert.ok(fields.length > 0);
    assert.equal(new Set(fields.map(field => field.fieldname.toLowerCase())).size, fields.length);
    const columns = fields.map(field => {
      assert.ok(['VARCHAR', 'TEXT', 'INT', 'BIGINT', 'DATETIME', 'VARBINARY'].includes(field.data_type));
      let type = field.data_type;
      if (type === 'VARCHAR') {
        assert.ok(Number.isSafeInteger(field.data_length) && field.data_length > 0 && field.data_length <= 4096);
        type += `(${field.data_length})`;
      }
      if (type === 'VARBINARY') type = 'LONGBLOB';
      // Nullable fixture columns allow omitted audit fields; this is not a migration.
      return `${sqlId(field.fieldname)} ${type} NULL`;
    });
    return `CREATE TABLE ${sqlId(schema)}.${sqlId(entity.table_name)} (${columns.join(',')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  });
}

export function uaaSchemaSQL(model, schema) {
  return `CREATE DATABASE ${sqlId(schema)} CHARACTER SET utf8mb4;\n${uaaSchemaTableSQL(model, schema).join('\n')}\n`;
}
