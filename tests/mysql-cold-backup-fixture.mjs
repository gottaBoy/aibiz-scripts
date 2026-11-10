import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export const coldRunId = 'abc123def456';
export function coldArchiveEntries(runId = coldRunId) {
  return [
    ...['.', 'data', 'data/mysql', `data/nf_${runId}_model_a`, `data/nf_${runId}_model_b`]
      .map(path => ({ path, kind: 'directory' })),
    ...['data/auto.cnf', 'data/ibdata1', 'data/ib_logfile0', 'data/mysql/user.frm',
      `data/nf_${runId}_model_a/t_srfpsmodule.ibd`, `data/nf_${runId}_model_b/t_srfpsmodule.ibd`]
      .map(path => ({ path, kind: 'file', content: `unit fixture: ${path}` })),
  ];
}

const create = String.raw`
import io, json, sys, tarfile
rows = json.load(sys.stdin)
with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz", format=tarfile.USTAR_FORMAT) as archive:
    for row in rows:
        info = tarfile.TarInfo(row["path"])
        info.uid, info.gid, info.mode = row.get("uid", 1001), row.get("gid", 1001), row.get("mode", 0o750)
        kind = row["kind"]
        if kind == "directory":
            info.type = tarfile.DIRTYPE
            archive.addfile(info)
        elif kind in ("symlink", "hardlink", "device", "fifo"):
            info.type = dict(symlink=tarfile.SYMTYPE, hardlink=tarfile.LNKTYPE, device=tarfile.CHRTYPE, fifo=tarfile.FIFOTYPE)[kind]
            info.linkname = row.get("link", "")
            archive.addfile(info)
        else:
            content = row.get("content", "").encode()
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
`;

export function createColdTestArchive(rows = coldArchiveEntries()) {
  const result = spawnSync('python3', ['-c', create], {
    input: JSON.stringify(rows), timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0);
  return result.stdout;
}

export function coldTestState() {
  return {
    serverUuid: '12345678-1234-1234-1234-123456789abc', version: '5.7.41',
    datadir: '/bitnami/mysql/data/', lowerCaseTableNames: 1, characterSet: 'utf8mb4',
    innodbFlushLogAtTrxCommit: 1, syncBinlog: 1, innodbFastShutdown: 1,
    innodbDataHomeDir: null, innodbLogHomeDir: './', innodbUndoDir: '.', innodbDataFilePath: 'ibdata1:12M:autoextend',
    logBin: 0, logBinBase: null,
    innodbDataFiles: [`./nf_${coldRunId}_model_a/t_srfpsmodule.ibd`, `./nf_${coldRunId}_model_b/t_srfpsmodule.ibd`],
  };
}
