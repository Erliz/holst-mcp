#!/usr/bin/env node
// Holst MCP server: read & write to Holst.so boards via local desktop CDP.
// Self-sufficient: auto-starts the app, self-heals mounts, ships its own docs
// (tool descriptions, holst_reference, holst_doctor, holst://docs/usage).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, DISPATCH } from './tools-schema.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { sanitizeError } from './policy.js';
import { USAGE_DOC } from './docs.js';

const server = new Server(
  { name: 'holst-mcp', version: '0.3.0' },
  { capabilities: { tools: {}, resources: {} } }
);



server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'holst://docs/usage',
      name: 'Holst MCP — Agent Usage Guide',
      description:
        'Full operational manual: prerequisites, workflow, conventions, timings, error actions, never-do list, env vars. Read this once before heavy work.',
      mimeType: 'text/markdown',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === 'holst://docs/usage') {
    return {
      contents: [
        { uri: 'holst://docs/usage', mimeType: 'text/markdown', text: USAGE_DOC },
      ],
    };
  }
  throw new Error('Unknown resource: ' + req.params.uri);
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const handler = DISPATCH[name];
    if (!handler) throw new Error('Unknown tool: ' + name);
    let result = await handler(args);
    // For summary, return text directly. For everything else — JSON.
    if (name === 'holst_get_board_summary' && result?.summary) {
      return {
        content: [{ type: 'text', text: result.summary }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${sanitizeError(e)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[holst-mcp] connected via stdio');
