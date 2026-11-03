import { describe, expect, it } from 'vitest';
import { validateJsonSchema } from '../../../src/tools/schema';

describe('validateJsonSchema', () => {
  it('accepts valid nested objects', () => {
    expect(
      validateJsonSchema(
        {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            count: { type: 'integer', minimum: 1, maximum: 5 },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
          },
          required: ['name'],
          additionalProperties: false,
        },
        { name: 'ok', count: 3, tags: ['a'] },
      ),
    ).toEqual([]);
  });

  it('rejects missing, extra, and ill-typed fields', () => {
    const errors = validateJsonSchema(
      {
        type: 'object',
        properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 2 } },
        required: ['name'],
        additionalProperties: false,
      },
      { count: 1, extra: true },
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        '$.name: is required',
        '$.count: must be at least 2',
        '$.extra: is not allowed',
      ]),
    );
  });

  it('supports enums, patterns, unions, and arrays', () => {
    expect(
      validateJsonSchema(
        {
          type: 'object',
          properties: {
            mode: { enum: ['a', 'b'] },
            hash: { type: 'string', pattern: '^[a-f0-9]{4}$' },
            value: { type: ['string', 'integer'] },
            items: { type: 'array', items: { type: 'boolean' } },
          },
        },
        { mode: 'c', hash: 'zzzz', value: 3, items: [true, 1] },
      ),
    ).toEqual(
      expect.arrayContaining([
        '$.mode: value is not one of the allowed values',
        '$.hash: does not match the required pattern',
        '$.items[1]: expected boolean',
      ]),
    );
  });
});
