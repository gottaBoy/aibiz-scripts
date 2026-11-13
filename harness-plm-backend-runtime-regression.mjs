#!/usr/bin/env node

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETIRED_PLM_RUNTIME_CONTRACT = Object.freeze({
  contract: 'retired-plm-shared-runtime-regression-v1',
  status: 'blocked-unsafe-shared-runtime-replay',
  executionAvailable: false,
  acceptedForProduction: false,
  reasons: [
    'The historical runner inherited shared service configuration and credentials.',
    'It removed fixed-name containers without proving current ownership.',
    'Its prefix-wide database cleanup was not limited to IDs created by that invocation.',
    'It mounted the workspace read-write into an unrestricted networked compiler.',
  ],
  nextAction: 'Use a reviewed run-owned PLM fixture with isolated data, bounded resources, source/image bindings and exact-ID cleanup.',
  reference: 'docs/PLM-RUNTIME-HARNESS-RETIREMENT-20261114.md',
});

export async function runPlmBackendRuntimeRegression() {
  const error = new Error(
    'Historical PLM runtime replay is disabled: it cannot prove owned containers or data. ' +
    'No service, database, image or workspace was changed. See ' +
    RETIRED_PLM_RUNTIME_CONTRACT.reference,
  );
  error.code = 'ERR_PLM_SHARED_RUNTIME_REPLAY_RETIRED';
  throw error;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(JSON.stringify(RETIRED_PLM_RUNTIME_CONTRACT, null, 2));
    return 0;
  }
  assert.equal(argv.length, 0, 'The retired runner has no execution flags or target overrides');
  try {
    await runPlmBackendRuntimeRegression();
    return 1;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Retired PLM runtime replay refused; no execution was attempted.');
    process.exitCode = 1;
  });
}
