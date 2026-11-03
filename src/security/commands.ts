import { redactSecrets } from '../shared/redaction';

export type CommandRisk = 'low' | 'medium' | 'high' | 'blocked';

export interface CommandAssessment {
  risk: CommandRisk;
  reason: string;
  matchedRule?: string;
}

const ALLOWED_EXECUTABLES = new Set([
  'node',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'corepack',
  'git',
  'tsc',
  'vitest',
  'jest',
  'mocha',
  'eslint',
  'prettier',
  'biome',
  'python',
  'python3',
  'pip',
  'pip3',
  'pytest',
  'uv',
  'poetry',
  'cargo',
  'rustc',
  'gofmt',
  'go',
  'dotnet',
  'java',
  'javac',
  'mvn',
  'gradle',
  'gradlew',
  'make',
  'cmake',
  'ninja',
  'gcc',
  'g++',
  'clang',
  'clang++',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'stat',
  'pwd',
  'echo',
  'printf',
  'which',
  'where',
  'file',
  'du',
  'df',
  'tree',
  'curl',
  'wget',
]);

const BLOCKED_EXECUTABLES = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'dash',
  'ksh',
  'cmd',
  'powershell',
  'pwsh',
  'env',
  'xargs',
  'sudo',
  'su',
  'doas',
  'ssh',
  'scp',
  'rsync',
  'nc',
  'netcat',
  'socat',
  'telnet',
  'vi',
  'vim',
  'nano',
  'emacs',
  'less',
  'more',
  'top',
  'htop',
  'watch',
  'gitk',
  'shutdown',
  'reboot',
  'poweroff',
  'halt',
  'mkfs',
  'fdisk',
  'parted',
  'wipefs',
]);

const READ_OR_UPLOAD = new Set([
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'find',
  'curl',
  'wget',
  'base64',
  'xxd',
  'od',
  'tar',
  'zip',
  'scp',
  'ssh',
]);

const PACKAGE_MANAGERS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'corepack',
  'pip',
  'pip3',
  'poetry',
  'cargo',
  'go',
]);
const INSTALL_SUBCOMMANDS = new Set([
  'install',
  'i',
  'add',
  'update',
  'upgrade',
  'remove',
  'rm',
  'uninstall',
]);
const PUBLISH_SUBCOMMANDS = new Set(['publish', 'deploy', 'release', 'dist-tag']);
const LONG_RUNNING_SUBCOMMANDS = new Set(['dev', 'serve', 'start', 'watch', 'preview']);

const BASE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'SYSTEMROOT',
  'SystemDrive',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERNAME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'PWD',
  'USER',
  'LOGNAME',
];

const ENV_OVERRIDE_ALLOWLIST = new Set([
  ...BASE_ENV_KEYS,
  'CI',
  'NODE_ENV',
  'NO_COLOR',
  'FORCE_COLOR',
  'COLORTERM',
  'TERM_PROGRAM',
]);

