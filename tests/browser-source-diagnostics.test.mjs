import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  attachBrowserSourceDiagnostics,
  classifyScriptSource,
  isLiveReloadRequest,
  isStartTimeReporterError,
} from '../browser-source-diagnostics.mjs';

test('reporter detection is narrow and VM/anonymous scripts are not automatically blamed on extensions', () => {
  assert.equal(
    isStartTimeReporterError(
      "Cannot read properties of undefined (reading 'startTime')\nat et.reportAllChanges (<anonymous>:2:19429)",
    ),
    true,
  );
  assert.equal(
    isStartTimeReporterError(
      "Cannot read properties of undefined (reading 'startTime')\nat app.render",
    ),
    false,
  );
  assert.equal(
    isStartTimeReporterError('et.reportAllChanges completed'),
    false,
  );
  assert.equal(
    isLiveReloadRequest('https://plm.ibizlab.cn:45571/livereload.js?snipver=1'),
    true,
  );
  assert.equal(
    isLiveReloadRequest('https://local/api?file=livereload.js'),
    false,
  );
  assert.equal(classifyScriptSource({ url: 'VM1267' }), 'unattributed');
  assert.equal(classifyScriptSource({ url: '' }), 'unattributed');
  assert.equal(
    classifyScriptSource({ url: 'chrome-extension://fixture/probe.js' }),
    'browser-extension',
  );
  assert.equal(
    classifyScriptSource({}, { origin: 'chrome-extension://fixture' }),
    'browser-extension',
  );
  assert.equal(
    classifyScriptSource({}, { auxData: { isDefault: false } }),
    'isolated-context-unattributed',
  );
  const url = 'http://localhost/app.js';
  assert.equal(
    classifyScriptSource({ url }, {}, new Set([url])),
    'network-script',
  );
});

test('CDP records script hashes, context, request initiators and failures without suppressing page errors', async () => {
  const session = new EventEmitter();
  const commands = [];
  session.send = async (name, params) => {
    commands.push([name, params]);
    return name === 'Debugger.getScriptSource'
      ? {
          scriptSource:
            'class et {reportAllChanges(){return undefined.startTime}}',
        }
      : {};
  };
  session.detach = async () => {};
  const page = {
    context: () => ({ newCDPSession: async () => session }),
    url: () => 'http://localhost/doc/',
  };
  const collector = await attachBrowserSourceDiagnostics(page);
  session.emit('Runtime.executionContextCreated', {
    context: {
      id: 1,
      name: '',
      origin: 'http://localhost',
      auxData: { isDefault: true },
    },
  });
  session.emit('Debugger.scriptParsed', {
    scriptId: '9',
    url: '',
    executionContextId: 1,
  });
  const frames = [
    {
      scriptId: '9',
      functionName: 'et.reportAllChanges',
      url: '',
      lineNumber: 1,
      columnNumber: 19428,
    },
  ];
  session.emit('Runtime.exceptionThrown', {
    exceptionDetails: {
      exceptionId: 7,
      exception: {
        description:
          "TypeError: Cannot read properties of undefined (reading 'startTime')",
      },
      stackTrace: { callFrames: frames },
    },
  });
  session.emit('Network.requestWillBeSent', {
    requestId: 'reload',
    type: 'Script',
    request: { url: 'https://plm.ibizlab.cn:45571/livereload.js?snipver=1' },
    documentURL: 'http://localhost/doc/',
    initiator: { type: 'script', stack: { callFrames: frames } },
  });
  session.emit('Network.loadingFailed', {
    requestId: 'reload',
    errorText: 'net::ERR_CONNECTION_REFUSED',
  });
  await collector.close();
  assert.equal(collector.report.status, 'observed');
  assert.equal(collector.report.records.length, 2);
  const [error, reload] = collector.report.records;
  assert.equal(error.sources[0].attribution, 'unattributed');
  assert.match(error.sources[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(error.sources[0].markers, ['reportAllChanges', 'startTime']);
  assert.equal(error.sources[0].executionContext.origin, 'http://localhost');
  assert.equal(error.sources[0].line, 2);
  assert.match(error.disposition, /retained as an unexpected error/);
  assert.equal(reload.failure.errorText, 'net::ERR_CONNECTION_REFUSED');
  assert.ok(
    commands.every(([command]) =>
      [
        'Runtime.enable',
        'Debugger.enable',
        'Network.enable',
        'Debugger.getScriptSource',
      ].includes(command),
    ),
  );
  assert.equal(session.listenerCount('Runtime.exceptionThrown'), 0);
});
