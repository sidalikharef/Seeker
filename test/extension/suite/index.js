const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const repoRoot = path.resolve(__dirname, '../../..');
const outRoot = path.join(repoRoot, 'out');
const { VscodeCommandApprover } = require(path.join(outRoot, 'extension/command-approval.js'));
const { ChatViewProvider } = require(path.join(outRoot, 'extension/chat-view.js'));
const { WorkspaceToolHost } = require(path.join(outRoot, 'extension/workspace-host.js'));
const { ALLOW_SESSION, RUN_ONCE, SessionCommandAllowlist } = require(
  path.join(outRoot, 'security/approvals.js'),
);

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeContext() {
  return {
    globalStorageUri: vscode.Uri.file(tempDirectory('seeker-test-storage-')),
  };
}

function fakeWebviewView() {
  const posted = [];
  let receive;
  const webview = {
    options: {},
    html: '',
    cspSource: 'vscode-resource://seeker',
    asWebviewUri: (uri) => uri,
    onDidReceiveMessage: (handler) => {
      receive = handler;
      return { dispose() {} };
    },
    postMessage: async (message) => {
      posted.push(message);
      return true;
    },
  };
  return {
    posted,
    webview,
    view: {
      webview,
      visible: true,
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    },
    receive: (message) => receive(message),
  };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for extension test condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function testApprovalPrompt() {
  const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const command = {
    workspace,
    file: 'node',
    args: ['-e', 'console.log("EXT_OK")'],
    cwd: workspace,
  };
  const request = {
    sessionId: 'session-a',
    toolId: 'terminal.execute',
    permission: 'execute',
    summary: 'Run a command',
    risk: 'medium',
    command,
  };
  const approvals = new SessionCommandAllowlist();
  let seen;
  const approver = new VscodeCommandApprover(approvals, {
    showWarningMessage: async (message, options, ...items) => {
      seen = { message, options, items };
      return RUN_ONCE;
    },
  });

  assert.equal(await approver.approve(request), true);
  assert.deepEqual(seen.options, { modal: true });
  assert.deepEqual(seen.items, [RUN_ONCE, ALLOW_SESSION]);
  assert.match(seen.message, /Seeker wants to run this exact command\./);
  assert.match(seen.message, new RegExp(`Executable: ${command.file}`));
  assert.match(seen.message, new RegExp(`Arguments: ${JSON.stringify(command.args)}`));
  assert.match(seen.message, new RegExp(`Working directory: ${command.cwd}`));
  assert.match(seen.message, new RegExp(`Workspace: ${command.workspace}`));
  assert.match(seen.message, /Review every argument carefully\./);
  assert.equal(approvals.isAllowed('session-a', command), false);

  const sessionApprover = new VscodeCommandApprover(approvals, {
    showWarningMessage: async () => ALLOW_SESSION,
  });
  assert.equal(await sessionApprover.approve(request), true);
  assert.equal(approvals.isAllowed('session-a', command), true);
  assert.equal(approvals.isAllowed('session-b', command), false);

  const deniedApprover = new VscodeCommandApprover(approvals, {
    showWarningMessage: async () => undefined,
  });
  assert.equal(await deniedApprover.approve({ ...request, sessionId: 'session-c' }), false);
}

async function testWorkspaceHostToolFlow() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const signal = new globalThis.AbortController().signal;
  const host = new WorkspaceToolHost({ context: fakeContext(), mode: 'build' });
  const requests = [];

  const terminal = await host.execute(
    'terminal.execute',
    { file: 'node', args: ['-e', 'console.log("EXT_OK")'], cwd: '.' },
    {
      signal,
      sessionId: 'session-a',
      approve: async (request) => {
        requests.push(request);
        return true;
      },
    },
  );
  assert.equal(terminal.ok, true);
  assert.match(terminal.data.stdout, /EXT_OK/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sessionId, 'session-a');
  assert.equal(requests[0].toolId, 'terminal.execute');
  assert.deepEqual(requests[0].command, {
    workspace: root,
    file: 'node',
    args: ['-e', 'console.log("EXT_OK")'],
    cwd: root,
  });

  const previews = [];
  const write = await host.execute(
    'filesystem.write',
    { path: 'approved-write.txt', content: 'approved\n', createIfMissing: true },
    {
      signal,
      sessionId: 'session-a',
      approve: async () => true,
      preview: {
        preview: async (request) => {
          previews.push(request);
          return true;
        },
      },
    },
  );
  assert.equal(write.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'approved-write.txt'), 'utf8'), 'approved\n');
  assert.deepEqual(previews, [{ path: 'approved-write.txt', before: '', after: 'approved\n' }]);

  const deniedWrite = await host.execute(
    'filesystem.write',
    { path: 'denied-write.txt', content: 'denied\n', createIfMissing: true },
    {
      signal,
      sessionId: 'session-a',
      approve: async () => true,
      preview: { preview: async () => false },
    },
  );
  assert.equal(deniedWrite.ok, false);
  assert.equal(deniedWrite.error.code, 'permission_denied');
  assert.equal(fs.existsSync(path.join(root, 'denied-write.txt')), false);
}

