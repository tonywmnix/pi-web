/**
 * Same workaround as `mcpAudioMarker.ts`: the MCP/session content pipeline has no resource
 * content-part type (the underlying SDK's tool-result content is text/image only), so an MCP
 * tool that wants to surface an interactive HTML widget instead writes the HTML to the
 * configured MCP UI directory and emits a marker line (`UI_HTML_FILE: <filename>`) inside its
 * ordinary text result. This module recognizes that marker so the chat transcript can render
 * the widget in a sandboxed iframe without a change to the upstream content protocol.
 */
export interface McpUiMarker {
  /** Basename reported by the MCP tool; the caller is responsible for URL-encoding it. */
  filename: string;
  /** The tool result text with the marker line removed, for display alongside the widget. */
  textWithoutMarker: string;
}

const UI_HTML_FILE_MARKER_LINE = /^UI_HTML_FILE: (.+)$/;

/** Finds the first `UI_HTML_FILE: <filename>` marker line in tool-result text, if any. */
export function parseMcpUiMarker(text: string): McpUiMarker | undefined {
  const lines = text.split("\n");
  const markerIndex = lines.findIndex((line) => UI_HTML_FILE_MARKER_LINE.test(line.trim()));
  if (markerIndex === -1) return undefined;

  const match = UI_HTML_FILE_MARKER_LINE.exec((lines[markerIndex] ?? "").trim());
  const filename = match?.[1]?.trim();
  if (filename === undefined || filename === "") return undefined;

  const remainingLines = [...lines.slice(0, markerIndex), ...lines.slice(markerIndex + 1)];
  return { filename, textWithoutMarker: remainingLines.join("\n").trim() };
}
