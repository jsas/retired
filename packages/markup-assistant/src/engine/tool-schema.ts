/**
 * JSON schema for the apply_edits tool the model must call. Kept separate
 * from the adapter for readability; mirrors the Edit union in
 * ../core/index.js.
 */
export const APPLY_EDITS_TOOL = {
  type: 'function',
  function: {
    name: 'apply_edits',
    description:
      'Apply concrete edits to the page/app to realize the user markup. ' +
      'Return an empty edits array when the markup cannot be interpreted.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'One-line explanation of the interpretation.',
        },
        edits: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  kind: { const: 'text' },
                  file: { type: 'string' },
                  find: { type: 'string' },
                  replace: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['kind', 'file', 'find', 'replace'],
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'write' },
                  file: { type: 'string' },
                  content: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['kind', 'file', 'content'],
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'dom' },
                  ops: { type: 'array', items: { $ref: '#/$defs/domOp' } },
                  description: { type: 'string' },
                },
                required: ['kind', 'ops'],
              },
            ],
          },
        },
      },
      required: ['edits'],
      $defs: {
        domOp: {
          oneOf: [
            {
              type: 'object',
              properties: {
                op: { const: 'setText' },
                selector: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['op', 'selector', 'text'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'setAttr' },
                selector: { type: 'string' },
                name: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['op', 'selector', 'name', 'value'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'setStyle' },
                selector: { type: 'string' },
                styles: { type: 'object', additionalProperties: { type: 'string' } },
              },
              required: ['op', 'selector', 'styles'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'move' },
                selector: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['op', 'selector', 'x', 'y'],
            },
            {
              type: 'object',
              properties: {
                op: { const: 'remove' },
                selector: { type: 'string' },
              },
              required: ['op', 'selector'],
            },
          ],
        },
      },
    },
  },
} as const
