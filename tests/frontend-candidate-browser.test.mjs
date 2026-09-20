import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAuthenticatedConsole,
  classifyAuthenticatedResponse,
  isDoubledPluginBaseMiss,
  isExpectedExtensionManifestConsole,
  isExpectedExtensionManifestMiss,
  isExpectedLoginTransition,
  parseStackFrame,
  redactSecrets,
  resolveSourceMapPosition,
} from "../../modelingweb/app/scripts/check-source-candidate.mjs";

test("the platform's no-extension-plugin 404 is expected only for the exact ext manifest path", () => {
  const manifest =
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/ext/package.json";
  assert.equal(
    isExpectedExtensionManifestMiss({ status: 404, url: manifest }),
    true,
  );
  assert.equal(
    isExpectedExtensionManifestMiss({
      status: 404,
      url: "http://127.0.0.1:32707/api/ibizplm__plmweb/remotemodel/ext/package.json",
    }),
    true,
  );
  // Only 404 is the documented "no extension plugin" response.
  assert.equal(
    isExpectedExtensionManifestMiss({ status: 500, url: manifest }),
    false,
  );
  assert.equal(
    isExpectedExtensionManifestMiss({ status: 403, url: manifest }),
    false,
  );
  // Other model files under remotemodel must still be reported.
  for (const url of [
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json",
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/ext/index.js",
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/ext/package.json/extra",
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/jsonschema/TICKET",
    "http://127.0.0.1:32707/plugins/ext/package.json",
    "not a url",
  ]) {
    assert.equal(isExpectedExtensionManifestMiss({ status: 404, url }), false, url);
  }
});

test("the matching console 404 for the ext manifest is expected, other console errors are not", () => {
  const manifest =
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/ext/package.json";
  const message =
    "Failed to load resource: the server responded with a status of 404 (Not Found)";
  assert.equal(
    isExpectedExtensionManifestConsole({ message, source: manifest }),
    true,
  );
  assert.equal(
    isExpectedExtensionManifestConsole({
      message: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      source: manifest,
    }),
    false,
  );
  assert.equal(
    isExpectedExtensionManifestConsole({
      message,
      source:
        "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json",
    }),
    false,
  );
  assert.equal(
    isExpectedExtensionManifestConsole({ message: "TypeError: x", source: "" }),
    false,
  );
});

test("expected initial authentication diagnostics require visible login and the actual appdata 401", () => {
  const event = {
    message:
      "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    source: "http://127.0.0.1:32705/api/ibizmodeling__modeldesign/appdata",
  };
  assert.equal(
    isExpectedLoginTransition(event, {
      loginVisible: true,
      appDataUnauthorized: true,
    }),
    true,
  );
  assert.equal(
    isExpectedLoginTransition(event, {
      loginVisible: false,
      appDataUnauthorized: true,
    }),
    false,
  );
  assert.equal(
    isExpectedLoginTransition(event, {
      loginVisible: true,
      appDataUnauthorized: false,
    }),
    false,
  );
  assert.equal(
    isExpectedLoginTransition(
      { ...event, source: "/other/api" },
      { loginVisible: true, appDataUnauthorized: true },
    ),
    false,
  );
  const navigation = {
    message:
      'Navigation aborted from "/" to "/-/index/-" via a navigation guard.',
    source: "",
  };
  assert.equal(
    isExpectedLoginTransition(navigation, {
      loginVisible: true,
      appDataUnauthorized: true,
    }),
    true,
  );
  assert.equal(
    isExpectedLoginTransition(
      { ...navigation, message: "TypeError: unexpected" },
      { loginVisible: true, appDataUnauthorized: true },
    ),
    false,
  );
});

test("credential values are redacted from recorded text, including URL-encoded forms", () => {
  assert.equal(
    redactSecrets("login aibizhi with p@ss word and p%40ss", ["aibizhi", "p@ss"]),
    "login [redacted] with [redacted] word and [redacted]",
  );
  // Very short secrets would redact unrelated text, so they are ignored.
  assert.equal(redactSecrets("abc", ["ab", ""]), "abc");
  assert.equal(redactSecrets("nothing here"), "nothing here");
});

test("a proxy CANDIDATE_READ_ONLY 403 is a proxy scope finding, an upstream 403 is not", () => {
  const url = "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/work_items/count_my_todo";
  assert.equal(
    classifyAuthenticatedResponse({ status: 403, url, bodyCode: "CANDIDATE_READ_ONLY" }),
    "proxy-read-only-block",
  );
  assert.equal(classifyAuthenticatedResponse({ status: 403, url }), "unexpected");
  assert.equal(
    classifyAuthenticatedResponse({ status: 403, url, bodyCode: "FORBIDDEN" }),
    "unexpected",
  );
  assert.equal(
    classifyAuthenticatedResponse({ status: 200, url, bodyCode: "CANDIDATE_READ_ONLY" }),
    "ok",
  );
});

