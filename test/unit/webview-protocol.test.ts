import { describe, expect, it } from 'vitest';
import { MAX_CHAT_MESSAGE_CHARS, parseWebviewMessage } from '../../src/extension/webview/protocol';

describe('webview protocol', () => {
  it('accepts and normalizes supported messages', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(
      parseWebviewMessage({
        type: 'chat.send',
        requestId: 'req-1',
        message: '  hello  ',
        provider: 'groq',
        modelId: 'model',
      }),
    ).toEqual({
      type: 'chat.send',
      requestId: 'req-1',
      message: '  hello  ',
      provider: 'groq',
      modelId: 'model',
    });
    expect(
      parseWebviewMessage({ type: 'settings.update', key: 'policy', value: 'free-first' }),
    ).toEqual({ type: 'settings.update', key: 'policy', value: 'free-first' });
  });

  it('rejects unknown types, invalid IDs, empty messages, and invalid enumerations', () => {
    expect(parseWebviewMessage(undefined)).toBeUndefined();
    expect(parseWebviewMessage({ type: 'unknown' })).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'chat.cancel', requestId: 'bad id with spaces' }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'chat.send', requestId: 'req-1', message: '   ' }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        type: 'chat.send',
        requestId: 'req-1',
        message: 'x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'model.select', provider: 'other', modelId: 'model' }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'credentials.manage', provider: 'groq', action: 'steal' }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'settings.update', key: 'policy', value: 'fastest' }),
    ).toBeUndefined();
    expect(parseWebviewMessage({ type: 'mode.set', mode: 'chaos' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'mode.set', mode: 'build' })).toEqual({
      type: 'mode.set',
      mode: 'build',
    });
  });

  it('requires provider and model IDs to be supplied together', () => {
    expect(
      parseWebviewMessage({
        type: 'chat.send',
        requestId: 'req-1',
        message: 'hi',
        provider: 'groq',
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        type: 'chat.send',
        requestId: 'req-1',
        message: 'hi',
        modelId: 'model',
      }),
    ).toBeUndefined();
    expect(parseWebviewMessage({ type: 'chat.send', requestId: 'req-1', message: 'hi' })).toEqual({
      type: 'chat.send',
      requestId: 'req-1',
      message: 'hi',
      provider: undefined,
      modelId: undefined,
    });
  });

  it('rejects malformed credential and preference messages', () => {
    expect(
      parseWebviewMessage({ type: 'credentials.manage', provider: '../x', action: 'set' }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'settings.update', key: 'preferredProvider', value: 'bad' }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({ type: 'settings.update', key: 'preferredProvider', value: '' }),
    ).toEqual({ type: 'settings.update', key: 'preferredProvider', value: '' });
  });
});
