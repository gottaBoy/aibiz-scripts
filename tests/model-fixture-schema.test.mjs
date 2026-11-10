import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createModelSchemaPlan, mergeModelSchema } from '../model-fixture-schema.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const column = (name, extra = {}) => ({ name, stdDataType: 25, length: 100, nullable: true, ...extra });
const key = column('ID', { pKey: true, nullable: false });
const sources = tables => ['DEFAULT', 'DB2', 'DB3'].map((link, index) => ({
  link, model: { getAllPSSysDBTables: tables[index] ?? [] },
}));
const dump = 'CREATE TABLE `sample` (\n  `ID` varchar(100) NOT NULL,\n  `LEGACY` int DEFAULT NULL,\n  PRIMARY KEY (`ID`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO `sample` VALUES (1,2);\n';

test('schema compatibility keeps existing dump fields/types/keys and adds actual model fields only', () => {
  const input = sources([[{ name: 'SAMPLE', getAllPSSysDBColumns: [key, column('ADDED')] }]]);
  const plan = createModelSchemaPlan(dump, input);
  assert.equal(plan.tables.length, 1);
  assert.deepEqual(plan.tables[0].columns, ['ADDED', 'ID', 'LEGACY']);
  assert.match(plan.tables[0].ddl, /`LEGACY` int DEFAULT NULL/);
  assert.match(plan.tables[0].ddl, /`ADDED` varchar\(100\) NULL/);
  assert.match(plan.tables[0].ddl, /PRIMARY KEY \(`ID`\)/);
  assert.doesNotMatch(plan.tables[0].ddl, /INSERT/);
  assert.deepEqual(input[0].model.getAllPSSysDBTables[0].getAllPSSysDBColumns, [key, column('ADDED')]);
});

test('projection union preserves capacity and rejects semantic, nullable or primary-key conflicts', () => {
  const input = sources([
    [{ name: 'SAMPLE', getAllPSSysDBColumns: [key, column('NAME')] }],
    [{ name: 'SAMPLE', getAllPSSysDBColumns: [column('NAME', { length: 200 })] }],
  ]);
  assert.equal(mergeModelSchema(input).get('sample').get('NAME').length, 200);
  for (const change of [
    c => { c.stdDataType = 9; }, c => { c.nullable = false; }, c => { c.pKey = true; },
    c => { c.stdDataType = 999; }, c => { c.autoIncrement = true; },
    c => { c.name = 'UNSAFE`'; },
  ]) {
    const bad = structuredClone(input);
    change(bad[1].model.getAllPSSysDBTables[0].getAllPSSysDBColumns[0]);
    assert.throws(() => mergeModelSchema(bad));
  }
});

test('model-only tables render explicit reviewed types without generic string or integer fallback', () => {
  const input = sources([[{ name: 'NEW_TABLE', getAllPSSysDBColumns: [key,
    column('AMOUNT', { stdDataType: 6, length: 12, precision: 2 }),
    column('RATE', { stdDataType: 7 }), column('COUNT', { stdDataType: 9 }),
    column('CREATED', { stdDataType: 5 }), column('DETAIL', { stdDataType: 21 }),
  ] }]]);
  const result = createModelSchemaPlan(dump, input).tables[0];
  for (const type of ['decimal(12,2)', 'double', 'int', 'datetime', 'mediumtext']) {
    assert.ok(result.ddl.includes(type));
  }
  const invalid = structuredClone(input);
  invalid[0].model.getAllPSSysDBTables[0].getAllPSSysDBColumns[1].precision = 13;
  assert.throws(() => createModelSchemaPlan(dump, invalid));
});

test('model-only row-size adaptations retain string capacity and never convert primary keys to text', () => {
  const input = sources([[{ name: 'WIDE', getAllPSSysDBColumns: [key,
    ...Array.from({ length: 10 }, (_, index) => column(`FIELD${index}`, { length: 4000 })),
  ] }]]);
  const result = createModelSchemaPlan(dump, input).tables[0];
  assert.ok(result.adaptations.length > 0);
  assert.ok(result.adaptations.every(row => row.column !== 'ID' && row.after === 'mediumtext'));
  assert.match(result.ddl, /`ID` varchar\(100\) NOT NULL/);
});

test('all local declarations have a traceable compatibility plan; missing dump is not missing schema', () => {
  const root = new URL('../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/', import.meta.url);
  const models = ['DEFAULT', 'DB2', 'DB3'].map(link => {
    const path = `PSSYSDBSCHEMES/${link}.json`;
    const bytes = fs.readFileSync(new URL(path, root));
    return { link, path, sha256: hash(bytes), model: JSON.parse(bytes) };
  });
  const actualDump = fs.readFileSync(new URL('../../modelingservice/sql/sCloud9471c1eca.sql', import.meta.url), 'utf8');
  const result = createModelSchemaPlan(actualDump, models);
  assert.equal(result.tables.length, 424);
  assert.equal(result.tables.filter(row => row.source === 'model').length, 27);
  const system = result.tables.find(row => row.name === 't_srfpssystem');
  assert.ok(system.columns.includes('PSDEVCENTERID'));
  const article = result.tables.find(row => row.name === 't_srfpshelparticle');
  assert.ok(article.columns.includes('PSSYSUSECASEID'));
  assert.ok(result.tables.some(row => row.name === 't_srfpssysusecase'));
  assert.deepEqual(createModelSchemaPlan(actualDump, models), result);
});
