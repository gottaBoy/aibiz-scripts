import { createHash } from 'node:crypto';

export function isStartTimeReporterError(message) {
  return (
    typeof message === 'string' &&
    /\bstartTime\b/.test(message) &&
    /\breportAllChanges\b/.test(message)
  );
}

export function isLiveReloadRequest(value) {
  try {
    return new URL(value).pathname === '/livereload.js';
  } catch {
    return false;
  }
}

export function classifyScriptSource(
  script = {},
  context = {},
  networkUrls = new Set(),
) {
  const url = script.url || '';
  if (
    [url, context.origin].some((value) =>
      /^(chrome|moz|safari-web)-extension:\/\//.test(value || ''),
    )
  ) {
    return 'browser-extension';
  }
  if (url && networkUrls.has(url)) return 'network-script';
  if (context.auxData?.isDefault === false)
    return 'isolated-context-unattributed';
  // VM/anonymous names also occur for application eval; they do not prove injection.
  return 'unattributed';
}

// Observe CDP events only. Nothing is injected into the page or suppressed.
export async function attachBrowserSourceDiagnostics(page) {
  const report = {
    method:
      'CDP script/exception/execution-context/network observation; no page patches',
    status: 'not_observed',
    records: [],
    limitations: [
      'A VM or anonymous stack alone cannot identify a browser extension.',
      'Absent local source matches do not prove browser injection.',
      'Only this page CDP target is observed; cross-origin out-of-process frames may require their own target.',
    ],
  };
  const session = await page.context().newCDPSession(page);
  const scripts = new Map();
  const contexts = new Map();
  const networkUrls = new Set();
  const requests = new Map();
  const pending = new Set();
  const listeners = [];
  const on = (event, callback) => {
    session.on(event, callback);
    listeners.push([event, callback]);
  };

  function enqueue(callback) {
    const task = callback().catch((error) => {
      report.records.push({ type: 'diagnostic-error', message: error.message });
    });
    pending.add(task);
    task.finally(() => pending.delete(task));
  }

  async function sourceEvidence(frames) {
    const evidence = [];
    const seen = new Set();
    for (const frame of frames.slice(0, 8)) {
      if (!frame.scriptId || seen.has(frame.scriptId)) continue;
      seen.add(frame.scriptId);
      const script = scripts.get(frame.scriptId) || {
        scriptId: frame.scriptId,
        url: frame.url,
      };
      const context = contexts.get(script.executionContextId) || {};
      const item = {
        scriptId: frame.scriptId,
        url: script.url || '',
        functionName: frame.functionName || '',
        line: frame.lineNumber + 1,
        column: frame.columnNumber + 1,
        hasSourceURL: script.hasSourceURL ?? false,
        executionContext: {
          id: script.executionContextId ?? null,
          name: context.name ?? null,
          origin: context.origin ?? null,
          isDefault: context.auxData?.isDefault ?? null,
          type: context.auxData?.type ?? null,
        },
        attribution: classifyScriptSource(script, context, networkUrls),
      };
      try {
        const { scriptSource } = await session.send(
          'Debugger.getScriptSource',
          { scriptId: frame.scriptId },
        );
        item.sha256 = createHash('sha256').update(scriptSource).digest('hex');
        item.markers = [
          'reportAllChanges',
          'startTime',
          'livereload.js',
        ].filter((marker) => scriptSource.includes(marker));
        const offset = scriptSource.indexOf('reportAllChanges');
        if (offset >= 0)
          item.reporterExcerpt = scriptSource.slice(
            Math.max(0, offset - 60),
            offset + 240,
          );
      } catch (error) {
        item.sourceUnavailable = error.message;
      }
      evidence.push(item);
    }
    return evidence;
  }

  function recordException(message, frames, details) {
    const signature = `${message}\n${frames.map((frame) => frame.functionName).join('\n')}`;
    if (!isStartTimeReporterError(signature)) return;
    report.status = 'observed';
    const record = {
      type: 'start-time-reporter-error',
      message,
      pageUrl: page.url(),
      ...details,
      frames,
      sources: [],
      disposition:
        'record-only; retained as an unexpected error by the smoke harness',
    };
    report.records.push(record);
    enqueue(async () => {
      record.sources = await sourceEvidence(frames);
    });
  }

  on('Debugger.scriptParsed', (script) =>
    scripts.set(script.scriptId, {
      scriptId: script.scriptId,
      url: script.url,
      executionContextId: script.executionContextId,
      hasSourceURL: script.hasSourceURL,
    }),
  );
  on('Runtime.executionContextCreated', (event) =>
    contexts.set(event.context.id, event.context),
  );
  on('Runtime.exceptionThrown', ({ exceptionDetails: details }) => {
    recordException(
      details.exception?.description || details.text,
      details.stackTrace?.callFrames || [],
      {
        exceptionId: details.exceptionId,
        executionContextId: details.executionContextId,
      },
    );
  });
  on('Runtime.consoleAPICalled', (event) => {
    if (event.type !== 'error') return;
    const message = event.args
      .map((arg) => arg.description || String(arg.value ?? ''))
      .join('\n');
    recordException(message, event.stackTrace?.callFrames || [], {
      channel: 'console.error',
    });
  });
  on('Network.requestWillBeSent', (event) => {
    if (event.type === 'Script') networkUrls.add(event.request.url);
    if (!isLiveReloadRequest(event.request.url)) return;
    report.status = 'observed';
    const record = {
      type: 'livereload-request',
      url: event.request.url,
      documentUrl: event.documentURL,
      initiator: event.initiator,
      sources: [],
    };
    report.records.push(record);
    requests.set(event.requestId, record);
    enqueue(async () => {
      record.sources = await sourceEvidence(
        event.initiator.stack?.callFrames || [],
      );
    });
  });
  on('Network.loadingFailed', (event) => {
    const record = requests.get(event.requestId);
    if (record)
      record.failure = {
        errorText: event.errorText,
        canceled: event.canceled ?? false,
      };
  });
  on('Network.responseReceived', (event) => {
    const record = requests.get(event.requestId);
    if (record) record.status = event.response.status;
  });

  try {
    await session.send('Runtime.enable');
    await session.send('Debugger.enable');
    await session.send('Network.enable');
  } catch (error) {
    for (const [name, listener] of listeners) session.off(name, listener);
    await session.detach();
    throw error;
  }
  return {
    report,
    async close() {
      for (const [name, listener] of listeners) session.off(name, listener);
      await Promise.all([...pending]);
      await session.detach();
    },
  };
}
