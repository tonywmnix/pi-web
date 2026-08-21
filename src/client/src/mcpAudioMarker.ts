/**
 * The MCP/session content pipeline has no audio content-part type, so an MCP tool
 * that generates audio instead emits a marker line (`AUDIO_FILE: <filename>`) inside
 * its ordinary text result. This module recognizes that marker so the chat transcript
 * can render a playable widget without a change to the upstream content protocol.
 */
export interface McpAudioMarker {
  /** Basename reported by the MCP tool; the caller is responsible for URL-encoding it. */
  filename: string;
  /** The tool result text with the marker line removed, for display alongside the widget. */
  textWithoutMarker: string;
}

const AUDIO_FILE_MARKER_LINE = /^AUDIO_FILE: (.+)$/;

/** Finds the first `AUDIO_FILE: <filename>` marker line in tool-result text, if any. */
export function parseMcpAudioMarker(text: string): McpAudioMarker | undefined {
  const lines = text.split("\n");
  const markerIndex = lines.findIndex((line) => AUDIO_FILE_MARKER_LINE.test(line.trim()));
  if (markerIndex === -1) return undefined;

  const match = AUDIO_FILE_MARKER_LINE.exec((lines[markerIndex] ?? "").trim());
  const filename = match?.[1]?.trim();
  if (filename === undefined || filename === "") return undefined;

  const remainingLines = [...lines.slice(0, markerIndex), ...lines.slice(markerIndex + 1)];
  return { filename, textWithoutMarker: remainingLines.join("\n").trim() };
}
