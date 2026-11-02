export const COMMANDS = {
  hello: 'seeker.hello',
  setApiKey: 'seeker.setApiKey',
  clearApiKey: 'seeker.clearApiKey',
  refreshModels: 'seeker.refreshModels',
  testConnection: 'seeker.testConnection',
  showRouting: 'seeker.debug.showSelection',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

export const COMMAND_IDS: readonly CommandId[] = Object.values(COMMANDS);
