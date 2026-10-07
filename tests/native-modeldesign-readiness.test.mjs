import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test, { before, after } from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import {
  collectNativeIndexEvidence,
  inspectNativeIndexReadiness,
  verifyModelDesignMenuNavigation,
  waitForNativeIndexReady,
} from '../../modelingweb/app/tests/native-modeldesign.browser.mjs';

const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { chromium } = require('playwright');
const options = {
  application: 'ModelDesign', applicationId: 'ibizmodeling__modeldesign',
  indexPath: 'PSSYSAPPS/ModelDesign/PSAPPINDEXVIEWS/ModelingIndex.json',
  timeout: 400, stableFor: 0,
};
let browser;
before(async () => { browser = await launchChromium(chromium, { args: ['--no-sandbox'] }); });
after(async () => { await browser?.close(); });

async function fixture(t, { clickMode = 'target', central = false } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(`<!doctype html><html><head><style>
    .ibiz-view { min-width: 200px; min-height: 40px; }
    .ibiz-left-side-menu, .ibiz-right-side-menu, .ibiz-bottom-side-menu { min-height: 30px; }
    .ibiz-top-side-menu { display: none; }
    .el-loading-mask, .app-loading-x, .el-skeleton { width: 100px; height: 100px; }
  </style></head><body>
    <div id="index-view" class="ibiz-view ibiz-view-appindexview">
      <div class="ibiz-left-side-menu">
        <button index="sys">System</button><button index="de">Entity</button>
      </div>
      <div class="ibiz-right-side-menu"><button index="plugins">Plugins</button></div>
      <div class="ibiz-top-side-menu"></div>
      <div class="ibiz-bottom-side-menu"><button index="debug">DEBUG</button></div>
    </div>
  </body></html>`);
  await page.evaluate(({ options, clickMode, central }) => {
    const applicationId = central ? 'ibizmodeling__central' : options.applicationId;
    const state = () => ({
      isCreated: true, isMounted: true, isLoading: false, isDestroyed: false, hasError: false,
    });
    const controls = [
      { name: 'leftsidemenu', appMenuItems: [
        { id: 'sys', caption: 'System', itemType: 'MENUITEM', appFuncId: 'system' },
        { id: 'de', caption: 'Entity', itemType: 'MENUITEM', appFuncId: 'entity', openDefault: true },
      ] },
      { name: 'rightsidemenu', appMenuItems: [
        { id: 'plugins', caption: 'Plugins', itemType: 'MENUITEM', appFuncId: 'plugins' },
      ] },
      { name: 'topsidemenu', appMenuItems: [
        { id: 'hidden', itemType: 'MENUITEM', hidden: true },
      ] },
      { name: 'bottomsidemenu', appMenuItems: [
        { id: 'debug', caption: 'DEBUG', itemType: 'MENUITEM' },
      ] },
    ];
    const index = {
      id: 'index-view', model: {
        id: 'modelingindex', codeName: 'ModelingIndex', appId: applicationId,
        viewType: 'APPINDEXVIEW', viewLayoutPanel: { controls }, controls: [],
      },
      context: { srfappid: applicationId }, state: {
        ...state(), designIndexErrors: [], designIndexDefaultOpens: { 'leftsidemenu:de': 'pending' },
      },
      layoutPanel: { state: state(), panelItems: {}, providers: {} },
    };
    const app = {
      getAppFunc: id => ({
        id, appFuncType: 'APPVIEW',
        appViewId: { system: 'system-view', entity: 'entity-view', plugins: 'plugins-view' }[id],
      }),
    };
    controls.forEach((control, position) => {
      const id = `side-${position}`;
      const name = control.name.replace('sidemenu', '');
      index.layoutPanel.panelItems[id] = {
        model: { id, name, rawItem: { predefinedType: `${name.toUpperCase()}_SIDE_MENU` } },
        appMenu: control, view: index, context: index.context, itemProviders: {},
        state: {
          ...state(), items: control.appMenuItems,
          menuItemsState: Object.fromEntries(control.appMenuItems.map(item => [
            item.id, { visible: !item.hidden, permitted: true },
          ])),
        },
      };
      index.layoutPanel.providers[id] = { component: `IBiz${name}SideMenu` };
    });
    const views = new Map([[index.id, index]]);
    window.Environment = { nativeModelApp: central ? 'Central' : options.application };
    window.ibiz = {
      env: { appId: applicationId },
      util: { viewStack: { getView: id => views.get(id) } },
      hub: { getApp: id => id === applicationId ? app : undefined },
    };
    window.fixture = { index, views, trustedClicks: 0 };
    document.querySelector('[index="sys"]').addEventListener('click', event => {
      if (event.isTrusted) window.fixture.trustedClicks += 1;
      if (clickMode === 'noop') return;
      if (clickMode === 'url-only') { location.hash = '/-/index/-/unrelated'; return; }
      const element = document.createElement('div');
      element.id = 'target-controller';
      element.className = 'ibiz-view';
      element.textContent = 'System tree';
      document.querySelector('#index-view').append(element);
      const target = {
        id: element.id, model: {
          id: clickMode === 'wrong-target' ? 'unrelated-view' : 'system-view',
          codeName: 'SystemView', appId: applicationId, viewType: 'DETREEEXPVIEW',
        },
        context: { srfappid: applicationId }, state: state(),
      };
      if (clickMode === 'loading') target.state.isLoading = true;
      if (clickMode === 'unmounted') target.state.isMounted = false;
      if (clickMode === 'error') target.state.hasError = true;
      if (clickMode === 'destroyed') target.state.isDestroyed = true;
      if (clickMode === 'wrong-app') target.model.appId = 'unrelated';
      if (clickMode === 'missing-controller') return;
      views.set(element.id, target);
    });
  }, { options, clickMode, central });
  return page;
}

