// Pure shaping of a tool handler's result into an MCP CallToolResult body.
// Extracted from server.js so the summary special-case, the screenshot
// { __image } envelope → [text, image] conversion and the JSON default are
// unit-testable without booting the stdio server.

export function toToolResult(result, toolName) {
  if (toolName === 'holst_get_board_summary' && result?.summary) {
    return { content: [{ type: 'text', text: result.summary }] };
  }
  if (result && result.__image) {
    const { __image, ...rest } = result;
    return {
      content: [
        { type: 'text', text: JSON.stringify(rest, null, 2) },
        { type: 'image', data: __image.data, mimeType: __image.mimeType },
      ],
    };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
