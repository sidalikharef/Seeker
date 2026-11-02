import { describe, expect, it } from 'vitest';
import {
  classifyFreeTier,
  estimatedCostUsdPerMTok,
  hasZeroPrice,
  isFreeClass,
  isPaidClass,
  parsePricePerMTok,
} from '../../../src/router/classify';
import { descriptor } from './fixtures';

describe('free-tier classification', () => {
  it('parses non-negative numeric prices from strings and numbers', () => {
    expect(parsePricePerMTok('1.25')).toBe(1.25);
    expect(parsePricePerMTok(0)).toBe(0);
    expect(parsePricePerMTok('-1')).toBeUndefined();
    expect(parsePricePerMTok('not-a-price')).toBeUndefined();
    expect(parsePricePerMTok(undefined)).toBeUndefined();
  });

  it('detects zero-price models', () => {
    expect(hasZeroPrice({ inputPerMTok: 0, outputPerMTok: 0, currency: 'USD' })).toBe(true);
    expect(hasZeroPrice({ inputPerMTok: 0, outputPerMTok: 1, currency: 'USD' })).toBe(false);
    expect(hasZeroPrice(undefined)).toBe(false);
  });

  it('keeps explicit provider classification', () => {
    expect(
      classifyFreeTier(
        descriptor('paid-model', {
          freeTierClass: 'paid',
          pricing: { inputPerMTok: 0, outputPerMTok: 0, currency: 'USD' },
        }),
      ),
    ).toBe('paid');
  });

  it('classifies free suffixes and zero prices as free tier', () => {
    expect(classifyFreeTier(descriptor('vendor/model:free', { freeTierClass: 'unknown' }))).toBe(
      'free-tier',
    );
    expect(
      classifyFreeTier(
        descriptor('zero-price', {
          freeTierClass: 'unknown',
          pricing: { inputPerMTok: 0, outputPerMTok: 0, currency: 'USD' },
        }),
      ),
    ).toBe('free-tier');
  });

  it('classifies paid prices and unknown prices safely', () => {
    expect(
      classifyFreeTier(
        descriptor('paid', {
          freeTierClass: 'unknown',
          pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' },
        }),
      ),
    ).toBe('paid');
    expect(classifyFreeTier(descriptor('unknown', { freeTierClass: 'unknown' }))).toBe('unknown');
  });

  it('separates free classes from paid classes', () => {
    expect(isFreeClass('free-tier')).toBe(true);
    expect(isFreeClass('local')).toBe(true);
    expect(isFreeClass('paid')).toBe(false);
    expect(isPaidClass('paid')).toBe(true);
    expect(isPaidClass('trial-credit')).toBe(true);
    expect(isPaidClass('subscription')).toBe(true);
    expect(isPaidClass('free-tier')).toBe(false);
  });

  it('estimates combined input and output price per million tokens', () => {
    expect(estimatedCostUsdPerMTok({ inputPerMTok: 1, outputPerMTok: 2, currency: 'USD' })).toBe(3);
    expect(estimatedCostUsdPerMTok(undefined)).toBe(0);
  });
});