const DANGEROUS_ENV_KEYS = new Set([
  'NODE_OPTIONS',
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'PS4',
  'PYTHONSTARTUP',
  'PYTHONPATH',
  'PERL5OPT',
  'RUBYOPT',
  'GIT_SSH_COMMAND',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);

const SECRET_ENV_PATTERN =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|CERTIFICATE|SIGNATURE/i;

export function executableName(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  return (normalized.split('/').at(-1) ?? normalized)
    .replace(/\.(exe|cmd|bat|com)$/i, '')
    .toLowerCase();
}

export function isAllowedExecutable(file: string): boolean {
  return ALLOWED_EXECUTABLES.has(executableName(file));
}

export function isBlockedExecutable(file: string): boolean {
  return BLOCKED_EXECUTABLES.has(executableName(file));
}

function hasRecursiveFlag(args: string[]): boolean {
  return args.some(
    (arg) => arg === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(arg) || arg === '-R',
  );
}

function dangerousRmTarget(args: string[]): string | undefined {
  if (!hasRecursiveFlag(args)) {
    return undefined;
  }
  return args.find((arg) => {
    if (arg.startsWith('-')) return false;
    return (
      arg === '/' ||
      arg === '/*' ||
      arg === '~' ||
      arg === '~/' ||
      arg === '..' ||
      arg === '../' ||
      arg === '.' ||
      arg === '*' ||
      arg.startsWith('/') ||
      arg.startsWith('~/') ||
      arg.startsWith('$HOME') ||
      arg.startsWith('${HOME}')
    );
  });
}

function isSensitiveArgument(argument: string): boolean {
  const candidates = [argument, argument.replace(/^@/, '')];
  const equalsIndex = argument.indexOf('=');
  if (equalsIndex !== -1) {
    candidates.push(argument.slice(equalsIndex + 1).replace(/^@/, ''));
  }
  return candidates.some((candidate) => {
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('-')) return false;
    const parts = normalized.split('/').filter(Boolean);
    const name = parts.at(-1) ?? '';
    if (
      name === '.env' ||
      name.startsWith('.env.') ||
      name === '.npmrc' ||
      name === '.pypirc' ||
      name === '.netrc' ||
      name === '.git-credentials' ||
      name === 'credentials.json' ||
      /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/.test(name)
    ) {
      return true;
    }
    if (
      name.endsWith('.pem') ||
      name.endsWith('.key') ||
      name.endsWith('.p12') ||
      name.endsWith('.pfx') ||
      name.endsWith('.jks') ||
      name.endsWith('.keystore')
    ) {
      return true;
    }
    return parts.some((part) => ['.ssh', '.aws', '.gnupg', '.docker'].includes(part));
  });
}

function isLongRunningCommand(name: string, args: string[]): boolean {
  const first = args.find((arg) => !arg.startsWith('-'));
  if (name === 'nodemon' || name === 'uvicorn' || name === 'serve') {
    return true;
  }
  if (name === 'vite' || name === 'next') {
    return (
      first === undefined || ['dev', 'serve', 'preview'].includes(first) || args.includes('--watch')
    );
  }
  if (name === 'flask') {
    return first === 'run';
  }
  if (name === 'webpack' && args.includes('serve')) {
    return true;
  }
  if (name === 'python' || name === 'python3') {
    return args.some((arg) => arg === 'http.server' || arg === 'runserver');
  }
  if (name === 'node' && (args.includes('--watch') || args.includes('-w'))) {
    return true;
  }
  if (PACKAGE_MANAGERS.has(name) && first) {
    if (LONG_RUNNING_SUBCOMMANDS.has(first)) {
      return true;
    }
    if (first === 'run' && args.some((arg) => ['dev', 'serve', 'start', 'watch'].includes(arg))) {
      return true;
    }
  }
  if (
    (name === 'tsc' || name === 'vitest' || name === 'jest') &&
    args.some((arg) => arg === '--watch' || arg === '-w')
  ) {
    return true;
  }
  return false;
}

function isInteractiveCommand(name: string, args: string[]): boolean {
  if ((name === 'node' || name === 'python' || name === 'python3') && args.length === 0) {
    return true;
  }
  if (name !== 'git') {
    return false;
  }
  const subcommand = args.find((arg) => !arg.startsWith('-'));
  if (subcommand === 'commit') {
    const hasMessage = args.some(
      (arg) =>
        /^-[A-Za-z]*m/.test(arg) ||
        arg.startsWith('--message') ||
        arg === '-F' ||
        arg.startsWith('-F') ||
        arg.startsWith('--file') ||
        arg === '--no-edit',
    );
    return !hasMessage;
  }
  if (
    (subcommand === 'rebase' ||
      subcommand === 'add' ||
      subcommand === 'checkout' ||
      subcommand === 'reset') &&
    args.includes('-i')
  ) {
    return true;
  }
  if (
    (subcommand === 'add' || subcommand === 'checkout' || subcommand === 'reset') &&
    args.includes('-p')
  ) {
    return true;
  }
  return false;
}

