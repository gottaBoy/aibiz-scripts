#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { nativeCandidateComposeInvocation } from './native-modeling-config.mjs';

try {
  const invocation = nativeCandidateComposeInvocation(process.argv.slice(2));
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`[native-candidate-compose] ${error.message}`);
  process.exitCode = 1;
}
