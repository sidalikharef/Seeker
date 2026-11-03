function escapeRegex(character: string): string {
  return /[\\^$+.()|{}]/.test(character) ? `\\${character}` : character;
}

export function normalizeGlobPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function globToRegExp(glob: string): RegExp {
  let pattern = normalizeGlobPath(glob.trim());
  if (!pattern) {
    return /^$/;
  }
  if (pattern.endsWith('/')) {
    pattern += '**';
  }

  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 3;
        } else {
          expression += '.*';
          index += 2;
        }
        continue;
      }
      expression += '[^/]*';
      index += 1;
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      index += 1;
      continue;
    }
    if (character === '[') {
      const closing = pattern.indexOf(']', index + 1);
      if (closing === -1) {
        expression += '\\[';
        index += 1;
        continue;
      }
      let content = pattern.slice(index + 1, closing);
      if (content.startsWith('!')) {
        content = `^${content.slice(1)}`;
      }
      expression += `[${content.replace(/\\/g, '\\\\')}]`;
      index = closing + 1;
      continue;
    }
    expression += escapeRegex(character);
    index += 1;
  }

  const prefix = pattern.includes('/') ? '^' : '(?:^|.*/)';
  return new RegExp(`${prefix}${expression}$`);
}

export function matchesGlob(relativePath: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizeGlobPath(relativePath));
}