function isPublishOrDeploy(name: string, args: string[]): boolean {
  const first = args.find((arg) => !arg.startsWith('-'));
  if (PACKAGE_MANAGERS.has(name) && first && PUBLISH_SUBCOMMANDS.has(first)) {
    return true;
  }
  if (name === 'vsce' && first === 'publish') {
    return true;
  }
  if (name === 'gh' && first === 'release') {
    return true;
  }
  if (name === 'docker' && first === 'push') {
    return true;
  }
  if (name === 'terraform' && (first === 'apply' || first === 'destroy')) {
    return true;
  }
  if (name === 'kubectl' && (first === 'apply' || first === 'delete' || first === 'create')) {
    return true;
  }
  if (name === 'aws' || name === 'gcloud' || name === 'az') {
    return true;
  }
  if (name === 'heroku' || name === 'vercel' || name === 'netlify' || name === 'wrangler') {
    return true;
  }
  return false;
}

function isDangerousGit(name: string, args: string[]): boolean {
  if (name !== 'git') {
    return false;
  }
  if (args.includes('--hard') && args.some((arg) => arg === 'reset' || arg === 'checkout')) {
    return true;
  }
  if (args.includes('clean') && args.some((arg) => /^-f/.test(arg) || arg === '--force')) {
    return true;
  }
  return false;
}

export function assessCommand(file: string, args: string[]): CommandAssessment {
  const name = executableName(file);

  if (!name) {
    return { risk: 'blocked', reason: 'Executable name is empty.', matchedRule: 'empty-command' };
  }
  if (BLOCKED_EXECUTABLES.has(name)) {
    return {
      risk: 'blocked',
      reason: `${name} is a shell, interactive, privileged, or credential-transfer executable and is not supported.`,
      matchedRule: 'blocked-executable',
    };
  }
  if (isLongRunningCommand(name, args)) {
    return {
      risk: 'blocked',
      reason: 'Long-running watch/server commands are not supported in terminal execution.',
      matchedRule: 'long-running-command',
    };
  }
  if (isInteractiveCommand(name, args)) {
    return {
      risk: 'blocked',
      reason:
        'Interactive or TTY-dependent commands are not supported. Pass non-interactive arguments.',
      matchedRule: 'interactive-command',
    };
  }
  if (isDangerousGit(name, args)) {
    return {
      risk: 'blocked',
      reason: 'Destructive Git reset/checkout/clean is blocked.',
      matchedRule: 'destructive-git',
    };
  }
  if (isPublishOrDeploy(name, args)) {
    return {
      risk: 'blocked',
      reason:
        'Publishing, deployment, cloud mutation, and payment commands are blocked in this phase.',
      matchedRule: 'publish-deploy',
    };
  }
  if (name === 'rm') {
    const target = dangerousRmTarget(args);
    if (target) {
      return {
        risk: 'blocked',
        reason: `Recursive deletion of ${target} is blocked.`,
        matchedRule: 'dangerous-rm',
      };
    }
  }
  if (name === 'dd' && args.some((arg) => arg.startsWith('of=/dev/'))) {
    return {
      risk: 'blocked',
      reason: 'Writing directly to a device is blocked.',
      matchedRule: 'device-write',
    };
  }
  if (args.join(' ').includes(':(){')) {
    return {
      risk: 'blocked',
      reason: 'Fork-bomb pattern is blocked.',
      matchedRule: 'fork-bomb',
    };
  }
  if (
    (READ_OR_UPLOAD.has(name) || name === 'git') &&
    args.some((arg) => isSensitiveArgument(arg))
  ) {
    return {
      risk: 'blocked',
      reason: 'Command arguments reference credential or secret files.',
      matchedRule: 'secret-path',
    };
  }
  if (name === 'find' && args.some((arg) => ['-exec', '-execdir', '-ok', '-okdir'].includes(arg))) {
    return {
      risk: 'blocked',
      reason: 'find with process execution is blocked.',
      matchedRule: 'find-exec',
    };
  }
  const first = args.find((arg) => !arg.startsWith('-'));
  if (
    name === 'npx' ||
    ((name === 'pnpm' || name === 'yarn') && first === 'dlx') ||
    (PACKAGE_MANAGERS.has(name) && first === 'exec')
  ) {
    return {
      risk: 'high',
      reason: 'On-demand package execution can download and run unreviewed code.',
      matchedRule: 'package-exec',
    };
  }
  if (
    (PACKAGE_MANAGERS.has(name) && first && INSTALL_SUBCOMMANDS.has(first)) ||
    ((name === 'python' || name === 'python3') &&
      args[0] === '-m' &&
      args[1] === 'pip' &&
      args[2] !== undefined &&
      INSTALL_SUBCOMMANDS.has(args[2]))
  ) {
    return {
      risk: 'high',
      reason: 'Dependency changes can execute package lifecycle scripts and require approval.',
      matchedRule: 'dependency-install',
    };
  }
  if (
    name === 'git' &&
    (first === 'push' || first === 'fetch' || first === 'pull' || first === 'clone')
  ) {
    return {
      risk: 'high',
      reason: 'Network Git operations can change or publish repository state.',
      matchedRule: 'git-network',
    };
  }
  if (name === 'curl' || name === 'wget') {
    return {
      risk: 'high',
      reason: 'Network downloads require approval.',
      matchedRule: 'network-download',
    };
  }
  if (
    name === 'git' &&
    (first === 'status' || first === 'diff' || first === 'log' || first === 'show')
  ) {
    return { risk: 'low', reason: 'Read-only Git inspection.', matchedRule: 'git-read' };
  }
  if (
    [
      'ls',
      'cat',
      'head',
      'tail',
      'wc',
      'grep',
      'rg',
      'find',
      'stat',
      'pwd',
      'echo',
      'printf',
      'which',
      'where',
      'file',
      'du',
      'df',
      'tree',
    ].includes(name)
  ) {
    return { risk: 'low', reason: 'Read-only local command.', matchedRule: 'read-only' };
  }
  if (PACKAGE_MANAGERS.has(name)) {
    return {
      risk: 'medium',
      reason: 'Package-manager command can execute project scripts.',
      matchedRule: 'package-manager',
    };
  }
  return { risk: 'medium', reason: 'Command execution requires approval.', matchedRule: 'default' };
}