test('reads public ViewStack and nested layout controls, including hidden and pending-default menus', async t => {
  const page = await fixture(t);
  const evidence = await waitForNativeIndexReady(page, options);
  assert.deepEqual(inspectNativeIndexReadiness(evidence), []);
  assert.equal(evidence.index.controllerId, 'index-view');
  assert.equal(evidence.layout.panels.length, 4);
  assert.equal(evidence.layout.panels[0].role, 'LEFT_SIDE_MENU');
  assert.equal(evidence.menus[0].bindingCount, 1);
  assert.equal(evidence.menus[0].controller.id, 'side-0');
  assert.equal(evidence.menus[0].items[0].dom[0].matchedBy, 'index');
  assert.equal(evidence.menus[2].items[0].hidden, true);
  assert.equal(evidence.defaultOpens['leftsidemenu:de'], 'pending');
});

test('accepts a Central controller without inventing ModelDesign side-menu requirements', async t => {
  const page = await fixture(t, { central: true });
  await page.evaluate(() => { window.fixture.index.model.viewLayoutPanel.controls = []; });
  const evidence = await waitForNativeIndexReady(page, {
    ...options, application: 'Central', applicationId: 'ibizmodeling__central',
  });
  assert.deepEqual(evidence.menus, []);
});

for (const selector of ['app-loading-x', 'el-loading-mask', 'el-skeleton']) {
  test(`does not pass while ${selector} is visible and waits for removal`, async t => {
    const page = await fixture(t);
    await page.evaluate(selector => {
      const overlay = document.createElement('div');
      overlay.className = selector;
      document.body.append(overlay);
    }, selector);
    await assert.rejects(waitForNativeIndexReady(page, { ...options, timeout: 150 }), error =>
      /loading overlay/.test(error.message) && error.evidence.runtime.visibleOverlays.length === 1);
    await page.evaluate(selector => {
      setTimeout(() => document.querySelector(`.${selector}`).remove(), 100);
    }, selector);
    const evidence = await waitForNativeIndexReady(page, options);
    assert.deepEqual(evidence.visibleOverlays, []);
  });
}

test('does not count overlays hidden by an ancestor as loading', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    hidden.innerHTML = '<div class="el-loading-mask"></div>';
    document.body.append(hidden);
  });
  assert.deepEqual((await waitForNativeIndexReady(page, options)).visibleOverlays, []);
});

