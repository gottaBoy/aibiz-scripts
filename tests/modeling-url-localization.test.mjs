import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { workspace } from '../localization-baseline.mjs';
import { classifyModelingTarget } from '../../modelingweb/app/tests/modeldesign-target.mjs';

const modelRoot = join(workspace, 'plm/model/PSSYSAPPS/plmweb');
const webRoot = join(workspace, 'plm-web');
const modelingRoot = join(workspace, 'modelingweb');
const composeRoot = join(workspace, 'plm/deploy/compose');
const localModelingUrl = 'http://127.0.0.1:32003/modeldesign/';

test('PLM Modeling HtmlView is local but cannot satisfy native editor acceptance', async () => {
  const [model, view, environment] = await Promise.all([
    readFile(
      join(modelRoot, 'PSAPPDEVIEWS/ps_core_prd_func_modeling_ide_html_view.json'),
      'utf8',
    ).then(JSON.parse),
    readFile(
      join(webRoot, 'src/publish/model/views/ps-core-prd-func-modeling-ide-html-view.ts'),
      'utf8',
    ),
    readFile(join(webRoot, 'public/environments/environment.js'), 'utf8'),
  ]);

  assert.equal(model.htmlUrl, localModelingUrl);
  assert.equal(classifyModelingTarget(model, localModelingUrl).eligible, false);
  assert.match(view, /getModelingWebUrl\(\)/);
  assert.match(environment, /modelingWebUrl:\s*['"]http:\/\/127\.0\.0\.1:32003\/modeldesign\/['"]/);
});

test('ModelDesign target classification rejects self-reference and PLM models', () => {
  const entry = localModelingUrl;
  assert.equal(
    classifyModelingTarget({ htmlUrl: `${entry}#editor` }, entry).eligible,
    false,
  );
  assert.equal(
    classifyModelingTarget({ htmlUrl: '/native-editor/', dynaModelFilePath: 'PSSYSAPPS/plmweb/view.json' }, entry).eligible,
    false,
  );
  assert.equal(classifyModelingTarget({}, entry).eligible, false);
  assert.equal(
    classifyModelingTarget({ htmlUrl: '/native-editor/', dynaModelFilePath: 'PSSYSAPPS/modeldesign/view.json' }, entry).eligible,
    true,
  );
});

test('PLM recent Modeling redirect is local and configurable in both model formats', async () => {
  const [jsonView, appModel, tsView] = await Promise.all([
    readFile(
      join(modelRoot, 'PSAPPDEVIEWS/recent_modeling_custome_view.json'),
      'utf8',
    ),
    readFile(join(modelRoot, 'PSSYSAPP.json'), 'utf8'),
    readFile(
      join(webRoot, 'src/publish/model/views/recent-modeling-custome-view.ts'),
      'utf8',
    ),
  ]);

  for (const source of [jsonView, appModel, tsView]) {
    assert.match(source, /Environment\?\.modelingWebUrl/);
    assert.match(source, /127\.0\.0\.1:32003\/modeldesign\//);
    assert.doesNotMatch(source, /plm\.ibizlab\.cn\/modeling/);
  }
});

test('Modeling Web plugin navigation reads the same runtime URL override', async () => {
  const [helper, workbench, environment, html] = await Promise.all([
    readFile(
      join(modelingRoot, 'app/src/modeling-plugins/modeling-url.ts'),
      'utf8',
    ),
    readFile(
      join(modelingRoot, 'app/src/modeling-plugins/Workbench.vue'),
      'utf8',
    ),
    readFile(
      join(modelingRoot, 'app/public/environments/environment.js'),
      'utf8',
    ),
    readFile(join(modelingRoot, 'app/modeling-plugins.html'), 'utf8'),
  ]);

  assert.match(helper, /environment\?\.modelingWebUrl/);
  assert.match(helper, /DEFAULT_MODELING_WEB_URL/);
  assert.match(helper, /replace\(\/\\\/\+\$\/, ''\)/);
  assert.match(workbench, /getModelingWebUrl\(\)/);
  assert.match(environment, /modelingWebUrl:\s*['"]http:\/\/127\.0\.0\.1:32003\/modeldesign\/['"]/);
  assert.match(html, /<script src="\.\/assets\/environment\.js"><\/script>/);
});

test('Modeling Web development and Docker serving expose the environment override', async () => {
  const [viteConfig, nginx, environmentConfig, start, compose] = await Promise.all([
    readFile(
      join(modelingRoot, 'app/vite.modeling-plugins.config.ts'),
      'utf8',
    ),
    readFile(join(modelingRoot, 'nginx-local.conf'), 'utf8'),
    readFile(join(modelingRoot, 'environment.config'), 'utf8'),
    readFile(join(modelingRoot, 'start.sh'), 'utf8'),
    readFile(join(composeRoot, 'docker-compose-dev.yml'), 'utf8'),
  ]);

  assert.match(
    viteConfig,
    /req\.url !== '\/assets\/environment\.js'/,
  );
  assert.match(viteConfig, /public\/environments\/environment\.js/);
  assert.doesNotMatch(
    nginx,
    /location = \/modeling-plugins\/assets\/environment\.js/,
  );
  assert.match(
    nginx,
    /location \^~ \/modeling-plugins\/ \{[\s\S]*?proxy_pass \$modeling_plugins_upstream;/,
  );
  assert.match(environmentConfig, /^modelingWebUrl:MODELINGWEBURL$/m);
  assert.match(
    start,
    /environment_file=\/dist\/environments\/environment\.js[\s\S]*?\/environment\.config ["']?\$environment_file/,
  );
  assert.match(
    compose,
    /- MODELINGWEBURL=\$\{MODELINGWEBURL:-http:\/\/127\.0\.0\.1:32003\/modeldesign\/\}/,
  );
});
