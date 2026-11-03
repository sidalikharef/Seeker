import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { isExcludedPath, type ExclusionDecision } from './exclusions';

export interface ResolvedPath {
  workspaceRelative: string;
  absolute: string;
  root: string;
  excluded: boolean;
  exclusionReason?: string;
  sensitive: boolean;
}

export interface ResolvePathOptions {
  mustExist?: boolean;
  followSymlinks?: boolean;
  patterns?: string[];
}

export type PathResolutionFailure =
  'outside_workspace' | 'not_found' | 'invalid_path' | 'not_a_file' | 'not_a_directory';

export type PathResolution =
  { ok: true; path: ResolvedPath } | { ok: false; reason: PathResolutionFailure; message: string };

async function canonicalRoots(
  roots: string[],
): Promise<Array<{ root: string; canonical: string }>> {
  const resolved: Array<{ root: string; canonical: string }> = [];
  for (const root of roots) {
    const absolute = normalize(resolve(root));
    try {
      resolved.push({ root: absolute, canonical: normalize(await realpath(absolute)) });
    } catch {
      resolved.push({ root: absolute, canonical: absolute });
    }
  }
  return resolved;
}

function isInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalize(candidate);
  const normalizedRoot = normalize(root);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  return normalizedCandidate.startsWith(
    normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`,
  );
}

function toRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

async function nearestExistingAncestor(
  target: string,
): Promise<{ existing: string; remainder: string[] } | undefined> {
  let current = target;
  const remainder: string[] = [];
  for (;;) {
    try {
      await stat(current);
      return { existing: current, remainder };
    } catch {
      const parent = resolve(current, '..');
      if (parent === current) {
        return undefined;
      }
      remainder.unshift(current.slice(parent.length).replace(/^[/\\]+/, ''));
      current = parent;
    }
  }
}

function excludedResult(absolute: string, root: string, decision: ExclusionDecision): ResolvedPath {
  return {
    absolute,
    root,
    workspaceRelative: toRelative(root, absolute),
    excluded: decision.excluded,
    exclusionReason: decision.reason,
    sensitive: decision.sensitive,
  };
}

export async function resolveWorkspacePath(
  inputPath: string,
  workspaceRoots: string[],
  options: ResolvePathOptions = {},
): Promise<PathResolution> {
  if (workspaceRoots.length === 0 || inputPath.includes('\0') || inputPath.trim().length === 0) {
    return {
      ok: false,
      reason: 'invalid_path',
      message: 'Path is empty or contains invalid characters.',
    };
  }

  const roots = await canonicalRoots(workspaceRoots);
  const primary = roots[0];
  if (!primary) {
    return { ok: false, reason: 'outside_workspace', message: 'No workspace root is available.' };
  }

  const lexical = isAbsolute(inputPath)
    ? normalize(resolve(inputPath))
    : normalize(resolve(primary.root, inputPath));

  const lexicalRoot =
    roots.find((entry) => isInside(lexical, entry.root)) ??
    roots.find((entry) => isInside(lexical, entry.canonical));
  if (!lexicalRoot) {
    return {
      ok: false,
      reason: 'outside_workspace',
      message: 'Path is outside the authorized workspace.',
    };
  }

  let absolute: string;
  let exists = true;
  try {
    const metadata = await stat(lexical);
    if (!metadata.isFile() && !metadata.isDirectory()) {
      return {
        ok: false,
        reason: 'invalid_path',
        message: 'Path is not a regular file or directory.',
      };
    }
    absolute = options.followSymlinks === false ? lexical : normalize(await realpath(lexical));
  } catch {
    exists = false;
    if (options.mustExist) {
      return { ok: false, reason: 'not_found', message: 'Path does not exist.' };
    }

    const ancestor = await nearestExistingAncestor(lexical);
    if (!ancestor) {
      return { ok: false, reason: 'not_found', message: 'No existing parent directory.' };
    }
    let canonicalAncestor: string;
    try {
      canonicalAncestor = normalize(await realpath(ancestor.existing));
    } catch {
      canonicalAncestor = normalize(ancestor.existing);
    }
    if (!isInside(canonicalAncestor, lexicalRoot.canonical)) {
      return {
        ok: false,
        reason: 'outside_workspace',
        message: 'Path resolves outside the authorized workspace.',
      };
    }
    absolute = normalize(resolve(canonicalAncestor, ...ancestor.remainder));
  }

  const canonicalRoot = roots.find((entry) => isInside(absolute, entry.canonical));
  if (!canonicalRoot) {
    return {
      ok: false,
      reason: 'outside_workspace',
      message: 'Path resolves outside the authorized workspace.',
    };
  }

  const workspaceRelative = toRelative(canonicalRoot.canonical, absolute);
  if (
    workspaceRelative.startsWith('..') ||
    isAbsolute(workspaceRelative) ||
    workspaceRelative.includes('\0')
  ) {
    return {
      ok: false,
      reason: 'outside_workspace',
      message: 'Path resolves outside the authorized workspace.',
    };
  }

  const decision = isExcludedPath(workspaceRelative, { patterns: options.patterns });
  const resolved = excludedResult(absolute, canonicalRoot.canonical, decision);

  if (exists && options.mustExist) {
    const metadata = await stat(absolute);
    if (!metadata.isFile() && !metadata.isDirectory()) {
      return {
        ok: false,
        reason: 'invalid_path',
        message: 'Path is not a regular file or directory.',
      };
    }
  }

  return { ok: true, path: resolved };
}
