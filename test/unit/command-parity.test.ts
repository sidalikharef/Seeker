import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HELLO_MESSAGE,
  registerSeekerCommands,
  type CommandRegistrar,
} from '../../src/extension/commands';
import { COMMANDS, COMMAND_IDS } from '../../src/shared/commands';

interface PackageManifest {
  contributes: {
    commands: Array<{ command: string }>;
  };
}

function readManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest;
}

describe('command parity', () => {
  it('contributes exactly the commands declared in the shared constants', () => {
    const contributed = readManifest().contributes.commands.map((entry) => entry.command);

    expect([...contributed].sort()).toEqual([...COMMAND_IDS].sort());
  });

  it('registers every contributed command', () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const registrar: CommandRegistrar = {
      registerCommand: (command, callback) => {
        registered.set(command, callback);
        return { dispose: () => undefined };
      },
    };

    const disposables = registerSeekerCommands(registrar, {
      showInformationMessage: () => undefined,
    });

    expect(disposables).toHaveLength(Object.keys(COMMANDS).length);
    expect([...registered.keys()].sort()).toEqual(
      readManifest()
        .contributes.commands.map((entry) => entry.command)
        .sort(),
    );
  });

  it('invokes the hello handler with the expected message', () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const messages: string[] = [];

    registerSeekerCommands(
      {
        registerCommand: (command, callback) => {
          registered.set(command, callback);
          return { dispose: () => undefined };
        },
      },
      {
        showInformationMessage: (message) => {
          messages.push(message);
        },
      },
    );

    const hello = registered.get(COMMANDS.hello);
    expect(hello).toBeDefined();
    hello?.();

    expect(messages).toEqual([HELLO_MESSAGE]);
  });
});