const rejected = [
  ['missing public controller', () => { window.fixture.views.clear(); }, /ViewController/],
  ['wrong injected selector', () => { window.Environment.nativeModelApp = 'Central'; }, /identity/],
  ['wrong runtime application', () => { window.ibiz.env.appId = 'ibizmodeling__central'; }, /identity/],
  ['wrong root controller identity', () => { window.fixture.index.id = 'other'; }, /ViewController/],
  ['wrong root model application', () => { window.fixture.index.model.appId = 'other'; }, /ViewController/],
  ['wrong index model', () => { window.fixture.index.model.codeName = 'OtherIndex'; }, /ViewController/],
  ['index still loading', () => { window.fixture.index.state.isLoading = true; }, /ViewController/],
  ['index not mounted', () => { window.fixture.index.state.isMounted = false; }, /ViewController/],
  ['index destroyed', () => { window.fixture.index.state.isDestroyed = true; }, /ViewController/],
  ['layout not mounted', () => { window.fixture.index.layoutPanel.state.isMounted = false; }, /layout/],
  ['mounted but unresolved host menus', () => {
    for (const item of Object.values(window.fixture.index.layoutPanel.panelItems)) item.appMenu = undefined;
  }, /host menu binding/],
  ['different bound model object', () => {
    const item = window.fixture.index.layoutPanel.panelItems['side-0'];
    item.appMenu = { ...item.appMenu };
  }, /host menu binding/],
  ['wrong menu owner', () => {
    window.fixture.index.layoutPanel.panelItems['side-0'].view = {};
  }, /host menu binding/],
  ['duplicate model declaration', () => {
    const index = window.fixture.index;
    index.model.controls.push(index.model.viewLayoutPanel.controls[0]);
  }, /ambiguous host menu binding/],
  ['duplicate bound controller', () => {
    const panel = window.fixture.index.layoutPanel;
    panel.panelItems.duplicate = { ...panel.panelItems['side-0'] };
  }, /ambiguous host menu binding/],
  ['lifecycle missing-placeholder errors', () => {
    window.fixture.index.state.designIndexErrors.push({ phase: 'layout', menu: 'rightsidemenu' });
  }, /lifecycle errors/],
  ['failed default open', () => {
    window.fixture.index.state.designIndexDefaultOpens['leftsidemenu:de'] = 'failed';
  }, /lifecycle errors/],
  ['empty menu shell', () => {
    document.querySelectorAll('button').forEach(item => item.remove());
  }, /visible DOM/],
  ['wrong DOM menu identity', () => {
    document.querySelector('[index="sys"]').setAttribute('index', 'other');
  }, /visible DOM/],
  ['duplicate menu DOM', () => {
    const item = document.querySelector('[index="sys"]');
    item.after(item.cloneNode(true));
  }, /visible DOM/],
  ['disabled real DOM button', () => {
    document.querySelector('[index="sys"]').disabled = true;
  }, /visible DOM/],
  ['no permitted menu entries', () => {
    for (const item of Object.values(window.fixture.index.layoutPanel.panelItems)) {
      for (const state of Object.values(item.state.menuItemsState)) state.permitted = false;
    }
  }, /no permitted/],
];
for (const [name, mutate, message] of rejected) {
  test(`rejects ${name} with actual runtime diagnostics`, async t => {
    const page = await fixture(t);
    await page.evaluate(mutate);
    await assert.rejects(waitForNativeIndexReady(page, { ...options, timeout: 100 }), error => {
      assert.match(error.message, message);
      assert.ok(error.evidence.runtime);
      assert.ok(error.evidence.readinessFailures.length);
      return true;
    });
  });
}

