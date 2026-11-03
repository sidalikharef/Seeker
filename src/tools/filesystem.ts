import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSeekerIgnore } from '../security/exclusions';
import { resolveWorkspacePath, type PathResolution } from '../security/paths';
import { sha256Hex } from '../shared/hash';
import {
  atomicWriteFile,
  readTextFile,
  splitTextLines,
  truncateUtf8,
  MAX_WRITE_BYTES,
} from './fs-utils';
import { applyUnifiedDiff, parseUnifiedDiff, patchPathsMatch } from './patch';
import { failure, type JsonSchema, type Tool, type ToolContext, type ToolResult } from './types';

export const READ_TIMEOUT_MS = 10_000;
export const WRITE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 1000;
const MAX_RECURSION_DEPTH = 10;

const objectOutput: JsonSchema = { type: 'object' };

function pathError(resolution: PathResolution): ToolResult<never> | undefined {
  if (!resolution.ok) {
    switch (resolution.reason) {
      case 'not_found':
        return failure('not_found', resolution.message);
      case 'outside_workspace':
        return failure('unsafe_path', resolution.message);
      default:
        return failure('invalid_arguments', resolution.message);
    }
  }
  return undefined;
}

function exclusionError(
  resolution: PathResolution,
  ctx: ToolContext,
): ToolResult<never> | undefined {
  if (!resolution.ok || !resolution.path.excluded || ctx.allowSensitivePaths) {
    return undefined;
  }
  return failure(
    'permission_denied',
    `Path ${resolution.path.workspaceRelative} is excluded: ${
      resolution.path.exclusionReason ?? 'excluded path'
    }`,
  );
}

async function resolveForTool(
  inputPath: string,
  ctx: ToolContext,
  mustExist: boolean,
): Promise<PathResolution> {
  return resolveWorkspacePath(inputPath, ctx.workspaceRoots, { mustExist });
}

interface ReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

interface ReadOutput {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  sha256: string;
  truncated: boolean;
}

export const filesystemRead: Tool<ReadInput, ReadOutput> = {
  id: 'filesystem.read',
  description: 'Read a UTF-8 text file or line range inside the workspace.',
  permission: 'read',
  timeoutMs: READ_TIMEOUT_MS,
  maxResultBytes: MAX_READ_BYTES,
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
      maxBytes: { type: 'integer', minimum: 1, maximum: MAX_READ_BYTES },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: objectOutput,
  async execute(input, ctx): Promise<ToolResult<ReadOutput>> {
    const resolution = await resolveForTool(input.path, ctx, true);
    const unresolved = pathError(resolution);
    if (unresolved) return unresolved;
    const excluded = exclusionError(resolution, ctx);
    if (excluded) return excluded;
    if (!resolution.ok) return failure('internal', 'Path resolution failed.');

    const file = await readTextFile(resolution.path.absolute);
    if (!file.ok) {
      if (file.reason === 'not_found') return failure('not_found', file.message);
      if (file.reason === 'too_large') return failure('too_large', file.message);
      return failure('invalid_arguments', file.message);
    }

    const lines = splitTextLines(file.text);
    const totalLines = lines.length;
    const requestedStart = input.startLine ?? 1;
    const requestedEnd = input.endLine ?? totalLines;
    if (totalLines === 0) {
      return {
        ok: true,
        data: {
          path: resolution.path.workspaceRelative,
          content: '',
          startLine: requestedStart,
          endLine: 0,
          totalLines,
          sha256: file.sha256,
          truncated: false,
        },
        bytes: 0,
      };
    }
    if (requestedStart > totalLines || requestedEnd < requestedStart) {
      return failure(
        'invalid_arguments',
        `Invalid line range ${requestedStart}-${requestedEnd} for ${totalLines} lines.`,
      );
    }

    const end = Math.min(requestedEnd, totalLines);
    const selected = lines.slice(requestedStart - 1, end).join('\n');
    const limited = truncateUtf8(selected, input.maxBytes ?? DEFAULT_MAX_BYTES);
    const returnedLines = limited.text.length === 0 ? 0 : limited.text.split('\n').length;
    const endLine = returnedLines === 0 ? requestedStart - 1 : requestedStart + returnedLines - 1;

    return {
      ok: true,
      data: {
        path: resolution.path.workspaceRelative,
        content: limited.text,
        startLine: requestedStart,
        endLine,
        totalLines,
        sha256: file.sha256,
        truncated: limited.truncated || end < requestedEnd,
      },
      truncated: limited.truncated || end < requestedEnd,
      bytes: Buffer.byteLength(limited.text, 'utf8'),
    };
  },
};

interface ListInput {
  path?: string;
  depth?: number;
  maxEntries?: number;
}

interface ListEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
}

interface ListOutput {
  root: string;
  entries: ListEntry[];
  truncated: boolean;
}

