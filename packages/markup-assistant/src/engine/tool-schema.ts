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
      'Respond to the user markup. When the user asks a question or there is ' +
      'nothing to change, fill "answer" and leave "edits" empty. When the user ' +
      'wants a change, fill "edits" and leave "answer" empty.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'One-line explanation of the interpretation.',
        },
        answer: {
          type: 'string',
          description:
            'A direct reply to the user when they asked a question or there is ' +
            'nothing to edit. Use instead of edits.',
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
