import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSeekerIgnore, isIgnoredPath, isSensitivePath } from '../security/exclusions';
import { matchesGlob } from '../security/glob';
import { resolveWorkspacePath } from '../security/paths';
import { readTextFile, splitTextLines } from './fs-utils';
import { failure, type JsonSchema, type Tool, type ToolContext, type ToolResult } from './types';

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SCANNED_FILES = 5000;
const MAX_SCANNED_BYTES = 16 * 1024 * 1024;
const SNIPPET_CHARS = 300;
const MAX_RESULT_BYTES = 256 * 1024;

const objectOutput: JsonSchema = { type: 'object' };

function mapPathError(
  resolution: Awaited<ReturnType<typeof resolveWorkspacePath>>,
): ToolResult<never> | undefined {
  if (resolution.ok) {
    return undefined;
  }
  if (resolution.reason === 'not_found') {
    return failure('not_found', resolution.message);
  }
  if (resolution.reason === 'outside_workspace') {
    return failure('unsafe_path', resolution.message);
  }
  return failure('invalid_arguments', resolution.message);
}

function excludedError(
  resolution: Extract<Awaited<ReturnType<typeof resolveWorkspacePath>>, { ok: true }>,
  ctx: ToolContext,
): ToolResult<never> | undefined {
  if (!resolution.path.excluded || ctx.allowSensitivePaths) {
    return undefined;
  }
  return failure(
    'permission_denied',
    `Path ${resolution.path.workspaceRelative} is excluded: ${
      resolution.path.exclusionReason ?? 'excluded path'
    }`,
  );
}

interface SearchTextInput {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  path?: string;
  include?: string[];
  exclude?: string[];
  maxResults?: number;
}

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  snippet: string;
}

interface SearchTextOutput {
  matches: SearchMatch[];
  truncated: boolean;
  scannedFiles: number;
}

interface WalkOptions {
  root: string;
  start: string;
  patterns: string[];
  include: string[];
  exclude: string[];
  signal: AbortSignal;
}

interface WalkResult {
  files: string[];
  truncated: boolean;
  scannedFiles: number;
  scannedBytes: number;
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/');
}

function matchesFilters(relativePath: string, include: string[], exclude: string[]): boolean {
  if (include.length > 0 && !include.some((pattern) => matchesGlob(relativePath, pattern))) {
    return false;
  }
  return !exclude.some((pattern) => matchesGlob(relativePath, pattern));
}

async function walkFiles(options: WalkOptions): Promise<WalkResult> {
  const files: string[] = [];
  let truncated = false;
  let scannedFiles = 0;
  let scannedBytes = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (truncated || options.signal.aborted) {
      return;
    }
    if (depth > 30) {
      truncated = true;
      return;
    }
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((left, right) => left.name.localeCompare(right.name));
    for (const dirent of dirents) {
      if (truncated || options.signal.aborted) {
        return;
      }
      if (dirent.isSymbolicLink()) {
        continue;
      }
      const absolute = join(directory, dirent.name);
      const relativePath = normalizeRelative(
        absolute.slice(options.root.length).replace(/^[/\\]/, ''),
      );
      if (isSensitivePath(relativePath) || isIgnoredPath(relativePath, options.patterns)) {
        continue;
      }
      if (dirent.isDirectory()) {
        const directoryExcluded = options.exclude.some(
          (pattern) =>
            matchesGlob(relativePath, pattern) || matchesGlob(`${relativePath}/`, pattern),
        );
        if (!directoryExcluded) {
          await visit(absolute, depth + 1);
        }
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }
      if (!matchesFilters(relativePath, options.include, options.exclude)) {
        continue;
      }
      if (scannedFiles >= MAX_SCANNED_FILES || scannedBytes >= MAX_SCANNED_BYTES) {
        truncated = true;
        return;
      }
      try {
        const metadata = await stat(absolute);
        if (metadata.size > MAX_FILE_BYTES) {
          continue;
        }
        scannedBytes += metadata.size;
      } catch {
        continue;
      }
      scannedFiles += 1;
      files.push(absolute);
    }
  };

  const metadata = await stat(options.start);
  if (metadata.isFile()) {
    const relativePath = normalizeRelative(
      options.start.slice(options.root.length).replace(/^[/\\]/, ''),
    );
    if (matchesFilters(relativePath, options.include, options.exclude)) {
      files.push(options.start);
      scannedFiles = 1;
    }
  } else if (metadata.isDirectory()) {
    await visit(options.start, 0);
  }

  return { files, truncated, scannedFiles, scannedBytes };
}

function trimMatches(
  matches: SearchMatch[],
  truncated: boolean,
): { matches: SearchMatch[]; truncated: boolean } {
  let current = matches;
  let didTruncate = truncated;
  while (
    current.length > 0 &&
    Buffer.byteLength(JSON.stringify(current), 'utf8') > MAX_RESULT_BYTES
  ) {
    current = current.slice(0, -1);
    didTruncate = true;
  }
  return { matches: current, truncated: didTruncate };
}

