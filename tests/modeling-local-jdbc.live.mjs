import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = new URL('../../', import.meta.url);
const migrationPath = new URL(
  'plm/deploy/compose/migrations/006_modeling_local_jdbc.sql', workspace);
const migration = await readFile(migrationPath, 'utf8');
const instanceId = '9A0C0A7E-8651-478D-96F3-5E5D314A13FB';
const legacyUrl = 'jdbc:mysql://mysql:3306/sCloud9471c1eca?autoReconnect=true'
  + '&useUnicode=true&characterEncoding=UTF-8&useOldAliasMetadataBehavior=true';
const localUrl = `${legacyUrl}&useSSL=false`;
const sqlString = value => `'${value.replaceAll("'", "''")}'`;

test('real MySQL verifies migration isolation, idempotency and deployed local transport', async () => {
  const fixtures = [
    { id: 'legacy-local', url: legacyUrl, expected: localUrl },
    { id: 'explicit-tls', url: `${legacyUrl}&useSSL=true` },
    { id: 'explicit-plaintext', url: localUrl },
    { id: 'remote-host', url: legacyUrl.replace('mysql:3306', 'remote-db.example:3306') },
    { id: 'different-instance', url: legacyUrl, instance: 'harness-unrelated-instance' },
    { id: 'different-dbtype', url: legacyUrl, type: 'CUSTOM' },
    { id: 'different-dbname', url: legacyUrl, database: 'harness_unrelated' },
    { id: 'case-sensitive-policy', url: legacyUrl.replace('autoReconnect', 'AUTORECONNECT') },
    { id: 'trailing-space-policy', url: `${legacyUrl} ` },
    { id: 'verified-identity-policy', url: `${legacyUrl}&sslMode=VERIFY_IDENTITY` },
    { id: 'customized-properties', url: `${legacyUrl}&enabledTLSProtocols=TLSv1.2` },
  ];
  const sql = `
CREATE TEMPORARY TABLE t_srfpssysmodelinst (
  TEST_CASE VARCHAR(100) NOT NULL,
  PSSYSMODELINSTID VARCHAR(100) NOT NULL,
  DBTYPE VARCHAR(100) NOT NULL,
  DBNAME VARCHAR(100) NOT NULL,
  CONNSTR TEXT NOT NULL,
  EXPECTED TEXT NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
INSERT INTO t_srfpssysmodelinst VALUES
${fixtures.map(row => [
    row.id, row.instance ?? instanceId, row.type ?? 'MYSQL5',
    row.database ?? 'sCloud9471c1eca', row.url, row.expected ?? row.url,
  ].map(sqlString).join(', ')).map(row => `(${row})`).join(',\n')};
${migration}
SELECT 'first-update', ROW_COUNT();
${migration}
SELECT 'second-update', ROW_COUNT();
SELECT TEST_CASE, BINARY CONNSTR = BINARY EXPECTED
FROM t_srfpssysmodelinst ORDER BY TEST_CASE;
DROP TEMPORARY TABLE t_srfpssysmodelinst;
SELECT 'deployed-local-transport', BINARY CONNSTR = ${sqlString(localUrl)}
FROM t_srfpssysmodelinst WHERE PSSYSMODELINSTID = ${sqlString(instanceId)};
`;
  const result = spawnSync('docker', [
    'exec', '-i', '-e', 'MYSQL_PWD',
    process.env.AIBIZ_MYSQL_CONTAINER ?? 'mysql',
    'mysql', '--batch', '--skip-column-names', '--default-character-set=utf8mb4',
    `--user=${process.env.AIBIZ_MYSQL_ROOT_USER ?? 'root'}`,
    process.env.AIBIZ_MYSQL_IBIZAPI_DATABASE ?? 'ibizapi',
  ], {
    input: sql,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, MYSQL_PWD: process.env.AIBIZ_MYSQL_ROOT_PASSWORD ?? 'Mysql@2022' },
  });
  const expected = new Map([
    ['first-update', '1'], ['second-update', '0'],
    ...fixtures.map(row => [row.id, '1']),
    ['deployed-local-transport', '1'],
  ]);
  const observed = (result.stdout ?? '').trim().split(/\r?\n/)
    .filter(Boolean).map(line => line.split('\t'));
  const checks = [
    { id: 'mysql-command', status: result.status === 0 ? 'pass' : 'fail' },
    ...[...expected].map(([id, value]) => {
      const matches = observed.filter(row => row.length === 2 && row[0] === id);
      return {
        id,
        status: matches.length === 1 && matches[0][1] === value ? 'pass' : 'fail',
      };
    }),
    { id: 'exact-results', status: observed.length === expected.size ? 'pass' : 'fail' },
  ];
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    evidence: 'real-mysql-temporary-table-and-read-only-deployed-instance',
    migration: 'plm/deploy/compose/migrations/006_modeling_local_jdbc.sql',
    migrationSha256: createHash('sha256').update(migration).digest('hex'),
    persistentWrites: false,
    nativeAcceptance: false,
    checks,
    status: checks.every(check => check.status === 'pass') ? 'pass' : 'fail',
  };
  const reportDir = process.env.AIBIZ_LOCAL_MODEL_JDBC_REPORT_DIR ?? fileURLToPath(new URL(
    `.artifacts/local-model-jdbc/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}/`,
    workspace));
  await mkdir(reportDir, { recursive: true });
  await writeFile(`${reportDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`JDBC real MySQL report: ${reportDir}/report.json`);
  assert.equal(report.status, 'pass', JSON.stringify(checks.filter(check => check.status !== 'pass')));
});
