#!/usr/bin/env node

import assert from 'node:assert/strict';

const keyOf = (principal, root) => {
  assert.match(principal ?? '', /^[A-Za-z0-9_.:-]+$/);
  assert.match(root ?? '', /^[A-Za-z0-9_.:-]+$/);
  return `${principal}\u0000${root}`;
};

/**
 * Design-only revision authority. It is intentionally not wired to the Java
 * cache, mutation services or any production transport.
 */
export class GrantRevisionStore {
  #values = new Map();

  current(principal, root) {
    return this.#values.get(keyOf(principal, root)) ?? 0;
  }

  advance(principal, root, expected = this.current(principal, root)) {
    assert.equal(Number.isSafeInteger(expected) && expected >= 0, true);
    const key = keyOf(principal, root);
    const current = this.#values.get(key) ?? 0;
    assert.equal(current, expected, 'Revision compare-and-set conflict');
    const next = current + 1;
    this.#values.set(key, next);
    return next;
  }
}

/**
 * Design-only cache adapter. A cache hit is valid only when its authority
 * revision equals the current authoritative revision supplied by the caller.
 */
export class RevisionedAuthorizationCache {
  #entries = new Map();

  put(cacheKey, revision, value) {
    assert.match(cacheKey ?? '', /^[A-Za-z0-9_.:-]+$/);
    assert.equal(Number.isSafeInteger(revision) && revision >= 0, true);
    this.#entries.set(cacheKey, { revision, value });
  }

  get(cacheKey, currentRevision) {
    const entry = this.#entries.get(cacheKey);
    if (!entry || entry.revision !== currentRevision) return undefined;
    return entry.value;
  }

  invalidate(cacheKey) {
    this.#entries.delete(cacheKey);
  }
}

/**
 * Additive nested-session design. Existing flat openSession semantics are
 * deliberately untouched; this class is a reference contract only.
 */
export class NestedActionSessionDraft {
  #stack = [];

  constructor(root = {}) {
    this.#stack.push({ name: 'root', values: new Map(Object.entries(root)), closed: false });
  }

  current() {
    return this.#stack.at(-1);
  }

  openNestedSession(name) {
    assert.match(name ?? '', /^[A-Za-z0-9_.:-]+$/);
    const parent = this.current();
    assert.ok(parent && !parent.closed, 'No active parent session');
    const child = { name, values: new Map(parent.values), parent, closed: false };
    this.#stack.push(child);
    return child;
  }

  closeNestedSession(commit = true) {
    assert.equal(this.#stack.length > 1, true, 'No nested session is open');
    const child = this.#stack.pop();
    const parent = this.current();
    assert.equal(child.closed, false);
    if (commit) parent.values = new Map(child.values);
    child.closed = true;
    return parent;
  }

  set(name, value) {
    assert.match(name ?? '', /^[A-Za-z0-9_.:-]+$/);
    this.current().values.set(name, value);
  }

  get(name) {
    return this.current().values.get(name);
  }

  async executeNestedSession(name, action) {
    assert.equal(typeof action, 'function');
    this.openNestedSession(name);
    try {
      const result = await action(this);
      this.closeNestedSession(true);
      return result;
    } catch (error) {
      this.closeNestedSession(false);
      throw error;
    }
  }
}

export const AUTHORIZATION_API_DRAFT_BOUNDARY = Object.freeze({
  productionWired: false,
  jwtLifetimeChanged: false,
  legacyOpenSessionChanged: false,
  cacheCodecChanged: false,
  requiredProductionWork: [
    'Add revision to PSDevUserCacheCodec.Entry and all serializers.',
    'Publish monotonic revisions from every PSDevSlnUser mutation path.',
    'Define cross-node delivery, loss and ordering semantics.',
    'Add additive Java nested-session APIs without changing openSession.',
  ],
});