export const filesystemList: Tool<ListInput, ListOutput> = {
  id: 'filesystem.list',
  description: 'List files and directories inside the workspace without following symlinks.',
  permission: 'read',
  timeoutMs: READ_TIMEOUT_MS,
  maxResultBytes: DEFAULT_MAX_BYTES,
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      depth: { type: 'integer', minimum: 0, maximum: MAX_RECURSION_DEPTH },
      maxEntries: { type: 'integer', minimum: 1, maximum: MAX_LIST_ENTRIES },
    },
    additionalProperties: false,
  },
  outputSchema: objectOutput,
  async execute(input, ctx): Promise<ToolResult<ListOutput>> {
    const resolution = await resolveForTool(input.path ?? '.', ctx, true);
    const unresolved = pathError(resolution);
    if (unresolved) return unresolved;
    const excluded = exclusionError(resolution, ctx);
    if (excluded) return excluded;
    if (!resolution.ok) return failure('internal', 'Path resolution failed.');

    const metadata = await stat(resolution.path.absolute);
    if (!metadata.isDirectory()) {
      return failure('invalid_arguments', 'filesystem.list requires a directory path.');
    }

    const depth = input.depth ?? 2;
    const maxEntries = input.maxEntries ?? 200;
    const ignorePatterns = await loadSeekerIgnore(resolution.path.root);
    const entries: ListEntry[] = [];
    let truncated = false;

    const visit = async (directory: string, remainingDepth: number): Promise<void> => {
      if (truncated || ctx.signal.aborted) {
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
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        const absolute = join(directory, dirent.name);
        const resolved = await resolveWorkspacePath(absolute, ctx.workspaceRoots, {
          mustExist: true,
          patterns: ignorePatterns,
        });
        if (!resolved.ok) {
          continue;
        }
        if (resolved.path.excluded && !ctx.allowSensitivePaths) {
          continue;
        }
        const type = dirent.isSymbolicLink()
          ? 'symlink'
          : dirent.isDirectory()
            ? 'directory'
            : dirent.isFile()
              ? 'file'
              : 'other';
        entries.push({ path: resolved.path.workspaceRelative, type });
        if (type === 'directory' && remainingDepth > 0) {
          await visit(absolute, remainingDepth - 1);
        }
      }
    };

    await visit(resolution.path.absolute, depth);
    if (ctx.signal.aborted) {
      return failure('cancelled', 'The operation was cancelled.', { retryable: true });
    }

    let limitedEntries = entries;
    while (
      limitedEntries.length > 0 &&
      Buffer.byteLength(JSON.stringify(limitedEntries), 'utf8') > DEFAULT_MAX_BYTES
    ) {
      limitedEntries = limitedEntries.slice(0, -1);
      truncated = true;
    }

    return {
      ok: true,
      data: {
        root: resolution.path.workspaceRelative || '.',
        entries: limitedEntries,
        truncated,
      },
      truncated,
      bytes: Buffer.byteLength(JSON.stringify(limitedEntries), 'utf8'),
    };
  },
};

interface WriteInput {
  path: string;
  content: string;
  expectedSha256?: string;
  createIfMissing?: boolean;
}

interface WriteOutput {
  path: string;
  sha256: string;
  bytes: number;
  created: boolean;
  previousSha256?: string;
}

