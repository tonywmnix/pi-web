import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ensureInside, isNodeErrorWithCode } from "../workspaces/pathSafety.js";

/** Falls back here when `PI_WEB_MCP_AUDIO_DIR` is unset, matching the openrouter-audio-mcp server's default output directory. */
export const DEFAULT_MCP_AUDIO_DIR = "/home/tony/mcp-servers/openrouter-audio-mcp/output";

// Filenames are basenames written by the MCP server (e.g. `<timestamp>_<model>.mp3`); no path separators are ever legitimate here.
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export class McpAudioInvalidFilenameError extends Error {}
export class McpAudioFileNotFoundError extends Error {}

/** Resolves the configured MCP audio output directory, defaulting when the env var is unset or empty. */
export function mcpAudioDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["PI_WEB_MCP_AUDIO_DIR"];
  return configured !== undefined && configured !== "" ? configured : DEFAULT_MCP_AUDIO_DIR;
}

export function isValidMcpAudioFilename(filename: string): boolean {
  return SAFE_FILENAME_PATTERN.test(filename) && !filename.includes("..");
}

/**
 * Validates and resolves an MCP audio filename to an absolute path inside `baseDir`.
 *
 * The allowlist regex alone would still accept a bare `..`, so traversal is rejected
 * explicitly, and the resolved path is confirmed to stay inside the realpath'd base
 * directory as a second, symlink-proof layer of defense.
 */
export async function resolveMcpAudioFilePath(baseDir: string, filename: string): Promise<string> {
  if (!isValidMcpAudioFilename(filename)) throw new McpAudioInvalidFilenameError(`Invalid audio filename: ${filename}`);

  const root = await realpath(baseDir).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new McpAudioFileNotFoundError("Audio directory not found");
    throw error;
  });
  const joined = join(root, filename);
  const target = await realpath(joined).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new McpAudioFileNotFoundError("Audio file not found");
    throw error;
  });
  ensureInside(root, target);

  const stats = await stat(target);
  if (!stats.isFile()) throw new McpAudioFileNotFoundError("Audio file not found");
  return target;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wave",
  pcm: "audio/pcm",
};

/** Content-Type for an MCP audio filename, based on its extension only (the caller has already validated the filename shape). */
export function mcpAudioContentType(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex === -1 ? "" : filename.slice(dotIndex + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}
