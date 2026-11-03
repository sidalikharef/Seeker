import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sha256Hex } from '../shared/hash';

export const MAX_READ_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_WRITE_BYTES = 2 * 1024 * 1024;

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

export function splitTextLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return { text, truncated: false };
  }
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }
  return { text: text.slice(0, end), truncated: true };
}

export async function readTextFile(
  path: string,
): Promise<
  | { ok: true; text: string; buffer: Buffer; sha256: string; bytes: number }
  | { ok: false; reason: 'not_found' | 'too_large' | 'binary' | 'not_file'; message: string }
> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    return { ok: false, reason: 'not_found', message: 'File does not exist.' };
  }
  if (!metadata.isFile()) {
    return { ok: false, reason: 'not_file', message: 'Path is not a regular file.' };
  }
  if (metadata.size > MAX_READ_FILE_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      message: `File exceeds the ${MAX_READ_FILE_BYTES} byte read limit.`,
    };
  }

  const buffer = await readFile(path);
  if (isBinaryBuffer(buffer)) {
    return { ok: false, reason: 'binary', message: 'Binary files are not supported.' };
  }
  return {
    ok: true,
    text: buffer.toString('utf8'),
    buffer,
    sha256: sha256Hex(buffer),
    bytes: buffer.length,
  };
}

export async function atomicWriteFile(path: string, contents: string): Promise<number> {
  const bytes = Buffer.from(contents, 'utf8');
  if (bytes.length > MAX_WRITE_BYTES) {
    throw new Error(`Content exceeds the ${MAX_WRITE_BYTES} byte write limit.`);
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.seeker-${randomUUID()}.tmp`;
  let mode: number | undefined;
  try {
    mode = (await stat(path)).mode;
  } catch {
    // New file.
  }

  try {
    const handle = await open(temporary, 'wx', mode === undefined ? 0o644 : mode & 0o777);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode !== undefined) {
      await chmod(temporary, mode & 0o777);
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  return bytes.length;
}
