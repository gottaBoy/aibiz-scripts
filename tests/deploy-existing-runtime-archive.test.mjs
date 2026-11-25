import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeArchiveAudit } from '../deploy-existing-runtime-archive.mjs';

function receipt(profile) {
  if (profile === 'viewthemesave') {
    return {
      contract: 'existing-allinone-view-theme-save-candidate-v1',
      status: 'PREPARED-NOT-DEPLOYED', deployed: false, serviceRestarted: false,
      original: { sha256: '2764f965f5b49a7b491fe38170112fa40f13d5be9320cb940f288038031277e8' },
      outerAudit: { entries: [{ entry: 'BOOT-INF/lib/ibiz-cloud-saas-extension-8.1.0.584.1.jar', changed: true }] },
      innerAudit: { entries: [
        'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json',
        'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme/PSDEACTIONS/Save.json',
        'sysmodel/saas-extension/PSSYSSERVICEAPIS/api.json',
        'sysmodel/saas-extension/PSSYSSERVICEAPIS/core.json',
      ].map(entry => ({ entry, changed: true, added: false })) },
      saveProbe: { status: 'PASS-EXPLICIT-KEYED-SAVE-CONTRACT',
        methods: ['api', 'core'].map(service => ({ service, resourceKeyRequired: true,
          dataAccess: 'CREATE', actionAccess: 'CREATE' })) },
      accessProbe: { status: 'PASS-VIEW-THEME-SCOPE-AND-SHARED-READ-MODEL',
        rows: Array(24), sharedReadOnly: true },
    };
  }
  if (profile === 'viewthemes') {
    return {
      contract: 'existing-allinone-view-theme-access-candidate-v1',
      status: 'PREPARED-NOT-DEPLOYED', deployed: false, serviceRestarted: false,
      original: { sha256: '563824e4fd2cb378c1cc6db86b9a023554b1f513631e510cf440f96631d82ad4' },
      outerAudit: { entries: [
        { entry: 'BOOT-INF/lib/ibiz-cloud-core-8.1.0.584.1.jar', changed: true },
        { entry: 'BOOT-INF/lib/ibiz-cloud-saas-extension-8.1.0.584.1.jar', changed: true },
      ] },
      innerAudit: { entries: [
        { entry: 'net/ibizsys/central/cloud/saas/extension/runtime/dataentity/security/DataEntityAccessManager.class',
          changed: true, added: false },
        { entry: 'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json',
          changed: true, added: false },
        { entry: 'sysmodel/saas-extension/PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme/PSDEUSERROLES/SystemRead.json',
          changed: true, added: true },
      ] },
      accessProbe: { status: 'PASS-VIEW-THEME-SCOPE-AND-SHARED-READ-MODEL',
        rows: Array(24), sharedReadOnly: true, personalRoleUnchanged: true },
      errorProbe: { rows: Array.from({ length: 10 }, () => ({ status: 404 })) },
      errorAudit: { entries: [
        { entry: 'net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.class', changed: true },
      ] },
    };
  }
  const portal = profile === 'portal';
  const module = portal ? 'BOOT-INF/lib/ibiz-plugin-cloud-8.1.0.584.1.jar'
    : 'BOOT-INF/lib/ibiz-cloud-core-8.1.0.584.1.jar';
  const classes = portal ? ['net/ibizsys/central/plugin/cloud/sysutil/SysCloudClientUtilRuntimeBase.class',
    ...[1, 2, 3].map(index =>
      `net/ibizsys/central/plugin/cloud/sysutil/SysCloudClientUtilRuntimeBase$${index}.class`)]
    : ['net/ibizsys/central/cloud/core/service/util/ResponseExceptionHandler.class'];
  return {
    contract: portal ? 'existing-allinone-local-portal-candidate-v1' : 'existing-plm-notfound-provider-candidate-v1',
    status: 'PREPARED-NOT-DEPLOYED', deployed: false, serviceRestarted: false,
    original: { sha256: portal ? '45655061236257781f4482a80d0e54d9e023d214d34b03fcd170e18814f2ad64'
      : '2b4d9064212bca8465f2351e5c34dcbf8b6ce27986e2b4edfa67ad223952fc38' },
    outerAudit: { entries: [{ entry: module, changed: true }] },
    innerAudit: { entries: [...classes.map(entry => ({ entry, changed: true, added: false })),
      ...(portal ? [{ entry: 'net/ibizsys/central/plugin/cloud/service/client/LocalCloudPortalClient.class',
        changed: true, added: true }] : [])] },
    dispatchProbe: { status: 'PASS-LOCAL-PORTAL-DISPATCH-AND-REMOTE-FALLBACK',
      forwardedMethods: 9, remoteFallbackPaths: 3 },
    originalProbe: { rows: Array.from({ length: 10 }, () => ({ status: 500 })) },
    candidateProbe: { rows: Array.from({ length: 10 }, () => ({ status: 404 })) },
  };
}

test('only the reviewed module and exact existing/additional classes are eligible', () => {
  for (const profile of ['portal', 'notfound', 'viewthemes', 'viewthemesave']) {
    const spec = validateRuntimeArchiveAudit(profile, receipt(profile));
    assert.ok(spec.container && spec.image && spec.target);
  }
});

test('unrelated classes, schemas, model edits and untested candidates are rejected', () => {
  for (const mutate of [
    value => value.outerAudit.entries.push({ entry: 'BOOT-INF/classes/schema.sql', changed: true }),
    value => value.innerAudit.entries.push({ entry: 'Unreviewed.class', changed: true, added: true }),
    value => { value.original.sha256 = '0'.repeat(64); },
    value => { value.status = 'FAILED'; },
    value => { value.deployed = true; },
    value => { value.dispatchProbe.forwardedMethods = 8; },
    value => { value.innerAudit.entries[0].added = true; },
  ]) {
    const value = receipt('portal');
    mutate(value);
    assert.throws(() => validateRuntimeArchiveAudit('portal', value));
  }
  assert.throws(() => validateRuntimeArchiveAudit('other-project', receipt('portal')));
});

test('view preference releases require both exact model scope and read-only shared behavior', () => {
  for (const mutate of [
    value => { value.accessProbe.sharedReadOnly = false; },
    value => { value.accessProbe.personalRoleUnchanged = false; },
    value => { value.errorAudit.entries[0].entry = 'Unreviewed.class'; },
    value => { value.innerAudit.entries[2].entry = 'sysmodel/other.json'; },
    value => { value.outerAudit.entries.push({ entry: 'BOOT-INF/classes/schema.sql', changed: true }); },
  ]) {
    const value = receipt('viewthemes');
    mutate(value);
    assert.throws(() => validateRuntimeArchiveAudit('viewthemes', value));
  }
});

test('Save releases must preserve the declared resource key and both API access mappings', () => {
  for (const mutate of [
    value => { value.saveProbe.methods[0].resourceKeyRequired = false; },
    value => { value.saveProbe.methods[1].dataAccess = 'NONE'; },
    value => { value.innerAudit.entries.push({ entry: 'Unreviewed.class', changed: true }); },
  ]) {
    const value = receipt('viewthemesave');
    mutate(value);
    assert.throws(() => validateRuntimeArchiveAudit('viewthemesave', value));
  }
});
