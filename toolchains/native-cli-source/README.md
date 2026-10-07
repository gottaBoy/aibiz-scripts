# Native CLI Supplemental Tools

This independent manifest supplies open-source type packages and the template
copy tool missing from the existing native CLI installations. It does not
contain iBiz CLI or CLI-core binaries. The manifest and npm lock record exact
versions; this is not a reproduction of all original upstream lock resolutions.

```sh
npm ci --prefix scripts/toolchains/native-cli-source \
  --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org/
```

Use the directory as an explicit supplemental dependency owner in the isolated
CLI source-build harness. Never install these dependencies into the downloaded
source evidence tree or mutate a business application's manifest or lockfile.
The harness itself does not install dependencies or run package managers.
