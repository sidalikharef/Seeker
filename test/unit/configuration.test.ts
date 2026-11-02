import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, CONFIG_SECTION, configurationKey } from '../../src/shared/configuration';

interface PackageManifest {
  contributes: {
    configuration: {
      properties: Record<string, { type: string; default: unknown }>;
    };
  };
}

function readManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest;
}

describe('configuration wiring', () => {
  it('builds fully qualified configuration keys', () => {
    expect(configurationKey(CONFIG_KEYS.enabled)).toBe('seeker.enabled');
    expect(CONFIG_SECTION).toBe('seeker');
  });

  it('declares the enabled setting with a safe default', () => {
    const properties = readManifest().contributes.configuration.properties;
    const enabled = properties[configurationKey(CONFIG_KEYS.enabled)];

    expect(enabled).toBeDefined();
    expect(enabled.type).toBe('boolean');
    expect(enabled.default).toBe(true);
  });

  it('declares routing settings that cannot spend money by default', () => {
    const properties = readManifest().contributes.configuration.properties;

    expect(properties[configurationKey(CONFIG_KEYS.routingPolicy)]).toMatchObject({
      type: 'string',
      default: 'free-first',
    });
    expect(properties[configurationKey(CONFIG_KEYS.routingAllowPaid)]).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(properties[configurationKey(CONFIG_KEYS.routingMaxCostUsdPerTask)]).toMatchObject({
      type: 'number',
      default: 0,
      minimum: 0,
    });
    expect(properties[configurationKey(CONFIG_KEYS.routingExcludedProviders)]).toMatchObject({
      type: 'array',
      default: [],
    });
  });
});
