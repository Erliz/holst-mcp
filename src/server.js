#!/usr/bin/env node
// Holst MCP server: read & write to Holst.so boards via local desktop CDP.
// Requires Holst desktop running with --remote-debugging-port=9222 and user logged in.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
} from './holst.js';

const server = new Server(
  { name: 'holst-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: 'holst_whoami',
    description:
      'Возвращает информацию о текущем залогиненном пользователе Holst. Используй для проверки, что MCP подключен и авторизация работает.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_list_boards',
    description:
      'Список всех досок и папок, доступных пользователю. Возвращает: пользователь, recent boards, и для каждого workspace — дерево досок/папок.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'holst_get_board_content',
    description:
      'Полный сырой Yjs-дамп доски: все объекты (стикеры, секции, стрелки, тексты) с координатами, и все документы (тексты). Возвращает { meta, content: { documents, objects, ... } }.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string', description: 'UUID доски (из URL board/{id})' },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_get_board_summary',
    description:
      'Структурированный markdown-дамп: стикеры сгруппированы по ближайшему shape-заголовку (секции). Удобно для чтения и работы с доской.',
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
      'Поиск по тексту всех объектов доски (стикеры, секции, простой текст). Возвращает массив совпадений с ID, типом, координатами и сниппетом.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        query: { type: 'string', description: 'Подстрока для поиска (case-insensitive)' },
      },
      required: ['boardId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_add_sticker',
    description:
      'Добавить стикер на доску. Изменения синкаются автоматически. По умолчанию 192×192 в координатах x,y. Требуется чтобы пользователь имел права на запись (admin/editor).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Текст стикера' },
        x: { type: 'number', description: 'X-координата на холсте' },
        y: { type: 'number', description: 'Y-координата на холсте' },
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
      'Изменить текст существующего объекта (стикер, секция-заголовок, простой текст). objectId берётся из get_board_content.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        objectId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['boardId', 'objectId', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_delete_object',
    description: 'Удалить объект с доски (стикер, секцию, текст, стрелку). Также удаляет связанный документ.',
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
      'Добавить shape (фигуру) с текстовым лейблом — используется для секций-заголовков. По умолчанию белый прямоугольник с серой рамкой 240×48. Для других цветов: yellow6, blue6, green6, red6, orange8, gray12 и т.п.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Текст внутри фигуры' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 240 },
        height: { type: 'number', default: 48 },
        shapeType: { type: 'string', default: 'square', description: 'square, circle, round-rect, rhombus, triangle' },
        fillColor: { type: 'string', default: 'white6' },
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
    description: 'Добавить простой текстовый лейбл (без фона). Размер автоматический по содержимому.',
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
      'Добавить стрелку между двумя точками или объектами. Endpoint = либо { x, y } для свободной точки, либо { objectId, relativePoint: { x, y } } для прикрепления к объекту (relativePoint = 0..1, где 0.5/0.5 — центр).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        start: {
          type: 'object',
          description: '{ x, y } или { objectId, relativePoint: {x, y} }',
        },
        end: {
          type: 'object',
          description: '{ x, y } или { objectId, relativePoint: {x, y} }',
        },
        arrowType: {
          type: 'string',
          default: 'elbow',
          description: 'elbow, straight, curved',
        },
        strokeColor: { type: 'string', default: 'gray10' },
      },
      required: ['boardId', 'start', 'end'],
      additionalProperties: false,
    },
  },
  {
    name: 'holst_move_object',
    description: 'Переместить объект на новые координаты. Работает для любого типа.',
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
    description: 'Изменить размер объекта (для shape, sticker). Передавай width/height/оба.',
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
      'Добавить фрейм — большой контейнер с подписью. Используется для группировки содержимого. labelText лежит в самом объекте, без отдельного документа. По умолчанию 800×600, садится ПОД остальные объекты (zIndex отрицательный) чтобы не закрывать контент.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        labelText: { type: 'string', default: 'Frame', description: 'Подпись фрейма' },
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
      'Добавить штамп / эмодзи на доску. По умолчанию 60×60. Поле text — любой эмодзи или короткий текст ("❤️", "🔥", "👍", "🐈" и т.п.).',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        text: { type: 'string', description: 'Эмодзи или короткий текст' },
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
      'Установить fillColor и/или strokeColor. Цвета — palette-имена (yellow6, blue6, green6, red6, orange8, gray12, white6 и т.п.).',
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

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result;
    switch (name) {
      case 'holst_whoami':
        result = await whoAmI();
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
      content: [{ type: 'text', text: `Error: ${e.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[holst-mcp] connected via stdio');
