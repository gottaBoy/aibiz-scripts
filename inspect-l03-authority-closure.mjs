#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const authorityPaths = Object.freeze({
  ideaEntity: 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json',
  ideaAction: 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDEACTIONS/get_customer_score.json',
  ideaLogic: 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json',
  settingEntity: 'plm/model/PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json',
  system: 'plm/model/PSSYSTEM.json',
  systemBackup: 'plm/model/PSSYSTEM.json.bak',
  dynamicModel: 'plm/model/PSSYSDYNAMODELS/Usr1014979662.json',
  ideaWebApp: 'plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/idea.json',
  ideaMobileApp: 'plm/model/PSSYSAPPS/plmmob/PSAPPDATAENTITIES/idea.json',
  settingMobileApp: 'plm/model/PSSYSAPPS/plmmob/PSAPPDATAENTITIES/view_theme_setting.json',
  ideaDTO: 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/prodmgmt/idea/dto/IdeaDefGroupCommonDTO.groovy',
  nestedDTO: 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingUsr1014979662DTO.groovy',
  settingDTO: 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingDTO.groovy',
  vendorIdeaDTO: 'vendor-upstream/plm-service/plm-core/src/main/groovy/cn/ibizlab/plm/prodmgmt/idea/dto/IdeaDefGroupCommonDTO.groovy',
  vendorNestedDTO: 'vendor-upstream/plm-service/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingUsr1014979662DTO.groovy',
  vendorSettingDTO: 'vendor-upstream/plm-service/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingDTO.groovy',
  vendorGottaboyIdeaDTO: 'vendor-upstream/gottaboy-plm-service/plm-core/src/main/groovy/cn/ibizlab/plm/prodmgmt/idea/dto/IdeaDefGroupCommonDTO.groovy',
  vendorGottaboyNestedDTO: 'vendor-upstream/gottaboy-plm-service/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingUsr1014979662DTO.groovy',
  vendorGottaboySettingDTO: 'vendor-upstream/gottaboy-plm-service/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingDTO.groovy',
  ideaPublishedModel: 'plm-web/src/publish/model/entities/idea.ts',
  apiDocs: 'plm/doc/docsify/api/ServiceAPI/deapi/view_theme_setting.md',
  scoreDocs: 'plm/doc/docsify/module/ProdMgmt/idea/logic/get_customer_score.md',
});

