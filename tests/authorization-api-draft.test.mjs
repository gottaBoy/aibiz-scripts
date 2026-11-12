import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHORIZATION_API_DRAFT_BOUNDARY, GrantRevisionStore, NestedActionSessionDraft,
  RevisionedAuthorizationCache,
} from '../authorization-api-draft.mjs';

test('revisioned cache rejects stale same-token authorization after monotonic advance', () => {
  const authority = new GrantRevisionStore();
  const cache = new RevisionedAuthorizationCache();
  const revision = authority.current('editor-a', 'library-a');
  cache.put('token-a:SYS:library-a', revision, { accMode: 3 });
  assert.deepEqual(cache.get('token-a:SYS:library-a', revision), { accMode: 3 });
  const next = authority.advance('editor-a', 'library-a', revision);
  assert.equal(cache.get('token-a:SYS:library-a', next), undefined);
  assert.throws(() => authority.advance('editor-a', 'library-a', revision));
});

test('revision authority is isolated per principal/root and explicit invalidation is bounded', () => {
  const authority = new GrantRevisionStore();
  assert.equal(authority.current('editor-a', 'library-a'), 0);
  assert.equal(authority.current('editor-a', 'library-b'), 0);
  assert.equal(authority.advance('editor-a', 'library-a'), 1);
  assert.equal(authority.current('editor-b', 'library-a'), 0);
  const cache = new RevisionedAuthorizationCache();
  cache.put('token-a:SYS:library-a', 1, { accMode: 1 });
  cache.invalidate('token-a:SYS:library-a');
  assert.equal(cache.get('token-a:SYS:library-a', 1), undefined);
});

test('nested draft commits child context and restores parent after rollback/error', async () => {
  const session = new NestedActionSessionDraft({ root: 'library-a', marker: 'parent' });
  await session.executeNestedSession('child', async current => {
    current.set('marker', 'committed');
  });
  assert.equal(session.current().name, 'root');
  assert.equal(session.get('marker'), 'committed');
  await assert.rejects(session.executeNestedSession('failing', async current => {
    current.set('marker', 'discarded');
    throw new Error('boom');
  }), /boom/);
  assert.equal(session.current().name, 'root');
  assert.equal(session.get('marker'), 'committed');
  assert.throws(() => session.closeNestedSession(), /No nested session/);
});

test('draft is explicitly not production-wired and does not alter JWT or legacy sessions', () => {
  assert.deepEqual(AUTHORIZATION_API_DRAFT_BOUNDARY, {
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
});
