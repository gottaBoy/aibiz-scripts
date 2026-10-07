import { collectPluginReferences } from './harness-plugin-audit.mjs';

export function inspectNativeThemeReferences(model) {
  const themes = model?.getAllPSAppUIThemes ?? [];
  if (!Array.isArray(themes)) throw new Error('Native theme declarations must be an array');
  const packages = new Map();
  const tags = new Set();
  for (const [index, theme] of themes.entries()) {
    const params = theme?.themeParams;
    if (!theme || typeof theme !== 'object' || Array.isArray(theme) ||
        typeof theme.themeTag !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(theme.themeTag) ||
        tags.has(theme.themeTag) ||
        (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params)))) {
      throw new Error('Native theme declarations require unique safe tags and object parameters');
    }
    tags.add(theme.themeTag);
    if (params && Object.hasOwn(params, 'icon-theme') &&
        !['true', 'false'].includes(params['icon-theme'])) {
      throw new Error('Native theme icon type must be the string true or false');
    }
    const fields = [];
    if (params && Object.hasOwn(params, 'theme-package-path')) {
      fields.push(['themeParams/theme-package-path', params['theme-package-path']]);
    }
    if (Object.hasOwn(theme, 'themeUrl')) fields.push(['themeUrl', theme.themeUrl]);
    if (!fields.length) {
      throw new Error('Native theme packages require an exact safe local name@version reference');
    }
    // Explicit fields must agree; precedence cannot hide an invalid or different repo.
    let plugin;
    for (const [, repo] of fields) {
      const references = collectPluginReferences({ rtobjectRepo: repo });
      if (references.invalidReferences.length || references.packages.length !== 1) {
        throw new Error('Native theme packages require an exact safe local name@version reference');
      }
      if (plugin && plugin.repo !== repo) {
        throw new Error('Native theme package fields must match the same exact local identity');
      }
      plugin = references.packages[0];
    }
    const { repo } = plugin;
    if (!packages.has(repo)) packages.set(repo, { ...plugin, locations: [], themes: [] });
    packages.get(repo).locations.push(...fields.map(([field]) => `/getAllPSAppUIThemes/${index}/${field}`));
    packages.get(repo).themes.push({
      tag: theme.themeTag,
      type: params?.['icon-theme'] === 'true' ? 'ICON' : 'COLOR',
    });
  }
  return [...packages.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}
