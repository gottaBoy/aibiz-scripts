import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function validateOwnedPlatformRequest(runId, peer, path, method) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.ok(['uaa', 'backend'].includes(peer));
  const auth = {
    '/auths/login': ['uaa', 'POST'],
    '/auths/user-info/self': ['uaa', 'GET'],
    '/v7/login': ['backend', 'POST'],
    '/uaa/oauth/userinfo': ['backend', 'GET'],
    '/appdata': ['backend', 'GET'],
    '/appdata/ibizmodeling': ['backend', 'GET'],
    '/uaa/getbydcsystem/ibizmodeling': ['backend', 'GET'],
    '/dictionaries/codelist/SysOperator': ['backend', 'GET'],
  }[path];
  if (auth) {
    assert.deepEqual([peer, method], auth);
    return;
  }
  const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
  if (new RegExp(`^/uaa/refresh_token/${uuid}$`).test(path)) {
    assert.deepEqual([peer, method], ['backend', 'GET']);
    return;
  }
  if (new RegExp(`^/auths/${uuid}/refresh_token$`).test(path)) {
    assert.deepEqual([peer, method], ['uaa', 'GET']);
    return;
  }
  assert.equal(peer, 'backend');
  if (new RegExp(`^/configs/customtheme/nf_${runId}_platform_[a-f0-9]{12}\\?share=false$`).test(path)) {
    assert.ok(['GET', 'PUT'].includes(method));
    return;
  }
  assert.ok(new RegExp(`^/api/ibizmodeling__modeldesign/psdevslnsys/nf_${runId}_root_[ab]/psmodules/(?:fetchcursys|nf_${runId}_module)$`)
    .test(path), 'Unreviewed owned platform route');
  assert.equal(method, path.endsWith('/fetchcursys') ? 'POST' : 'GET');
}

export async function ownedPlatformRequest(context, {
  peer, path, method = 'GET', data, token, applicationContext,
}, { fetchImplementation = fetch } = {}) {
  validateOwnedPlatformRequest(context.manifest.runId, peer, path, method);
  if (token !== undefined) assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  if (applicationContext) {
    assert.deepEqual(Object.keys(applicationContext).sort(), ['organization', 'system']);
    assert.equal(applicationContext.system, 'ibizmodeling');
    assert.ok(context.manifest.users.some(user =>
      applicationContext.organization === `${user.centerId}_org`));
  }
  const live = context.guard();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const result = { status: null, error: null, bytes: 0, data: null };
  try {
    const response = await fetchImplementation(live.origins[peer] + path, {
      method, redirect: 'manual', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(applicationContext ? { srfsystemid: applicationContext.system,
          srforgid: applicationContext.organization } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    result.status = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { ...result, error: 'redirect-refused' };
    }
    const chunks = [];
    const reader = response.body?.getReader();
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      result.bytes += value.length;
      if (result.bytes > 2 * 1024 * 1024) {
        controller.abort();
        return { ...result, error: 'response-too-large' };
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    result.responseSha256 = createHash('sha256').update(bytes).digest('hex');
    if (!bytes.length) return result;
    assert.match(response.headers.get('content-type') ?? '',
      /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i);
    result.data = JSON.parse(bytes.toString('utf8'));
    return result;
  } catch {
    return { ...result, error: controller.signal.aborted ? 'timeout' : 'transport-or-json-error' };
  } finally { clearTimeout(timer); }
}
