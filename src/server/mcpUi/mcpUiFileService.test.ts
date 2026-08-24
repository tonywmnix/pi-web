import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_UI_DIR,
  isValidMcpUiFilename,
  mcpUiDir,
  McpUiFileNotFoundError,
  McpUiInvalidFilenameError,
  resolveMcpUiFilePath,
} from "./mcpUiFileService.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mcpUiDir", () => {
  it("uses PI_WEB_MCP_UI_DIR when set", () => {
    expect(mcpUiDir({ PI_WEB_MCP_UI_DIR: "/configured/ui" })).toBe("/configured/ui");
  });

  it("falls back to the default MCP UI directory", () => {
    expect(mcpUiDir({})).toBe(DEFAULT_MCP_UI_DIR);
  });

  it("treats an empty env value the same as unset", () => {
    expect(mcpUiDir({ PI_WEB_MCP_UI_DIR: "" })).toBe(DEFAULT_MCP_UI_DIR);
  });
});

describe("isValidMcpUiFilename", () => {
  it.each(["widget.html", "widget.HTML", "widget.htm", "2026-08-21T03-36-33_widget.html"])("accepts %s", (filename) => {
    expect(isValidMcpUiFilename(filename)).toBe(true);
  });

  it.each(["../secret.html", "sub/dir.html", "sub\\dir.html", "..", "a/../b.html", "", "widget.js", "widget.svg", "widget"])(
    "rejects %s",
    (filename) => {
      expect(isValidMcpUiFilename(filename)).toBe(false);
    },
  );
});

describe("resolveMcpUiFilePath", () => {
  async function tempUiDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-ui-"));
    tempRoots.push(root);
    return root;
  }

  it("resolves a file that exists inside the directory", async () => {
    const dir = await tempUiDir();
    await writeFile(join(dir, "widget.html"), "<p>hi</p>");
    await expect(resolveMcpUiFilePath(dir, "widget.html")).resolves.toBe(join(dir, "widget.html"));
  });

  it("rejects a filename that fails the allowlist before touching the filesystem", async () => {
    const dir = await tempUiDir();
    await expect(resolveMcpUiFilePath(dir, "../widget.html")).rejects.toBeInstanceOf(McpUiInvalidFilenameError);
  });

  it("rejects a non-HTML extension even if it otherwise looks like a safe basename", async () => {
    const dir = await tempUiDir();
    await writeFile(join(dir, "widget.js"), "alert(1)");
    await expect(resolveMcpUiFilePath(dir, "widget.js")).rejects.toBeInstanceOf(McpUiInvalidFilenameError);
  });

  it("reports a missing file as not found", async () => {
    const dir = await tempUiDir();
    await expect(resolveMcpUiFilePath(dir, "missing.html")).rejects.toBeInstanceOf(McpUiFileNotFoundError);
  });

  it("reports a missing base directory as not found", async () => {
    await expect(resolveMcpUiFilePath(join(tmpdir(), "pi-web-mcp-ui-does-not-exist"), "widget.html")).rejects.toBeInstanceOf(
      McpUiFileNotFoundError,
    );
  });

  it("rejects a directory entry even if named like a file", async () => {
    const dir = await tempUiDir();
    await mkdir(join(dir, "widget.html"));
    await expect(resolveMcpUiFilePath(dir, "widget.html")).rejects.toBeInstanceOf(McpUiFileNotFoundError);
  });

  it("rejects a validly-named symlink that escapes the configured directory", async () => {
    const dir = await tempUiDir();
    const outside = await tempUiDir();
    await writeFile(join(outside, "secret.html"), "<p>secret</p>");
    await symlink(join(outside, "secret.html"), join(dir, "escape.html"));
    await expect(resolveMcpUiFilePath(dir, "escape.html")).rejects.toThrow("Path escapes workspace");
  });
});
