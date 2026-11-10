import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { prepareNativeServiceCandidate } from '../prepare-native-service-candidate.mjs';
import { verifyNativeCentralServiceCandidate } from '../native-model-design-isolated-launch.mjs';

const sourceWorkspace = new URL('../../', import.meta.url).pathname;

export function createCentralServiceFixture(workspace) {
  const path = 'scripts/fixtures/native-service-migration-contract.json';
  const contract = JSON.parse(fs.readFileSync(join(sourceWorkspace, path)));
  for (const name of [path, ...Object.values(contract.files)
    .map(file => join(contract.sourceModelRoot, file.path))]) {
    const target = join(workspace, name);
    fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(join(sourceWorkspace, name), target);
  }
  const output = join(workspace, '.artifacts/native-service-migration/test-central-query');
  prepareNativeServiceCandidate({ workspace, output });
  return verifyNativeCentralServiceCandidate({ workspace, receiptPath: join(output, 'receipt.json') });
}
