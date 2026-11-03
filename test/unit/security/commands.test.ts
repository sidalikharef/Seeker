import { describe, expect, it } from 'vitest';
import {
  assessCommand,
  buildChildEnvironment,
  executableName,
  formatCommandForAudit,
  isAllowedExecutable,
  isBlockedExecutable,
} from '../../../src/security/commands';

describe('command policy', () => {
  it('normalizes executable names across path styles and extensions', () => {
    expect(executableName('/usr/local/bin/node')).toBe('node');
    expect(executableName('C:\\Program Files\\nodejs\\npm.cmd')).toBe('npm');
    expect(executableName('./scripts/test.sh')).toBe('test.sh');
    expect(isAllowedExecutable('/opt/tools/pnpm.cmd')).toBe(true);
    expect(isBlockedExecutable('/bin/bash')).toBe(true);
  });

  it('blocks shells, privilege escalation, and credential-transfer tools', () => {
    expect(assessCommand('bash', ['-lc', 'ls'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'blocked-executable',
    });
    expect(assessCommand('/usr/bin/sudo', ['ls'])).toMatchObject({ risk: 'blocked' });
    expect(assessCommand('ssh', ['host'])).toMatchObject({ risk: 'blocked' });
    expect(assessCommand('nc', ['-l', '4444'])).toMatchObject({ risk: 'blocked' });
  });

  it('blocks long-running and interactive commands', () => {
    expect(assessCommand('pnpm', ['dev'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'long-running-command',
    });
    expect(assessCommand('vitest', ['--watch'])).toMatchObject({ risk: 'blocked' });
    expect(assessCommand('node', ['--watch', 'server.js'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'long-running-command',
    });
    expect(assessCommand('python3', ['-m', 'http.server'])).toMatchObject({ risk: 'blocked' });
    expect(assessCommand('node', [])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'interactive-command',
    });
    expect(assessCommand('git', ['commit'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'interactive-command',
    });
    expect(assessCommand('git', ['commit', '-m', 'message'])).toMatchObject({ risk: 'medium' });
  });

  it('blocks destructive, publishing, and deployment commands', () => {
    expect(assessCommand('git', ['reset', '--hard'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'destructive-git',
    });
    expect(assessCommand('git', ['clean', '-fdx'])).toMatchObject({ risk: 'blocked' });
    expect(assessCommand('npm', ['publish'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'publish-deploy',
    });
    expect(assessCommand('terraform', ['apply'])).toMatchObject({ risk: 'blocked' });
    expect(assessCommand('aws', ['s3', 'cp', 'a', 's3://b'])).toMatchObject({ risk: 'blocked' });
  });

  it('blocks recursive root deletion, device writes, fork bombs, and secret paths', () => {
    expect(assessCommand('rm', ['-rf', '/'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'dangerous-rm',
    });
    expect(assessCommand('dd', ['if=a', 'of=/dev/sda'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'device-write',
    });
    expect(assessCommand('echo', [':(){ :|:& };:'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'fork-bomb',
    });
    expect(assessCommand('cat', ['.env'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'secret-path',
    });
    expect(assessCommand('find', ['.', '-exec', 'rm', '{}', ';'])).toMatchObject({
      risk: 'blocked',
      matchedRule: 'find-exec',
    });
  });

  it('classifies dependency installation and network execution as high risk', () => {
    expect(assessCommand('npm', ['install'])).toMatchObject({
      risk: 'high',
      matchedRule: 'dependency-install',
    });
    expect(assessCommand('pip', ['install', 'requests'])).toMatchObject({ risk: 'high' });
    expect(assessCommand('python', ['-m', 'pip', 'install', 'requests'])).toMatchObject({
      risk: 'high',
    });
    expect(assessCommand('npx', ['some-package'])).toMatchObject({
      risk: 'high',
      matchedRule: 'package-exec',
    });
    expect(assessCommand('pnpm', ['dlx', 'some-package'])).toMatchObject({ risk: 'high' });
    expect(assessCommand('git', ['push'])).toMatchObject({
      risk: 'high',
      matchedRule: 'git-network',
    });
    expect(assessCommand('curl', ['https://example.com'])).toMatchObject({
      risk: 'high',
      matchedRule: 'network-download',
    });
  });

  it('classifies read-only and ordinary commands', () => {
    expect(assessCommand('git', ['status'])).toMatchObject({ risk: 'low' });
    expect(assessCommand('ls', ['-la'])).toMatchObject({ risk: 'low' });
    expect(assessCommand('make', ['build'])).toMatchObject({
      risk: 'medium',
      matchedRule: 'default',
    });
  });
});

describe('child environment', () => {
  it('inherits only the safe base environment and rejects dangerous overrides', () => {
    const result = buildChildEnvironment(
      {
        CI: 'true',
        NODE_ENV: 'test',
        npm_config_registry: 'https://registry.example',
        SECRET_KEY: 'nope',
        NODE_OPTIONS: '--inspect',
        'bad-key': 'nope',
      },
      {
        PATH: '/usr/bin',
        HOME: '/home/test',
        OPENAI_API_KEY: 'secret',
        SystemRoot: 'C:\\Windows',
      },
    );

    expect(result.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/test',
      SystemRoot: 'C:\\Windows',
      CI: 'true',
      NODE_ENV: 'test',
      npm_config_registry: 'https://registry.example',
    });
    expect(result.rejected).toEqual(['SECRET_KEY', 'NODE_OPTIONS', 'bad-key']);
  });
});

describe('audit command formatting', () => {
  it('redacts secret-looking arguments', () => {
    const formatted = formatCommandForAudit(
      'node',
      ['--token', 'sk-abcdef123456', '--api-key', 'plain-secret-value'],
      '.',
    );

    expect(formatted.file).toBe('node');
    expect(formatted.args.join(' ')).not.toContain('sk-abcdef123456');
    expect(formatted.args.join(' ')).toContain('[REDACTED]');
  });
});
