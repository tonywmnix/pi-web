import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  McpUiFileNotFoundError,
  McpUiInvalidFilenameError,
  mcpUiDir,
  resolveMcpUiFilePath,
} from "./mcpUiFileService.js";

export interface McpUiRouteOptions {
  /** Overrides the directory resolved from `PI_WEB_MCP_UI_DIR`; primarily for tests. */
  uiDir?: string;
}

/**
 * Serves HTML resources an MCP tool wrote to the configured directory via the `UI_HTML_FILE:`
 * marker convention, so the chat transcript can render them inline in a sandboxed iframe.
 *
 * The response is deliberately locked down for content the server never sanitizes: `frame-ancestors
 * 'self'` (plus `X-Frame-Options: SAMEORIGIN`) so only PI WEB's own iframe can embed it, and a CSP
 * that forbids the document from reaching out to anything but inline styles/scripts and data URIs.
 * The client-side iframe adds the second, primary layer of isolation (`sandbox="allow-scripts"`
 * with no `allow-same-origin`), which is what keeps the resource from ever holding PI WEB session
 * credentials even if these headers were bypassed.
 */
export function registerMcpUiRoutes(app: FastifyInstance, options: McpUiRouteOptions = {}): void {
  app.get<{ Params: { filename: string } }>("/api/mcp-ui/:filename", async (request, reply) => {
    const baseDir = options.uiDir ?? mcpUiDir();
    try {
      const target = await resolveMcpUiFilePath(baseDir, request.params.filename);
      const body = await readFile(target);
      return await reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Length", String(body.byteLength))
        .header("Cache-Control", "private, max-age=3600")
        .header("X-Frame-Options", "SAMEORIGIN")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; frame-ancestors 'self'")
        .send(body);
    } catch (error) {
      if (error instanceof McpUiInvalidFilenameError) return reply.code(400).send({ error: error.message });
      if (error instanceof McpUiFileNotFoundError) return reply.code(404).send({ error: "UI resource not found" });
      request.log.error({ err: error }, "failed to serve MCP UI resource");
      return reply.code(500).send({ error: "Failed to read UI resource" });
    }
  });
}
