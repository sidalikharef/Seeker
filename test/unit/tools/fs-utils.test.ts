import { chmod, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_READ_FILE_BYTES,
  MAX_WRITE_BYTES,
  atomicWriteFile,
  isBinaryBuffer,
  readTextFile,
  splitTextLines,
  truncateUtf8,
} from '../../../src/tools/fs-utils';
import { makeWorkspace, type TestWorkspace } from './helpers';

let workspace: TestWorkspace | undefined;

afterEach(async () => {
  await workspace?.cleanup();
  workspace = undefined;
});

describe('fs-utils', () => {
  it('detects binary content and splits lines', () => {
    expect(isBinaryBuffer(Buffer.from([1, 2, 0, 4]))).toBe(true);
    expect(isBinaryBuffer(Buffer.from('text'))).toBe(false);
    expect(splitTextLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c']);
    expect(splitTextLines('')).toEqual([]);
  });

  it('truncates without splitting UTF-8 code points', () => {
    const result = truncateUtf8('aaa😀bbb', 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('aaa');
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(5);
  });

  it('reads text files and rejects binary, missing, and oversized files', async () => {
    workspace = await makeWorkspace({
      'text.txt': 'hello',
      'binary.bin': Buffer.from([0, 1]),
      'huge.txt': 'x'.repeat(MAX_READ_FILE_BYTES + 1),
    });

    await expect(readTextFile(join(workspace.root, 'text.txt'))).resolves.toMatchObject({
      ok: true,
      text: 'hello',
    });
    await expect(readTextFile(join(workspace.root, 'binary.bin'))).resolves.toMatchObject({
      ok: false,
      reason: 'binary',
    });
    await expect(readTextFile(join(workspace.root, 'missing.txt'))).resolves.toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    await expect(readTextFile(join(workspace.root, 'huge.txt'))).resolves.toMatchObject({
      ok: false,
      reason: 'too_large',
    });
  });

  it('writes atomically without leaving temp files', async () => {
    workspace = await makeWorkspace({});
    const target = join(workspace.root, 'nested', 'file.txt');

    await expect(atomicWriteFile(target, 'content')).resolves.toBe(7);

    await expect(readFile(target, 'utf8')).resolves.toBe('content');
    await expect(readdir(join(workspace.root, 'nested'))).resolves.toEqual(['file.txt']);
  });

  it('preserves existing permission bits', async () => {
    workspace = await makeWorkspace({ 'mode.txt': 'old' });
    const target = join(workspace.root, 'mode.txt');
    await chmod(target, 0o640);

    await atomicWriteFile(target, 'new');

    expect((await stat(target)).mode & 0o777).toBe(0o640);
  });

  it('rejects oversized writes', async () => {
    workspace = await makeWorkspace({});
    await expect(
      atomicWriteFile(join(workspace.root, 'large.txt'), 'x'.repeat(MAX_WRITE_BYTES + 1)),
    ).rejects.toThrow(/write limit/);
  });
});
