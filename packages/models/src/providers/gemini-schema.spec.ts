import { describe, expect, it } from 'vitest';
import { toGeminiSchema } from './gemini-messages.js';

describe('toGeminiSchema', () => {
  it('keeps a well-formed object schema intact', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL' },
          retries: { type: 'integer', minimum: 0, maximum: 5 },
        },
        required: ['url'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL' },
        retries: { type: 'integer', minimum: 0, maximum: 5 },
      },
      required: ['url'],
    });
  });

  it('drops a freeform object property and leaves the rest usable', () => {
    // The shape shipped by http_request in packages/tools/src/tool-schemas.ts.
    const out = toGeminiSchema({
      type: 'object',
      properties: {
        url: { type: 'string' },
        headers: { type: 'object' },
      },
      required: ['url'],
    });

    expect(out).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    });
  });

  it('returns undefined for a schema with no usable properties', () => {
    // browser_get_images / ha_list_services ship exactly this. Gemini rejects an
    // OBJECT with empty properties, so the caller must omit `parameters`.
    expect(toGeminiSchema({ type: 'object', properties: {} })).toBeUndefined();
    expect(toGeminiSchema({ type: 'object' })).toBeUndefined();
  });

  it('drops a required entry whose property did not survive', () => {
    const out = toGeminiSchema({
      type: 'object',
      properties: { keep: { type: 'string' }, freeform: { type: 'object' } },
      required: ['keep', 'freeform'],
    });

    expect(out).toMatchObject({ required: ['keep'] });
    expect(Object.keys((out as { properties: object }).properties)).toEqual(['keep']);
  });

  it('strips JSON Schema keywords Gemini does not accept', () => {
    const out = toGeminiSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:example',
      type: 'object',
      additionalProperties: false,
      patternProperties: { '^x-': { type: 'string' } },
      properties: { name: { type: 'string', const: 'fixed', default: 'x' } },
    });

    expect(out).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
  });

  it('collapses a nullable type union into type + nullable', () => {
    expect(toGeminiSchema({ type: ['string', 'null'], description: 'maybe' })).toEqual({
      type: 'string',
      nullable: true,
      description: 'maybe',
    });
  });

  it('recurses into array items', () => {
    expect(
      toGeminiSchema({
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
          additionalProperties: false,
        },
      }),
    ).toEqual({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } } },
    });
  });

  it('drops items that sanitise away, leaving the array itself', () => {
    expect(toGeminiSchema({ type: 'array', items: { type: 'object' } })).toEqual({ type: 'array' });
  });

  it('recurses into anyOf and drops unusable variants', () => {
    expect(
      toGeminiSchema({
        anyOf: [{ type: 'string' }, { type: 'object' }],
      }),
    ).toEqual({ anyOf: [{ type: 'string' }] });
  });

  it('rejects non-object input', () => {
    expect(toGeminiSchema(undefined)).toBeUndefined();
    expect(toGeminiSchema(null)).toBeUndefined();
    expect(toGeminiSchema('string')).toBeUndefined();
    expect(toGeminiSchema([{ type: 'string' }])).toBeUndefined();
  });

  it('handles an empty schema, which MCP servers do send', () => {
    // packages/integrations/src/mcp-tool-port.spec.ts exercises `inputSchema: {}`.
    expect(toGeminiSchema({})).toEqual({});
  });
});
