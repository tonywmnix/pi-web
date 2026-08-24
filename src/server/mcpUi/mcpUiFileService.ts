import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ensureInside, isNodeErrorWithCode } from "../workspaces/pathSafety.js";

/** Falls back here when `PI_WEB_MCP_UI_DIR` is unset. Distinct from the MCP audio default: there is no
 * companion MCP-UI server shipping today, so this just needs a stable, PI WEB-owned location. */
export const DEFAULT_MCP_UI_DIR = "/home/tony/.pi-web/mcp-ui";

// Filenames are basenames an MCP tool writes for us to serve back (e.g. `<timestamp>_<widget>.html`);
// no path separators are ever legitimate here.
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// Resource content is rendered inside a sandboxed iframe with no server-side sanitization, so only an
// explicit, narrow set of file types the renderer knows how to sandbox is servable at all.
const SERVABLE_EXTENSIONS = new Set(["html", "htm"]);

export class McpUiInvalidFilenameError extends Error {}
export class McpUiFileNotFoundError extends Error {}

/** Resolves the configured MCP UI resource directory, defaulting when the env var is unset or empty. */
export function mcpUiDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["PI_WEB_MCP_UI_DIR"];
  return configured !== undefined && configured !== "" ? configured : DEFAULT_MCP_UI_DIR;
}

export function isValidMcpUiFilename(filename: string): boolean {
  if (!SAFE_FILENAME_PATTERN.test(filename) || filename.includes("..")) return false;
  return SERVABLE_EXTENSIONS.has(extensionOf(filename));
}

/**
 * Validates and resolves an MCP UI resource filename to an absolute path inside `baseDir`.
 *
 * The allowlist regex alone would still accept a bare `..`, so traversal is rejected
 * explicitly, and the resolved path is confirmed to stay inside the realpath'd base
 * directory as a second, symlink-proof layer of defense.
 */
export async function resolveMcpUiFilePath(baseDir: string, filename: string): Promise<string> {
  if (!isValidMcpUiFilename(filename)) throw new McpUiInvalidFilenameError(`Invalid UI resource filename: ${filename}`);

  const root = await realpath(baseDir).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new McpUiFileNotFoundError("UI resource directory not found");
    throw error;
  });
  const joined = join(root, filename);
  const target = await realpath(joined).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) throw new McpUiFileNotFoundError("UI resource file not found");
    throw error;
  });
  ensureInside(root, target);

  const stats = await stat(target);
  if (!stats.isFile()) throw new McpUiFileNotFoundError("UI resource file not found");
  return target;
}

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex + 1).toLowerCase();
}
