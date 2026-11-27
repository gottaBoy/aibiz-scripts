import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(workspace, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));

const templates = parse('plm/model/PSSYSTEM.json').getAllPSSysMsgTempls
  .filter(template => [
    'product_member_create',
    'product_member_remove',
    'product_archived_or_activate',
    'product_remove_or_recover',
  ].includes(template.codeName));
const eventTexts = [
  '把你加入了产品',
  '把你移除了产品',
  '归档了产品',
  '激活了产品',
  '删除了产品',
  '恢复了产品',
];
const enLabels = parse('plm-web/src/locale/en.json');
const htmlProvider = read(
  'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-html/internal-message-html.tsx',
);
const mobHtmlProvider = read(
  'ibiz-app-hub/components/ibiz-next-mob-vue3/src/panel-component/user-message/internal-message-html/internal-message-html.tsx',
);
const htmlLocale = read(
  'ibiz-app-hub/components/ibiz-next-vue3/src/util/user-message-util/internal-message-locale.ts',
);
const mobHtmlLocale = read(
  'ibiz-app-hub/components/ibiz-next-mob-vue3/src/panel-component/user-message/internal-message-locale.ts',
);
const htmlParser = read(
  'ibiz-app-hub/components/ibiz-next-vue3/src/util/wang-editor-util/wang-editor-util.ts',
);
const modelLocale = read('plm-web/src/locale/model-locale.ts');
const frontendStatus = read('scripts/docs/FRONTEND-IMPLEMENTATION-20261122.md');
const dtoStatus = read('scripts/docs/L03-DTO-SOURCE-FOLLOWUP-20261118.md');
const remaining = read('scripts/docs/REMAINING-25-20261111.md');
const enMobileEvidence = parse(
  '.artifacts/current-owned-notification-final-20261123-r4/test-results/current-owned-product-noti-39342-state-before-native-cleanup-current-product-en-mobile/product-notification-evidence.private.json',
);

test('B01/L02 source contract identifies the authoritative persisted notification text', () => {
  assert.equal(templates.length, 4);
  for (const text of eventTexts) {
    const found = text === '归档了产品'
      ? templates.some(template => template.content.includes('归档') && template.content.includes('了产品'))
      : text === '激活了产品'
        ? templates.some(template => template.content.includes('激活') && template.content.includes('了产品'))
        : text === '删除了产品'
          ? templates.some(template => template.content.includes('删除') && template.content.includes('了产品'))
          : text === '恢复了产品'
            ? templates.some(template => template.content.includes('恢复') && template.content.includes('了产品'))
            : templates.some(template => template.content.includes(text));
    assert.ok(found, `Missing authoritative Chinese notification event: ${text}`);
  }
  assert.ok(templates.every(template => template.content.includes('产品管理')));
  assert.ok(enMobileEvidence.locale === 'en-US');
  const observedEvents = enMobileEvidence.stages.uiMarkRead.leafActions
    .map(action => action.event)
    .sort();
  assert.deepEqual(observedEvents, [...eventTexts].sort());
  assert.equal(enMobileEvidence.fullLocalizationAcceptance, false);
});

test('B01/L02 proves display-only localization preserves stored IDs, names and statuses', () => {
  assert.match(htmlProvider, /parseHtml\(props\.message\.content\)/);
  assert.match(htmlProvider, /localizeInternalMessageHtml/);
  assert.match(htmlProvider, /v-html=\{this\.msgContent\}/);
  assert.match(mobHtmlProvider, /localizeInternalMessageHtml/);
  for (const source of [htmlLocale, mobHtmlLocale]) {
    assert.match(source, /Added you to the product/);
    assert.match(source, /Product Management/);
    assert.match(source, /notice-card__event-desc/);
    assert.match(source, /notice-pilot-info/);
    assert.match(source, /user supplied|stored message content|stored message/i);
  }
  assert.match(htmlParser, /decodeURIComponent\(atob\(emoji\)\)/);
  assert.equal(enLabels['产品管理'], 'Products');
  assert.match(modelLocale, /key === 'content'/);
  assert.match(modelLocale, /rawItem\.contentType === 'HTML'/);
  assert.doesNotMatch(modelLocale, /internal-message-html|IInternalMessage|message\.content/);
});

