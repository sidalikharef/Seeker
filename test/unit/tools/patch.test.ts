import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff, parseUnifiedDiff, patchPathsMatch } from '../../../src/tools/patch';

const simplePatch = `--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,3 @@
 export function add(a: number, b: number) {
-  return a - b;
+  return a + b;
 }
`;

describe('parseUnifiedDiff', () => {
  it('parses a single-file unified diff', () => {
    const parsed = parseUnifiedDiff(simplePatch);
    expect(parsed).toMatchObject({
      ok: true,
      patch: {
        oldPath: 'src/math.ts',
        newPath: 'src/math.ts',
        hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }],
      },
    });
  });

  it('rejects malformed, multi-file, and non-unified input', () => {
    expect(parseUnifiedDiff('')).toMatchObject({ ok: false });
    expect(parseUnifiedDiff('not a patch')).toMatchObject({ ok: false });
    expect(
      parseUnifiedDiff(`@@ -1 +1 @@
-a
+b
--- a/one.ts
+++ b/one.ts
--- a/two.ts
+++ b/two.ts
`),
    ).toMatchObject({ ok: false });
  });

  it('rejects incomplete hunks', () => {
    expect(
      parseUnifiedDiff(`--- a/x
+++ b/x
@@ -1,2 +1,2 @@
-old
+new
`),
    ).toMatchObject({ ok: false });
  });
});

describe('applyUnifiedDiff', () => {
  it('applies hunks exactly without fuzzy matching', () => {
    const parsed = parseUnifiedDiff(simplePatch);
    if (!parsed.ok) throw new Error(parsed.error);

    const result = applyUnifiedDiff(
      'export function add(a: number, b: number) {\n  return a - b;\n}\n',
      parsed.patch.hunks,
    );

    expect(result).toEqual({
      ok: true,
      content: 'export function add(a: number, b: number) {\n  return a + b;\n}\n',
    });
  });

  it('rejects context mismatches', () => {
    const parsed = parseUnifiedDiff(simplePatch);
    if (!parsed.ok) throw new Error(parsed.error);

    expect(
      applyUnifiedDiff(
        'export function add(a: number, b: number) {\n  return a * b;\n}\n',
        parsed.patch.hunks,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('does not match') });
  });

  it('applies multiple hunks and preserves CRLF line endings', () => {
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-one
+ONE
 two
@@ -5,2 +5,2 @@
-five
+FIVE
 six
`;
    const parsed = parseUnifiedDiff(patch);
    if (!parsed.ok) throw new Error(parsed.error);

    const result = applyUnifiedDiff(
      'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\n',
      parsed.patch.hunks,
    );

    expect(result).toEqual({
      ok: true,
      content: 'ONE\r\ntwo\r\nthree\r\nfour\r\nFIVE\r\nsix\r\n',
    });
  });

  it('matches patch headers against the target path', () => {
    const parsed = parseUnifiedDiff(simplePatch);
    if (!parsed.ok) throw new Error(parsed.error);

    expect(patchPathsMatch(parsed.patch, 'src/math.ts')).toBe(true);
    expect(patchPathsMatch(parsed.patch, 'src/other.ts')).toBe(false);
  });
});