function readRegular(relative, root = workspace) {
  const filename = path.resolve(root, relative);
  assert.equal(fs.realpathSync(filename), filename, `Authority input is not the expected real path: ${relative}`);
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && before.nlink === 1 && before.size < 64 * 1024 * 1024);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(descriptor);
    for (const after of [fs.fstatSync(descriptor), fs.lstatSync(filename)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function one(rows, predicate, message) {
  const matches = rows.filter(predicate);
  assert.equal(matches.length, 1, message);
  return matches[0];
}

function dtoFields(dto, fieldKey = 'getPSDEMethodDTOFields') {
  return Object.hasOwn(dto, fieldKey) ? (dto[fieldKey] ?? []) : null;
}

function appDtoFields(dto) {
  return Object.hasOwn(dto, 'getPSAppDEMethodDTOFields') ? (dto.getPSAppDEMethodDTOFields ?? []) : null;
}

function methodReferences(entity, dtoId) {
  return (entity.getAllPSDEActions ?? []).filter(action =>
    action.getPSDEActionReturn?.getPSDEMethodDTO?.id === dtoId
    || action.getPSDEActionInput?.getPSDEMethodDTO?.id === dtoId);
}

export function inspectL03AuthorityClosure({ root = workspace } = {}) {
  const bytes = Object.fromEntries(Object.entries(authorityPaths)
    .map(([key, relative]) => [key, readRegular(relative, root)]));
  const parsed = Object.fromEntries(Object.entries(bytes)
    .filter(([key]) => !['ideaDTO', 'nestedDTO', 'settingDTO', 'vendorIdeaDTO', 'vendorNestedDTO',
      'vendorSettingDTO', 'vendorGottaboyIdeaDTO', 'vendorGottaboyNestedDTO', 'vendorGottaboySettingDTO',
      'ideaPublishedModel', 'apiDocs', 'scoreDocs'].includes(key))
    .map(([key, value]) => [key, JSON.parse(value)]));
  const ideaDTO = one(parsed.ideaEntity.getAllPSDEMethodDTOs,
    row => row.name === 'idea_def_group_common_dto', 'idea method DTO');
  const ideaWebDTO = one(parsed.ideaWebApp.getAllPSAppDEMethodDTOs,
    row => row.codeName === 'idea_def_group_common_dto', 'idea web app DTO');
  const ideaMobileDTO = one(parsed.ideaMobileApp.getAllPSAppDEMethodDTOs,
    row => row.codeName === 'idea_def_group_common_dto', 'idea mobile app DTO');
  const settingDTO = one(parsed.settingEntity.getAllPSDEMethodDTOs,
    row => row.name === 'view_theme_setting_dto', 'settings DTO');
  const nestedDTO = one(parsed.settingEntity.getAllPSDEMethodDTOs,
    row => row.name === 'view_theme_setting_usr1014979662dto', 'nested method DTO');
  const nestedMobileDTO = one(parsed.settingMobileApp.getAllPSAppDEMethodDTOs,
    row => row.codeName === 'view_theme_setting_usr1014979662dto', 'nested mobile DTO');
  const systemDTO = one(parsed.system.getAllPSSysMethodDTOs,
    row => row.name === 'Usr1014979662DTO', 'system DTO');
  const systemBackupDTO = one(parsed.systemBackup.getAllPSSysMethodDTOs,
    row => row.name === 'Usr1014979662DTO', 'backup system DTO');
  const nestedField = one(settingDTO.getPSDEMethodDTOFields,
    row => row.name === 'search_conds', 'nested search_conds field');
  assert.equal(nestedField.type, 'DTOS');
  assert.equal(nestedField.getRefPSDEMethodDTO.id, nestedDTO.name);
  assert.equal(nestedField.getRefPSDataEntity.path,
    'PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json');
  const group = one(parsed.ideaEntity.getAllPSDEFGroups,
    row => row.codeName === 'DEFGroup_common', 'idea common group');
  const ideaAction = one(parsed.ideaEntity.getAllPSDEActions,
    row => row.codeName === 'get_customer_score', 'customer score action');
  const dedicatedAction = JSON.parse(bytes.ideaAction);
  assert.equal(ideaAction.getPSDEActionReturn.getPSDEMethodDTO.id, ideaDTO.name);
  assert.equal(dedicatedAction.getPSDEActionReturn.getPSDEMethodDTO.id, ideaDTO.name);
  assert.equal(dedicatedAction.getPSDELogic.path,
    'PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json');
  const systemSources = [
    { name: 'PSSYSTEM.json', dto: systemDTO },
    { name: 'PSSYSTEM.json.bak', dto: systemBackupDTO },
  ];
  const currentGroovy = bytes.ideaDTO.toString();
  const currentNestedGroovy = bytes.nestedDTO.toString();
  const currentSettingGroovy = bytes.settingDTO.toString();
  const vendorPairs = [
    ['IdeaDefGroupCommonDTO', bytes.ideaDTO, bytes.vendorIdeaDTO, currentGroovy],
    ['ViewThemeSettingUsr1014979662DTO', bytes.nestedDTO, bytes.vendorNestedDTO, currentNestedGroovy],
    ['ViewThemeSettingDTO', bytes.settingDTO, bytes.vendorSettingDTO, currentSettingGroovy],
    ['GottaboyIdeaDefGroupCommonDTO', bytes.ideaDTO, bytes.vendorGottaboyIdeaDTO, currentGroovy],
    ['GottaboyViewThemeSettingUsr1014979662DTO', bytes.nestedDTO, bytes.vendorGottaboyNestedDTO, currentNestedGroovy],
    ['GottaboyViewThemeSettingDTO', bytes.settingDTO, bytes.vendorGottaboySettingDTO, currentSettingGroovy],
  ].map(([name, local, vendor, expected]) => ({
    name, localSha256: digest(local), vendorSha256: digest(vendor), bytesEqual: local.equals(vendor),
    localHasDeclaredMembers: /\b(?:String|Integer|Long|BigDecimal|Timestamp|List<|Map<)\s+\w+\s*(?:[=;])/.test(expected),
  }));
  for (const pair of vendorPairs) assert.equal(pair.bytesEqual, true, `${pair.name} vendor drift`);
  const publishedIdea = bytes.ideaPublishedModel.toString();
  const outputKeys = [...bytes.scoreDocs.toString().matchAll(/result\.set\("([^"]+)",/g)]
    .map(match => match[1]);
  const dynamicModelAttributes = parsed.dynamicModel.getPSDynaModelAttrs ?? null;
  const findings = {
    ideaMethodDTO: {
      id: ideaDTO.name, sourceType: ideaDTO.sourceType, localFields: dtoFields(ideaDTO),
      webFields: appDtoFields(ideaWebDTO), mobileFields: appDtoFields(ideaMobileDTO),
      commonGroupDetails: group.getPSDEFGroupDetails ?? null,
      backendDeclaredMembers: /\b(?:String|Integer|Long|BigDecimal|Timestamp|List<|Map<)\s+\w+\s*(?:[=;])/.test(currentGroovy),
      methodReferences: {
        entityAction: ideaAction.codeName,
        dedicatedAction: dedicatedAction.name ?? dedicatedAction.codeName,
        webAppReturn: one(parsed.ideaWebApp.getAllPSAppDEMethods,
          row => row.codeName === 'get_customer_score', 'web customer score method')
          .getPSAppDEMethodReturn?.getPSAppDEMethodDTO?.id ?? null,
        mobileAppReturn: one(parsed.ideaMobileApp.getAllPSAppDEMethods,
          row => row.codeName === 'get_customer_score', 'mobile customer score method')
          .getPSAppDEMethodReturn?.getPSAppDEMethodDTO?.id ?? null,
      },
      logicObservedKeys: [...new Set(outputKeys)],
      declarationStatus: 'UNRESOLVED',
    },
    nestedTarget: {
      parentField: {
        name: nestedField.name, wrapper: nestedField.type,
        targetDTO: nestedField.getRefPSDEMethodDTO.id,
      },
      targetEntityFields: dtoFields(nestedDTO),
      targetMobileFields: appDtoFields(nestedMobileDTO),
      targetSystemFields: dtoFields(systemDTO, 'getPSSysMethodDTOFields'),
      targetSystemBackupFields: dtoFields(systemBackupDTO, 'getPSSysMethodDTOFields'),
      dynamicModel: {
        codeName: parsed.dynamicModel.codeName, name: parsed.dynamicModel.name,
        attributes: dynamicModelAttributes,
        hasAttributeDeclaration: Array.isArray(dynamicModelAttributes) && dynamicModelAttributes.length > 0,
      },
      backendDeclaredMembers: /\b(?:String|Integer|Long|BigDecimal|Timestamp|List<|Map<)\s+\w+\s*(?:[=;])/.test(currentNestedGroovy),
      rawLogicSource: {
        path: 'PSMODULES/Base/PSDATAENTITIES/view_theme_setting/PSDELOGICS/fill_search_conds.json',
        storesDynamicValue: /search_conds.*themeModel\.get\(["']searchconds["']\)/s.test(
          JSON.parse(bytes.settingEntity.toString()).getAllPSDELogics
            .find(row => row.codeName === 'fill_search_conds')?.getPSDELogicNodes
            ?.find(row => row.codeName === 'RAWSFCODE1')?.code ?? ''),
      },
      declarationStatus: 'PARENT_CLOSED_TARGET_UNRESOLVED',
    },
    sources: Object.fromEntries(Object.entries(bytes).map(([key, value]) =>
      [key, { path: authorityPaths[key], sha256: digest(value), bytes: value.length }])),
    sourceConsensus: {
      vendorUpstreamMatchesCurrent: vendorPairs.every(row => row.bytesEqual),
      systemBackupTargetEquivalent: JSON.stringify(systemDTO) === JSON.stringify(systemBackupDTO),
      publishedFrontendRetainsMissingDTO: publishedIdea.includes("codeName: 'idea_def_group_common_dto'")
        && !publishedIdea.includes("codeName: 'customer_score'"),
      docsOnlyEvidence: bytes.apiDocs.toString().includes('|Object|过滤条件|')
        && bytes.scoreDocs.toString().includes('customer_score_precent'),
      systemSources,
    },
    candidate: {
      status: 'BLOCKED_NO_AUTHORITATIVE_FIELD_DEFINITION',
      idea: {
        minimumModelChange: 'Add authoritative getPSDEMethodDTOFields to idea.json and matching web/mobile model DTOs, then regenerate backend/frontend outputs.',
        forbiddenGuess: ['customer_score', 'customer_score_precent'],
        reason: 'Only logic output keys exist; no authoritative field names/types/nullable rules are declared.',
      },
      nested: {
        minimumModelChange: 'Add authoritative attributes to PSSYSDYNAMODELS/Usr1014979662.json, regenerate PSSYSTEM/system DTO and nested entity/app DTO outputs.',
        forbiddenGuess: ['searchconds item fields', 'diagnostic_payload'],
        reason: 'The parent DTOS link is declared, but the DYNAMODEL and every target DTO source has no attributes.',
      },
      generationRequired: true,
      runtimeProofCannotCloseDeclarations: true,
    },
    counts: {
      unresolvedMethodDTODeclarations: 2,
      unresolvedNestedDTOReferences: 1,
      logicObservedOutputKeys: [...new Set(outputKeys)].length,
    },
  };
  assert.equal(findings.counts.unresolvedMethodDTODeclarations, 2);
  assert.equal(findings.counts.unresolvedNestedDTOReferences, 1);
  return findings;
}

export function writeL03AuthorityReport({ output, root = workspace } = {}) {
  const report = inspectL03AuthorityClosure({ root });
  const target = path.resolve(output);
  assert.equal(path.dirname(target), path.join(root, '.artifacts'));
  assert.match(path.basename(target), /^l03-authority-closure-[A-Za-z0-9-]+$/);
  assert.equal(fs.existsSync(target), false);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const reportBytes = Buffer.from(json({
    contract: 'l03-authority-closure-v1', status: 'BLOCKED_NO_AUTHORITATIVE_FIELD_DEFINITION',
    generatedAt: new Date().toISOString(), ...report,
  }));
  fs.writeFileSync(path.join(target, 'report.private.json'), reportBytes, { mode: 0o600, flag: 'wx' });
  return { status: 'BLOCKED_NO_AUTHORITATIVE_FIELD_DEFINITION',
    reportPath: path.join(target, 'report.private.json'), reportSha256: digest(reportBytes), report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
    const result = writeL03AuthorityReport({ output: values.output });
    console.log(json({ status: result.status, reportPath: result.reportPath,
      reportSha256: result.reportSha256, counts: result.report.counts,
      candidate: result.report.candidate }));
  } catch (error) {
    console.error(json({ status: 'FAILED_L03_AUTHORITY_CLOSURE', message: error.message }));
    process.exitCode = 1;
  }
}
