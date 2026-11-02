const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [REDACTED]'],
  [/\b(sk-[A-Za-z0-9_-]{6,})/g, '[REDACTED]'],
  [/\b(gsk_[A-Za-z0-9_-]{6,})/g, '[REDACTED]'],
  [/\b(AIza[0-9A-Za-z_-]{10,})/g, '[REDACTED]'],
  [/(?<=\bapi[_-]?key["'\s:=]{1,4})[A-Za-z0-9._~+/=-]{8,}/gi, '[REDACTED]'],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of ['key', 'api_key', 'apiKey', 'token', 'access_token']) {
      if (parsed.searchParams.has(name)) {
        parsed.searchParams.set(name, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return redactSecrets(url);
  }
}
