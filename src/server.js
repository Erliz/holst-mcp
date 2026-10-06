#!/usr/bin/env node
// Holst MCP server: read & write to Holst.so boards via local desktop CDP.
// Self-sufficient: auto-starts the app, self-heals mounts, ships its own docs
// (tool descriptions, holst_reference, holst_doctor, holst://docs/usage).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  listBoards,
  getBoardContent,
  getBoardSummary,
  searchBoardText,
  addSticker,
  addShape,
  addSimpleText,
  addArrow,
  addFrame,
  addStamp,
  updateText,
  deleteObject,
  moveObject,
  setColor,
  resizeObject,
  whoAmI,
  doctor,
} from './holst.js';
import { getReference } from './reference.js';
import { sanitizeError } from './policy.js';
import { USAGE_DOC } from './docs.js';

const server = new Server(
  { name: 'holst-mcp', version: '0.3.0' },
  { capabilities: { tools: {}, resources: {} } }
);

const ADD_NOTE =
  'NOTE: takes 3-8s (editor settle) — slow is normal, never retry on slowness. ' +
  'Result: { ok, id, documentId, mounted, native }; mounted=false = not rendered yet (server self-heals via reload) — verify with holst_get_board_summary. ' +
  'Coordinates: top-left origin, y grows down.';