export const filesystemWrite: Tool<WriteInput, WriteOutput> = {
  id: 'filesystem.write',
  description: 'Create a new file or replace an existing file after verifying its SHA-256 hash.',
  permission: 'write',
  timeoutMs: WRITE_TIMEOUT_MS,
  maxResultBytes: 4096,
  idempotent: false,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      content: { type: 'string', maxLength: MAX_WRITE_BYTES },
      expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      createIfMissing: { type: 'boolean' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  outputSchema: objectOutput,
  async execute(input, ctx): Promise<ToolResult<WriteOutput>> {
    const resolution = await resolveForTool(input.path, ctx, false);
    const unresolved = pathError(resolution);
    if (unresolved) return unresolved;
    const excluded = exclusionError(resolution, ctx);
    if (excluded) return excluded;
    if (!resolution.ok) return failure('internal', 'Path resolution failed.');

    if (Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) {
      return failure('too_large', `Content exceeds the ${MAX_WRITE_BYTES} byte write limit.`);
    }

    let existingText = '';
    let previousSha256: string | undefined;
    let existed = false;
    try {
      const existing = await readTextFile(resolution.path.absolute);
      if (existing.ok) {
        existed = true;
        existingText = existing.text;
        previousSha256 = existing.sha256;
      } else if (existing.reason === 'binary') {
        return failure('invalid_arguments', 'Refusing to replace a binary file.');
      } else if (existing.reason === 'too_large') {
        return failure('too_large', existing.message);
      } else if (existing.reason === 'not_file') {
        return failure('invalid_arguments', 'Path is not a regular file.');
      }
    } catch {
      // Missing file.
    }

    if (existed) {
      if (!input.expectedSha256) {
        return failure('invalid_arguments', 'expectedSha256 is required when replacing a file.');
      }
      if (input.expectedSha256 !== previousSha256) {
        return failure('conflict', 'The file changed since it was read.', {
          details: { expected: input.expectedSha256, actual: previousSha256 },
        });
      }
    } else {
      if (!input.createIfMissing) {
        return failure('not_found', 'File does not exist. Set createIfMissing to create it.');
      }
      if (
        input.expectedSha256 !== undefined &&
        input.expectedSha256 !== sha256Hex(Buffer.alloc(0))
      ) {
        return failure('conflict', 'A new file must be based on an empty pre-image hash.');
      }
    }

    if (ctx.preview) {
      const approved = await ctx.preview.preview({
        path: resolution.path.workspaceRelative,
        before: existingText,
        after: input.content,
      });
      if (!approved) {
        return failure('permission_denied', 'The diff preview was rejected.');
      }
    }

    const bytes = await atomicWriteFile(resolution.path.absolute, input.content);
    return {
      ok: true,
      data: {
        path: resolution.path.workspaceRelative,
        sha256: sha256Hex(input.content),
        bytes,
        created: !existed,
        previousSha256,
      },
      bytes,
    };
  },
};

interface ApplyPatchInput {
  path: string;
  expectedSha256: string;
  patch: string;
  createIfMissing?: boolean;
}

interface ApplyPatchOutput {
  path: string;
  sha256: string;
  bytes: number;
  hunks: number;
  created: boolean;
  previousSha256: string;
}

export const filesystemApplyPatch: Tool<ApplyPatchInput, ApplyPatchOutput> = {
  id: 'filesystem.apply_patch',
  description: 'Apply a unified diff after verifying the current file SHA-256 hash.',
  permission: 'write',
  timeoutMs: WRITE_TIMEOUT_MS,
  maxResultBytes: 8192,
  idempotent: false,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      patch: { type: 'string', minLength: 1, maxLength: MAX_WRITE_BYTES },
      createIfMissing: { type: 'boolean' },
    },
    required: ['path', 'expectedSha256', 'patch'],
    additionalProperties: false,
  },
  outputSchema: objectOutput,
  async execute(input, ctx): Promise<ToolResult<ApplyPatchOutput>> {
    const resolution = await resolveForTool(input.path, ctx, false);
    const unresolved = pathError(resolution);
    if (unresolved) return unresolved;
    const excluded = exclusionError(resolution, ctx);
    if (excluded) return excluded;
    if (!resolution.ok) return failure('internal', 'Path resolution failed.');

    let original = '';
    let previousSha256 = sha256Hex(Buffer.alloc(0));
    let existed = false;
    try {
      const existing = await readTextFile(resolution.path.absolute);
      if (existing.ok) {
        existed = true;
        original = existing.text;
        previousSha256 = existing.sha256;
      } else if (existing.reason === 'binary') {
        return failure('invalid_arguments', 'Refusing to patch a binary file.');
      } else if (existing.reason === 'too_large') {
        return failure('too_large', existing.message);
      } else if (existing.reason === 'not_file') {
        return failure('invalid_arguments', 'Path is not a regular file.');
      }
    } catch {
      // Missing file.
    }

    if (!existed && !input.createIfMissing) {
      return failure('not_found', 'File does not exist. Set createIfMissing to create it.');
    }
    if (input.expectedSha256 !== previousSha256) {
      return failure('conflict', 'The file changed since it was read.', {
        details: { expected: input.expectedSha256, actual: previousSha256 },
      });
    }

    const parsed = parseUnifiedDiff(input.patch);
    if (!parsed.ok) {
      return failure('invalid_arguments', parsed.error);
    }
    if (!patchPathsMatch(parsed.patch, resolution.path.workspaceRelative)) {
      return failure('invalid_arguments', 'Patch headers do not match the target path.');
    }

    const applied = applyUnifiedDiff(original, parsed.patch.hunks);
    if (!applied.ok) {
      return failure('conflict', applied.error, {
        details: { hunk: applied.hunk === undefined ? undefined : applied.hunk + 1 },
      });
    }

    if (ctx.preview) {
      const approved = await ctx.preview.preview({
        path: resolution.path.workspaceRelative,
        before: original,
        after: applied.content,
      });
      if (!approved) {
        return failure('permission_denied', 'The diff preview was rejected.');
      }
    }

    const bytes = await atomicWriteFile(resolution.path.absolute, applied.content);
    return {
      ok: true,
      data: {
        path: resolution.path.workspaceRelative,
        sha256: sha256Hex(applied.content),
        bytes,
        hunks: parsed.patch.hunks.length,
        created: !existed,
        previousSha256,
      },
      bytes,
    };
  },
};

export const filesystemTools: Tool[] = [
  filesystemRead as Tool,
  filesystemList as Tool,
  filesystemWrite as Tool,
  filesystemApplyPatch as Tool,
];
