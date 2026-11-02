const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('your-publisher-id.seeker');
  assert.ok(extension, 'Seeker extension should be discoverable in the test host');

  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('seeker.hello'), 'seeker.hello should be registered');

  await vscode.commands.executeCommand('seeker.hello');
}

module.exports = { run };
