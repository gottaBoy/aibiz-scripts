import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '../..');
const compose = await readFile(join(root, 'plm/deploy/compose/docker-compose-dev.yml'), 'utf8');
const dockerfile = await readFile(join(root, 'plm-web/Dockerfile.plmweb'), 'utf8');
const nginx = await readFile(join(root, 'plm-web/nginx-local.conf'), 'utf8');
const start = await readFile(join(root, 'plm-web/start.sh'), 'utf8');

test('PLM Web Compose uses the local source-built image and mounted model/plugins', () => {
  const block = compose.slice(compose.indexOf('  #plmweb'), compose.indexOf('\n\n  #plmmob'));
  assert.match(block, /build:\n\s+context: \.\.\/\.\.\/\.\.\/plm-web/);
  assert.match(block, /dockerfile: Dockerfile\.plmweb/);
  assert.match(block, /image: \$\{PLM_WEB_IMAGE:-aibiz\/plmweb:local\}/);
  assert.match(block, /pull_policy: never/);
  assert.match(block, /30250:8080/);
  assert.match(block, /LOCAL_PLUGIN_SOURCE=\/opt\/aibiz\/local-plugins/);
  assert.match(block, /:\/opt\/aibiz\/local-plugins:ro/);
  assert.match(block, /:\/app\/model:ro/);
  assert.match(block, /entrypoint: \/start\.sh/);
  assert.match(block, /plmservice:\n\s+condition: service_healthy/);
  assert.match(compose, /AIBIZ_HARNESS_PLM_URL=http:\/\/plmweb:8080\/ibizplm-plmweb\//);
});

test('PLM Web image is self-contained and runs unprivileged Nginx', () => {
  assert.match(dockerfile, /FROM \$\{NGINX_IMAGE\}/);
  assert.match(dockerfile, /COPY --chown=101:101 dist\/ \/dist\//);
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /USER 101/);
  assert.match(dockerfile, /ENTRYPOINT \["\/start\.sh"\]/);
  assert.match(dockerfile, /test -s \/dist\/index\.html/);
  assert.match(start, /PLMWEB ENV OVERRIDES/);
  assert.match(nginx, /listen 8080/);
  assert.match(nginx, /\/ibizplm-plmweb\//);
  assert.match(nginx, /\/ibizservicerunner\/serviceapi/);
  assert.match(nginx, /\/dictionaries\//);
  assert.match(nginx, /jsonschema/);
});
