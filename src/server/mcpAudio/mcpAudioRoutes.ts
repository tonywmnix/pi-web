import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  mcpAudioContentType,
  mcpAudioDir,
  McpAudioFileNotFoundError,
  McpAudioInvalidFilenameError,
  resolveMcpAudioFilePath,
} from "./mcpAudioFileService.js";

export interface McpAudioRouteOptions {
  /** Overrides the directory resolved from `PI_WEB_MCP_AUDIO_DIR`; primarily for tests. */
  audioDir?: string;
}

/** Serves audio files written by the openrouter-audio-mcp server so the chat transcript can play them inline. */
export function registerMcpAudioRoutes(app: FastifyInstance, options: McpAudioRouteOptions = {}): void {
  app.get<{ Params: { filename: string } }>("/api/mcp-audio/:filename", async (request, reply) => {
    const baseDir = options.audioDir ?? mcpAudioDir();
    try {
      const target = await resolveMcpAudioFilePath(baseDir, request.params.filename);
      const body = await readFile(target);
      return await reply
        .header("Content-Type", mcpAudioContentType(request.params.filename))
        .header("Content-Length", String(body.byteLength))
        .header("Cache-Control", "private, max-age=3600")
        .send(body);
    } catch (error) {
      if (error instanceof McpAudioInvalidFilenameError) return reply.code(400).send({ error: error.message });
      if (error instanceof McpAudioFileNotFoundError) return reply.code(404).send({ error: "Audio file not found" });
      request.log.error({ err: error }, "failed to serve MCP audio file");
      return reply.code(500).send({ error: "Failed to read audio file" });
    }
  });
}
