export interface PatchLine {
  kind: ' ' | '+' | '-';
  text: string;
}

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PatchLine[];
}

export interface ParsedPatch {
  oldPath?: string;
  newPath?: string;
  hunks: PatchHunk[];
}

export type PatchParseResult = { ok: true; patch: ParsedPatch } | { ok: false; error: string };

function headerPath(line: string, prefix: '--- ' | '+++ '): string | undefined {
  const value = line.slice(prefix.length).split('\t')[0]?.trim();
  if (!value || value === '/dev/null') {
    return undefined;
  }
  return value.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(input: string): PatchParseResult {
  if (input.length === 0) {
    return { ok: false, error: 'Patch is empty.' };
  }
  if (input.includes('\0')) {
    return { ok: false, error: 'Patch contains binary data.' };
  }

  const lines = input.split(/\r?\n/);
  const hunks: PatchHunk[] = [];
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let current: PatchHunk | undefined;
  let remainingOld = 0;
  let remainingNew = 0;
  let seenFilePair = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('diff --git ')) {
      if (hunks.length > 0) {
        return { ok: false, error: 'Patch must target a single file.' };
      }
      continue;
    }
    if (line.startsWith('index ') || line.startsWith('new file mode ')) {
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      return { ok: false, error: 'File deletion is not supported.' };
    }
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      return { ok: false, error: 'Renames are not supported.' };
    }
    if (line.startsWith('Binary files ')) {
      return { ok: false, error: 'Binary patches are not supported.' };
    }
    if (line.startsWith('--- ')) {
      if (seenFilePair > 0) {
        return { ok: false, error: 'Patch must target a single file.' };
      }
      oldPath = headerPath(line, '--- ');
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = headerPath(line, '+++ ');
      seenFilePair += 1;
      continue;
    }
    if (line.startsWith('@@ ')) {
      if (remainingOld > 0 || remainingNew > 0) {
        return { ok: false, error: 'Previous hunk is incomplete.' };
      }
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) {
        return { ok: false, error: `Malformed hunk header: ${line}` };
      }
      current = {
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      remainingOld = current.oldLines;
      remainingNew = current.newLines;
      hunks.push(current);
      continue;
    }
    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }
    if (current && line.length > 0) {
      const kind = line[0];
      if (kind !== ' ' && kind !== '+' && kind !== '-') {
        return { ok: false, error: `Malformed patch line: ${line}` };
      }
      current.lines.push({ kind, text: line.slice(1) });
      if (kind !== '+') {
        remainingOld -= 1;
      }
      if (kind !== '-') {
        remainingNew -= 1;
      }
      if (remainingOld < 0 || remainingNew < 0) {
        return { ok: false, error: 'Hunk contains more lines than its header declares.' };
      }
      continue;
    }
    if (
      line.length === 0 &&
      current &&
      (remainingOld > 0 || remainingNew > 0) &&
      index < lines.length - 1
    ) {
      current.lines.push({ kind: ' ', text: '' });
      remainingOld -= 1;
      remainingNew -= 1;
      continue;
    }
    if (line.trim().length > 0) {
      return { ok: false, error: `Unexpected patch content: ${line}` };
    }
  }

  if (remainingOld > 0 || remainingNew > 0) {
    return { ok: false, error: 'Patch ended before a hunk was complete.' };
  }
  if (hunks.length === 0) {
    return { ok: false, error: 'Patch contains no hunks.' };
  }

  return { ok: true, patch: { oldPath, newPath, hunks } };
}

export type PatchApplyResult =
  { ok: true; content: string } | { ok: false; error: string; hunk?: number };

export function applyUnifiedDiff(original: string, hunks: PatchHunk[]): PatchApplyResult {
  const hadTrailingNewline = original.endsWith('\n');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }

  const output: string[] = [];
  let sourceIndex = 0;

  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
    const hunk = hunks[hunkIndex];
    const targetIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (targetIndex < sourceIndex || targetIndex > lines.length) {
      return {
        ok: false,
        hunk: hunkIndex,
        error: `Hunk ${hunkIndex + 1} does not apply at the declared position.`,
      };
    }
    while (sourceIndex < targetIndex) {
      output.push(lines[sourceIndex]);
      sourceIndex += 1;
    }

    let oldSeen = 0;
    let newSeen = 0;
    for (const line of hunk.lines) {
      if (line.kind === '+' || line.kind === ' ') {
        newSeen += 1;
      }
      if (line.kind === '-' || line.kind === ' ') {
        oldSeen += 1;
      }

      if (line.kind === '+') {
        output.push(line.text);
        continue;
      }
      if (sourceIndex >= lines.length || lines[sourceIndex] !== line.text) {
        return {
          ok: false,
          hunk: hunkIndex,
          error: `Hunk ${hunkIndex + 1} context does not match the current file.`,
        };
      }
      if (line.kind === ' ') {
        output.push(lines[sourceIndex]);
      }
      sourceIndex += 1;
    }

    if (oldSeen !== hunk.oldLines || newSeen !== hunk.newLines) {
      return {
        ok: false,
        hunk: hunkIndex,
        error: `Hunk ${hunkIndex + 1} line counts do not match its header.`,
      };
    }
  }

  while (sourceIndex < lines.length) {
    output.push(lines[sourceIndex]);
    sourceIndex += 1;
  }

  const content = output.join(eol) + (hadTrailingNewline ? eol : '');
  return { ok: true, content };
}

export function patchPathsMatch(patch: ParsedPatch, workspaceRelative: string): boolean {
  const normalized = workspaceRelative.replace(/\\/g, '/');
  const matches = (header: string | undefined): boolean => {
    if (!header) {
      return true;
    }
    const candidate = header.replace(/\\/g, '/').replace(/^\.\//, '');
    return candidate === normalized || normalized.endsWith(`/${candidate}`);
  };
  return matches(patch.oldPath) && matches(patch.newPath);
}
