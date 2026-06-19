import fs from 'fs';
import {
  CONFIG_FILE,
  AGENT_SCOPE,
  readConfigFile,
  readConfigLayers,
  getJsonWriteTarget,
  writeConfig,
} from '../opencode/shared.js';

/**
 * OpenCode config helpers scoped to the Memory feature.
 *
 * Memory backends integrate with OpenCode through two config surfaces:
 *  - `plugin`: an array of plugin package names (e.g. "opencode-mem")
 *  - `mcp`: an object of MCP server entries (e.g. "mempalace")
 *
 * These helpers keep plugin-array manipulation deterministic and layer-aware,
 * mirroring the patterns already used by `mcp.js`.
 */

/**
 * Normalize a plugin array entry to its bare package name.
 * Plugin entries can include a version spec ("opencode-mem@1.2.3") or be a
 * file path. We compare on the package identity only.
 */
function normalizePluginName(entry) {
  if (typeof entry !== 'string') return '';
  const trimmed = entry.trim();
  if (!trimmed) return '';
  // Preserve scoped package names (@scope/name) while stripping a trailing
  // "@version" suffix.
  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash === -1) return trimmed;
    const afterSlash = trimmed.slice(slash + 1);
    const at = afterSlash.indexOf('@');
    return at === -1 ? trimmed : `${trimmed.slice(0, slash + 1)}${afterSlash.slice(0, at)}`;
  }
  const at = trimmed.indexOf('@');
  return at === -1 ? trimmed : trimmed.slice(0, at);
}

function readPluginArray(config) {
  const value = config?.plugin;
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Return the merged plugin list (across user/project/custom layers).
 */
function listPlugins(workingDirectory) {
  const layers = readConfigLayers(workingDirectory);
  return readPluginArray(layers?.mergedConfig);
}

/**
 * Is a plugin (by package name) present in the merged config?
 */
function hasPlugin(workingDirectory, pluginName) {
  const normalized = normalizePluginName(pluginName);
  return listPlugins(workingDirectory).some((entry) => normalizePluginName(entry) === normalized);
}

function resolveWriteTarget(layers, scope) {
  const target = getJsonWriteTarget(layers, scope === AGENT_SCOPE.PROJECT ? AGENT_SCOPE.PROJECT : AGENT_SCOPE.USER);
  const targetPath = target.path || CONFIG_FILE;
  const config = target.config && typeof target.config === 'object'
    ? target.config
    : (fs.existsSync(targetPath) ? readConfigFile(targetPath) : {});
  return { targetPath, config };
}

/**
 * Add a plugin package to the plugin array if not already present.
 * Returns true when a write occurred.
 */
function addPlugin(workingDirectory, pluginName, scope = AGENT_SCOPE.USER) {
  if (hasPlugin(workingDirectory, pluginName)) {
    return false;
  }
  const layers = readConfigLayers(workingDirectory);
  const { targetPath, config } = resolveWriteTarget(layers, scope);
  const current = readPluginArray(config);
  config.plugin = [...current, pluginName];
  writeConfig(config, targetPath);
  return true;
}

/**
 * Remove a plugin package (by package name, ignoring version) from every layer
 * that contains it. Returns true when at least one write occurred.
 */
function removePlugin(workingDirectory, pluginName) {
  const normalized = normalizePluginName(pluginName);
  const layers = readConfigLayers(workingDirectory);
  const targets = [
    { path: layers.paths.userPath, config: layers.userConfig },
    { path: layers.paths.projectPath, config: layers.projectConfig },
    { path: layers.paths.customPath, config: layers.customConfig },
  ];

  let changed = false;
  for (const target of targets) {
    if (!target.path || !target.config) continue;
    const current = readPluginArray(target.config);
    if (current.length === 0) continue;
    const next = current.filter((entry) => normalizePluginName(entry) !== normalized);
    if (next.length === current.length) continue;

    // Re-read from disk to avoid clobbering unrelated in-memory merges.
    const onDisk = fs.existsSync(target.path) ? readConfigFile(target.path) : {};
    const onDiskPlugins = readPluginArray(onDisk).filter(
      (entry) => normalizePluginName(entry) !== normalized,
    );
    if (onDiskPlugins.length > 0) {
      onDisk.plugin = onDiskPlugins;
    } else {
      delete onDisk.plugin;
    }
    writeConfig(onDisk, target.path);
    changed = true;
  }
  return changed;
}

export {
  normalizePluginName,
  listPlugins,
  hasPlugin,
  addPlugin,
  removePlugin,
};