export interface ChildEnvironment {
  env: Record<string, string>;
  rejected: string[];
}

function isSecretEnvKey(key: string): boolean {
  return (
    SECRET_ENV_PATTERN.test(key) ||
    key.startsWith('AWS_') ||
    key.startsWith('AZURE_') ||
    key.startsWith('GOOGLE_') ||
    key === 'GOOGLE_APPLICATION_CREDENTIALS'
  );
}

function isDangerousEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    DANGEROUS_ENV_KEYS.has(upper) ||
    upper.startsWith('GIT_CONFIG_KEY_') ||
    upper.startsWith('GIT_CONFIG_VALUE_') ||
    upper.startsWith('DYLD_')
  );
}

function isAllowedOverrideKey(key: string): boolean {
  return ENV_OVERRIDE_ALLOWLIST.has(key) || key.startsWith('npm_config_');
}

export function buildChildEnvironment(
  overrides: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): ChildEnvironment {
  const env: Record<string, string> = {};
  for (const key of BASE_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  const rejected: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      typeof value !== 'string' ||
      value.includes('\0') ||
      !isAllowedOverrideKey(key) ||
      isSecretEnvKey(key) ||
      isDangerousEnvKey(key)
    ) {
      rejected.push(key);
      continue;
    }
    env[key] = value;
  }

  return { env, rejected };
}

export function formatCommandForAudit(
  file: string,
  args: string[],
  cwd: string,
): { file: string; args: string[]; cwd: string } {
  return {
    file: redactSecrets(file),
    args: args.map((argument) => redactSecrets(argument)),
    cwd: redactSecrets(cwd),
  };
}