const TOOLS = [
  {
    name: 'holst_whoami',
    description:
      'Check the Holst connection: returns the logged-in user. Run this first if anything fails. Never auto-launches anything by itself.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_doctor',
    description:
      'Full self-diagnosis: CDP endpoint, Holst app, tabs, auth, editor readiness, latency, effective config. Never throws — returns a report with a human-readable verdict and suggested action. Run this before troubleshooting anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_reference',
    description:
      'On-demand reference: palette colors, verified shape/arrow types, coordinate conventions, timings, result-field semantics, limits, env vars, do-not list. Cheaper than guessing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_list_boards',
    description:
      'List all boards and folders across the user\'s workspaces. Returns the user, recent boards, and per-workspace trees. boardId for other tools is a strict UUID from here (or from a board URL).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_get_board_content',
    description:
      'Full raw dump of a board: all objects (with coordinates) + all document texts. Size-capped by HOLST_MAX_DUMP_BYTES (default 2MB) — for big boards use holst_search_text or holst_get_board_summary instead.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'UUID board id' },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_get_board_summary',
    description:
      'Structured markdown of a board: stickers grouped under nearest section headers. The preferred way to read a board and to VERIFY your own changes (every block must show its text).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_search_text',
    description:
      'Case-insensitive substring search across all texts on a board. Returns matches with object id, type, position, snippet. Use for big boards instead of full dumps.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        query: { type: 'string', description: 'Substring to search (case-insensitive)' },
      },
      required: ['boardId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_sticker',
    description:
      'Add a sticky note with text (default 192x192, yellow). ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Sticker text (plain, \\n = new paragraph)' },
        x: { type: 'number', description: 'Top-left X on canvas' },
        y: { type: 'number', description: 'Top-left Y on canvas' },
        width: { type: 'number', default: 192 },
        height: { type: 'number', default: 192 },
      },
      required: ['boardId', 'text', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_update_text',
    description:
      'Replace the text of an existing object (sticker / shape / simple-text). Idempotent — safe to retry once if verification shows the text missing. Takes 2-6s.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string', description: 'From get_board_content / creation result' },
        text: { type: 'string' },
      },
      required: ['boardId', 'objectId', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_delete_object',
    description:
      'Delete an object AND its linked text document. Irreversible — confirm intent for bulk deletions.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_shape',
    description:
      'Add a shape with a text label (section headers, flow blocks). Verified types: round-rect, square. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Label inside the shape' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 240 },
        height: { type: 'number', default: 48 },
        shapeType: { type: 'string', default: 'square', description: 'round-rect, square (verified); circle, rhombus, triangle exist' },
        fillColor: { type: 'string', default: 'white6', description: 'Palette name: yellow6, blue6, green6, red6, orange8, gray12, white6...' },
        strokeColor: { type: 'string', default: 'gray12' },
        strokeWidth: { type: 'number', default: 2 },
        fixedSize: { type: 'boolean', default: true },
      },
      required: ['boardId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_simple_text',
    description:
      'Add a plain text label (no background), auto-sized by content — for step annotations near arrows. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['boardId', 'text', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_arrow',
    description:
      'Connect two points or objects. Endpoint = { x, y } for a free point, or { objectId, relativePoint: { x, y } } to attach (0..1 of object bounds; 0.5/1 = bottom center). Create endpoint objects FIRST — you need their ids.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        start: {
          type: 'object',
          description: '{ x, y } or { objectId, relativePoint: {x, y} }',
        },
        end: {
          type: 'object',
          description: '{ x, y } or { objectId, relativePoint: {x, y} }',
        },
        arrowType: { type: 'string', default: 'elbow', description: 'elbow, straight, curved' },
        strokeColor: { type: 'string', default: 'gray10' },
      },
      required: ['boardId', 'start', 'end'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_move_object',
    description: 'Move an object to new coordinates (top-left corner). Takes 1-3s.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['boardId', 'objectId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_resize_object',
    description: 'Change width and/or height of a shape or sticker.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_frame',
    description:
      'Add a large labeled container that sits BELOW content (groups a diagram). labelText is a plain field, no separate document. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        labelText: { type: 'string', default: 'Frame', description: 'Frame title' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 800 },
        height: { type: 'number', default: 600 },
        fillColor: { type: 'string', default: 'white3' },
      },
      required: ['boardId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_stamp',
    description:
      'Add an emoji / text stamp (e.g. "❤️", "🔥"). text = the emoji itself. ' + ADD_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Emoji or short text' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 60 },
        height: { type: 'number', default: 60 },
        stampType: { type: 'string', default: 'textStamp' },
      },
      required: ['boardId', 'text', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_set_color',
    description:
      'Set fillColor and/or strokeColor (palette names: yellow6, blue6, green6, red6, orange8, gray12, white6...). Full list: holst_reference.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        fillColor: { type: 'string' },
        strokeColor: { type: 'string' },
      },
      required: ['boardId', 'objectId'],
      additionalProperties: false,
    },
  },
];

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
    let result;
    switch (name) {
      case 'holst_whoami':
        result = await whoAmI();
        break;
      case 'holst_doctor':
        result = await doctor();
        break;
      case 'holst_reference':
        result = getReference();
        break;
      case 'holst_list_boards':
        result = await listBoards();
        break;
      case 'holst_get_board_content':
        result = await getBoardContent(args.boardId);
        break;
      case 'holst_get_board_summary':
        result = await getBoardSummary(args.boardId);
        break;
      case 'holst_search_text':
        result = await searchBoardText(args.boardId, args.query);
        break;
      case 'holst_add_sticker':
        result = await addSticker(args.boardId, args);
        break;
      case 'holst_update_text':
        result = await updateText(args.boardId, args.objectId, args.text);
        break;
      case 'holst_delete_object':
        result = await deleteObject(args.boardId, args.objectId);
        break;
      case 'holst_add_shape':
        result = await addShape(args.boardId, args);
        break;
      case 'holst_add_simple_text':
        result = await addSimpleText(args.boardId, args);
        break;
      case 'holst_add_arrow':
        result = await addArrow(args.boardId, args);
        break;
      case 'holst_move_object':
        result = await moveObject(args.boardId, args.objectId, { x: args.x, y: args.y });
        break;
      case 'holst_resize_object':
        result = await resizeObject(args.boardId, args.objectId, { width: args.width, height: args.height });
        break;
      case 'holst_set_color':
        result = await setColor(args.boardId, args.objectId, { fillColor: args.fillColor, strokeColor: args.strokeColor });
        break;
      case 'holst_add_frame':
        result = await addFrame(args.boardId, args);
        break;
      case 'holst_add_stamp':
        result = await addStamp(args.boardId, args);
        break;
      default:
        throw new Error('Unknown tool: ' + name);
    }
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
