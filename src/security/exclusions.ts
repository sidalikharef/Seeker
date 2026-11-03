import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { matchesGlob, normalizeGlobPath } from './glob';

const IGNORED_SEGMENTS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'venv',
]);

const SENSITIVE_SEGMENTS = new Set(['.aws', '.docker', '.gnupg', '.ssh']);

const EXACT_SENSITIVE_NAMES = new Set([
  '.env',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
]);

const SENSITIVE_GLOBS = [
  '.env.*',
  '*.key',
  '*.p12',
  '*.pem',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_dsa.*',
  'id_ecdsa.*',
  'id_ed25519.*',
  'id_rsa.*',
  'credentials.json',
  'service-account*.json',
];

export const DEFAULT_SECRET_GLOBS = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/.npmrc',
  '**/.pypirc',
  '**/.git-credentials',
  '**/.aws/**',
  '**/.ssh/**',
];

export interface ExclusionOptions {
  allowSensitive?: boolean;
  patterns?: string[];
}

export interface ExclusionDecision {
  excluded: boolean;
  sensitive: boolean;
  reason?: string;
}

function segments(relativePath: string): string[] {
  return normalizeGlobPath(relativePath).split('/').filter(Boolean);
}

export function isSensitivePath(relativePath: string): boolean {
  const parts = segments(relativePath);
  if (parts.some((part) => SENSITIVE_SEGMENTS.has(part))) {
    return true;
  }
  const name = parts.at(-1) ?? '';
  if (EXACT_SENSITIVE_NAMES.has(name)) {
    return true;
  }
  return SENSITIVE_GLOBS.some((glob) => matchesGlob(name, glob));
}

export function isIgnoredPath(relativePath: string, patterns: string[] = []): boolean {
  const normalized = normalizeGlobPath(relativePath);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => IGNORED_SEGMENTS.has(part))) {
    return true;
  }
  return patterns.some((pattern) => matchesGlob(normalized, pattern));
}

export function isExcludedPath(
  relativePath: string,
  options: ExclusionOptions = {},
): ExclusionDecision {
  if (!options.allowSensitive && isSensitivePath(relativePath)) {
    return { excluded: true, sensitive: true, reason: 'path contains credentials or secrets' };
  }
  if (isIgnoredPath(relativePath, options.patterns)) {
    return { excluded: true, sensitive: false, reason: 'path is ignored' };
  }
  return { excluded: false, sensitive: false };
}

export async function loadSeekerIgnore(root: string): Promise<string[]> {
  try {
    const contents = await readFile(join(root, '.seekerignore'), 'utf8');
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'));
  } catch {
    return [];
  }
}