export const searchText: Tool<SearchTextInput, SearchTextOutput> = {
  id: 'search.text',
  description: 'Search text or regular expressions across workspace files.',
  permission: 'read',
  timeoutMs: SEARCH_TIMEOUT_MS,
  maxResultBytes: MAX_RESULT_BYTES,
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1024 },
      regex: { type: 'boolean' },
      caseSensitive: { type: 'boolean' },
      path: { type: 'string' },
      include: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      exclude: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS },
    },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: objectOutput,
  async execute(input, ctx): Promise<ToolResult<SearchTextOutput>> {
    const resolution = await resolveWorkspacePath(input.path ?? '.', ctx.workspaceRoots, {
      mustExist: true,
    });
    const pathFailure = mapPathError(resolution);
    if (pathFailure) return pathFailure;
    if (!resolution.ok) return failure('internal', 'Path resolution failed.');
    const excluded = excludedError(resolution, ctx);
    if (excluded) return excluded;

    let expression: RegExp;
    try {
      const source = input.regex ? input.query : input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expression = new RegExp(source, input.caseSensitive ? 'g' : 'gi');
    } catch (error) {
      return failure(
        'invalid_arguments',
        `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const ignorePatterns = await loadSeekerIgnore(resolution.path.root);
    const walk = await walkFiles({
      root: resolution.path.root,
      start: resolution.path.absolute,
      patterns: ignorePatterns,
      include: input.include ?? [],
      exclude: input.exclude ?? [],
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) {
      return failure('cancelled', 'The operation was cancelled.', { retryable: true });
    }

    const matches: SearchMatch[] = [];
    let truncated = walk.truncated;
    const maxResults = input.maxResults ?? 200;

    for (const file of walk.files) {
      if (matches.length >= maxResults || ctx.signal.aborted) {
        truncated = true;
        break;
      }
      const read = await readTextFile(file);
      if (!read.ok) {
        continue;
      }
      const relativePath = normalizeRelative(
        file.slice(resolution.path.root.length).replace(/^[/\\]/, ''),
      );
      const lines = splitTextLines(read.text);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
        const line = lines[lineIndex];
        expression.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = expression.exec(line)) !== null) {
          matches.push({
            path: relativePath,
            line: lineIndex + 1,
            column: match.index + 1,
            snippet: line.slice(0, SNIPPET_CHARS),
          });
          if (matches.length >= maxResults) {
            truncated = true;
            break;
          }
          if (match[0].length === 0) {
            expression.lastIndex += 1;
          }
        }
      }
    }

    const limited = trimMatches(matches, truncated);
    return {
      ok: true,
      data: {
        matches: limited.matches,
        truncated: limited.truncated,
        scannedFiles: walk.scannedFiles,
      },
      truncated: limited.truncated,
      bytes: Buffer.byteLength(JSON.stringify(limited.matches), 'utf8'),
    };
  },
};

interface SearchFilesInput {
  pattern: string;
  path?: string;
  maxResults?: number;
}

interface SearchFilesOutput {
  files: string[];
  truncated: boolean;
  scannedFiles: number;
}

export const searchFiles: Tool<SearchFilesInput, SearchFilesOutput> = {
  id: 'search.files',
  description: 'Find workspace files whose paths match a glob pattern.',
  permission: 'read',
  timeoutMs: SEARCH_TIMEOUT_MS,
  maxResultBytes: MAX_RESULT_BYTES,
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', minLength: 1, maxLength: 512 },
      path: { type: 'string' },
      maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  outputSchema: objectOutput,
  async execute(input, ctx): Promise<ToolResult<SearchFilesOutput>> {
    const resolution = await resolveWorkspacePath(input.path ?? '.', ctx.workspaceRoots, {
      mustExist: true,
    });
    const pathFailure = mapPathError(resolution);
    if (pathFailure) return pathFailure;
    if (!resolution.ok) return failure('internal', 'Path resolution failed.');
    const excluded = excludedError(resolution, ctx);
    if (excluded) return excluded;

    const ignorePatterns = await loadSeekerIgnore(resolution.path.root);
    const walk = await walkFiles({
      root: resolution.path.root,
      start: resolution.path.absolute,
      patterns: ignorePatterns,
      include: [],
      exclude: [],
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) {
      return failure('cancelled', 'The operation was cancelled.', { retryable: true });
    }

    const maxResults = input.maxResults ?? 200;
    const files: string[] = [];
    let truncated = walk.truncated;
    for (const file of walk.files) {
      const relativePath = normalizeRelative(
        file.slice(resolution.path.root.length).replace(/^[/\\]/, ''),
      );
      if (matchesGlob(relativePath, input.pattern)) {
        if (files.length >= maxResults) {
          truncated = true;
          break;
        }
        files.push(relativePath);
      }
    }

    let limited = files;
    while (
      limited.length > 0 &&
      Buffer.byteLength(JSON.stringify(limited), 'utf8') > MAX_RESULT_BYTES
    ) {
      limited = limited.slice(0, -1);
      truncated = true;
    }

    return {
      ok: true,
      data: { files: limited, truncated, scannedFiles: walk.scannedFiles },
      truncated,
      bytes: Buffer.byteLength(JSON.stringify(limited), 'utf8'),
    };
  },
};

export const searchTools: Tool[] = [searchText as Tool, searchFiles as Tool];