async function testSessionAllowlistThroughHost() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const signal = new globalThis.AbortController().signal;
  const host = new WorkspaceToolHost({ context: fakeContext(), mode: 'build' });
  let approvals = 0;
  const approve = async (request) => {
    approvals += 1;
    host.approvals.allow(request.sessionId, request.command);
    return true;
  };
  const input = {
    file: 'node',
    args: ['-e', 'console.log("SESSION_OK")'],
    cwd: '.',
  };

  assert.equal(
    (await host.execute('terminal.execute', input, { signal, sessionId: 'a', approve })).ok,
    true,
  );
  assert.equal(
    (await host.execute('terminal.execute', input, { signal, sessionId: 'a', approve })).ok,
    true,
  );
  assert.equal(
    (await host.execute('terminal.execute', input, { signal, sessionId: 'b', approve })).ok,
    true,
  );
  assert.equal(approvals, 2);
  assert.equal(
    host.approvals.isAllowed('a', { workspace: root, file: 'node', args: input.args, cwd: root }),
    true,
  );
  assert.equal(
    host.approvals.isAllowed('b', { workspace: root, file: 'node', args: input.args, cwd: root }),
    true,
  );
}

async function testMockedWebviewFlow() {
  const calls = [];
  const service = {
    subscribe() {
      return () => {};
    },
    getPublicState: async () => ({
      mode: 'ask',
      providers: [],
      policy: 'free-first',
      allowPaid: false,
      maxCostUsd: 0,
      session: { messages: [], status: 'idle' },
    }),
    ensureModels: async () => {
      calls.push('ensureModels');
    },
    setMode: (mode) => {
      calls.push(`mode:${mode}`);
    },
    send: async (message) => {
      calls.push(`send:${message.message}`);
    },
  };
  const provider = new ChatViewProvider(
    vscode.Uri.file(repoRoot),
    'your-publisher-id.seeker',
    service,
  );
  const harness = fakeWebviewView();

  await provider.resolveWebviewView(harness.view);
  assert.match(harness.view.webview.html, /id="mode-select"/);
  assert.match(harness.view.webview.html, /value="debug"/);

  harness.receive({ type: 'ready' });
  await waitFor(() => harness.posted.some((message) => message.type === 'init'));
  assert.ok(calls.includes('ensureModels'));

  harness.receive({ type: 'mode.set', mode: 'build' });
  await waitFor(() => calls.includes('mode:build'));

  harness.receive({ type: 'chat.send', requestId: 'req-1', message: 'hello' });
  await waitFor(() => calls.includes('send:hello'));

  harness.receive({ type: 'unknown' });
  await waitFor(() =>
    harness.posted.some(
      (message) =>
        message.type === 'error' &&
        /ignored an invalid or unsupported webview message/.test(message.message),
    ),
  );

  provider.dispose();
}

async function run() {
  const extension = vscode.extensions.getExtension('your-publisher-id.seeker');
  assert.ok(extension, 'Seeker extension should be discoverable in the test host');

  await extension.activate();

  const contributions = extension.packageJSON.contributes;
  assert.ok(contributions.viewsContainers.activitybar.some((item) => item.id === 'seeker'));
  assert.ok(
    contributions.views.seeker.some((item) => item.id === 'seeker.chat' && item.type === 'webview'),
    'seeker.chat should be contributed as a webview',
  );

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('seeker.hello'), 'seeker.hello should be registered');
  assert.ok(
    commands.includes('seeker.debug.showSelection'),
    'routing debug command should be registered',
  );

  assert.ok(vscode.workspace.workspaceFolders?.length, 'extension test workspace should be open');
  assert.equal(
    path
      .basename(vscode.workspace.workspaceFolders[0].uri.fsPath)
      .startsWith('seeker-extension-test-'),
    true,
  );

  await testApprovalPrompt();
  await testWorkspaceHostToolFlow();
  await testSessionAllowlistThroughHost();
  await testMockedWebviewFlow();

  await vscode.commands.executeCommand('workbench.view.extension.seeker');
  await new Promise((resolve) => setTimeout(resolve, 150));

  await vscode.commands.executeCommand('seeker.hello');
}

module.exports = { run };
