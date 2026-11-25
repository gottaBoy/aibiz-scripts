#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(workspace, 'plm-e2e/package.json'));
const { chromium } = require('@playwright/test');
const credentialPath = path.join(workspace, '.artifacts/current-business-actors-20261122-r1/credentials.private.json');
const credentials = JSON.parse(fs.readFileSync(credentialPath));
assert.equal(fs.statSync(credentialPath).mode & 0o077, 0);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    try { localStorage.setItem('language', 'en'); } catch {}
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:30250/ibizplm-plmweb/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="password"]').waitFor({ state: 'visible' });
  await page.locator('input[type="text"]').first().fill(credentials.username);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.getByRole('button', { name: /^(?:Login|Log in|Sign in|登录)$/i }).click();
  await page.locator('.ibiz-control-appmenu-plm_menu').waitFor({ state: 'visible' });
  const fixture = JSON.parse(fs.readFileSync(path.join(workspace,
    '.artifacts/native-actors-run-20261124-r7/report.private.json')));
  const productId = fixture.product.id;
  assert.match(productId, /^[a-f0-9]{32}$/);
  const menu = page.locator('.ibiz-control-appmenu-plm_menu');
  if (await menu.evaluate(element => element.classList.contains('is-collapse'))) {
    await menu.locator('.ibiz-control-appmenu-collapse-icon').tap();
  }
  await menu.locator('.el-menu-item').filter({ hasText: /^Products$/ }).tap();
  const tree = page.locator('.ibiz-view--product_tree_exp_view');
  await tree.waitFor({ state: 'visible' });
  if (!await menu.evaluate(element => element.classList.contains('is-collapse'))) {
    await menu.locator('.ibiz-control-appmenu-collapse-icon').tap();
  }
  await tree.getByText('All Products', { exact: true }).first().tap();
  const products = page.locator('.ibiz-view--product_all_grid_view:visible');
  await products.locator('.el-table__row').filter({ hasText: fixture.product.name }).tap();
  await page.locator('.ibiz-search-groups').last().waitFor({ state: 'visible' });
  const result = await page.locator('.ibiz-search-groups').last().evaluate(element => {
    const ancestors = [];
    for (let current = element; current && ancestors.length < 12; current = current.parentElement) {
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      ancestors.push({ class: current.className, style: current.getAttribute('style'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        flex: style.flex, display: style.display, overflow: style.overflow,
        grid: style.gridTemplateColumns, align: style.alignItems });
    }
    return { ancestors, children: [...element.children].map(child => {
      const rect = child.getBoundingClientRect();
      const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { class: child.className, text: child.textContent,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        centerHitClass: center?.className };
    }) };
  });
  console.log(JSON.stringify(result));
  await context.close();
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', type: error.name, message: error.message.slice(0, 400) }));
  process.exitCode = 1;
} finally { await browser.close(); }