test("the doubled plugin base stylesheet 404 is its own candidate finding category", () => {
  const doubled =
    "http://127.0.0.1:32707/modeldesign/modeldesign/plugins/@ibiz-template-plm/list-tree@0.0.3-alpha.225/dist/style.css";
  assert.equal(isDoubledPluginBaseMiss({ status: 404, url: doubled }), true);
  assert.equal(
    classifyAuthenticatedResponse({ status: 404, url: doubled }),
    "candidate-plugin-base-doubled-404",
  );
  assert.equal(isDoubledPluginBaseMiss({ status: 500, url: doubled }), false);
  for (const url of [
    "http://127.0.0.1:32707/modeldesign/plugins/@ibiz-template-plm/list-tree@0.0.3-alpha.225/dist/style.css",
    "http://127.0.0.1:32707/modeldesign/modeldesign/plugins/@ibiz-template-plm/list-tree@0.0.3-alpha.225/dist/index.es.js",
    "not a url",
  ]) {
    assert.equal(isDoubledPluginBaseMiss({ status: 404, url }), false, url);
    assert.equal(classifyAuthenticatedResponse({ status: 404, url }), "unexpected", url);
  }
  assert.equal(
    classifyAuthenticatedResponse({
      status: 404,
      url: "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/ext/package.json",
    }),
    "expected-extension-manifest-404",
  );
  assert.equal(classifyAuthenticatedResponse({ status: 200, url: doubled }), "ok");
});

test("console errors are tied to the classified response of the same step", () => {
  const doubled =
    "http://127.0.0.1:32707/modeldesign/modeldesign/plugins/@ibiz-template-plm/list-tree@0.0.3-alpha.225/dist/style.css";
  const blocked =
    "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/work_items/count_my_todo";
  const responses = [
    { status: 404, url: doubled },
    { status: 403, url: blocked, bodyCode: "CANDIDATE_READ_ONLY" },
    { status: 200, url: "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/appdata" },
  ];
  const notFound =
    "Failed to load resource: the server responded with a status of 404 (Not Found)";
  const forbidden =
    "Failed to load resource: the server responded with a status of 403 (Forbidden)";
  assert.equal(
    classifyAuthenticatedConsole({ message: notFound, source: doubled }, responses),
    "candidate-plugin-base-doubled-404",
  );
  assert.equal(
    classifyAuthenticatedConsole({ message: forbidden, source: blocked }, responses),
    "proxy-read-only-block",
  );
  // A 403 the proxy did not produce stays unexpected.
  assert.equal(
    classifyAuthenticatedConsole({ message: forbidden, source: blocked }, [
      { status: 403, url: blocked },
    ]),
    "unexpected",
  );
  // A status line for a response the step never saw stays unexpected.
  assert.equal(
    classifyAuthenticatedConsole(
      { message: notFound, source: "http://127.0.0.1:32707/api/x" },
      responses,
    ),
    "unexpected",
  );
  // loglevel's bare "ERROR: Event" from <link>.onerror only counts as the
  // doubled-base finding when that 404 was recorded in the same step.
  assert.equal(
    classifyAuthenticatedConsole({ message: "[22:34:50] ERROR: Event", source: "" }, responses),
    "candidate-plugin-base-doubled-404",
  );
  assert.equal(
    classifyAuthenticatedConsole({ message: "[22:34:50] ERROR: Event", source: "" }, []),
    "unexpected",
  );
  assert.equal(
    classifyAuthenticatedConsole(
      { message: "TypeError: Cannot set properties of undefined (setting 'product')", source: "" },
      responses,
    ),
    "unexpected",
  );
  assert.equal(
    classifyAuthenticatedConsole(
      {
        message: notFound,
        source: "http://127.0.0.1:32707/api/ibizmodeling__modeldesign/remotemodel/ext/package.json",
      },
      [],
    ),
    "expected-extension-manifest-404",
  );
});

test("the first stack frame is parsed with its full script URL", () => {
  assert.deepEqual(
    parseStackFrame(
      "TypeError: Cannot set properties of undefined (setting 'product')\n    at http://127.0.0.1:32707/modeldesign/plugins/@ibiz-template-plm/x@1.0.0/dist/index.legacy.js:1:18625\n    at b (http://x/y.js:2:3)",
    ),
    {
      url: "http://127.0.0.1:32707/modeldesign/plugins/@ibiz-template-plm/x@1.0.0/dist/index.legacy.js",
      line: 1,
      column: 18625,
    },
  );
  assert.deepEqual(
    parseStackFrame("Error: x\n    at fn (http://127.0.0.1:32707/modeldesign/a.js?time=1:414:9310)"),
    { url: "http://127.0.0.1:32707/modeldesign/a.js?time=1", line: 414, column: 9310 },
  );
  assert.equal(parseStackFrame("Error without frames"), null);
});

test("generated positions resolve through a v3 source map", () => {
  // Line 1: col 1 -> a.ts 1:1 ; col 5 -> a.ts 2:1 (name "foo").
  // Line 2: col 1 -> b.ts 1:3.
  const map = {
    sources: ["a.ts", "b.ts"],
    names: ["foo"],
    mappings: "AAAA,IACAA;ACDE",
  };
  assert.deepEqual(resolveSourceMapPosition(map, 1, 1), {
    source: "a.ts",
    line: 1,
    column: 1,
    name: null,
  });
  assert.deepEqual(resolveSourceMapPosition(map, 1, 3), {
    source: "a.ts",
    line: 1,
    column: 1,
    name: null,
  });
  assert.deepEqual(resolveSourceMapPosition(map, 1, 5), {
    source: "a.ts",
    line: 2,
    column: 1,
    name: "foo",
  });
  assert.deepEqual(resolveSourceMapPosition(map, 1, 400), {
    source: "a.ts",
    line: 2,
    column: 1,
    name: "foo",
  });
  assert.deepEqual(resolveSourceMapPosition(map, 2, 1), {
    source: "b.ts",
    line: 1,
    column: 3,
    name: null,
  });
  assert.equal(resolveSourceMapPosition(map, 3, 1), null);
  assert.equal(resolveSourceMapPosition({ mappings: "" }, 1, 1), null);
});