test('requires a real trusted menu DOM click and a new mounted model-linked target controller', async t => {
  const page = await fixture(t);
  const evidence = await verifyModelDesignMenuNavigation(page, options);
  assert.equal(await page.evaluate(() => window.fixture.trustedClicks), 1);
  assert.equal(evidence.click.menu, 'leftsidemenu');
  assert.equal(evidence.click.itemId, 'sys');
  assert.equal(evidence.click.appFuncId, 'system');
  assert.equal(evidence.click.target.viewId, 'system-view');
  assert.deepEqual(evidence.click.event, {
    type: 'click', isTrusted: true, button: 0, index: 'sys', text: 'System',
  });
  assert.equal(evidence.after.views.find(view => view.id === 'system-view').lifecycle.isMounted, true);
});

for (const clickMode of [
  'noop', 'url-only', 'wrong-target', 'wrong-app', 'loading', 'unmounted',
  'error', 'destroyed', 'missing-controller',
]) {
  test(`does not accept ${clickMode} as ModelDesign navigation`, async t => {
    const page = await fixture(t, { clickMode });
    await assert.rejects(verifyModelDesignMenuNavigation(page, { ...options, timeout: 150 }), error => {
      assert.match(error.message, /clicked APPVIEW target is not mounted/);
      assert.equal(error.evidence.click.itemId, 'sys');
      assert.ok(error.evidence.before.index);
      assert.ok(error.evidence.runtime);
      return true;
    });
    assert.equal(await page.evaluate(() => window.fixture.trustedClicks), 1);
  });
}

test('allows unique caption binding for ElementPlus menu DOM without an index attribute', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    document.querySelector('[index="sys"]').removeAttribute('index');
  });
  const evidence = await verifyModelDesignMenuNavigation(page, options);
  assert.equal(evidence.click.dom.matchedBy, 'caption');
});

test('does not use an automatically opened default menu as a navigation proof', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const index = window.fixture.index;
    for (const control of index.model.viewLayoutPanel.controls) {
      for (const item of control.appMenuItems) item.openDefault = true;
    }
  });
  await assert.rejects(verifyModelDesignMenuNavigation(page, options), /non-default APPVIEW/);
  assert.equal(await page.evaluate(() => window.fixture.trustedClicks), 0);
});

test('does not reuse a preexisting target controller as new navigation evidence', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const element = document.createElement('div');
    element.id = 'existing-system';
    element.className = 'ibiz-view';
    element.style.display = 'none';
    document.body.append(element);
    window.fixture.views.set(element.id, {
      id: element.id, model: {
        id: 'system-view', codeName: 'SystemView', appId: window.ibiz.env.appId,
        viewType: 'DETREEEXPVIEW',
      },
      state: { ...window.fixture.index.state },
    });
  });
  await assert.rejects(verifyModelDesignMenuNavigation(page, options), /non-default APPVIEW/);
  assert.equal(await page.evaluate(() => window.fixture.trustedClicks), 0);
});

test('does not assume a custom item provider executes its declared APPVIEW function', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.fixture.index.layoutPanel.panelItems['side-0'].itemProviders.sys = { onClick() {} };
  });
  await assert.rejects(verifyModelDesignMenuNavigation(page, options), /non-default APPVIEW/);
  assert.equal(await page.evaluate(() => window.fixture.trustedClicks), 0);
});

test('accepts root-level host controls as well as viewLayoutPanel controls', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const index = window.fixture.index;
    index.model.controls = index.model.viewLayoutPanel.controls;
    index.model.viewLayoutPanel.controls = [];
  });
  assert.equal((await waitForNativeIndexReady(page, options)).menus.length, 4);
});

test('rechecks current bindings rather than accepting an index that was ready before reload', async t => {
  const page = await fixture(t);
  await waitForNativeIndexReady(page, options);
  await page.reload();
  await assert.rejects(waitForNativeIndexReady(page, { ...options, timeout: 100 }), error =>
    /identity mismatch/.test(error.message) && error.evidence.runtime.index === null);
});

test('collector remains synchronous and serializable across page evaluation', async t => {
  const page = await fixture(t);
  const evidence = await page.evaluate(collectNativeIndexEvidence, options);
  assert.equal(Object.hasOwn(evidence, 'then'), false);
  assert.equal(JSON.parse(JSON.stringify(evidence)).menus.length, 4);
});
