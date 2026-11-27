import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { inspectDtoAuthorities, inspectOwnedDtoRuntimeContract } from '../inspect-owned-dto-runtime-contract.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const read = relative => JSON.parse(fs.readFileSync(path.join(workspace, 'plm/model', relative)));
const authority = () => ({
  idea: read('PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json'),
  setting: read('PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json'),
  system: read('PSSYSTEM.json'),
  dynamicModel: read('PSSYSDYNAMODELS/Usr1014979662.json'),
  logic: read('PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json'),
  action: read('PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDEACTIONS/get_customer_score.json'),
});
let observed, runtimeFailure;
function runtime() {
  if (runtimeFailure) throw runtimeFailure;
  try {
    observed ||= inspectOwnedDtoRuntimeContract({
      output: path.join(workspace, '.artifacts', `owned-dto-runtime-tests-${randomBytes(6).toString('hex')}`),
    });
  } catch (error) {
    runtimeFailure = error;
    throw error;
  }
  return observed;
}

test('authority inspection retains the two absent declarations and the explicitly typed nested wrapper', () => {
  const value = inspectDtoAuthorities(authority());
  assert.equal(value.idea.declaredFields, null);
  assert.equal(value.idea.commonGroupFields, null);
  assert.equal(value.setting.declaredFields, null);
  assert.equal(value.setting.sourceSystemFields, null);
  assert.equal(value.setting.dynamicModelName, 'searchcond');
  assert.equal(value.fieldDeclarationsClosed, false);
  assert.deepEqual(value.nested, {
    code: 'search_conds', wrapper: 'DTOS', targetDTO: 'view_theme_setting_usr1014979662dto',
  });
  assert.deepEqual(value.scoreLogic.outputKeys, ['customer_score', 'customer_score_precent']);
  assert.equal(value.scoreLogic.fieldsAreDTODeclarations, false);
});

test('changed action, nested target or return-param bindings cannot be treated as the same contract', () => {
  for (const mutate of [
    value => { value.action.getPSDEActionReturn.type = 'VOID'; },
    value => { value.action.getPSDEActionReturn.getPSDEMethodDTO.id = 'idea_dto'; },
    value => { value.logic.getPSDELogicNodes.find(node => node.codeName === 'END1').getReturnParam.id = 'Default'; },
    value => { value.setting.getAllPSDEMethodDTOs.find(dto => dto.name === 'view_theme_setting_dto')
      .getPSDEMethodDTOFields.find(field => field.name === 'search_conds').getRefPSDEMethodDTO.id = 'other'; },
  ]) {
    const value = authority();
    mutate(value);
    assert.throws(() => inspectDtoAuthorities(value));
  }
});

test('actual cached native DTOs and Jackson preserve Unicode, explicit-null policy and the typed nested list', () => {
  const value = runtime();
  assert.equal(value.mapperSerializationVerified, true);
  assert.equal(value.observed.currentSource.mapper.unicode, '中文🙂 e\u0301 \' " \\\nSecond line');
  assert.equal(value.observed.currentSource.mapper.diagnosticDynamicKeyIsDomainDeclaration, false);
  assert.equal(value.declarationGapsClosed, false);
  assert.equal(value.HTTPExecuted, false);
  assert.equal(value.databaseExecuted, false);
  assert.equal(value.sharedRuntimeModified, false);
});

test('current customer-score source must return its calculated DTO through the actual END dispatcher', () => {
  const value = runtime();
  assert.equal(value.status, 'PASS_NATIVE_MAPPER_AND_CURRENT_SOURCE_RETURN_CONTRACT');
  assert.equal(value.currentSourceReturnsDTO, true);
  for (const row of value.observed.currentSource.calculation.rows) {
    assert.equal(row.resultNull, false);
    assert.equal(row.resultIsOriginalDTO, true);
    assert.deepEqual(row.trace, ['RAWSFCODE1', 'END1']);
  }
  for (const row of value.observed.sealedNative.calculation.rows.filter(row => !row.followFramework)) {
    assert.equal(row.resultNull, true);
    assert.equal(row.resultIsOriginalDTO, false);
  }
});
