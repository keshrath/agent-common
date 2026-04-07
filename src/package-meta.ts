// =============================================================================
// agent-common — Read package.json metadata at runtime
//
// Consumers call this from a known location (typically `dist/<file>.js`) so
// that the relative `..` path resolves to their package.json. The result is
// cached per-path so repeated calls are cheap.
// =============================================================================

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export interface PackageMeta {
  name: string;
  version: string;
}

const cache = new Map<string, PackageMeta>();

export interface ReadPackageMetaOptions {
  /** import.meta.url of the calling file. Required when running as ESM. */
  importMetaUrl?: string;
  /** Override absolute path to a package.json. Wins over importMetaUrl. */
  packageJsonPath?: string;
  /** Fallback name if package.json is missing or unreadable. */
  fallbackName?: string;
  /** Fallback version if package.json is missing or unreadable. */
  fallbackVersion?: string;
}

/**
 * Read `name` + `version` from a package.json. Resolution order:
 *   1. options.packageJsonPath (absolute)
 *   2. options.importMetaUrl → ../package.json (relative to caller)
 *   3. fallback values
 */
export function readPackageMeta(options: ReadPackageMetaOptions = {}): PackageMeta {
  const fallback: PackageMeta = {
    name: options.fallbackName ?? 'unknown',
    version: options.fallbackVersion ?? '0.0.0',
  };

  let path: string | undefined = options.packageJsonPath;
  if (!path && options.importMetaUrl) {
    const callerDir = dirname(fileURLToPath(options.importMetaUrl));
    path = resolve(join(callerDir, '..', 'package.json'));
  }

  if (!path) return fallback;

  const cached = cache.get(path);
  if (cached) return cached;

  try {
    const raw = readFileSync(path, 'utf8');
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    const meta: PackageMeta = {
      name: typeof pkg.name === 'string' ? pkg.name : fallback.name,
      version: typeof pkg.version === 'string' ? pkg.version : fallback.version,
    };
    cache.set(path, meta);
    return meta;
  } catch {
    cache.set(path, fallback);
    return fallback;
  }
}