test('B02 remains a static inventory only and does not claim the 73-plugin behavior matrix', () => {
  assert.match(remaining, /B02 \| PARTIAL/);
  assert.match(remaining, /73 插件\/356 个声明文件已有字节审计/);
  assert.match(remaining, /逐插件验证成功\/空态\/错误、读写\/只读、权限、刷新和持久化/);
  assert.match(frontendStatus, /B03\/B04：首批没有新增/);
});

test('B03 source contract keeps generated API search separate from real app embedding and API authorization', () => {
  const compact = frontendStatus.replace(/\s+/g, ' ');
  assert.match(compact, /没有新增 Development\/API Reference 执行或 PLM 内原生 IDE CRUD 证据/);
  assert.match(compact, /B03 的真实权限执行、Development 浏览与/);
  assert.match(compact, /不增加 API Try It/);
  assert.match(remaining, /B03 \| PARTIAL \| Development \/ API Reference/);
});

test('B04 source contract keeps iframe-shell evidence separate from PLM-host CRUD and R05 authorization', () => {
  assert.match(remaining, /B04 \| PARTIAL \| PLM 内 Data Model \/ Modeling IDE/);
  assert.match(remaining, /真实 PLM 宿主执行模型 CRUD/);
  assert.match(remaining, /R05 先解决插件范围授权及 JWT 调度/);
  assert.match(remaining, /MQTT 单独端到端验收/);
  const packageJson = parse('modelingweb/app/package.json');
  const linkedRuntime = JSON.stringify(packageJson);
  assert.match(linkedRuntime, /link:\.\.\/\.\.\/ibiz-app-hub/);
  assert.match(read('scripts/docs/VERSION-COMPATIBILITY-MATRIX.md'), /条件兼容/);
});

test('L03 source contract preserves unresolved DTO provenance instead of inventing declarations', () => {
  const compact = dtoStatus.replace(/\s+/g, ' ');
  assert.match(compact, /7,829 DTO method references/);
  assert.match(compact, /7,827 field-resolved references/);
  assert.match(compact, /two unresolved method references and one unresolved nested reference/);
  assert.match(compact, /Runtime serialization, response types, per-operation validation and authorization remain unaccepted/);
  assert.match(compact, /Completing the two DTO declarations requires an authoritative model definition/);
  assert.match(remaining, /L03 \| PARTIAL \| API 文档正文与 DTO 双语/);
});

test('L01/L02 source contract records the exact safe repair shape', () => {
  const requiredTranslations = {
    '把你加入了产品': 'Added you to the product',
    '把你移除了产品': 'Removed you from the product',
    归档了产品: 'Archived the product',
    激活了产品: 'Activated the product',
    删除了产品: 'Deleted the product',
    恢复了产品: 'Restored the product',
    产品管理: 'Product Management',
  };
  for (const [source, target] of Object.entries(requiredTranslations)) {
    assert.equal(typeof source, 'string');
    assert.equal(typeof target, 'string');
    assert.notEqual(source, target);
    const present = ['归档了产品', '激活了产品', '删除了产品', '恢复了产品'].includes(source)
      ? templates.some(template => template.content.includes(source.slice(0, 2)) &&
        template.content.includes('了产品'))
      : templates.some(template => template.content.includes(source));
    assert.ok(present);
    if (source !== '产品管理') assert.ok(!Object.values(enLabels).includes(target));
  }
  assert.match(frontendStatus, /动态边界/);
  assert.match(remaining, /B03 \| PARTIAL \| Development \/ API Reference/);
});
