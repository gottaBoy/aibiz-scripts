import assert from 'node:assert/strict';

// These are independent local-model acceptance probes, not upstream specifications.
export const domainCases = Object.freeze({
  logicdesign: { collection: ['nodes'], node: 'assign', property: 'target', invalid: '' },
  workflowdesign: { collection: ['nodes'], node: 'approval', property: 'dueHours', invalid: 0 },
  erdesign: { collection: ['nodes'], node: 'table', property: 'tableName', invalid: '' },
  dataflowdesign: { collection: ['nodes'], node: 'source', property: 'records', invalid: 'not-an-array' },
  dataquerydesign: { collection: ['nodes'], node: 'select', property: 'limit', invalid: 0 },
  valueruledesign: { collection: ['nodes'], node: 'predicate', property: 'operator', invalid: 'unsupported' },
  formdesign: { collection: ['items'], path: ['settings', 'columns'], invalid: 0 },
  griddesign: { collection: ['items'], path: ['settings', 'pageSize'], invalid: 0 },
  toolbardesign: { collection: ['items'], path: ['settings', 'mode'], invalid: 'unsupported' },
  menudesign: { collection: ['items'], path: ['settings', 'direction'], invalid: 'unsupported' },
  treeviewdesign: { collection: ['items'], path: ['settings', 'checkable'], invalid: 'true' },
  viewdesign: { collection: ['items'], path: ['settings', 'gap'], invalid: -1 },
  mddesign: { collection: ['items'], path: ['settings', 'columns'], invalid: 0 },
  dashboarddesign: { collection: ['items'], path: ['settings', 'gap'], invalid: -1 },
  chartdesign: { collection: ['items'], path: ['settings', 'chartType'], invalid: 'unsupported' },
  bireportdesign: { collection: ['items'], path: ['settings', 'precision'], invalid: 9 },
  plm4modeling: { collection: ['tasks'], path: ['tasks', 0, 'title'], invalid: '' },
  ibizappviewcreator: { collection: ['entity', 'fields'], path: ['view', 'kind'], invalid: 'unsupported' },
  modelperspectivetool: { collection: ['model', 'getPSDataEntities'], path: ['query'], invalid: 42 },
  ibizmodelingadvanced: { setting: ['settings', 'pageSize'], path: ['settings', 'pageSize'], invalid: 0 },
  'modeling-materials': { collection: ['materials'], path: ['materials', 0, 'name'], invalid: '' },
  'modeling-sync': { object: ['incoming'], path: ['incoming'], invalid: [] },
  ibizdbschemaimporter: { collection: ['schema', 'tables'], path: ['schema', 'name'], invalid: '' },
});

const at = (value, path) => path.reduce((current, key) => current[key], value);
const specification = id => {
  assert.ok(Object.hasOwn(domainCases, id), `Unknown plugin case: ${id}`);
  return domainCases[id];
};

export function assertDomainEdit(id, before, after) {
  const spec = specification(id);
  assert.equal(after.pluginId, id);
  assert.equal(after.id, before.id, 'Editing must not replace the document');
  assert.equal(after.revision, before.revision, 'Unsaved editing must not change revision');
  if (spec.collection) {
    const previous = at(before.content, spec.collection);
    const current = at(after.content, spec.collection);
    assert.ok(Array.isArray(previous) && Array.isArray(current));
    assert.equal(current.length, previous.length + 1, `${id}: expected a domain item to be added`);
    for (const item of previous) {
      const key = item.id === undefined ? 'name' : 'id';
      assert.deepEqual(current.find(candidate => candidate[key] === item[key]), item, `${id}: add changed an existing item`);
    }
  } else if (spec.setting) {
    assert.equal(at(after.content, spec.setting), Number(at(before.content, spec.setting)) % 500 + 1);
  } else {
    assert.equal(Object.keys(at(after.content, spec.object)).length, Object.keys(at(before.content, spec.object)).length + 1);
    for (const [key, value] of Object.entries(at(before.content, spec.object))) {
      assert.deepEqual(at(after.content, spec.object)[key], value, 'Sync add discarded an existing input value');
    }
    assert.deepEqual(after.content.target, before.content.target, 'Sync preview must not apply changes to target');
    assert.deepEqual(after.content.base, before.content.base);
  }
}

export function invalidDomainDocument(document) {
  const spec = specification(document.pluginId);
  const invalid = structuredClone(document);
  let path = spec.path;
  if (spec.node) {
    const index = invalid.content.nodes.findIndex(node => node.kind === spec.node);
    assert.ok(index >= 0, `${document.pluginId}: missing required node`);
    path = ['nodes', index, 'properties', spec.property];
  }
  at(invalid.content, path.slice(0, -1))[path.at(-1)] = structuredClone(spec.invalid);
  return invalid;
}
