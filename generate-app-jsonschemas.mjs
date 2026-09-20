#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoot = join(workspace, 'plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES');
const commonEntities = ['ticket', 'work_item', 'test_case', 'ai_kb_chunk'];
const typeMap = new Map([
  [1, 'boolean'],
  [5, 'string'],
  [6, 'number'],
  [7, 'number'],
  [8, 'number'],
  [9, 'integer'],
  [21, 'string'],
  [25, 'string'],
  [29, 'object'],
  [30, 'array'],
]);

function reference(field) {
  const modes = Array.isArray(field.getAllPSAppDEFUIModes)
    ? field.getAllPSAppDEFUIModes
    : [];
  for (const mode of modes) {
    const form = mode?.getPSDEFFormItem;
    const path = form?.getRefPSDataEntity?.path || form?.getRefPSDEDataEntity?.path;
    if (typeof path === 'string' && /^[A-Za-z0-9_.-]+\.json$/.test(basename(path))) {
      return basename(path);
    }
  }
  return undefined;
}

function schemaFor(model) {
  const properties = {};
  for (const field of Array.isArray(model.getAllPSAppDEFields) ? model.getAllPSAppDEFields : []) {
    if (typeof field.codeName !== 'string' || !field.codeName) continue;
    const property = {
      type: typeMap.get(field.stdDataType) || 'string',
      description: typeof field.logicName === 'string' && field.logicName
        ? field.logicName
        : field.name || field.codeName,
    };
    if (field.stdDataType === 5) property.format = 'date-time';
    if (Number.isSafeInteger(field.stringLength) && field.stringLength > 0 &&
      property.type === 'string' && field.stringLength < 1048576) {
      property.maxLength = field.stringLength;
    }
    const ref = reference(field);
    if (ref) property.$ref = ref;
    properties[field.codeName] = property;
  }
  return {
    type: 'object',
    title: model.logicName || model.name || model.codeName,
    properties,
  };
}

function entityFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.jsonschema'))
    .map(entry => join(root, entry.name));
}

function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      entity: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      root: { type: 'string' },
      check: { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log('Usage: node scripts/generate-app-jsonschemas.mjs [--entity NAME ...] [--all] [--check] [--force]');
    return 0;
  }
  const root = resolve(values.root || defaultRoot);
  const files = entityFiles(root);
  const wanted = values.all
    ? files
    : files.filter(file => commonEntities.includes(basename(file, '.json')));
  if (values.entity) {
    const selected = new Set(values.entity.map(value => value.toLowerCase()));
    for (const file of files) {
      if (selected.has(basename(file, '.json').toLowerCase())) wanted.push(file);
    }
  }
  const unique = [...new Set(wanted)];
  if (!unique.length) throw new Error('No matching app entity models');
  let changed = 0;
  for (const file of unique) {
    const model = JSON.parse(readFileSync(file, 'utf8'));
    const name = typeof model.name === 'string' && /^[A-Za-z0-9_]+$/.test(model.name)
      ? model.name
      : basename(file, '.json').toUpperCase();
    const output = join(root, `${name}.jsonschema`);
    const bytes = `${JSON.stringify(schemaFor(model))}\n`;
    if (values.check) {
      if (readFileSync(output, 'utf8') !== bytes) throw new Error(`Schema is stale: ${output}`);
    } else if (!values.force) {
      try {
        readFileSync(output, 'utf8');
        console.log(`KEEP ${name} existing schema`);
        continue;
      } catch {
        // Generate only missing schemas unless --force is explicit.
      }
    } else {
      writeFileSync(output, bytes);
      changed += 1;
    }
    console.log(`${values.check ? 'CHECK' : 'WRITE'} ${name} ${model.getAllPSAppDEFields?.length || 0} fields`);
  }
  console.log(`${values.check ? 'Checked' : 'Generated'} ${unique.length} schema files${values.check ? '' : ` (${changed} written)`}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
