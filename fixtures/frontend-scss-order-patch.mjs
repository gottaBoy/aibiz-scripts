import assert from 'node:assert/strict';

// Static imports precede deferred module graphs; neither follows transform completion.
export function stylesheetGraphOrder(ids, getInfo, styles) {
  const entries = ids.filter(id => getInfo(id)?.isEntry);
  if (entries.length !== 1) throw new Error('One reviewed bundle entry is required for deterministic CSS');
  const visited = new Set(), ordered = [], deferred = [];
  const visit = id => {
    if (visited.has(id)) return;
    visited.add(id);
    if (Object.prototype.hasOwnProperty.call(styles, id)) ordered.push(id);
    const info = getInfo(id);
    for (const imported of info?.importedIds ?? []) visit(imported);
    for (const imported of info?.dynamicallyImportedIds ?? []) deferred.push(imported);
  };
  visit(entries[0]);
  for (let index = 0; index < deferred.length; index++) visit(deferred[index]);
  if (ordered.length !== Object.keys(styles).length) {
    throw new Error('A collected stylesheet is outside the reviewed static entry graph');
  }
  return ordered;
}

export function patchScssCollectionOrder(source) {
  assert.equal(typeof source, 'string');
  const anchor = /for \(const id in styles\) \{\r?\n                scss \+= styles\[id\] \|\| '';\r?\n            \}/g;
  assert.equal([...source.matchAll(anchor)].length, 1, 'Unexpected SCSS collector implementation');
  return source.replace(anchor,
    `for (const id of (${stylesheetGraphOrder.toString()})([...this.getModuleIds()], id => this.getModuleInfo(id), styles)) {\n` +
    `                scss += styles[id] || '';\n            }`);
}
