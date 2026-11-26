import {
  createApiReferenceContract, renderApiReferenceFiles,
} from '../../plm/doc/tools/api-reference.mjs';

export function renderedSearchFixture() {
  const modelPath = 'PSMODULES/Documentation/PSDATAENTITIES/rendered_fixture.json';
  const label = '中文 & <标签> **stars** _under_ ~~tilde~~ [brackets] \\';
  const englishLabel = 'English & <rendered-label> **stars** _under_ ~~tilde~~ [brackets] \\';
  const format = 'alpha&beta|gamma `code` **stars** _under_ \\ e\u0301 👩🏽‍💻 ' +
    '<img src="/never-load.png"> <script>window.renderedSearchSideEffect=1</script>';
  const source = {
    codeName: 'ServiceAPI', aPIType: 'RESTFUL',
    getPSDEServiceAPIs: [{
      codeName: 'rendered_fixture', codeName2: 'rendered_fixtures', major: true,
      logicName: '渲染文本', getPSDataEntity: { path: modelPath },
      getPSDEServiceAPIFields: [{ codeName: 'value', logicName: label, stdDataType: 25 }],
      getPSDEServiceAPIMethods: [{
        name: 'Get', requestMethod: 'GET', needResourceKey: true, noServiceCodeName: true,
        getPSDEServiceAPIMethodReturn: { type: 'DTO', getPSDEMethodDTO: { id: 'rendered_dto' } },
      }],
    }],
    getPSDEServiceAPIRSs: [],
  };
  const models = new Map([[modelPath, { getAllPSDEMethodDTOs: [{
    name: 'rendered_dto', type: 'DEFAULT', sourceType: 'DE',
    getPSDEMethodDTOFields: [{
      name: 'value', logicName: label, type: 'SIMPLE', stdDataType: 25, jsonFormat: format,
      getPSDEField: { codeName: 'value' },
    }],
  }] }]]);
  const contract = createApiReferenceContract(source, { dtoModels: models });
  const files = renderApiReferenceFiles(contract, { englishLabels: {
    [label]: englishLabel, 渲染文本: 'Rendered Text',
  } });
  const schema = contract.dtoSchemas.find(item => item.name === 'rendered_dto');
  return { files, source, models, label, englishLabel, format, anchor: schema.anchor };
}
